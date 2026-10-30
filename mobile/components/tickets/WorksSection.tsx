/* The works list — each work expands to its own parts, with per-work and overall
   totals. Self-contained: it owns the catalog-picker sheets and the "which work
   is open" state, so a caller hands it `works` and gets a new array back. The
   ticket editor and the new-ticket form render the identical block this way. */

import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  VAT,
  isGarageAdmin,
  money,
  workTotal,
  worksSummary,
  type PartRow,
  type TicketWork,
} from '@garage/shared';
import { C, rtl, s } from '../../lib/theme';
import { Button, NumberPrompt, SectionHead, Stepper, TextPrompt, TotalRow, TrashIcon } from '../ui';
import { workUid } from './catalog';
import { PartPicker } from './PartPicker';
import { WorkPicker } from './WorkPicker';

export function WorksSection({
  works,
  onChange,
}: {
  works: TicketWork[];
  onChange: (works: TicketWork[]) => void;
}) {
  const { t } = useTranslation();

  const [openWork, setOpenWork] = useState<string | null>(null);
  const [pickWork, setPickWork] = useState(false);
  const [pickPartFor, setPickPartFor] = useState<string | null>(null); // work uid
  const [pricing, setPricing] = useState<{ uid: string; index: number; part: PartRow } | null>(null);
  const [laborFor, setLaborFor] = useState<TicketWork | null>(null);
  /* Free text: 'work' for a new work, or the uid of the work a part goes on. */
  const [freeFor, setFreeFor] = useState<'work' | string | null>(null);

  const sum = worksSummary(works);

  /* What a customer is charged is an admin's call. A member still adds works,
     removes them, edits their parts and writes the note — everything except
     repricing the labour on a work already on the ticket.

     This only decides what to render. save_ticket_works re-checks the role in
     the database, because a flag the client reads is a flag the client can
     lie about. Same rule as the web's WorksStep. */
  const canPrice = isGarageAdmin();

  const addWork = (w: TicketWork) => {
    onChange([...works, w]);
    setPickWork(false);
  };

  /* A line in the mechanic's own words that is not in either catalog and should
     not be. On this ticket only: no work_defs or items row, no code or מק״ט, and
     a price of zero — an admin prices it on the card. Same as the web. */
  const addFreeText = (text: string) => {
    if (freeFor === 'work') {
      const uid = workUid();
      onChange([...works, { uid, code: '', name: text, labor: 0, items: [], custom: true }]);
      setOpenWork(uid);   // open, so the price and the parts are right there
    } else if (freeFor) {
      addPart(freeFor, { sku: '', name: text, qty: 1, price: 0 });
    }
    setFreeFor(null);
  };

  const patchWork = (uid: string, patch: Partial<TicketWork>) =>
    onChange(works.map((w) => (w.uid === uid ? { ...w, ...patch } : w)));

  const removeWork = (uid: string) => onChange(works.filter((w) => w.uid !== uid));

  const addPart = (uid: string, part: PartRow) => {
    patchWork(uid, { items: [...(works.find((w) => w.uid === uid)?.items ?? []), part] });
    setPickPartFor(null);
  };

  const patchPart = (uid: string, idx: number, patch: Partial<PartRow>) => {
    const w = works.find((x) => x.uid === uid);
    if (!w) return;
    patchWork(uid, { items: w.items.map((p, i) => (i === idx ? { ...p, ...patch } : p)) });
  };

  const removePart = (uid: string, idx: number) => {
    const w = works.find((x) => x.uid === uid);
    if (!w) return;
    patchWork(uid, { items: w.items.filter((_, i) => i !== idx) });
  };

  /* A price correction is a per-unit price, not a line total: the stepper beside
     it owns the quantity. Through NumberPrompt rather than Alert.prompt, which
     exists only on iOS — see the note there. */
  const applyPrice = (price: number) => {
    if (pricing) patchPart(pricing.uid, pricing.index, { price });
    setPricing(null);
  };

  const applyLabor = (labor: number) => {
    if (laborFor) patchWork(laborFor.uid, { labor });
    setLaborFor(null);
  };

  return (
    <>
      <SectionHead
        title={t('works.section')}
        count={works.length}
        action={t('works.add')}
        onAction={() => setPickWork(true)}
        secondary={t('works.freeText')}
        onSecondary={() => setFreeFor('work')}
      />

      {works.map((w, wi) => (
        <WorkCard
          key={`${w.uid}-${wi}`}
          work={w}
          open={openWork === w.uid}
          canPrice={canPrice}
          onToggle={() => setOpenWork(openWork === w.uid ? null : w.uid)}
          onAddPart={() => setPickPartFor(w.uid)}
          onAddFreePart={() => setFreeFor(w.uid)}
          onPatchPart={(i, patch) => patchPart(w.uid, i, patch)}
          onEditPrice={(i, p) => setPricing({ uid: w.uid, index: i, part: p })}
          onEditLabor={() => setLaborFor(w)}
          onNotes={(notes) => patchWork(w.uid, { notes })}
          onRemovePart={(i) => removePart(w.uid, i)}
          onRemove={() => removeWork(w.uid)}
        />
      ))}

      {!works.length ? (
        <Text style={[s.dim, { textAlign: 'center', paddingVertical: 8 }]}>{t('works.empty')}</Text>
      ) : null}

      {works.length ? (
        <View style={[s.card, { gap: 6 }]}>
          <TotalRow label={t('works.totals.net')} value={money(sum.net)} />
          <TotalRow
            label={t('works.totals.vat', { percent: Math.round(VAT * 100) })}
            value={money(sum.vat)}
          />
          <View style={{ height: 1, backgroundColor: C.line, marginVertical: 4 }} />
          <View style={s.rowBetween}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }}>
              {t('works.totals.total')}
            </Text>
            <Text style={{ fontSize: 20, fontWeight: '800', color: C.slate }}>
              {money(sum.total)}
            </Text>
          </View>
        </View>
      ) : null}

      <NumberPrompt
        visible={Boolean(pricing)}
        title={t('works.priceTitle')}
        subtitle={pricing?.part.name}
        value={pricing?.part.price ?? 0}
        onCancel={() => setPricing(null)}
        onSubmit={applyPrice}
      />

      <TextPrompt
        visible={Boolean(freeFor)}
        title={t(freeFor === 'work' ? 'works.freeWorkTitle' : 'works.freePartTitle')}
        subtitle={t('works.freeHint')}
        placeholder={t('works.freePlaceholder')}
        onCancel={() => setFreeFor(null)}
        onSubmit={addFreeText}
      />

      <NumberPrompt
        visible={Boolean(laborFor)}
        title={t('works.laborTitle')}
        subtitle={laborFor?.name}
        value={laborFor?.labor ?? 0}
        onCancel={() => setLaborFor(null)}
        onSubmit={applyLabor}
      />

      {/* Each picker is told what this ticket already carries, so the same code
          cannot arrive twice — by being picked out of the catalog or by being
          created against it. */}
      <WorkPicker
        visible={pickWork}
        taken={works.map((w) => w.code)}
        onClose={() => setPickWork(false)}
        onPick={addWork}
      />
      <PartPicker
        workUid={pickPartFor}
        taken={works.find((w) => w.uid === pickPartFor)?.items.map((p) => p.sku) ?? []}
        onClose={() => setPickPartFor(null)}
        onPick={(part) => pickPartFor && addPart(pickPartFor, part)}
      />
    </>
  );
}

