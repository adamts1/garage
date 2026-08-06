/* Everything about the ticket that is not a work, a photo or a note: who the
   customer is, which car, and where the job stands. */

import { Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { COLUMNS, assignableWorkers } from '@garage/shared';
import type { Status, Ticket, Worker } from '@garage/shared';
import { C, s } from '../../../lib/theme';
import { ChipGroup, Field, ReadOnly } from '../../ui';

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
        {/* The customer is shown here, never edited here.

            Who the customer is was settled at intake, and this screen writes a
            ticket — the name, phone and address on it are a denormalised copy
            of a customer record it does not own. Correcting the copy on one
            ticket left the record and every other ticket saying something else,
            which is how the same person ends up under two phone numbers. The
            customer record is the place to fix it. */}
        <View style={s.row}>
          <Field label={t('ticket.fields.customer')} flex>
            <ReadOnly value={draft.customer} />
          </Field>
          <Field label={t('ticket.fields.phone')} flex>
            <ReadOnly value={draft.phone} />
          </Field>
        </View>
        <Field label={t('ticket.fields.address')}>
          <ReadOnly value={draft.address} />
        </Field>
        <Text style={[s.dim, { fontSize: 11 }]}>{t('ticket.customerLocked')}</Text>
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
        </View>
      </View>

      <View style={[s.card, { gap: 10 }]}>
        <Field label={t('ticket.fields.status')}>
          {/* שולם is not on offer from the phone. Marking a ticket paid is a
              claim that money was taken, and the phone has no till, no invoice
              and no payment screen behind it — so the only way to reach it here
              was a mechanic's thumb. It stays visible on a ticket that already
              is paid, because hiding the state a ticket is in tells a worse lie
              than showing one that cannot be chosen. */}
          <ChipGroup
            options={COLUMNS.filter((c) => c.id !== 'paid' || draft.st === 'paid').map((c) => ({
              id: c.id,
              label: c.title,
              color: c.dot,
            }))}
            value={draft.st}
            onChange={(v) => onStatus(v as Status)}
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
