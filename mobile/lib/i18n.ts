/* Every string the phone app shows, in one file instead of inline in the
   component that shows it. Mirrors src/i18n/index.ts — same library, same
   `t('a.b.c')` call, so moving between the two apps needs no relearning.

   The locale file is the app's own rather than the web's. The phone shows a
   subset of the product with its own wording ("קריאות" in a list the web calls
   a board), and merging them would ship the invoice, report and supplier copy
   in a bundle that has no screen for any of it. Strings that must agree —
   status titles, priorities — already come from @garage/shared, which is where
   the agreement is enforced.

   What is NOT in here: text that gets written to the database. A ticket's
   flags and its default title are values the web board reads back, so
   translating them would change stored data, not the display. Those stay as
   constants next to the code that writes them (components/tickets/newTicket.ts). */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he.json';

export const DEFAULT_LANGUAGE = 'he';

export const resources = {
  he: { translation: he },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    // React escapes what it renders; i18next escaping it again turns a customer
    // called "בני ובניו" into mojibake.
    escapeValue: false,
  },
});

export default i18n;
