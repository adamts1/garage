-- ============================================================
--  vehicles  (a customer's cars, for ticket auto-complete)
--  The customers table is NOT touched. A customer has many
--  vehicles; a new ticket fills plate / make / model / year / km
--  from the chosen vehicle.
--  Paste into Supabase SQL Editor and Run. Safe to re-run.
-- ============================================================

drop table if exists public.vehicles cascade;

create table public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  plate         text not null,
  manufacturer  text,
  model         text,
  year          text,
  km            text,
  vehicle_code  text,
  created_at    timestamptz not null default now()
);
create index vehicles_customer_id_idx on public.vehicles (customer_id);
create index vehicles_plate_idx       on public.vehicles (plate);

-- RLS: demo policy, same as the other tables
alter table public.vehicles enable row level security;
create policy demo_all on public.vehicles for all using (true) with check (true);

-- realtime
alter table public.vehicles replica identity full;
alter publication supabase_realtime add table public.vehicles;

-- ---------- populate ----------
-- matched to each customer by name; cars line up with the seeded tickets,
-- plus a few second cars / fleet vehicles so multi-vehicle pick is real.
insert into public.vehicles (customer_id, plate, manufacturer, model, year, km)
select c.id, v.plate, v.manufacturer, v.model, v.year, v.km
from (values
  ('יוסי לוי',                '12-345-67', 'טויוטה',  'קורולה',   '2019', '112,400'),
  ('יוסי לוי',                '84-220-15', 'סוזוקי',  'איגניס',   '2022', '28,900'),
  ('חברת דלתא הובלות בע״מ',   '45-901-23', 'פורד',    'טרנזיט',   '2016', '248,900'),
  ('חברת דלתא הובלות בע״מ',   '45-902-24', 'פורד',    'טרנזיט',   '2018', '176,400'),
  ('חברת דלתא הובלות בע״מ',   '62-330-77', 'מרצדס',   'ספרינטר',  '2019', '210,300'),
  ('אבי פרידמן',              '63-820-11', 'מאזדה',   'CX-5',     '2018', '96,200'),
  ('מוחמד עלי',               '30-555-90', 'קיה',     'ספורטג׳',  '2017', '134,700'),
  ('שרה כהן',                 '88-221-04', 'יונדאי',  'i20',      '2020', '71,300'),
  ('רונית ברק',               '61-430-18', 'מאזדה',   '3',        '2021', '54,100'),
  ('מוסך שלום הסעות בע״מ',     '33-410-88', 'מרצדס',   'ספרינטר',  '2017', '320,500'),
  ('מוסך שלום הסעות בע״מ',     '33-411-89', 'וולוו',   '9700',     '2015', '540,000'),
  ('מוסך שלום הסעות בע״מ',     '71-205-63', 'יונדאי',  'H1',       '2020', '132,000'),
  ('ליאת דגן',                '51-778-20', 'יונדאי',  'i35',      '2016', '143,200'),
  ('דוד אזולאי',              '77-654-32', 'סקודה',   'אוקטביה',  '2019', '88,900'),
  ('אולגה פטרוב',             '25-118-73', 'רנו',     'קליאו',    '2018', '102,500'),
  ('כרים חדאד',               '39-702-56', 'פיאט',    '500',      '2019', '84,300'),
  ('נועם בר אל',              '22-114-88', 'סקודה',   'אוקטביה',  '2017', '119,000')
) as v(cust, plate, manufacturer, model, year, km)
join public.customers c on c.name = v.cust;
