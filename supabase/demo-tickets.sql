-- ============================================================
--  DEMO TICKETS
--  Builds 12 tickets across all six board columns, wired to the
--  customers and vehicles already in your database, with real
--  works and parts (prices come from the items catalog).
--
--  Amounts = (labor + parts) * 1.18  (VAT 18%)
--
--  Paste the whole file into the Supabase SQL Editor and Run.
--  Safe to re-run: it clears tickets first (works/work_items cascade).
-- ============================================================

-- make sure the "שולם" status is allowed (no-op if you already ran add-paid-status.sql)
alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.tickets add constraint tickets_status_check
  check (status in ('todo','diag','appr','prog','parts','qa','done','paid'));

-- ⚠️ wipes existing tickets so the file is re-runnable. Delete this line to append instead.
delete from public.tickets;

-- ---------- tickets ----------
-- phone/email are pulled from the customer record by the join.
insert into public.tickets
  (key, job, status, type, epic, priority, points, assignee, title, plate, car,
   customer_id, customer_name, phone, email, km, year, amount, done, subtasks,
   flags, due, blocked, paid, pay_method, doc)
select v.key, v.job, v.status, v.type, v.epic, v.priority, v.points, v.assignee,
       v.title, v.plate, v.car, c.id, v.customer_name, c.phone, c.email,
       v.km, v.year, v.amount, v.done, v.subtasks, v.flags, v.due, v.blocked,
       v.paid, v.pay_method, v.doc
