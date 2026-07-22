/* The login form. Email and password — see packages/shared/src/auth.ts for why
   not magic links.

   Accounts are created by an operator, so there is no "sign up" link and no
   "forgot password" yet: both would be dead ends. A garage that cannot get in
   phones us, and we reset it. That is honest for ten pilot customers and should
   be replaced before it is a hundred. */

import { useState } from 'react';
import { signIn } from '@garage/shared';

/** Supabase returns English; these are the only two a user can actually cause. */
const hebrewError = (message: string): string => {
  if (/invalid login credentials/i.test(message)) return 'האימייל או הסיסמה שגויים.';
  if (/email not confirmed/i.test(message)) return 'החשבון עדיין לא אושר. פנו לתמיכה.';
  return 'ההתחברות נכשלה. נסו שוב, ואם זה חוזר — פנו לתמיכה.';
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      // No navigation here: useAuth is subscribed to the auth state and swaps
      // the screen out from under this component the moment the session lands.
    } catch (err) {
      setError(hebrewError(err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>מוסך</h1>
        <p className="text-muted">התחברות למערכת</p>

        <label htmlFor="login-email">אימייל</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          dir="ltr"
          required
          autoFocus
        />

        <label htmlFor="login-password">סיסמה</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          dir="ltr"
          required
        />

        {/* role=alert so a screen reader announces a failed attempt; without it
            the only feedback is visual and the form looks like it did nothing. */}
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <button className="btn primary block" type="submit" disabled={busy || !email || !password}>
          {busy ? 'מתחבר…' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}
