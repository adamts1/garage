/* Decides which of four screens the app is on, before App renders.

   It wraps App rather than living inside it so that no board component ever
   mounts without a session — useTickets subscribes to realtime on mount, and a
   subscription opened before login would have to be torn down and reopened.

   The four states, and why "signed in with no garage" is one of them:

     loading   — a stored session is being checked. Blank, briefly. Not a login
                 form; see useAuth.
     out       — login form.
     no garage — an account exists that is not a member of any garage. Under
                 operator-created accounts this should be unreachable, which is
                 exactly why it gets a screen: if it ever appears, onboarding
                 wrote a user without writing a membership, and a spinner or an
                 empty board would hide that. It must never fall through to the
                 board — after 2c that user sees nothing, and before 2c they see
                 the backfill tenant's data, which is worse. */

import { signOut } from '@garage/shared';
import { useTranslation } from 'react-i18next';
import { isConfigured } from '../lib/supabase';
import { useAuth } from '../lib/useAuth';
import { LoginPage } from '../pages/Login';
import styles from './auth.module.css';
import SetupNotice from './SetupNotice';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const auth = useAuth();

  if (!isConfigured) return <SetupNotice />;

  if (auth.status === 'loading') {
    /* Deliberately not a spinner. This resolves from localStorage in a few
       milliseconds; a spinner would flash on every page load. */
    return <div className={styles.gate} />;
  }

  if (auth.status === 'out') return <LoginPage />;

  if (auth.status === 'no-garage') {
    return (
      <div className={styles.gate}>
        <div className={styles.card}>
          <h1>{t('authGate.noGarageTitle')}</h1>
          <p className={styles.muted}>
            {t(auth.error ? 'authGate.checkFailed' : 'authGate.noMembership')}
          </p>
          <button className="btn ghost block" onClick={() => void signOut()}>
            {t('nav.signOut')}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
