import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { setSupabaseClient } from '@garage/shared';
import App from './App';
import AuthGate from './app/AuthGate';
import { BusyOverlay } from './components/Busy';
import { ModalHost } from './components/Modal';
import { ToastHost } from './components/Toast';
import { CatalogProvider } from './features/catalog';
import './i18n';
import { projectUrl, supabase } from './lib/supabase';
import { ErrorBoundary, initSentry } from './lib/sentry';
import { store } from './store';
import './styles.css';

// Before render, so a crash during the first paint is still reported.
initSentry();

// @garage/shared has no client of its own — the browser build hands it this one.
// Must run before any component calls into the data layer.
setSupabaseClient(supabase, projectUrl);

/** Last resort: a white screen tells the user nothing and tells us nothing. */
const Fallback = () => (
  <div style={{ padding: 32, textAlign: 'center', fontFamily: 'inherit' }}>
    <h2>משהו השתבש</h2>
    <p>אירעה שגיאה בטעינת המערכת. נסו לרענן את הדף.</p>
    <button onClick={() => window.location.reload()}>רענון</button>
  </div>
);

/* A data router, not <BrowserRouter>: only a data router can hold a navigation
   back (useBlocker), and that is how an open ticket with unsaved edits gets to
   ask before the sidebar or the browser's Back button takes it away. One splat
   route — the screens themselves are still matched by App's <Routes>.

   The router wraps AuthGate, not just App: a deep link opened by someone signed
   out must survive the login screen. The URL is untouched while AuthGate holds
   them, so landing on /tickets/GAR-12 and signing in puts them on that ticket. */
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      /* Inside the route, not around the router: a data router catches render
         errors in its routes itself, so a boundary outside it would never see
         one and Sentry would never hear of it. */
      <ErrorBoundary fallback={<Fallback />}>
        {/* Outside App so no board component — and so no realtime subscription —
            mounts before there is a session. */}
        <AuthGate>
          {/* Inside the gate on purpose: the catalogue is tenant data behind
              RLS, so loading it before there is a session buys a 401 and an
              error toast on the login screen. */}
          <CatalogProvider>
            <App />

            {/* A sibling of the app rather than a child of a page — that is
                what lets any component open a modal without the page it sits
                in owning one, and keeps a dialog up across a route change.
                Inside the provider because the work and part pickers read the
                catalogue for themselves. */}
            <ModalHost />
          </CatalogProvider>
        </AuthGate>

        {/* Outside the gate, both of them: the login screen waits on the
            network and reports failures the same way every other screen
            does. */}
        <BusyOverlay />
        <ToastHost />
      </ErrorBoundary>
    ),
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Outside the router: a store that failed to build would take everything
        inside down with it. */}
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </React.StrictMode>,
);