/** One work: a tappable summary row that reveals its parts and its subtotal. */
function WorkCard({
  work: w,
  open,
  canPrice,
  onToggle,
  onAddPart,
  onAddFreePart,
  onPatchPart,
  onEditPrice,
  onEditLabor,
  onNotes,
  onRemovePart,
  onRemove,
}: {
  work: TicketWork;
  open: boolean;
  /** Whether this member may reprice the labour — see WorksSection. */
  canPrice: boolean;
  onToggle: () => void;
  onAddPart: () => void;
  onAddFreePart: () => void;
  onPatchPart: (idx: number, patch: Partial<PartRow>) => void;
  onEditPrice: (idx: number, part: PartRow) => void;
  onEditLabor: () => void;
  onNotes: (notes: string) => void;
  onRemovePart: (idx: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={s.card}>
      <Pressable onPress={onToggle} style={[s.rowBetween, { gap: 10 }]} accessibilityRole="button">
        <View style={{ flex: 1 }}>
          <Text style={s.h2} numberOfLines={1}>
            {w.name}
          </Text>
          <Text style={[s.dim, { marginTop: 2 }]}>
            {t('works.summary', { n: w.items.length, amount: money(workTotal(w)) })}
            {/* A picker-made work always has a code; one without was typed in. */}
            {w.custom && !w.code ? ` · ${t('works.freeBadge')}` : ''}
          </Text>
        </View>
        <Text style={{ fontSize: 20, color: C.mist }}>{open ? '⌄' : '‹'}</Text>
      </Pressable>

      {!open ? null : (
        <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 }}>
          {/* The labour line. It used to be a bare word with no figure beside
              it, so the number the work is mostly made of was the one thing the
              card did not show. An admin taps it to reprice; everyone else
              reads it, and is told why it does not open. */}
          <Pressable
            onPress={canPrice ? onEditLabor : undefined}
            disabled={!canPrice}
            style={[s.rowBetween, { paddingVertical: 6 }]}
            accessibilityRole={canPrice ? 'button' : undefined}
            accessibilityLabel={canPrice ? t('works.laborTitle') : undefined}
          >
            <Text style={[s.body, { fontSize: 13 }]}>{t('works.labor')}</Text>
            <Text
              style={{
                fontSize: 14,
                fontWeight: '700',
                color: canPrice ? C.ink : C.dim,
                ...rtl,
              }}
            >
              {money(w.labor)}
            </Text>
          </Pressable>
          {!canPrice ? (
            <Text style={[s.dim, { fontSize: 11, paddingBottom: 6 }]}>{t('works.adminOnly')}</Text>
          ) : null}

          {/* What was actually done, against the work it was done on. Open to
              everyone: it records labour, it does not price it.

              No label above it — the placeholder says what it is, and a card
              this narrow reads better without a caption over every control.
              The name it still needs is the accessibility one.

              Written straight through on every keystroke, unlike the web's
              commit-on-blur field — here the edit lands in the screen's draft
              and reaches the database only when somebody taps save, so a
              sentence is one write and not thirty. */}
          <TextInput
            style={[s.input, { minHeight: 56, marginBottom: 12 }]}
            multiline
            value={w.notes ?? ''}
            onChangeText={onNotes}
            placeholder={t('works.notesPlaceholder')}
            placeholderTextColor={C.dim}
            accessibilityLabel={t('works.notes')}
          />

          {/* parts of THIS work — name · quantity · price · delete */}
          {w.items.map((p, i) => (
            <View
              key={`${w.uid}-${i}`}
              style={[
                s.rowBetween,
                { paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line, gap: 10 },
              ]}
            >
              <Text
                style={[s.body, { flex: 1, fontSize: 14, fontWeight: '600', textAlign: 'right' }]}
                numberOfLines={2}
              >
                {p.name}
              </Text>
              <Stepper value={p.qty} onChange={(n) => onPatchPart(i, { qty: n })} />
              <Pressable onPress={() => onEditPrice(i, p)} style={{ width: 90, alignItems: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink, ...rtl }}>
                  {money(p.qty * p.price)}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onRemovePart(i)}
                hitSlop={8}
                style={{ width: 30, alignItems: 'center' }}
                accessibilityRole="button"
                accessibilityLabel={t('common.delete')}
              >
                <TrashIcon />
              </Pressable>
            </View>
          ))}

          {!w.items.length ? (
            <Text style={[s.dim, { paddingVertical: 6 }]}>{t('works.noParts')}</Text>
          ) : null}

          <View style={[s.row, { gap: 8, marginTop: 12 }]}>
            <Button label={t('works.addPart')} onPress={onAddPart} variant="accent" style={{ flex: 2 }} />
            <Button label={t('works.freeText')} onPress={onAddFreePart} variant="outline" style={{ flex: 1 }} />
          </View>

          <View
            style={[
              s.rowBetween,
              { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
            ]}
          >
            <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink, ...rtl }}>
              {money(workTotal(w))}
            </Text>
            <Text style={[s.body, { fontSize: 14, fontWeight: '700' }]}>{t('works.subtotal')}</Text>
          </View>

          <Button
            label={t('works.remove')}
            onPress={onRemove}
            variant="link"
            color={C.danger}
            style={{ alignSelf: 'center', marginTop: 12 }}
          />
        </View>
      )}
    </View>
  );
}
