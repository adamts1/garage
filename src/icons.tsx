/* Line icons drawn with currentColor, so they always match the colour of the
   label beside them — including :hover and .active states. */

const base = {
  width: 19,
  height: 19,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const IconBoard = () => (
  <svg {...base}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const IconTickets = () => (
  <svg {...base}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 10h18" />
    <path d="M8 15h5" />
  </svg>
);

export const IconCustomers = () => (
  <svg {...base}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
);

export const IconParts = () => (
  <svg {...base}>
    <path d="M12 3 4 7v10l8 4 8-4V7z" />
    <path d="M4 7l8 4 8-4" />
    <path d="M12 21V11" />
  </svg>
);

export const IconReports = () => (
  <svg {...base}>
    <path d="M4 20h16" />
    <rect x="6" y="11" width="3.4" height="6" rx="1" />
    <rect x="12" y="7" width="3.4" height="10" rx="1" />
    <rect x="18" y="14" width="2" height="3" rx="1" />
  </svg>
);

export const IconPin = ({ filled = false }: { filled?: boolean }) => (
  <svg {...base} fill={filled ? 'currentColor' : 'none'}>
    <path d="M9 4h6l-1 6 3 3v1H7v-1l3-3z" />
    <path d="M12 14v6" />
  </svg>
);

export const IconWrench = ({ size = 19 }: { size?: number }) => (
  <svg {...base} width={size} height={size}>
    <path d="M15.5 3.5a5 5 0 0 0-6.1 6.4L3.6 15.7a2 2 0 0 0 2.8 2.8l5.8-5.8a5 5 0 0 0 6.4-6.1l-3 3-2.4-2.4z" />
  </svg>
);

export const IconBox = ({ size = 19 }: { size?: number }) => (
  <svg {...base} width={size} height={size}>
    <path d="M12 3 4 7v10l8 4 8-4V7z" />
    <path d="M4 7l8 4 8-4" />
    <path d="M12 21V11" />
  </svg>
);

export const IconCar = () => (
  <svg {...base}>
    <path d="M5 17h14" />
    <path d="M4 17v-4l2-5h12l2 5v4" />
    <circle cx="7.5" cy="17" r="1.6" />
    <circle cx="16.5" cy="17" r="1.6" />
  </svg>
);

export const IconDoc = () => (
  <svg {...base}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

export const IconClock = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
);

export const IconChat = () => (
  <svg {...base}>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
  </svg>
);

export const IconPrint = () => (
  <svg {...base}>
    <path d="M7 9V4h10v5" />
    <rect x="4" y="9" width="16" height="7" rx="2" />
    <path d="M7 14h10v6H7z" />
  </svg>
);

export const IconCard = () => (
  <svg {...base}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 10h18" />
  </svg>
);

export const IconTrash = () => (
  <svg {...base}>
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <path d="M6 7l1 13h10l1-13" />
  </svg>
);

export const IconCheck = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </svg>
);

export const IconToolbox = ({ size = 44 }: { size?: number }) => (
  <svg {...base} width={size} height={size} strokeWidth={1.3}>
    <rect x="3" y="8" width="18" height="11" rx="2" />
    <path d="M3 12h18" />
    <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    <path d="M10.5 12h3v2.5h-3z" />
  </svg>
);

export const IconWhatsapp = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.22.25-.85.84-.85 2.05s.87 2.37.99 2.54c.12.16 1.71 2.61 4.15 3.66.58.25 1.03.4 1.39.51.58.19 1.11.16 1.53.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z" />
  </svg>
);
