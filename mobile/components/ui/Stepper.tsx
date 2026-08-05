/* − n + . Never goes below one: a row with a quantity of zero is a row that
   should have been deleted, and there is a bin at the end of it for that. */

import { Pressable, Text, View, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '../../lib/theme';

const button: ViewStyle = {
  width: 30,
  height: 30,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: C.line,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: C.card,
};

export function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();

  return (
    <View
      style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, justifyContent: 'center' }}
    >
      <Pressable
        style={button}
        onPress={() => onChange(value + 1)}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={t('ui.increase')}
      >
        <Text style={{ fontSize: 16, color: C.ink }}>+</Text>
      </Pressable>
      <Text
        style={{ minWidth: 18, textAlign: 'center', fontSize: 14, fontWeight: '700', color: C.ink }}
      >
        {value}
      </Text>
      <Pressable
        style={button}
        onPress={() => onChange(Math.max(1, value - 1))}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={t('ui.decrease')}
      >
        <Text style={{ fontSize: 16, color: C.ink }}>−</Text>
      </Pressable>
    </View>
  );
}
