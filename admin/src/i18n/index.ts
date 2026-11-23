import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import app from '../../../src/i18n/locales/he.json';
import consoleHe from './he.json';

/* The app's locale plus the console's own, under its own namespace "console".

   The app's is needed because the reused components (Table, Tabs, Field…)
   translate a few strings of their own — "no rows", pagination. The console's
   strings never go into the app's file: the app does not ship them. */
export const resources = {
  he: { translation: { ...app, ...consoleHe } },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: 'he',
  fallbackLng: 'he',
  interpolation: { escapeValue: false },
});

export default i18n;
