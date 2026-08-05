/* The one button.

   Before this there were fourteen Pressables, each with its own inline padding,
   radius, disabled opacity and font weight — which is why "save" was 14pt on one
   screen and 15 on the next, and why two of them had no minimum tap target at
   all. The variants below are the ones the product actually uses; a fifteenth
   shape should be a new variant here rather than another inline style. */

import { ActivityIndicator, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { C } from '../../lib/theme';

export type ButtonVariant =
  /** Filled with `color`. The one action a screen most wants you to take. */
  | 'primary'
  /** Quiet tinted pill — a secondary action sitting next to a heading. */
  | 'secondary'
  /** Bordered and neutral. Sits beside a primary without competing with it. */
  | 'outline'
  /** Bordered in `color`. Loud enough to be found, quiet enough to not be the primary. */
  | 'accent'
  /** No chrome at all — for an action that should be findable but not inviting. */
  | 'link';

export type ButtonSize = 'sm' | 'md';

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  color = C.ink,
  busy = false,
  disabled = false,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** The accent: the fill for `primary`, the border and text elsewhere. */
  color?: string;
  /** Swaps the label for a spinner and blocks the press. */
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const off = disabled || busy;
  const small = size === 'sm';

  const shape: ViewStyle = {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: small ? 10 : 12,
    paddingVertical: small ? 7 : 14,
    paddingHorizontal: small ? 12 : 16,
    // 48dp is the smallest thing a thumb finds reliably; the small pill is a
    // secondary action next to a heading, where the row sets the height.
    minHeight: small ? undefined : 48,
    opacity: off ? 0.5 : 1,
  };

  const skin: Record<ButtonVariant, { view: ViewStyle; text: string }> = {
    primary: { view: { backgroundColor: color }, text: C.onInk },
    secondary: {
      view: { backgroundColor: C.tint, borderWidth: 1, borderColor: C.mist },
      text: C.slate,
    },
    outline: { view: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line }, text: C.ink },
    accent: { view: { backgroundColor: C.card, borderWidth: 1.5, borderColor: color }, text: color },
    link: { view: {}, text: color },
  };

  const { view, text } = skin[variant];
  const linkish = variant === 'link';

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[shape, view, linkish && { paddingVertical: 6, minHeight: undefined }, style]}
    >
      {/* Held at the label's size so swapping in the spinner does not resize the
          button and shuffle whatever is laid out beside it. */}
      {busy ? (
        <View style={{ height: small ? 16 : 19, justifyContent: 'center' }}>
          <ActivityIndicator color={variant === 'primary' ? C.onInk : color} />
        </View>
      ) : (
        <Text
          style={{
            color: text,
            fontSize: small ? 13 : 15,
            fontWeight: variant === 'primary' ? '800' : '700',
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
