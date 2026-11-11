/* One icon per feature card, in the order the copy lists the features. */

import type { ReactNode } from 'react';

const icon = (paths: ReactNode) => (
  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);

export const FEATURE_ICONS = [
  icon(<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />),
  icon(<><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M9 12l2 2 4-4" /></>),
  icon(<><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 20v-4h-4" /></>),
  icon(<><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>),
  icon(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" /><path d="M9 8h6" /><path d="M9 12h6" /></>),
  icon(<><rect x="2" y="4" width="14" height="11" rx="1.5" /><path d="M6 19h6" /><rect x="17" y="8" width="5" height="12" rx="1.2" /></>),
];
