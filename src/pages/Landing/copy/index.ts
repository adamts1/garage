import type { Lang } from '../languages';
import ar from './ar';
import he, { type LandingCopy } from './he';

export const COPY: Record<Lang, LandingCopy> = { he, ar };
export type { LandingCopy };
