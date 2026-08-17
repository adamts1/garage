/* The login screen — a single centred card on a soft backdrop, matching the
   product mockup. Auth is email + password via signIn; see
   packages/shared/src/auth.ts for why not magic links.

   Accounts are created by an operator, so "forgot password" is not a self-serve
   reset yet — the link explains how to get back in rather than being a dead end
   or a half-built flow that mails a link nobody configured. "Remember me" is
   surfaced but the Supabase client already persists the session by default. */

import { signIn } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../../app/auth.module.css';

/** Provider messages are English and not ours to show. Only the two we can
 *  actually act on get their own wording; anything else is the same advice. */
const errorKey = (message: string): string => {
  if (/invalid login credentials/i.test(message)) return 'login.errors.badCredentials';
  if (/email not confirmed/i.test(message)) return 'login.errors.notConfirmed';
  return 'login.errors.generic';
};

/* Small inline icons — kept local so the login has no icon-set dependency. */
const I = {
  mail: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>,
  lock: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>,
  lockSm: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>,
  eye: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>,
  eyeOff: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" /><path d="M9.9 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 3-.5" /></svg>,
};

export default function LoginPage() {
  const { t } = useTranslation();
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
      /* No navigation here: useAuth is subscribed to the auth state and swaps
         the screen out the moment the session lands. */
    } catch (err) {
      setError(errorKey(err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  };

  return (
    <div className={styles.signIn}>
      <form className={styles.loginCard} onSubmit={submit}>
        <img className={styles.logo} src="/logo.png" alt="" />
        <h1 className={styles.title}>{t('login.brand')}</h1>
        <p className={styles.tagline}>{t('login.tagline')}</p>

        <label htmlFor="login-email">{t('login.email')}</label>
        <div className={styles.field}>
          <span className={styles.fieldIcon}>{I.mail}</span>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('login.emailPlaceholder')}
            autoComplete="username"
            dir="ltr"
            required
            autoFocus
          />
        </div>

        <label htmlFor="login-password">{t('login.password')}</label>
        <div className={styles.field}>
          <span className={styles.fieldIcon}>{I.lock}</span>
          <input
            id="login-password"
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('login.passwordPlaceholder')}
            autoComplete="current-password"
            dir="ltr"
            required
          />
          <button
            type="button"
            className={styles.eye}
            onClick={() => setShow((v) => !v)}
            aria-label={t(show ? 'login.hidePassword' : 'login.showPassword')}
          >
            {show ? I.eyeOff : I.eye}
          </button>
        </div>

        <div className={styles.row}>
          {/* Checkbox after the text so it sits on the inner edge, as in the
              mockup — the label still wraps it, so the hit area is the pair. */}
          <label className={styles.remember}>
            {t('login.rememberMe')}
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
          </label>
          <button
            type="button"
            className={styles.forgot}
            onClick={() => setNotice(t('login.forgotNotice'))}
          >
            {t('login.forgot')}
          </button>
        </div>

        {error && <p className={styles.error} role="alert">{t(error)}</p>}
        {notice && <p className={styles.notice}>{notice}</p>}

        <button className={styles.submit} type="submit" disabled={busy || !email || !password}>
          {busy ? t('login.signingIn') : t('login.signIn')}
        </button>

        <div className={styles.secure}>{I.lockSm} {t('login.secureData')}</div>
      </form>
    </div>
  );
}
