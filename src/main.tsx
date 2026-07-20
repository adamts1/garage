import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary, initSentry } from './lib/sentry';
import './styles.css';

// Before render, so a crash during the first paint is still reported.
initSentry();

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
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
