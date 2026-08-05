/* A section title with its count, and optionally the button that adds to it.

   `action` is optional: the photos section puts its two buttons on the row
   below rather than in the heading. */

import { Text, View } from 'react-native';
import { s } from '../../lib/theme';
import { Button } from './Button';

export function SectionHead({
  title,
  count,
  action,
  onAction,
}: {
  title: string;
  count: number;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.rowBetween}>
      <Text style={s.h2}>
        {title} ({count})
      </Text>
      {action && onAction ? (
        <Button label={`+ ${action}`} onPress={onAction} variant="secondary" size="sm" />
      ) : null}
    </View>
  );
}
