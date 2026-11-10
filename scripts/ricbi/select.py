"""Apply the garage's import rules to the decoded CSVs and write import.json.

usage: python3 -I select_import.py <decoded dir> <since YYYY-MM-DD> <out json>

Rules (agreed 2026-11-10):
- customers: not suppliers, not the walk-in account "מזדמן", must have a phone;
  same name + same phone (compared like the app does) merge into one customer.
- cars: only cars whose owner is an imported customer.
- history: only work cards (010), from <since> on, on an imported car.
- suppliers: the list only (no documents).
"""
import csv, json, re, sys, collections

SRC, SINCE, OUT = sys.argv[1:4]
rd = lambda f: list(csv.DictReader(open(f'{SRC}/{f}', encoding='utf-8-sig')))
name_key = lambda n: re.sub(r'\s+', ' ', n.strip()).lower()
digits = lambda p: re.sub(r'\D', '', p or '')

accounts = rd('customers.csv')
stats = collections.Counter()


def main_phone(c):
    # phone2 is the mobile slot in the old program and the one most often filled
    return next((p for p in (c['phone2'], c['phone1'], c['phone3']) if digits(p)), '')


# ---- customers, merged on name + phone ----
by_key, customer_of = {}, {}            # merge key -> customer, legacy id -> merge key
for c in accounts:
    if c['account_kind'] == 'supplier':
        continue
    if name_key(c['name']) in ('מזדמן', ''):
        stats['customer: walk-in / no name'] += 1
        continue
    phone = main_phone(c)
    if not phone:
        stats['customer: no phone'] += 1
        continue
    key = (name_key(c['name']), digits(phone))
    other = [p for p in (c['phone1'], c['phone2'], c['phone3']) if digits(p) and digits(p) != digits(phone)]
    if key in by_key:
        m = by_key[key]
        stats['customer: merged into another'] += 1
        m['legacy_ids'].append(c['legacy_id'])
        for f in ('email', 'id_number', 'city', 'address'):
            m[f] = m[f] or c[f]
        m['other_phones'] += [p for p in other if p not in m['other_phones']]
    else:
        by_key[key] = dict(legacy_ids=[c['legacy_id']], name=c['name'].strip(), phone=phone,
                           other_phones=other, email=c['email'], id_number=c['id_number'],
                           city=c['city'], address=c['address'])
    customer_of[c['legacy_id']] = key

# ---- cars of imported customers ----
cars = {}
for car in rd('cars.csv'):
    key = customer_of.get(car['legacy_customer_id'])
    if not key:
        stats['car: owner not imported'] += 1
        continue
    cars[car['plate']] = dict(plate=car['plate'], manufacturer=car['manufacturer'],
                              model=car['model'], year=car['year'], km=car['km'], owner=key)

# customers are kept only if they own an imported car
owners = {c['owner'] for c in cars.values()}
stats['customer: no car'] = sum(1 for k in by_key if k not in owners)
customers = {k: v for k, v in by_key.items() if k in owners}

# ת״ז / company number is unique per garage: the first holder keeps it.
seen_ids = set()
for v in customers.values():
    n = digits(v['id_number'])
    if len(n) < 5 or n in seen_ids:
        if v['id_number']:
            stats['customer: id number dropped (blank-ish or held by another)'] += 1
        v['id_number'] = ''
    else:
        seen_ids.add(n)
        v['id_number'] = n
    v['kind'] = 'business' if re.search(r'בע"?מ', v['name']) or re.fullmatch(r'5\d{8}', v['id_number']) else 'private'

# ---- work cards ----
lines = collections.defaultdict(list)
for l in rd('visit_lines.csv'):
    lines[l['legacy_doc']].append(l)

cards = []
for v in rd('visits.csv'):
    if v['doc_type'] != 'כרטיס עבודה':
        continue
    if v['date_in'] < SINCE:
        stats['card: older than cutoff'] += 1
        continue
    if v['plate'] not in cars:
        stats['card: car not imported'] += 1
        continue
    key = customer_of.get(v['legacy_customer_id'])
    cards.append(dict(number=v['number'], date_in=v['date_in'], date_out=v['date_out'],
                      plate=v['plate'], km=v['km'], title=v['title'],
                      customer=list(key) if key in customers else None,
                      customer_name=v['customer_name'], phone=v['phone'],
                      invoice=v['closed_into_invoice'],
                      lines=[{k: l[k] for k in ('kind', 'sku', 'description', 'qty', 'unit_price',
                                                 'discount_pct', 'line_total')}
                             for l in lines[v['legacy_doc']]]))

suppliers = {}
for c in accounts:
    if c['account_kind'] != 'supplier' or not c['name'].strip():
        continue
    if name_key(c['name']) in suppliers:
        stats['supplier: same name merged'] += 1
        continue
    suppliers[name_key(c['name'])] = dict(
        legacy_id=c['legacy_id'], name=c['name'].strip(), tax_id=digits(c['id_number']),
        phone=main_phone(c), email=c['email'],
        address=', '.join(x for x in (c['address'], c['city']) if x))
suppliers = list(suppliers.values())

out = dict(customers=[dict(v, key=list(k)) for k, v in customers.items()],
           cars=[dict(c, owner=list(c['owner'])) for c in cars.values()],
           cards=cards, suppliers=suppliers)
json.dump(out, open(OUT, 'w'), ensure_ascii=False)
for k in ('customers', 'cars', 'cards', 'suppliers'):
    print(f'{k}: {len(out[k])}')
print('cards whose customer is not the imported owner:', sum(1 for c in cards if c['customer'] is None))
print('cars with history:', len({c["plate"] for c in cards}))
for k, v in sorted(stats.items()):
    print(f'  {k}: {v}')
