/* Phone vs. tablet, from the live window size.

   useWindowDimensions re-renders on rotation and iPad split-view resize, so a
   phone-width Slide Over falls back to the phone layout and a full-screen iPad
   gets the two-pane one. The test is the *shortest* side: a phone in landscape
   is still a phone, but any orientation of a tablet clears 600dp on both axes. */

import { useWindowDimensions } from 'react-native';

/** Android's own tablet cutoff (smallestWidth 600dp); iPads sit well above it. */
export const TABLET_MIN = 600;

export type DeviceType = 'phone' | 'tablet';

export function useDeviceType(): DeviceType {
  const { width, height } = useWindowDimensions();
  return Math.min(width, height) >= TABLET_MIN ? 'tablet' : 'phone';
}

export function useIsTablet(): boolean {
  return useDeviceType() === 'tablet';
}
