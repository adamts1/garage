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
  icon(<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>),
  icon(<><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4" /><path d="M12 10v7" /><path d="M9 14l3 3 3-3" /></>),
  icon(<><path d="M4 8h14" /><path d="M15 5l3 3-3 3" /><path d="M20 16H6" /><path d="M9 13l-3 3 3 3" /></>),
  icon(<><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>),
];

/* Store marks for the footer download links. */
export const APPLE_ICON = (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM13.9 5c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z" />
  </svg>
);

export const ANDROID_ICON = (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.6 9.5l1.8-3.1a.4.4 0 0 0-.7-.4l-1.8 3.1a11 11 0 0 0-9.8 0L5.3 6a.4.4 0 0 0-.7.4l1.8 3.1A10.4 10.4 0 0 0 1 18h22a10.4 10.4 0 0 0-5.4-8.5zM7 15.3a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2zm10 0a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2z" />
  </svg>
);
