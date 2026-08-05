/* A tick box with a label beside it.

   There were three copies of this square: "save to the catalog" in both
   pickers, "key received" on the intake form, and every subtask row on the
   ticket. They had drifted to two different sizes. */

import { Pressable, StyleProp, Text, TextStyle, View } from 'react-native';
import { C, s } from '../../lib/theme';

export function Checkbox({
  checked,
  onChange,
  label,
  labelStyle,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** For the one caller that strikes the label through once it is ticked. */
  labelStyle?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      style={[s.row, { paddingVertical: 6, gap: 10 }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
    >
      <Box checked={checked} />
      <Text style={[s.body, { flex: 1 }, labelStyle]}>{label}</Text>
    </Pressable>
  );
}

function Box({ checked }: { checked: boolean }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: checked ? C.ok : C.line,
        backgroundColor: checked ? C.ok : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked ? (
        <Text style={{ color: C.onInk, fontSize: 13, fontWeight: '800' }}>✓</Text>
      ) : null}
    </View>
  );
}
