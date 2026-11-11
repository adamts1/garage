/* A right-to-left row that scrolls sideways instead of squeezing.

   With a large system font (Android's display and font size settings) a row of
   tabs or buttons no longer fits the screen, and flex shrinks every child until
   the labels wrap or clip. Inside this row the children keep their natural
   width: when they fit, it lays them out as `justify` says; when they don't, the
   row scrolls.

   The app is laid out LTR with rows reversed by hand (see lib/theme), so a
   horizontal ScrollView opens at its left end, which is the END of a Hebrew
   row. It is scrolled to the right on every size change, so the first item is
   the one in view. */

import { useRef } from 'react';
import { ScrollView, type StyleProp, type ViewStyle } from 'react-native';

export function ScrollRow({
  children,
  gap = 8,
  justify = 'space-between',
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  justify?: ViewStyle['justifyContent'];
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<ScrollView>(null);
  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[{ flexGrow: 0 }, style]}
      contentContainerStyle={{
        flexGrow: 1,
        flexDirection: 'row-reverse',
        alignItems: 'center',
        justifyContent: justify,
        gap,
      }}
      onContentSizeChange={() => ref.current?.scrollToEnd({ animated: false })}
    >
      {children}
    </ScrollView>
  );
}
