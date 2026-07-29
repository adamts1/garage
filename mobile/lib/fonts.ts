/* Heebo, applied app-wide.
 *
 * React Native does NOT pick a bold cut from fontWeight when a custom font is
 * set — each weight is its own family (Heebo_700Bold, …). Rather than add a
 * fontFamily to all ~40 fontWeight sites (and every future one), we patch Text
 * and TextInput once so that whatever fontWeight a style already declares is
 * mapped to the matching Heebo family, and the numeric fontWeight is cleared so
 * the platform doesn't also synthesise a faux-bold on top.
 *
 * The patch is defensive: if RN's component shape ever changes so we can't find
 * a render to wrap, it no-ops and text falls back to the system font — it never
 * throws. Fonts are loaded from bundled assets, so after first launch this is
 * instant. */

import React from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import {
  useFonts,
  Heebo_400Regular,
  Heebo_500Medium,
  Heebo_600SemiBold,
  Heebo_700Bold,
  Heebo_800ExtraBold,
} from '@expo-google-fonts/heebo';

const WEIGHT_TO_FAMILY: Record<string, string> = {
  '100': 'Heebo_400Regular', '200': 'Heebo_400Regular', '300': 'Heebo_400Regular',
  '400': 'Heebo_400Regular', normal: 'Heebo_400Regular',
  '500': 'Heebo_500Medium',
  '600': 'Heebo_600SemiBold',
  '700': 'Heebo_700Bold', bold: 'Heebo_700Bold',
  '800': 'Heebo_800ExtraBold', '900': 'Heebo_800ExtraBold',
};

/** Load the Heebo weights the app uses. Returns true once ready. */
export function useHeebo(): boolean {
  const [loaded] = useFonts({
    Heebo_400Regular, Heebo_500Medium, Heebo_600SemiBold, Heebo_700Bold, Heebo_800ExtraBold,
  });
  return loaded;
}

function withHeebo(el: any) {
  if (!el || !el.props) return el;
  const flat = StyleSheet.flatten(el.props.style) || {};
  const weight = flat.fontWeight != null ? String(flat.fontWeight) : '400';
  const family = WEIGHT_TO_FAMILY[weight] ?? 'Heebo_400Regular';
  // fontFamily first (so an explicit fontFamily in the style still wins); then the
  // original style; then clear fontWeight so there's no faux-bold on the real cut.
  return React.cloneElement(el, {
    style: [{ fontFamily: family }, el.props.style, { fontWeight: undefined }],
  });
}

let patched = false;
/** Route Text/TextInput through Heebo. Safe to call more than once. */
export function applyHeebo(): void {
  if (patched) return;
  patched = true;
  for (const Comp of [Text, TextInput] as any[]) {
    try {
      if (Comp && typeof Comp.render === 'function') {
        // forwardRef component
        const orig = Comp.render;
        Comp.render = function patchedRender(...args: any[]) {
          return withHeebo(orig.apply(this, args));
        };
      } else if (Comp && Comp.prototype && typeof Comp.prototype.render === 'function') {
        // class component
        const orig = Comp.prototype.render;
        Comp.prototype.render = function patchedRender() {
          return withHeebo(orig.call(this));
        };
      }
    } catch {
      // If the internals differ, leave this component on the system font rather
      // than risk breaking every screen.
    }
  }
}
