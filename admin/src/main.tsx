import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
/* The app's design tokens and base styles, so the console looks like the
   system it manages. */
import '../../src/styles.css';
import { App } from './App';
import './i18n';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
