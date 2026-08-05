/* Everything about the ticket that is not a work, a photo or a note: who the
   customer is, which car, and where the job stands. */

import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { COLUMNS, PRIORITIES, assignableWorkers } from '@garage/shared';
import type { Priority, Status, Ticket, Worker } from '@garage/shared';
import { C, s } from '../../../lib/theme';
import { ChipGroup, Field } from '../../ui';

export function DetailsTab({
  draft,
  onSet,
  onStatus,
  workers,
}: {
  draft: Ticket;
  onSet: <K extends keyof Ticket>(field: K, value: Ticket[K]) => void;
  /** Status is not a plain field — landing in done/paid also closes the checklist. */
  onStatus: (status: Status) => void;
  workers: Worker[];
}) {
  const { t } = useTranslation();

  return (
    <>
      <View style={[s.card, { gap: 10 }]}>
        <Field label={t('ticket.fields.title')}>
          <TextInput
            style={[s.input, { minHeight: 60 }]}
            multiline
            value={draft.title}
            onChangeText={(v) => onSet('title', v)}
          />
        </Field>
        <View style={s.row}>
          <Field label={t('ticket.fields.customer')} flex>
            <TextInput
              style={s.input}
              value={draft.customer}
              onChangeText={(v) => onSet('customer', v)}
            />
          </Field>
          <Field label={t('ticket.fields.phone')} flex>
            <TextInput
              style={s.input}
              keyboardType="phone-pad"
              value={draft.phone ?? ''}
              onChangeText={(v) => onSet('phone', v)}
            />
          </Field>
        </View>
        <Field label={t('ticket.fields.address')}>
          <TextInput
            style={s.input}
            value={draft.address ?? ''}
            onChangeText={(v) => onSet('address', v)}
          />
        </Field>
        <View style={s.row}>
          <Field label={t('ticket.fields.car')} flex>
            <TextInput style={s.input} value={draft.car} onChangeText={(v) => onSet('car', v)} />
          </Field>
          <Field label={t('ticket.fields.plate')} flex>
            <TextInput style={s.input} value={draft.plate} onChangeText={(v) => onSet('plate', v)} />
          </Field>
        </View>
        <View style={s.row}>
          <Field label={t('ticket.fields.km')} flex>
            <TextInput
              style={s.input}
              keyboardType="numeric"
              value={draft.km ?? ''}
              onChangeText={(v) => onSet('km', v)}
            />
          </Field>
          <Field label={t('ticket.fields.year')} flex>
            <TextInput
              style={s.input}
              keyboardType="numeric"
              value={draft.year ?? ''}
              onChangeText={(v) => onSet('year', v)}
            />
          </Field>
          <Field label={t('ticket.fields.due')} flex>
            <TextInput style={s.input} value={draft.due} onChangeText={(v) => onSet('due', v)} />
          </Field>
        </View>
      </View>

      <View style={[s.card, { gap: 10 }]}>
        <Field label={t('ticket.fields.status')}>
          <ChipGroup
            options={COLUMNS.map((c) => ({ id: c.id, label: c.title, color: c.dot }))}
            value={draft.st}
            onChange={(v) => onStatus(v as Status)}
          />
        </Field>
        <Field label={t('ticket.fields.priority')}>
          <ChipGroup
            options={(Object.keys(PRIORITIES) as Priority[]).map((p) => ({
              id: p,
              label: PRIORITIES[p].t,
              color: PRIORITIES[p].c,
            }))}
            value={draft.prio}
            onChange={(v) => onSet('prio', v as Priority)}
          />
        </Field>
        <Field label={t('ticket.fields.assignee')}>
          {/* Active workers only, plus an explicit way to say nobody. Without that
              option an assignment could never be undone — ChipGroup has no
              deselect — and unassigned is a real state. */}
          <ChipGroup
            options={[
              { id: '', label: t('ticket.unassigned'), color: C.unassigned },
              ...assignableWorkers(workers).map((w) => ({
                id: w.code,
                label: w.name,
                color: w.color,
              })),
            ]}
            value={draft.who ?? ''}
            onChange={(v) => onSet('who', v || null)}
          />
        </Field>
      </View>
    </>
  );
}
