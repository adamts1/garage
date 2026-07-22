/* Decides which of four screens the app is on, before App renders.

   It wraps App rather than living inside it so that no board component ever
   mounts without a session — useTickets subscribes to realtime on mount, and a
   subscription opened before login would have to be torn down and reopened.

   The four states, and why "signed in with no garage" is one of them:

     loading  — a stored session is being checked. Blank, briefly. Not a login
                form; see useAuth.
     out      — login form.
     no garage— an account exists that is not a member of any garage. Under
                operator-created accounts this should be unreachable, which is
                exactly why it gets a screen: if it ever appears, onboarding
                wrote a user without writing a membership, and a spinner or an
                empty board would hide that. It must never fall through to the
                board — after 2c that user sees nothing, and before 2c they see
                the backfill tenant's data, which is worse.
     in       — the app. */

import { signOut } from '@garage/shared';
import { isConfigured } from './lib/supabase';
import { useAuth } from './lib/useAuth';
import Login from './Login';
import SetupNotice from './SetupNotice';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  if (!isConfigured) return <SetupNotice />;

  if (auth.status === 'loading') {
    // Deliberately not a spinner. This resolves from localStorage in a few
    // milliseconds; a spinner would flash on every page load.
    return <div className="login" />;
  }

  if (auth.status === 'out') return <Login />;

  if (auth.garages.length === 0) {
    return (
      <div className="login">
        <div className="login-card">
          <h1>אין הרשאה למוסך</h1>
          <p className="text-muted">
            {auth.error
              ? 'לא הצלחנו לאמת את ההרשאות. נסו לרענן, ואם זה חוזר — פנו לתמיכה.'
              : 'המשתמש קיים אך אינו משויך למוסך. פנו לתמיכה כדי להשלים את ההגדרה.'}
          </p>
          <button className="btn ghost block" onClick={() => void signOut()}>
            התנתקות
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
