/* A labelled form control. `flex` is for the rows that put two or three of
   these side by side and want them to share the width evenly. */

import { Text, View } from 'react-native';
import { s } from '../../lib/theme';

export function Field({
  label,
  children,
  flex,
}: {
  label: string;
  children: React.ReactNode;
  flex?: boolean;
}) {
  return (
    <View style={flex ? { flex: 1 } : undefined}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}
