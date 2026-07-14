-- ============================================================
--  מערכת מוסך — Supabase schema
--  Paste this whole file into the Supabase SQL Editor and Run.
--  Safe to re-run: it drops and recreates everything.
-- ============================================================

create extension if not exists pgcrypto;

drop table if exists public.work_items cascade;
drop table if exists public.works      cascade;
drop table if exists public.tickets    cascade;
drop table if exists public.items      cascade;
drop table if exists public.customers  cascade;

-- ---------- customers ----------
create table public.customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  email      text,
  address    text,
  city       text,
  kind       text not null default 'פרטי',   -- פרטי | עסקי
  created_at timestamptz not null default now()
);

-- ---------- items (parts / inventory catalog) ----------
create table public.items (
  id         uuid primary key default gen_random_uuid(),
  sku        text not null unique,
  name       text not null,
  price      numeric(10,2) not null default 0,
  stock      integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- tickets ----------
create table public.tickets (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,                    -- GAR-142
  job           text,                                    -- W-1042
  status        text not null default 'todo'    check (status   in ('todo','diag','appr','prog','parts','qa','done')),
  type          text not null default 'job'     check (type     in ('job','diag','part','quote','test')),
  epic          text not null default 'service' check (epic     in ('brakes','engine','service','ac','susp','elec','body')),
  priority      text not null default 'med'     check (priority in ('urgent','high','med','low')),
  assignee      text not null default 'dk'      check (assignee in ('dk','il','ns','am')),
  points        integer not null default 3,
  title         text not null,
  plate         text,
  car           text,
  customer_id   uuid references public.customers(id) on delete set null,
  customer_name text,                                    -- denormalised: the board renders with no join
  phone         text,
  email         text,
  address       text,
  km            text,
  year          text,
  amount        numeric(10,2) not null default 0,
  done          integer not null default 0,              -- how many subtasks are checked
  subtasks      text[] not null default '{}',
  flags         text[] not null default '{}',
  due           text,
  blocked       text,
  notes         text,
  paid          boolean not null default false,
  pay_method    text,
  doc           text,
  reference     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index tickets_status_idx      on public.tickets (status);
create index tickets_customer_id_idx on public.tickets (customer_id);

-- ---------- works (a job line on a ticket) ----------
create table public.works (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets(id) on delete cascade,
  uid        text not null,                              -- the id the UI uses client-side
  code       text,
  name       text not null,
  labor      numeric(10,2) not null default 0,
  custom     boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index works_ticket_id_idx on public.works (ticket_id);

-- ---------- work_items (the parts a work consumes) ----------
create table public.work_items (
  id       uuid primary key default gen_random_uuid(),
  work_id  uuid not null references public.works(id) on delete cascade,
  sku      text,
  name     text not null,
  qty      numeric(10,2) not null default 1,
  price    numeric(10,2) not null default 0,
  position integer not null default 0
);
create index work_items_work_id_idx on public.work_items (work_id);

-- ---------- keep updated_at honest ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger tickets_touch_updated_at
  before update on public.tickets
  for each row execute function public.touch_updated_at();

-- ============================================================
--  RLS — DEMO ONLY: anyone with the anon key can read + write.
--  Before this ever sees real customers, replace these policies
--  with auth-based ones (e.g. `using (auth.uid() is not null)`).
-- ============================================================
alter table public.customers  enable row level security;
alter table public.items      enable row level security;
alter table public.tickets    enable row level security;
alter table public.works      enable row level security;
alter table public.work_items enable row level security;

create policy demo_all on public.customers  for all using (true) with check (true);
create policy demo_all on public.items      for all using (true) with check (true);
create policy demo_all on public.tickets    for all using (true) with check (true);
create policy demo_all on public.works      for all using (true) with check (true);
create policy demo_all on public.work_items for all using (true) with check (true);

-- ============================================================
--  Realtime — broadcast every insert/update/delete on these tables.
--  replica identity full => DELETE payloads carry the old row.
-- ============================================================
alter table public.customers  replica identity full;
alter table public.items      replica identity full;
alter table public.tickets    replica identity full;
alter table public.works      replica identity full;
alter table public.work_items replica identity full;

alter publication supabase_realtime add table public.customers;
alter publication supabase_realtime add table public.items;
alter publication supabase_realtime add table public.tickets;
alter publication supabase_realtime add table public.works;
alter publication supabase_realtime add table public.work_items;

-- ============================================================
--  SEED — the same demo data the app used to hold in memory
-- ============================================================

insert into public.customers (name, phone, email, city, kind) values
  ('יוסי לוי',           '050-1234567', 'yossi@example.com',  'תל אביב',   'פרטי'),
  ('חברת דלתא בע״מ',     '03-7654321',  'office@delta.co.il', 'חולון',     'עסקי'),
  ('א. פרידמן',          '052-9988776', null,                 'רמת גן',    'פרטי'),
  ('מוחמד עלי',          '054-3344556', null,                 'יפו',       'פרטי'),
  ('שרה כהן',            '053-1122334', 'sarah@example.com',  'ראשל״צ',    'פרטי'),
  ('רונית ברק',          '050-7778889', null,                 'הרצליה',    'פרטי'),
  ('נועם ברק',           '052-4445556', null,                 'גבעתיים',   'פרטי'),
  ('ליאת דגן',           '054-6667778', null,                 'בת ים',     'פרטי');

insert into public.items (sku, name, price, stock) values
  ('OIL-530', 'שמן מנוע 5W-30 (ליטר)',  45,  40),
  ('FLT-OIL', 'פילטר שמן',              65,  14),
  ('FLT-AIR', 'פילטר אוויר',            90,  12),
  ('FLT-CAB', 'מסנן אבקנים',            75,   9),
  ('BRK-F22', 'רפידות בלם קדמי',       240,   7),
  ('DSC-F10', 'דיסקיות בלם קדמי',      180,   6),
  ('BRK-R18', 'רפידות בלם אחורי',      190,   5),
  ('DSC-R08', 'דיסקיות בלם אחורי',     150,   4),
  ('FLD-BRK', 'נוזל בלמים DOT4',        35,  20),
  ('BAT-70A', 'מצבר 70 אמפר',          520,   3),
  ('GAS-134', 'גז מזגן R134',          220,   8),
  ('SHK-R09', 'בולם זעזועים אחורי',    360,   0),
  ('MNT-R01', 'תותב בולם',              45,  10),
  ('TIM-KIT', 'ערכת רצועת טיימינג',    890,   2),
  ('PMP-WTR', 'משאבת מים',             320,   3),
  ('CLT-FRD', 'ערכת מצמד מלאה',       1650,   0),
  ('BRG-CLT', 'מיסב מצמד',             180,   4),
  ('BLB-H7',  'נורת הלוגן H7',          25,  24),
  ('WPR-BLD', 'מגבי שמשה (זוג)',        80,  11);

-- tickets: customer_id is resolved by name from the rows above
insert into public.tickets
  (key, job, status, type, epic, priority, points, assignee, title, plate, car,
   customer_id, customer_name, amount, done, subtasks, flags, due, blocked)
select v.key, v.job, v.status, v.type, v.epic, v.priority, v.points, v.assignee,
       v.title, v.plate, v.car, c.id, v.customer_name, v.amount, v.done,
       v.subtasks, v.flags, v.due, v.blocked
from (values
  ('GAR-142','W-1042','prog', 'job',  'brakes', 'urgent',5,'dk',
   'רעש חריקה בבלימה — החלפת רפידות ודיסקיות קדמיות','12-345-67','טויוטה קורולה','יוסי לוי',2340,3,
   array['פירוק גלגלים קדמיים','מדידת עובי דיסקית','החלפת רפידות','הרכבה ומומנט','נסיעת מבחן'],
   array['VIP','ממתין בבית'],'היום 16:00',null),

  ('GAR-143','W-1042','prog', 'job',  'service','med',   3,'dk',
   'טיפול 100,000 ק״מ — שמן, פילטרים ונוזלים','12-345-67','טויוטה קורולה','יוסי לוי',640,3,
   array['החלפת שמן מנוע','פילטר שמן ואוויר','בדיקת נוזלים'],
   array[]::text[],'היום 16:00',null),

  ('GAR-138','W-1043','appr', 'quote','engine', 'urgent',8,'il',
   'החלפת מצמד מלא — פורד טרנזיט','45-901-23','פורד טרנזיט','חברת דלתא בע״מ',2890,0,
   array['פירוק תיבת הילוכים','החלפת ערכת מצמד','הרכבה','נסיעת מבחן'],
   array['VIP','ממתין יומיים'],'עבר יומיים',null),

  ('GAR-139','W-1043','appr', 'quote','ac',     'high',  2,'il',
   'מזגן לא מקרר — גז R134 ובדיקת נזילות','45-901-23','פורד טרנזיט','חברת דלתא בע״מ',420,0,
   array['בדיקת לחצים','מילוי גז'],
   array['VIP'],'עבר יומיים',null),

  ('GAR-145','W-1044','appr', 'quote','service','med',   3,'dk',
   'רצועת טיימינג + ניקוי מערכת דלק','63-820-11','מאזדה CX-5','א. פרידמן',2400,0,
   array['הצעת מחיר ללקוח','החלפת רצועה','ניקוי מזרקים'],
   array['איסוף היום'],'איסוף 17:00',null),

  ('GAR-131','W-1039','parts','part', 'susp',   'high',  5,'il',
   'החלפת בולמים אחוריים — ממתין למשלוח מהספק','30-555-90','קיה ספורטג׳','מוחמד עלי',1890,2,
   array['אבחון בולמים','הזמנת חלקים','פירוק','הרכבה','יישור'],
   array[]::text[],'צפי 14/07','בולם זעזועים אחורי — הזמנה #4471 בדרך'),

  ('GAR-146','W-1043','parts','part', 'engine', 'urgent',8,'il',
   'מצמד מלא פורד — אזל מהמלאי','45-901-23','פורד טרנזיט','חברת דלתא בע״מ',940,0,
   array['בירור מול יבואן','הזמנה','קליטה למלאי'],
   array['חוסם עבודה'],'טרם הוזמן','מלאי 0 — נדרשת הזמנה מיבואן ישיר'),

  ('GAR-140','W-1041','diag', 'diag', 'elec',   'high',  2,'dk',
   'נורית מנוע דולקת — קריאת תקלות במחשב','88-221-04','יונדאי i20','שרה כהן',0,1,
   array['חיבור סורק OBD','פענוח קודי תקלה','הצעת המשך טיפול'],
   array['חדש'],'היום',null),

  ('GAR-147','W-1047','diag', 'test', 'body',   'med',   1,'ns',
   'בדיקת טסט שנתי — הכנה לרישוי','45-901-23','פורד טרנזיט','חברת דלתא בע״מ',350,0,
   array['בדיקת אורות','בדיקת בלמים','בדיקת פליטה','תיאום מכון רישוי'],
   array[]::text[],'20/08',null),

  ('GAR-148','W-1040','qa',   'job',  'service','med',   2,'dk',
   'נסיעת מבחן ובדיקה סופית אחרי טיפול','61-430-18','מאזדה 3','רונית ברק',0,2,
   array['נסיעת מבחן','בדיקת דליפות','ניקוי הרכב'],
   array[]::text[],'היום',null),

  ('GAR-136','W-1038','done', 'job',  'service','low',   3,'dk',
   'החלפת שמן + פילטרים — הושלם','61-430-18','מאזדה 3','רונית ברק',780,3,
   array['החלפת שמן','החלפת פילטרים','איפוס מחוון טיפול'],
   array['שולם'],'—',null),

  ('GAR-149','W-1045','todo', 'job',  'brakes', 'med',   3,'il',
   'בלמים אחוריים חורקים — סקודה אוקטביה','22-114-88','סקודה אוקטביה','נועם ברק',0,0,
   array['אבחון רעש','הצעת מחיר','ביצוע'],
   array['חדש'],'מחר',null),

  ('GAR-150','W-1046','todo', 'diag', 'elec',   'low',   2,'ns',
   'מצבר מתרוקן — בדיקת מערכת טעינה','51-778-20','פיאט 500','ליאת דגן',0,0,
   array['בדיקת אלטרנטור','בדיקת מצבר'],
   array[]::text[],'מחר',null)
) as v(key, job, status, type, epic, priority, points, assignee, title, plate, car,
       customer_name, amount, done, subtasks, flags, due, blocked)
left join public.customers c on c.name = v.customer_name;

-- a couple of works + their parts, so a ticket opens with real lines in it
insert into public.works (ticket_id, uid, code, name, labor, position)
select t.id, 'w-brk-f', 'BRK-F', 'בלמים קדמיים', 250, 0
from public.tickets t where t.key = 'GAR-142';

insert into public.work_items (work_id, sku, name, qty, price, position)
select w.id, x.sku, x.name, x.qty, x.price, x.position
from public.works w
join (values
  ('BRK-F22','רפידות בלם קדמי',   1, 240, 0),
  ('DSC-F10','דיסקיות בלם קדמי',  2, 180, 1),
  ('FLD-BRK','נוזל בלמים DOT4',   1,  35, 2)
) as x(sku, name, qty, price, position) on true
where w.uid = 'w-brk-f';

insert into public.works (ticket_id, uid, code, name, labor, position)
select t.id, 'w-oil', 'OIL-01', 'טיפול שמן מלא', 120, 0
from public.tickets t where t.key = 'GAR-143';

insert into public.work_items (work_id, sku, name, qty, price, position)
select w.id, x.sku, x.name, x.qty, x.price, x.position
from public.works w
join (values
  ('OIL-530','שמן מנוע 5W-30 (ליטר)', 5, 45, 0),
  ('FLT-OIL','פילטר שמן',             1, 65, 1),
  ('FLT-AIR','פילטר אוויר',           1, 90, 2)
) as x(sku, name, qty, price, position) on true
where w.uid = 'w-oil';
