/* Entry point of the landing page, apart from the app's: no Supabase, no store,
   no router — a visitor downloads the page and nothing else. The language comes
   from the HTML file that loaded it (marketing/ or marketing/ar/). In a build
   the markup is already in the HTML (scripts/prerender-landing.mjs), so React
   hydrates it; under `npm run dev` the root is empty and React renders it. */

import React from 'react';
import ReactDOM from 'react-dom/client';
import LandingPage from './LandingPage';
import { isLang } from './languages';
import './landing-base.css';

const lang = document.documentElement.lang;

const root = document.getElementById('root')!;
const page = (
  <React.StrictMode>
    <LandingPage lang={isLang(lang) ? lang : 'he'} />
  </React.StrictMode>
);

if (root.hasChildNodes()) ReactDOM.hydrateRoot(root, page);
else ReactDOM.createRoot(root).render(page);
