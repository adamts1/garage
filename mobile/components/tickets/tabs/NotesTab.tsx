/* Free text: what the mechanic wants the next person to know, and what is
   stopping the job from moving. */

import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Ticket } from '@garage/shared';
import { s } from '../../../lib/theme';
import { Field } from '../../ui';

export function NotesTab({
  draft,
  onSet,
}: {
  draft: Ticket;
  onSet: <K extends keyof Ticket>(field: K, value: Ticket[K]) => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={[s.card, { gap: 10 }]}>
      <Field label={t('ticket.fields.notes')}>
        <TextInput
          style={[s.input, { minHeight: 90 }]}
          multiline
          value={draft.notes ?? ''}
          onChangeText={(v) => onSet('notes', v)}
        />
      </Field>
      <Field label={t('ticket.fields.blocked')}>
        <TextInput
          style={s.input}
          value={draft.blocked ?? ''}
          onChangeText={(v) => onSet('blocked', v || undefined)}
        />
      </Field>
    </View>
  );
}
