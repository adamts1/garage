/* A section title with its count, and optionally the button that adds to it.

   `action` is optional: the photos section puts its two buttons on the row
   below rather than in the heading. `secondary` is a second, quieter way to add
   — the works section's free-text line beside its catalog picker. */

import { Text, View } from 'react-native';
import { s } from '../../lib/theme';
import { Button } from './Button';
import { ScrollRow } from './ScrollRow';

export function SectionHead({
  title,
  count,
  action,
  onAction,
  secondary,
  onSecondary,
}: {
  title: string;
  count: number;
  action?: string;
  onAction?: () => void;
  secondary?: string;
  onSecondary?: () => void;
}) {
  return (
    <ScrollRow>
      <Text style={s.h2}>
        {title} ({count})
      </Text>
      <View style={[s.row, { gap: 8 }]}>
        {secondary && onSecondary ? (
          <Button label={secondary} onPress={onSecondary} variant="outline" size="sm" />
        ) : null}
        {action && onAction ? (
          <Button label={`${action} +`} onPress={onAction} variant="secondary" size="sm" />
        ) : null}
      </View>
    </ScrollRow>
  );
}