from (values
  -- ===== ממתין לטיפול =====
  ('GAR-301','W-2001','todo','job','brakes','high',5,'dk',
   'רעש חריקה בבלימה, נדרשת החלפת רפידות ודיסקיות קדמיות','12-345-67','טויוטה קורולה','יוסי לוי','112,400','2019',
   1044, 0, array['פירוק גלגלים קדמיים','מדידת עובי דיסקית','החלפת רפידות ודיסקיות','הרכבה ומומנט','נסיעת מבחן'],
   array['חדש'],'מחר 10:00',null::text,false,null::text,null::text),

  ('GAR-302','W-2002','todo','diag','engine','low',2,'ns',
   'רעד במנוע בסרק, בדיקת נרות ורצועות','22-114-88','סקודה אוקטביה','נועם בר אל','119,000','2017',
   0, 0, array['בדיקת נרות הצתה','בדיקת רצועת אלטרנטור','הצעת מחיר ללקוח'],
   array['חדש'],'מחר',null,false,null,null),

  -- ===== ממתין לאישור =====
  ('GAR-303','W-2003','appr','quote','service','med',5,'dk',
   'רצועת טיימינג ומשאבת מים, ממתין לאישור הלקוח','63-820-11','מאזדה CX-5','אבי פרידמן','96,200','2018',
   2537, 0, array['הצעת מחיר ללקוח','החלפת רצועת טיימינג','החלפת משאבת מים','מילוי נוזל קירור'],
   array['ממתין אישור לקוח'],'ממתין אישור',null,false,null,null),

  ('GAR-304','W-2004','appr','quote','engine','urgent',8,'il',
   'החלפת מצמד מלא לפורד טרנזיט, הצעה נשלחה','45-901-23','פורד טרנזיט','חברת דלתא הובלות בע״מ','248,900','2016',
   3280, 0, array['פירוק תיבת הילוכים','החלפת ערכת מצמד ומיסב','הרכבה','נסיעת מבחן'],
   array['VIP','ממתין אישור לקוח'],'ממתין אישור',null,false,null,null),

  -- ===== בעבודה =====
  ('GAR-305','W-2005','prog','job','elec','high',2,'ns',
   'הרכב מתקשה בהתנעה, החלפת מצבר ובדיקת מערכת טעינה','88-221-04','יונדאי i20','שרה כהן','71,300','2020',
   684, 1, array['בדיקת מערכת טעינה','החלפת מצבר','בדיקה חוזרת'],
   array[]::text[],'היום 15:00',null,false,null,null),

  ('GAR-306','W-2006','prog','job','service','med',3,'dk',
   'טיפול תקופתי מלא, שמן פילטרים ונרות','77-654-32','סקודה אוקטביה','דוד אזולאי','88,900','2019',
   1012, 2, array['החלפת שמן מנוע','החלפת פילטרים','החלפת נרות הצתה','איפוס מחוון טיפול'],
   array[]::text[],'היום 17:00',null,false,null,null),

  -- ===== חסום, חלקים =====
  ('GAR-307','W-2007','parts','part','susp','high',5,'il',
   'החלפת בולמים אחוריים, ממתין למשלוח מהספק','25-118-73','רנו קליאו','אולגה פטרוב','102,500','2018',
   1451, 2, array['אבחון בולמים','הזמנת חלקים','פירוק','הרכבה','יישור פרונט'],
   array['חוסם עבודה'],'צפי 22/07','בולם זעזועים אחורי, הזמנה מספר 4471 בדרך מהספק',false,null,null),

  ('GAR-308','W-2008','parts','part','brakes','med',4,'il',
   'בלמים אחוריים למרצדס ספרינטר, דיסקיות אזלו מהמלאי','33-410-88','מרצדס ספרינטר','מוסך שלום הסעות בע״מ','320,500','2017',
   997, 1, array['אבחון בלמים','הזמנת דיסקיות','החלפה','נסיעת מבחן'],
   array['חוסם עבודה'],'צפי 23/07','דיסקיות בלם אחורי, מלאי 0, נדרשת הזמנה מיבואן',false,null,null),

  -- ===== מוכן לאיסוף (טרם שולם) =====
  ('GAR-309','W-2009','done','job','service','low',3,'dk',
   'טיפול שמן ופילטרים הושלם, הרכב מוכן לאיסוף','61-430-18','מאזדה 3','רונית ברק','54,100','2021',
   570, 3, array['החלפת שמן','החלפת פילטרים','איפוס מחוון טיפול'],
   array['מוכן לאיסוף'],'איסוף היום',null,false,null,null),

  ('GAR-310','W-2010','done','job','ac','med',3,'ns',
   'טיפול מזגן והחלפת מגבים הושלם, ממתין לאיסוף','51-778-20','יונדאי i35','ליאת דגן','143,200','2016',
   625, 3, array['מילוי גז מזגן','החלפת מגבים','החלפת נורות'],
   array['מוכן לאיסוף'],'איסוף מחר',null,false,null,null),

  -- ===== שולם =====
  ('GAR-311','W-2011','paid','job','brakes','med',4,'il',
   'בלמים אחוריים והחלפת מגבים, נמסר ושולם','22-333-444','סובארו XV','אדם ציטיאט','130,000','2018',
   578, 3, array['החלפת רפידות אחוריות','החלפת מגבים','נסיעת מבחן'],
   array['שולם'],'',null,true,'אשראי','חשבונית 2051'),

  ('GAR-312','W-2012','paid','job','service','low',2,'dk',
   'טיפול שמן קטן, נמסר ושולם','84-220-15','סוזוקי איגניס','יוסי לוי','28,900','2022',
   431, 2, array['החלפת שמן','החלפת פילטר שמן'],
   array['שולם'],'',null,true,'מזומן','חשבונית 2052')
) as v(key, job, status, type, epic, priority, points, assignee, title, plate, car,
       customer_name, km, year, amount, done, subtasks, flags, due, blocked,
       paid, pay_method, doc)
left join public.customers c on c.name = v.customer_name;

-- ---------- works (the job lines on each ticket) ----------
insert into public.works (ticket_id, uid, code, name, labor, position)
select t.id, x.uid, x.code, x.name, x.labor, x.position
from (values
  ('GAR-301','w-301-1','BRK-F','בלמים קדמיים',      250, 0),
  ('GAR-303','w-303-1','TIM-01','רצועת טיימינג ומשאבה',780, 0),
  ('GAR-304','w-304-1','CLT-01','החלפת מצמד',        950, 0),
  ('GAR-305','w-305-1','BAT-01','החלפת מצבר',         60, 0),
  ('GAR-306','w-306-1','SVC-01','טיפול תקופתי מלא',  200, 0),
  ('GAR-307','w-307-1','SHK-01','בולמים אחוריים',    420, 0),
  ('GAR-308','w-308-1','BRK-R','בלמים אחוריים',      320, 0),
  ('GAR-309','w-309-1','OIL-01','טיפול שמן',         120, 0),
  ('GAR-310','w-310-1','AC-01','טיפול מזגן ומגבים',  180, 0),
  ('GAR-311','w-311-1','BRK-R','בלמים אחוריים',      220, 0),
  ('GAR-312','w-312-1','OIL-01','טיפול שמן קטן',     120, 0)
) as x(tkey, uid, code, name, labor, position)
join public.tickets t on t.key = x.tkey;

