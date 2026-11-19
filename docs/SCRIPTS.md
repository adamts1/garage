# מדריך פקודות וסקריפטים

כל הפקודות של הפרויקט במקום אחד: פיתוח, בילדים לכל סביבה, פקודות ה־Supabase CLI, והסקריפטים לניהול מוסכים.
ההסברים המלאים (למה כל דבר בנוי ככה) נמצאים ב־[WORKFLOW.md](WORKFLOW.md), ב־[mobile/README.md](../mobile/README.md) ובהערה שבראש כל סקריפט.

כל הפקודות רצות משורש הריפו, חוץ מפקודות המובייל שרצות מתוך התיקייה `mobile/`.

---

## 1. הסביבות

| סביבה | פרויקט | מזהה (ref) | מי משתמש בה |
|---|---|---|---|
| **מקומית** | Docker על המחשב | `127.0.0.1:54321` | בדיקת מיגרציות על מסד נקי |
| **בדיקות** | `garage-staging` | `poksqsdklnhaumozriqd` | פיתוח, אתר הבדיקות, בילדים של בדיקות |
| **ייצור** | `garage-production` | `farpgkljbmlaeiocrore` | המוסכים האמיתיים |

### מה קובע לאן כל דבר מתחבר

| מה | נקבע ע״י | ברירת מחדל |
|---|---|---|
| האפליקציה בווב, `npm run dev` | `.env.local` | בדיקות |
| האתר המפורסם | משתני הסביבה ב־Netlify (נאפים בזמן הבילד) | לפי האתר |
| האפליקציה במובייל, `expo start` | `mobile/.env` | בדיקות |
| בילד מובייל ב־EAS | פרופיל ב־`mobile/eas.json` + משתני הסביבה ב־EAS | לפי הפרופיל |
| סקריפטים בלי `:prod` | `.env.local` | בדיקות |
| סקריפטים עם `:prod` | `.env.production.local` | ייצור |
| `db push`, `migration list` | הקישור של ה־CLI: `supabase/.temp/project-ref` | **מה שקושר אחרון** |
| `functions:push` / `functions:push:prod` | מזהה כתוב בתוך הפקודה | בדיקות / ייצור |

> ⚠️ **לפני כל `db push`, בדוק לאן ה־CLI מקושר:**
>
> ```bash
> cat supabase/.temp/project-ref
> ```
>
> אם מופיע `farpgkljbmlaeiocrore`, הפקודה הבאה תרוץ **על הייצור**.

### עבודה מול מסד מקומי

```bash
npx supabase start                     # מרים את המסד המקומי (צריך Docker)
cp .env.local.localdb .env.local       # הווב מתחבר למסד המקומי
cp mobile/.env.localdb mobile/.env     # המובייל מתחבר למסד המקומי
npx supabase stop
```

כדי לחזור לבדיקות, שחזר את `.env.local` מ־`.env.local.example` עם הערכים של בדיקות.

---

## 2. Git: איך שינוי מגיע לייצור

```
feature branch  ←  staging   (מתפצלים מ־staging)
PR  →  staging                (אתר הבדיקות מתעדכן)
PR  staging  →  main          (האתר בייצור מתעדכן)
```

ה־CI רץ על כל PR: בדיקת טיפוסים, טסטים ובילד לווב ולמובייל, לינט, והחלת כל המיגרציות על מסד נקי.

---

## 3. ווב

| פקודה | מה היא עושה |
|---|---|
| `npm run dev` | שרת פיתוח, מול המסד שב־`.env.local` |
| `npm run build` | בילד לייצור, כולל דף הנחיתה ב־`/marketing/` |
| `npm run preview` | מגיש את הבילד מקומית |
| `npm run typecheck` | בדיקת טיפוסים |
| `npm run lint` | לינט |
| `npm test` | טסטים |

### בילד ופרסום לכל סביבה

אין פקודת פרסום. Netlify בונה לבד:

| ענף | אתר | מסד |
|---|---|---|
| `staging` | אתר הבדיקות | בדיקות |
| `main` | האתר בייצור | ייצור |
| כל PR | תצוגה מקדימה | לפי משתני ה־Netlify |

משתני הסביבה נאפים בזמן הבילד. שינוי שלהם בלוח הבקרה של Netlify לא משפיע עד הפרסום הבא.

---

## 4. Supabase CLI

### מיגרציות

