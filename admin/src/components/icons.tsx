/* The console's icons: the app's own where it has one (same stroke, same
   size), and the few the app never needed drawn the same way. */
export { IconCar, IconLayers, IconSearch } from '../../../src/icons';

const base = {
  width: 19,
  height: 19,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const IconPlusSquare = () => (
  <svg {...base}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

export const IconPlus = () => (
  <svg {...base} width={17} height={17} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconCode = () => (
  <svg {...base}>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
  </svg>
);

export const IconPhone = () => (
  <svg {...base}>
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
    <path d="M11 18h2" />
  </svg>
);

export const IconRefresh = () => (
  <svg {...base} width={17} height={17}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v5h-5" />
  </svg>
);

export const IconFilter = () => (
  <svg {...base} width={17} height={17}>
    <path d="M4 5h16l-6 7.5V19l-4 1.5v-8L4 5Z" />
  </svg>
);

/* The brand mark: a car in outline, as on the landing page's header. */
export const IconLogo = () => (
  <svg {...base} width={34} height={34} strokeWidth={1.6}>
    <path d="M3 15.5V13l2.2-4.2A2 2 0 0 1 7 7.7h10a2 2 0 0 1 1.8 1.1L21 13v2.5a1 1 0 0 1-1 1h-1.2" />
    <path d="M5.2 16.5H4a1 1 0 0 1-1-1" />
    <circle cx="7.5" cy="16.5" r="1.8" />
    <circle cx="16.5" cy="16.5" r="1.8" />
    <path d="M9.3 16.5h5.4M4 12.5h16" />
  </svg>
);
