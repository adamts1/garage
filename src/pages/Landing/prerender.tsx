/* Server-side render of the landing page, used only at build time by
   scripts/prerender-landing.mjs. The HTML it returns is written into
   dist/marketing/(ar/)index.html, so a crawler reads the whole page without
   running any JavaScript; main.tsx then hydrates it in the browser. */

import { renderToString } from 'react-dom/server';
import LandingPage from './LandingPage';
import type { Lang } from './languages';

export const render = (lang: Lang) => renderToString(<LandingPage lang={lang} />);