```bash
npm run db:new add_something      # קובץ מיגרציה חדש ב־supabase/migrations/
npm run db:reset                  # בונה מחדש את המסד המקומי בלבד, ומריץ את seed.sql
npm run db:diff some_name         # מייצר מיגרציה מתוך הבדלים במסד המקומי
npm run db:lint                   # לינט על הסכמה
```

`db:reset` נוגע **רק** במסד המקומי. האפליקציה שמחוברת לבדיקות לא תראה את השינוי עד `db push`.

### החלת מיגרציות: קודם בדיקות, אחר כך ייצור

```bash
# בדיקות
npx supabase link --project-ref poksqsdklnhaumozriqd
npx supabase migration list --linked          # מה הוחל ומה לא
npx supabase db push --linked --dry-run       # מה ייכתב
npx supabase db push

# ייצור, רק אחרי שבדיקות עובדות
npx supabase link --project-ref farpgkljbmlaeiocrore
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push

# להחזיר את הקישור לבדיקות כשמסיימים
npx supabase link --project-ref poksqsdklnhaumozriqd
```

כללים:
- לא עורכים מיגרציה שכבר הוחלה. מתקנים במיגרציה חדשה.
- מיגרציה לא מוחקת טבלה.
- כל טבלה חדשה צריכה גם הרשאות (grant) וגם מדיניות (policy). ראה WORKFLOW.md §4.

### פונקציות קצה (Edge Functions)

מיגרציה ופונקציה הן שני פרסומים נפרדים. **קודם המיגרציה, אחר כך הפונקציה.** תמיד לציין את שם הפונקציה.

```bash
npm run functions:push issue-invoice          # בדיקות
npm run functions:push:prod issue-invoice     # ייצור
```

הפונקציות שבריפו:
`bookkeeping-ready`, `export-bookkeeping`, `extract-invoice`, `issue-invoice`, `manage-staff`, `photo`, `record-expense`, `send-bookkeeping`.

הפונקציה `photo` ציבורית (`verify_jwt = false` ב־`supabase/config.toml`). אחרי פרסום שלה, בדוק שקישור לתמונה עדיין נפתח בלי התחברות.

### מה רץ איפה

| פקודה | מה היא עונה |
|---|---|
| `npm run functions:status` | האם בדיקות וייצור מריצים אותו קוד, לפי גיבוב (hash) |
| `npm run functions:status:staging` | האם מה שרץ בבדיקות זהה ל־`origin/staging` |
| `npm run functions:status:prod` | האם מה שרץ בייצור זהה ל־`origin/main` |
| `npm run mobile:status` | מאיזה commit נבנה כל בילד מובייל, וכמה שינויים במובייל יש מאז |

כולן קוראות בלבד.

### סודות (secrets) לפונקציות

```bash
npm run resend-key           # מפתח Resend → בדיקות
npm run resend-key:prod      # מפתח Resend → ייצור
```

הסקריפט מבקש את המפתח בלי להציג אותו. לסודות אחרים:

```bash
npx supabase secrets list --project-ref <ref>
npx supabase secrets set NAME=value --project-ref <ref>
```

### גיבוי הייצור

```bash
npm run backup:prod                  # → ~/Documents/MyBusiness/Garage-backups/prod-<תאריך>
npm run backup:prod -- /some/dir     # לתיקייה אחרת
```

קורא בלבד: סכמה, נתונים, תפקידים וקבצי התמונות. בסוף הוא מחזיר את קישור ה־CLI לבדיקות. התיקייה מכילה מידע אישי של לקוחות, אז לא שולחים אותה לשום מקום.
שחזור, למסד **ריק**, בסדר הזה: `roles.sql`, `schema.sql`, `data.sql`, ואז העלאת `storage/` לאותם נתיבים.

---

## 5. ניהול מוסכים

לכל הסקריפטים כאן יש גרסה רגילה, שרצה על בדיקות דרך `.env.local`, וגרסת `:prod` שרצה על ייצור דרך `.env.production.local`.
כולם מדפיסים לאיזה פרויקט הם עומדים לכתוב, ובודקים שהמפתח שייך לפרויקט שב־URL.
לסקריפט שאין לו `:prod`, מריצים כך:

```bash
node --env-file=.env.production.local scripts/<script>.mjs ...
```

> בשורה האחרונה של פקודה מרובת שורות **אין** לוכסן הפוך `\`. אם יש, המסוף מחכה לעוד קלט ולא מריץ כלום.

### 5.1 מוסך חדש ומשתמשים — `onboard`

זו הדרך היחידה ליצור חשבון. אין הרשמה עצמית.

```bash
# מוסך חדש + המשתמש הראשון שלו (מנהל)
npm run onboard:prod -- --garage 'מוסך הרצל' --email avi@example.com --admin

