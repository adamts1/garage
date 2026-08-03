/* How every screen keeps the keyboard off the field being typed into.
 *
 * This used to be written inline at five call sites as
 * `Platform.OS === 'ios' ? 'padding' : undefined`, and on Android `undefined`
 * means KeyboardAvoidingView renders a plain View and does nothing at all. That
 * was not an oversight: Android resized the window itself, through
 * `windowSoftInputMode="adjustResize"` in the manifest, so nothing in JS had to
 * move.
 *
 * `edgeToEdgeEnabled=true` (android/gradle.properties) ends that. An
 * edge-to-edge app draws underneath the system bars and the IME, so the window
 * is no longer resized when the keyboard opens — `adjustResize` still sits in
 * the manifest and no longer does anything. The keyboard simply covers the
 * bottom of the form, which on a phone is most of it.
 *
 * So the avoidance has to happen in JS on both platforms now. The component
 * does subscribe to keyboardDidShow/keyboardDidHide on Android (see
 * KeyboardAvoidingView.js) — it was only ever the missing `behavior` that made
 * it inert, and the offset it computes from the keyboard frame is correct under
 * edge-to-edge because the view's frame spans the whole screen.
 *
 * `padding` rather than `height`: it shrinks the content box, so a bottom
 * action bar positioned absolutely rides up above the keyboard instead of
 * hiding behind it, and the ScrollView shrinks rather than being clipped.
 */

import type { KeyboardAvoidingViewProps } from 'react-native';

export const KEYBOARD_BEHAVIOR: KeyboardAvoidingViewProps['behavior'] = 'padding';
