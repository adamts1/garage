/* Shown when .env.local is missing or still holds the placeholder values.
   Better than a blank screen: it says exactly what to do. */

export default function SetupNotice() {
  return (
    <div className="setup-notice">
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
          ב‑<b>SQL Editor</b> הדבק את כל <code>supabase/schema.sql</code> ולחץ <b>Run</b> -
          זה יוצר את הטבלאות ומזין נתוני דמו
        </li>
        <li>
          העתק את <code>.env.local.example</code> ל‑<code>.env.local</code>, מלא את שני הערכים
          מ‑<b>Project Settings → API</b>, והרץ מחדש <code>npm run dev</code>
        </li>
      </ol>

      <pre>{`VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}</pre>

      <p className="text-muted">
        שים לב: Vite קורא את <code>.env.local</code> רק בעליית השרת - צריך להפעיל אותו מחדש אחרי השינוי.
      </p>
    </div>
  );
}
