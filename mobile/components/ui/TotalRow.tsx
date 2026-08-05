/* A label on one side, its figure on the other. */

import { Text, View } from 'react-native';
import { s } from '../../lib/theme';

export function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.rowBetween}>
      <Text style={s.dim}>{label}</Text>
      <Text style={[s.body, { fontSize: 13, fontWeight: '600' }]}>{value}</Text>
    </View>
  );
}
