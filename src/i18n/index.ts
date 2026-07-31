import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he.json';

/* Hebrew is the only language today, and every string in the app used to be
   written inline in the component that showed it. Routing them all through a
   key does two things a second language would not: it puts the whole of the
   product's copy in one file where a wording change is one edit rather than a
   grep, and it makes an untranslated string a visible key rather than a
   silently-shipped one.

   Adding a language is then a file and a line in `resources` — no component is
   touched. The one thing that is NOT free is direction: index.html hardcodes
   dir="rtl", so an LTR language needs that made dynamic too. */
export const DEFAULT_LANGUAGE = 'he';

export const resources = {
  he: { translation: he },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    // React escapes everything it renders; i18next doing it again turns a
    // customer called "בני ובניו" into mojibake.
    escapeValue: false,
  },
});

export default i18n;
