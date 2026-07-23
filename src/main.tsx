import React from 'react';
import ReactDOM from 'react-dom/client';
import { setSupabaseClient } from '@garage/shared';
import App from './App';
import AuthGate from './AuthGate';
import { supabase } from './lib/supabase';
import { ErrorBoundary, initSentry } from './lib/sentry';
import './styles.css';

// Before render, so a crash during the first paint is still reported.
initSentry();

// @garage/shared has no client of its own — the browser build hands it this one.
// Must run before any component calls into the data layer.
setSupabaseClient(supabase);

/** Last resort: a white screen tells the user nothing and tells us nothing. */
const Fallback = () => (
  <div style={{ padding: 32, textAlign: 'center', fontFamily: 'inherit' }}>
    <h2>משהו השתבש</h2>
    <p>אירעה שגיאה בטעינת המערכת. נסו לרענן את הדף.</p>
    <button onClick={() => window.location.reload()}>רענון</button>
  </div>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<Fallback />}>
      {/* Outside App so no board component — and so no realtime subscription —
          mounts before there is a session. */}
      <AuthGate>
        <App />
      </AuthGate>
    </ErrorBoundary>
  </React.StrictMode>,
);
