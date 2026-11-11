"""Decode a Metal/Ricbi garage backup (ricbi/ data folder) into CSVs.

usage: python3 -I decode_ricbi.py <ricbi dir> <edit dir (.car logs)> <out dir>

Record layouts were reverse-engineered from the 2026-11-09 backup:
fixed-size records of Pascal short strings (1 length byte + cp1255 text).
"""
import csv, os, re, sys, collections

SRC, EDIT, OUT = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)


def ps(r, o):
    n = r[o]
    return r[o + 1:o + 1 + n].decode('cp1255', 'replace').strip()


def records(name, size):
    d = open(os.path.join(SRC, name), 'rb').read()
    for k in range(len(d) // size):
        yield d[k * size:(k + 1) * size]


def ddmmyyyy(s):
    m = re.fullmatch(r'(\d\d)/(\d\d)/(\d{4})', s or '')
    return f'{m[3]}-{m[2]}-{m[1]}' if m else ''


def write(name, header, rows):
    with open(os.path.join(OUT, name), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f'{name}: {len(rows)} rows')


DOC_TYPES = {'001': 'חשבונית מס', '002': 'חשבונית מס קבלה', '003': 'חש.זיכוי',
             '006': 'הצעת מחיר', '008': 'חש.ספק', '010': 'כרטיס עבודה'}

# ---- manufacturers (tvw.md: string[30] slots from 3131) and models (degemw.md: 3102-byte
# block per manufacturer, model j at 31 + (j-1)*31) ----
tv = open(os.path.join(SRC, 'tvw.md'), 'rb').read()
dg = open(os.path.join(SRC, 'degemw.md'), 'rb').read()


def manufacturer(code):
    if not code.isdigit():
        return ''
    o = 3131 + int(code) * 31
    return ps(tv, o) if o + 31 <= len(tv) and tv[o] < 31 else ''


def model(mcode, code):
    if not (mcode.isdigit() and code.isdigit()) or int(code) < 1:
        return ''
    o = int(mcode) * 3102 + 31 + (int(code) - 1) * 31
    return ps(dg, o) if o + 31 <= len(dg) and dg[o] < 31 else ''


# ---- customers (cardl.md, 669 bytes) ----
customers = []
for r in records('cardl.md', 669):
    if not r[0]:
        continue
    customers.append([ps(r, 0), ps(r, 11), ps(r, 64), ps(r, 80), ps(r, 113), ps(r, 129),
                      ps(r, 145), ps(r, 208), ps(r, 249), ddmmyyyy(ps(r, 655)), ddmmyyyy(ps(r, 621)),
                      {2: 'customer', 5: 'supplier'}.get(r[262], f'other{r[262]}')])
write('customers.csv', ['legacy_id', 'name', 'city', 'address', 'phone1', 'phone2', 'phone3',
                        'email', 'id_number', 'opened', 'last_activity', 'account_kind'], customers)

# ---- cars (zi.md, 1051 bytes) ----
cars = []
for r in records('zi.md', 1051):
    if not r[0]:
        continue
    mc, mo = ps(r, 26), ps(r, 52)
    cars.append([ps(r, 0), mc, manufacturer(mc), mo, model(mc, mo), ps(r, 78), ps(r, 104),
                 ps(r, 390), ps(r, 182), ps(r, 208), ddmmyyyy(ps(r, 754)), ddmmyyyy(ps(r, 780))])
write('cars.csv', ['plate', 'manufacturer_code', 'manufacturer', 'model_code', 'model', 'year',
                   'engine_code', 'km', 'legacy_customer_id', 'owner_name', 'last_visit',
                   'next_service'], cars)

# ---- per-car logs: card -> invoice closures and cancelled documents ----
closed_into, cancelled = {}, set()
name_to_type = {v: k for k, v in DOC_TYPES.items()}
for f in os.listdir(EDIT):
    text = open(os.path.join(EDIT, f), 'rb').read().decode('cp1255', 'replace')
    for m in re.finditer(r'סגירת כרטיס עבודה (\d+) ל(.+?) (\d+) \d\d/', text):
        t = name_to_type.get(m[2])
        if t:
            closed_into['010' + m[1].zfill(7)] = t + m[3].zfill(7)
    for m in re.finditer(r'ביטול (.+?) (\d+) ', text):
        t = name_to_type.get(m[1])
        if t:
            cancelled.add(t + m[2].zfill(7))

# ---- document headers (crd.md, 1282 bytes) ----
headers = {}
for r in records('crd.md', 1282):
    doc = ps(r, 668)
    if not doc:
        continue
    headers[doc] = dict(plate=ps(r, 18), model_code=ps(r, 62), km=ps(r, 91), cust=ps(r, 112),
                        name=ps(r, 126), phone=ps(r, 232), date_in=ddmmyyyy(ps(r, 316)),
                        date_out=ddmmyyyy(ps(r, 337)), time_in=ps(r, 358), time_out=ps(r, 379),
                        year=ps(r, 711), next_service=ddmmyyyy(ps(r, 804)))


# ---- document lines (crd.mc, 191 bytes) ----
def num(s):
    try:
        return float(s)
    except ValueError:
        return None


def parse_line(raw):
    """A line is cell text joined by 0xFF, each later cell led by its column tag byte."""
    parts = raw.split(b'\xff')
    cells = {0: parts[0].decode('cp1255', 'replace').strip()}
    for p in parts[1:]:
        if p:
            cells[p[0]] = p[1:].decode('cp1255', 'replace').strip()
    if 5 in cells or 7 in cells:          # card heading: complaint + department
        return dict(kind='heading', sku='', text=cells[0], dept=cells.get(5, ''))
    sku, text = ('', cells[0])
    if 1 in cells:
        sku, text = cells[0], cells[1]
    if 6 in cells:
        qty = num(cells[6])
    else:
        qty = num(cells.get(4, ''))
    price = num(cells.get(8, ''))
    if 14 in cells:
        disc, total = num(cells.get(13, '')), num(cells[14])
    else:
        disc, total = None, num(cells.get(13, ''))
    kind = 'item' if price is not None or total is not None else 'text'
    return dict(kind=kind, sku=sku, text=text, qty=qty, price=price, disc=disc, total=total)


lines = collections.defaultdict(list)
for r in records('crd.mc', 191):
    doc = ps(r, 101)
    if doc:
        lines[doc].append((r[1:1 + r[0]], ps(r, 112), ps(r, 121), ps(r, 130), ps(r, 171)))

visits, vlines, skipped = [], [], collections.Counter()
for doc, ls in sorted(lines.items()):
    t = doc[:3]
    if t not in ('001', '002', '010'):
        skipped[DOC_TYPES.get(t, t)] += 1
        continue
    if doc in cancelled:
        skipped['מבוטל'] += 1
        continue
    h = headers.get(doc, {})
    _, ymd, cust, name, plate = ls[0]
    date = h.get('date_in') or (f'{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}' if len(ymd) == 8 else '')
    parsed = [parse_line(x[0]) for x in ls]
    title = next((p['text'] for p in parsed if p['kind'] == 'heading'), '')
    total = sum(p.get('total') or 0 for p in parsed if p['kind'] == 'item')
    visits.append([doc, DOC_TYPES[t], int(doc[3:]), date, h.get('date_out', ''),
                   h.get('plate') or plate, h.get('cust') or cust, h.get('name') or name,
                   h.get('phone', ''), h.get('km', ''), title, closed_into.get(doc, ''),
                   f'{total:.2f}'])
    for i, p in enumerate(parsed):
        vlines.append([doc, i, p['kind'], p['sku'], p['text'], p.get('qty'), p.get('price'),
                       p.get('disc'), p.get('total')])

write('visits.csv', ['legacy_doc', 'doc_type', 'number', 'date_in', 'date_out', 'plate',
                     'legacy_customer_id', 'customer_name', 'phone', 'km', 'title',
                     'closed_into_invoice', 'lines_total'], visits)
write('visit_lines.csv', ['legacy_doc', 'position', 'kind', 'sku', 'description', 'qty',
                          'unit_price', 'discount_pct', 'line_total'], vlines)
print('skipped documents:', dict(skipped))
