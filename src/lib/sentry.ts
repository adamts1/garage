/* Error tracking.

   Off unless VITE_SENTRY_DSN is set, so dev, CI and anyone without a DSN run
   untouched.

   The scrubbing below is not optional politeness. We hold customer names,
   phones, addresses and plates, and PostgREST puts filters in the query string
   — `.eq('name', 'יוסי לוי')` becomes `?name=eq.%D7%99...`. Sentry records fetch
   breadcrumbs with full URLs, so without this every customer we look up would
   be shipped to a third party. See docs/PRODUCTION.md §6. */

import * as Sentry from '@sentry/react';
import { scrubUrl } from './scrub';

const DSN = (import.meta.env.VITE_SENTRY_DSN ?? '').trim();

export const isSentryEnabled = Boolean(DSN);

export function initSentry() {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,

    // Errors only for now. Turn tracing on deliberately, with a sample rate.
    tracesSampleRate: 0,

    beforeBreadcrumb(crumb) {
      if (crumb.data?.url && typeof crumb.data.url === 'string') {
        crumb.data.url = scrubUrl(crumb.data.url);
      }
      // Console breadcrumbs can contain anything we ever logged. Not worth the risk.
      if (crumb.category === 'console') return null;
      return crumb;
    },

    beforeSend(event) {
      if (event.request?.url) event.request.url = scrubUrl(event.request.url);
      delete event.request?.cookies;
      delete event.user;
      return event;
    },
  });
}

export const ErrorBoundary = Sentry.ErrorBoundary;