# משתמש נוסף למוסך קיים
npm run onboard:prod -- --garage-id <uuid> --email worker@example.com --member

# מוסך חדש עם קטלוג התחלתי (scripts/starter-catalog.json)
npm run onboard:prod -- --garage 'מוסך הרצל' --email avi@example.com --admin --catalog
```

| דגל | משמעות |
|---|---|
| `--garage <שם>` | יוצר מוסך חדש |
| `--garage-id <uuid>` | עובד על מוסך קיים |
| `--email` | המשתמש |
| `--admin` / `--member` | **חובה** כשיש `--email`. אין ברירת מחדל, כי הרצה חוזרת דורסת את התפקיד |
| `--password` | בלי הדגל נוצרת סיסמה אקראית ומודפסת |
| `--catalog` | קטלוג התחלתי, רק במוסך חדש |

**כותרת לדפוס (letterhead).** נקבעת רק כאן, אין לה עורך באפליקציה. רק השדות שמועברים נכתבים, ומחרוזת ריקה מוחקת שדה.

```bash
npm run onboard:prod -- \
  --garage-id <uuid> \
  --print-name 'מוסך מרום' \
  --motto 'מגיע לך המוסך הכי טוב' \
  --services 'מכונאות * דיאגנוסטיקה * חשמל ומיזוג' \
  --address 'אמיל זולא 29 פתח תקוה' \
  --phone '050-5888827' \
  --fax '03-0000000' \
  --license-no 40677 \
  --tax-id 514123456
```

### 5.2 חיבור לחשבונית ירוקה / iCount — `connect-billing`

```bash
npm run connect-billing:prod -- --garage-id <uuid> --cid <icount-cid> --token <icount-token>
```

דגלים נוספים: `--provider` (ברירת מחדל `icount`), `--vat-rate 0.18`.
הטוקן לא מודפס בחזרה. מומלץ להחליף אותו אחרי העלייה לאוויר.

### 5.3 תוכנת הנהלת חשבונות — `bookkeeping-software`

נדרש לפני שמוסך יכול לייצא לרואה החשבון. המוסך חייב להיות מחובר קודם (5.2).

```bash
npm run bookkeeping-software:prod -- --list
npm run bookkeeping-software:prod -- --garage-id <uuid> --software rivhit
npm run bookkeeping-software:prod -- --garage-id <uuid> --software hashavshevet
```

### 5.4 נתוני דוגמה

| פקודה | מה היא כותבת | ייצור? |
|---|---|---|
| `seed:catalog` | עבודות ופריטים (מחירון) | כן, מוסיפה בלבד |
| `seed:board` | לקוחות, רכבים וכרטיסים | כן, מוסיפה בלבד |
| `seed:demo` | **מוחקת** את נתוני המוסך ובונה מחדש | לא, מסרבת. כרגע לא עובדת בכלל, כי אסור למחוק כרטיסים |

```bash
# בלי --yes זו הרצת ניסיון שרק מדפיסה את התוכנית
npm run seed:catalog:prod -- --id <uuid>
npm run seed:catalog:prod -- --id <uuid> --yes

# המוסך כבר מכיל עבודות ופריטים? --append שומר את הקיים ומדלג על כפולים
npm run seed:catalog:prod -- --id <uuid> --append --yes

