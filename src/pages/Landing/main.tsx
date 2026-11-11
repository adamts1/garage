/* Entry point of the landing page, apart from the app's: no Supabase, no store,
   no router — a visitor downloads the page and nothing else. The language comes
   from the HTML file that loaded it (marketing/ or marketing/ar/). */

import React from 'react';
import ReactDOM from 'react-dom/client';
import LandingPage from './LandingPage';
import { isLang } from './languages';
import './landing-base.css';

const lang = document.documentElement.lang;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LandingPage lang={isLang(lang) ? lang : 'he'} />
  </React.StrictMode>,
);
