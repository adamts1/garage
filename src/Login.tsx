/* The login screen — a branded split panel (brand rail + form), matching the
   product mockup. Auth is still email + password via signIn; see
   packages/shared/src/auth.ts for why not magic links.

   Accounts are created by an operator, so "forgot password" is not a self-serve
   reset yet — the link explains how to get back in rather than being a dead end
   or a half-built flow that mails a link nobody configured. "Remember me" is
   surfaced but the Supabase client already persists the session by default. */

import { useState } from 'react';
import { signIn } from '@garage/shared';

const hebrewError = (message: string): string => {
  if (/invalid login credentials/i.test(message)) return 'האימייל או הסיסמה שגויים.';
  if (/email not confirmed/i.test(message)) return 'החשבון עדיין לא אושר. פנו לתמיכה.';
  return 'ההתחברות נכשלה. נסו שוב, ואם זה חוזר — פנו לתמיכה.';
};

/* Small inline icons — kept local so the login has no icon-set dependency. */
const I = {
  mail: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>,
  lock: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>,
  eye: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>,
  eyeOff: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" /><path d="M9.9 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 3-.5" /></svg>,
  shield: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" /></svg>,
  arrow: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7" /></svg>,
  check: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12l5 5L20 6" /></svg>,
  chart: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  users: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-3-5" /></svg>,
};

const FEATURES = [
  { icon: I.check, title: 'ניהול כרטיסי עבודה', text: 'מעקב מלא אחר כל הטיפולים והלקוחות' },
  { icon: I.chart, title: 'דוחות וסטטיסטיקות', text: 'כל הנתונים החשובים במקום אחד' },
  { icon: I.users, title: 'גישה מכל מקום', text: 'עובד במחשב, בטאבלט ובטלפון' },
];

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signIn(email, password);
      // No navigation here: useAuth is subscribed to the auth state and swaps
      // the screen out the moment the session lands.
    } catch (err) {
      setError(hebrewError(err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  };

  return (
    <div className="login2">
      {/* ---------- brand rail ---------- */}
      <aside className="login2-brand">
        <div className="login2-brand-head">
          <img className="login2-logo" src="/logo.png" alt="" />
          <h1 className="login2-title">מוסך</h1>
          <p className="login2-tagline">מערכת ניהול מוסך חכמה</p>
        </div>

        <ul className="login2-features">
          {FEATURES.map((f) => (
            <li key={f.title} className="login2-feature">
              <span className="login2-feature-ic">{f.icon}</span>
              <div>
                <b>{f.title}</b>
                <span>{f.text}</span>
              </div>
            </li>
          ))}
        </ul>

        <div className="login2-brand-foot">{I.lock} הנתונים שלך מאובטחים</div>
      </aside>

      {/* ---------- form ---------- */}
      <main className="login2-panel">
        <form className="login2-form" onSubmit={submit}>
          <img className="login2-logo compact" src="/logo.png" alt="" />
          <h2 className="login2-welcome">ברוכים הבאים</h2>
          <p className="login2-sub">התחברו כדי להמשיך למערכת</p>

          <label htmlFor="login-email">אימייל</label>
          <div className="login2-field">
            <span className="login2-field-ic">{I.mail}</span>
            <input
              id="login-email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="הכנס את האימייל שלך"
              autoComplete="username" dir="ltr" required autoFocus
            />
          </div>

          <label htmlFor="login-password">סיסמה</label>
          <div className="login2-field">
            <span className="login2-field-ic">{I.lock}</span>
            <input
              id="login-password" type={show ? 'text' : 'password'} value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="הכנס את הסיסמה שלך"
              autoComplete="current-password" dir="ltr" required
            />
            <button
              type="button" className="login2-eye"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'הסתר סיסמה' : 'הצג סיסמה'}
            >
              {show ? I.eyeOff : I.eye}
            </button>
          </div>

          <div className="login2-row">
            <label className="login2-remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              זכור אותי
            </label>
            <button
              type="button" className="login2-forgot"
              onClick={() => setNotice('לאיפוס סיסמה פנו לתמיכה ונטפל בזה מיד.')}
            >
              שכחת סיסמה?
            </button>
          </div>

          {error && <p className="login-error" role="alert">{error}</p>}
          {notice && <p className="login2-notice">{notice}</p>}

          <button className="login2-submit" type="submit" disabled={busy || !email || !password}>
            {busy ? 'מתחבר…' : <> כניסה </>}
          </button>

          <div className="login2-secure">{I.shield} גישה מאובטחת</div>
        </form>
      </main>
    </div>
  );
}