npm run seed:board:prod -- --id <uuid> --yes
```

אפשר `--garage <שם>` במקום `--id <uuid>`. הנתונים עצמם ב־[scripts/demo-data.mjs](../scripts/demo-data.mjs).

### 5.5 לקוחות כפולים — `dupes`

```bash
npm run dupes                                   # דו״ח לכל המוסכים
npm run dupes -- --garage-id <uuid>             # מוסך אחד
npm run dupes -- --merge <id1,id2,id3>          # מיזוג: הוותיק נשאר
```

**מיזוג לא הפיך.** קרא את הדו״ח, החלט, ורק אז העבר מזהים במפורש.

### 5.6 ייבוא מהתוכנה הישנה (מטל / ריכבי)

```bash
python3 -I scripts/ricbi/decode.py <ricbi dir> <ricbi/edit dir> <out dir>
python3 -I scripts/ricbi/select.py <out dir> <since YYYY-MM-DD> <out dir>/import.json
npm run import:ricbi -- --garage 'richbi-test' --data <out dir>/import.json         # ניסיון
npm run import:ricbi -- --garage 'richbi-test' --data <out dir>/import.json --yes
```

אפשר להריץ שוב: מה שכבר יובא מדולג. על ייצור הסקריפט מסרב בלי `--production`.

### סדר הקמה של מוסך חדש

1. `onboard:prod`: מוסך + מנהל.
2. `onboard:prod --garage-id`: כותרת לדפוס.
3. `onboard:prod --garage-id --email --member`: שאר העובדים.
4. `connect-billing:prod`: חשבוניות.
5. `bookkeeping-software:prod`: ייצוא לרואה חשבון.
6. אופציונלי: `seed:catalog:prod` למחירון התחלתי.

---

## 6. מובייל

כל הפקודות מתוך `mobile/`. התקנה: קודם `npm ci` בשורש, ואז `npm ci` ב־`mobile/`.

### פיתוח

| פקודה | מה היא עושה |
|---|---|
| `npm start` | Expo, מול המסד שב־`mobile/.env` (בדיקות) |
| `npm run ios` / `npm run android` | בילד נייטיב מקומי והרצה |
| `npm run typecheck` / `npm test` | בדיקות |

### בילדים לכל סביבה

**EAS בונה מ־git.** מה שלא עשית לו commit לא נכנס לבילד. הסקריפט `scripts/release.sh` עוצר אם יש שינויים לא שמורים, ומדפיס ענף, commit ומסד יעד. קרא את מה שהוא מדפיס.

| פקודה | פרופיל | מסד | תוצר |
|---|---|---|---|
| `npm run build:sim:ios` / `run:sim:ios` | `simulator` | בדיקות | בילד לסימולטור / בונה ומריץ |
| `npm run build:sim:android` / `run:sim:android` | `simulator` | בדיקות | APK לאמולטור |
| `npm run testflight:staging` | `staging` | בדיקות | אפליקציית הבדיקות ב־TestFlight |
| `npm run build:staging:ios` | `staging` | בדיקות | אותו דבר, בלי שליחה |
| `npm run build:staging:android` | `staging` | בדיקות | קישור ל־APK, עובד בכל טלפון |
| `npm run build:staging:play` | `staging-play` | בדיקות | AAB לרישום הבדיקות ב־Play |
| `npm run adhoc:staging:ios` | `adhoc-staging` | בדיקות | התקנה ישירה, רק במכשירים רשומים |
| `npm run adhoc:ios` / `adhoc:android` | `adhoc` | **ייצור** | התקנה ישירה |
| `npm run testflight` | `production` | **ייצור** | בילד + שליחה ל־TestFlight |
| `npm run build:prod:ios` | `production` | **ייצור** | בילד בלי שליחה |
| `npm run build:prod:android` | `production` | **ייצור** | AAB, מעלים ידנית ל־Play Console |

פקודות עזר:

| פקודה | מה היא עושה |
|---|---|
| `npm run submit:ios` / `submit:staging:ios` | שולח בילד קיים ל־TestFlight |
| `npm run builds:ios` / `builds:android` | חמשת הבילדים האחרונים |
| `npm run device` | רישום מכשיר לבילדים מסוג adhoc |
| `npx eas env:list --environment production` | בדיקה שהמשתנים בייצור מצביעים לייצור, **לפני כל שחרור** |

בילד של בדיקות מותקן **לצד** אפליקציית הייצור ומופיע בשם `מוסך (Staging)`. בתחתית המסך יש פס צהוב לבדיקות, ופס אדום אם הבילד והמסד לא תואמים.

שינוי בחבילות נייטיב (למשל expo-print) מחייב בילד חדש. עדכון קוד בלבד לא מגיע לטלפונים בלי בילד.

---

## 7. רשימת בדיקה לשחרור

1. מיגרציות: `migration list --linked` על בדיקות, `db push`, בדיקה באתר הבדיקות.
2. פונקציות: `functions:push` לבדיקות, ואז `functions:status:staging`.
3. מיזוג `staging` ל־`main`: Netlify מפרסם את הווב בייצור.
4. ייצור: `link` לייצור, `db push`, ואז `functions:push:prod`, ואז `functions:status:prod`.
5. `link` חזרה לבדיקות.
6. מובייל, אם השתנה: `eas env:list --environment production`, ואז `npm run testflight` ו־`npm run build:prod:android`.
7. אחרי בילד: להתקין ולבדוק שהאפליקציה נפתחת, רשימת הכרטיסים נטענת, הסכומים בכרטיס נכונים ותמונה עולה.
