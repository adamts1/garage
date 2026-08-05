/* The subtask checklist.

   Not built on ui/Checkbox, and the reason is in the schema: `done` is a count,
   not a flag per row (supabase/schema.sql). Tapping row i means "the first i+1
   are done", and tapping the last ticked row unticks back to it — so a row's
   press is an index, not a boolean. The web board reads the same number. */

import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, s } from '../../../lib/theme';

export function ChecklistTab({
  subtasks,
  done,
  onToggle,
}: {
  subtasks: string[];
  done: number;
  onToggle: (index: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={[s.card, { gap: 8 }]}>
      <Text style={s.h2}>{t('ticket.checklist.title', { done, total: subtasks.length })}</Text>

      {subtasks.map((task, i) => (
        <Row key={i} label={task} checked={i < done} onPress={() => onToggle(i)} />
      ))}

      {!subtasks.length ? <Text style={s.dim}>{t('ticket.checklist.empty')}</Text> : null}

      <Text style={[s.dim, { fontSize: 11 }]}>{t('ticket.checklist.hint')}</Text>
    </View>
  );
}

function Row({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.row, { paddingVertical: 8, gap: 10 }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
    >
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
      <Text
        style={[
          s.body,
          {
            flex: 1,
            color: checked ? C.dim : C.text,
            textDecorationLine: checked ? 'line-through' : 'none',
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