-- ---------- work_items (the parts each job consumes) ----------
insert into public.work_items (work_id, sku, name, qty, price, position)
select w.id, x.sku, x.name, x.qty, x.price, x.position
from (values
  -- GAR-301 front brakes
  ('w-301-1','BRK-F22','רפידות בלם קדמי',      1, 240, 0),
  ('w-301-1','DSC-F10','דיסקיות בלם קדמי',     2, 180, 1),
  ('w-301-1','FLD-BRK','נוזל בלמים DOT4',      1,  35, 2),
  -- GAR-303 timing + water pump
  ('w-303-1','TIM-KIT','ערכת רצועת טיימינג',   1, 890, 0),
  ('w-303-1','PMP-WTR','משאבת מים',            1, 320, 1),
  ('w-303-1','COOL-12','נוזל קירור G12 (ליטר)',4,  40, 2),
  -- GAR-304 clutch
  ('w-304-1','CLT-FRD','ערכת מצמד מלאה',       1,1650, 0),
  ('w-304-1','BRG-CLT','מיסב מצמד',            1, 180, 1),
  -- GAR-305 battery
  ('w-305-1','BAT-70A','מצבר 70 אמפר',         1, 520, 0),
  -- GAR-306 full service
  ('w-306-1','OIL-540','שמן מנוע 5W-40 (ליטר)',4,  52, 0),
  ('w-306-1','FLT-OIL','פילטר שמן',            1,  65, 1),
  ('w-306-1','FLT-AIR','פילטר אוויר',          1,  90, 2),
  ('w-306-1','FLT-CAB','מסנן אבקנים',          1,  75, 3),
  ('w-306-1','SPK-IRD','נרות הצתה אירידיום',   4,  55, 4),
  -- GAR-307 rear shocks
  ('w-307-1','SHK-R09','בולם זעזועים אחורי',   2, 360, 0),
  ('w-307-1','MNT-R01','תותב בולם',            2,  45, 1),
  -- GAR-308 rear brakes
  ('w-308-1','BRK-R18','רפידות בלם אחורי',     1, 190, 0),
  ('w-308-1','DSC-R08','דיסקיות בלם אחורי',    2, 150, 1),
  ('w-308-1','FLD-BRK','נוזל בלמים DOT4',      1,  35, 2),
  -- GAR-309 oil service
  ('w-309-1','OIL-540','שמן מנוע 5W-40 (ליטר)',4,  52, 0),
  ('w-309-1','FLT-OIL','פילטר שמן',            1,  65, 1),
  ('w-309-1','FLT-AIR','פילטר אוויר',          1,  90, 2),
  -- GAR-310 AC + wipers
  ('w-310-1','GAS-134','גז מזגן R134',         1, 220, 0),
  ('w-310-1','WPR-BLD','מגבי שמשה (זוג)',      1,  80, 1),
  ('w-310-1','BLB-H7','נורת הלוגן H7',         2,  25, 2),
  -- GAR-311 rear brakes (paid)
  ('w-311-1','BRK-R18','רפידות בלם אחורי',     1, 190, 0),
  ('w-311-1','WPR-BLD','מגבי שמשה (זוג)',      1,  80, 1),
  -- GAR-312 small oil service (paid)
  ('w-312-1','OIL-530','שמן מנוע 5W-30 (ליטר)',4,  45, 0),
  ('w-312-1','FLT-OIL','פילטר שמן',            1,  65, 1)
) as x(wuid, sku, name, qty, price, position)
join public.works w on w.uid = x.wuid;
