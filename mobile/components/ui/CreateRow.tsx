/* The dashed row under a picker's list: nothing matched, so make one.
   Dashed rather than solid because it is an invitation, not a result. */

import { Pressable, Text } from 'react-native';
import { C, s } from '../../lib/theme';

export function CreateRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[s.card, { borderStyle: 'dashed', borderColor: C.mist }]}
    >
      <Text style={[s.h2, { color: C.slate }]}>+ {label}</Text>
    </Pressable>
  );
}
