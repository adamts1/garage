/* The navy header of the expense screens: a back arrow, a title, a line under
   it, and room for one action on the far side. */

import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { C, s } from '../../lib/theme';

export function ExpenseHeader({
  title, subtitle, onBack, action,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.row, { backgroundColor: C.ink, paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 8 }]}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.onInk, fontSize: 24 }}>›</Text>
        </Pressable>
      )}
      <View style={{ flex: 1, paddingHorizontal: onBack ? 0 : 8 }}>
        <Text style={{ color: C.onInk, fontSize: 19, fontWeight: '800', textAlign: 'right' }} numberOfLines={1}>{title}</Text>
        {!!subtitle && (
          <Text style={{ color: C.onInkDim, fontSize: 12.5, textAlign: 'right' }} numberOfLines={1}>{subtitle}</Text>
        )}
      </View>
      {action}
    </View>
  );
}
