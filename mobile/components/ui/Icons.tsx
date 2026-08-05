/* Icons drawn out of Views.

   The app carries no icon font and no SVG renderer, and these three shapes are
   not worth either. Everything else on screen is an emoji or a glyph the system
   already has. */

import { View } from 'react-native';
import { C } from '../../lib/theme';

/** A trash can. `size` scales every part of it, so it fits any row height. */
export function TrashIcon({ color = C.danger, size = 20 }: { color?: string; size?: number }) {
  const bodyW = size * 0.62;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: size * 0.14,
      }}
    >
      {/* handle */}
      <View
        style={{
          width: bodyW * 0.44,
          height: size * 0.09,
          borderTopLeftRadius: 2,
          borderTopRightRadius: 2,
          backgroundColor: color,
        }}
      />
      {/* lid */}
      <View
        style={{
          width: bodyW * 1.32,
          height: size * 0.11,
          borderRadius: 2,
          backgroundColor: color,
          marginTop: size * 0.04,
        }}
      />
      {/* can */}
      <View
        style={{
          width: bodyW,
          flex: 1,
          marginTop: size * 0.07,
          borderWidth: Math.max(1.5, size * 0.1),
          borderTopWidth: 0,
          borderColor: color,
          borderBottomLeftRadius: size * 0.18,
          borderBottomRightRadius: size * 0.18,
        }}
      />
    </View>
  );
}

/** The universal power mark, used for sign-out. */
export function PowerIcon({ color = C.danger }: { color?: string }) {
  return (
    <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          borderWidth: 2,
          borderColor: color,
          marginTop: 3,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          width: 2,
          height: 9,
          borderRadius: 1,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/** Three bars — the header's menu opener. */
export function MenuIcon({ color = C.onInk }: { color?: string }) {
  return (
    <View style={{ gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 22, height: 2, borderRadius: 1, backgroundColor: color }} />
      ))}
    </View>
  );
}
