import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { setSupabaseClient } from '@garage/shared';
import App from './App';
import AuthGate from './AuthGate';
import { ModalHost } from './components/Modal';
import { ToastHost } from './components/Toast';
import './i18n';
import { supabase } from './lib/supabase';
import { ErrorBoundary, initSentry } from './lib/sentry';
import { store } from './store';
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
    {/* Outside the boundary: the fallback itself dispatches nothing, but a
        store that failed to build would take the boundary down with it. */}
    <Provider store={store}>
      <ErrorBoundary fallback={<Fallback />}>
        {/* The router wraps AuthGate, not just App: a deep link opened by someone
            signed out must survive the login screen. The URL is untouched while
            AuthGate holds them, so landing on /tickets/GAR-12 and signing in puts
            them on that ticket. */}
        <BrowserRouter>
          {/* Outside App so no board component — and so no realtime subscription —
              mounts before there is a session. */}
          <AuthGate>
            <App />
          </AuthGate>

          {/* Siblings of the whole app rather than children of a page. That is
              what lets any component raise a toast or open a modal without the
              page it sits in having to own one, and what keeps a dialog up
              across a route change. Outside AuthGate too, so the login screen
              reports failures the same way every other screen does. */}
          <ToastHost />
          <ModalHost />
        </BrowserRouter>
      </ErrorBoundary>
    </Provider>
  </React.StrictMode>,
);
