/* Shown when the Supabase connection is unconfigured — .env.local missing, or
   still holding the placeholder values. Better than a blank screen: it says
   exactly what to do.

   Deliberately not translated. It is a developer-facing screen that only
   appears before the app is wired up, and it quotes file names and commands
   verbatim; routing those through i18n would put build instructions in the
   same file as the product's copy. */

import styles from './SetupNotice.module.css';

export default function SetupNotice() {
  return (
    <div className={styles.notice}>
      <h2>חיבור ל‑Supabase לא הוגדר</h2>
      <p>
        האפליקציה מחוברת ל‑Supabase, אבל חסרים פרטי החיבור.
        שלושה שלבים (הפירוט המלא ב‑<code>SUPABASE_SETUP.md</code>):
      </p>

      <ol>
        <li>
          פתח פרויקט חדש ב‑<a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">supabase.com/dashboard</a>
        </li>
        <li>
          ב‑<b>SQL Editor</b> הדבק את כל <code>supabase/migrations/20260730000000_baseline.sql</code> ולחץ <b>Run</b> -
          זה יוצר את הטבלאות
        </li>
        <li>
          העתק את <code>.env.local.example</code> ל‑<code>.env.local</code>, מלא את שני הערכים
          מ‑<b>Project Settings → API</b>, והרץ מחדש <code>npm run dev</code>
        </li>
      </ol>

      <pre>{`VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}</pre>

      <p className={styles.muted}>
        שים לב: Vite קורא את <code>.env.local</code> רק בעליית השרת - צריך להפעיל אותו מחדש אחרי השינוי.
      </p>
    </div>
  );
}
