/* The landing page's languages and where each one lives. */

export const LANDING_PATHS = { he: '/marketing/', ar: '/marketing/ar/' } as const;

export type Lang = keyof typeof LANDING_PATHS;

export const isLang = (value: string): value is Lang => value in LANDING_PATHS;
