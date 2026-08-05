/* The works list — each work expands to its own parts, with per-work and overall
   totals. Self-contained: it owns the catalog-picker sheets and the "which work
   is open" state, so a caller hands it `works` and gets a new array back. The
   ticket editor and the new-ticket form render the identical block this way. */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { VAT, money, workTotal, worksSummary, type PartRow, type TicketWork } from '@garage/shared';
import { C, rtl, s } from '../../lib/theme';
import { Button, NumberPrompt, SectionHead, Stepper, TotalRow, TrashIcon } from '../ui';
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

  const sum = worksSummary(works);

  const addWork = (w: TicketWork) => {
    onChange([...works, w]);
    setPickWork(false);
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

  return (
    <>
      <SectionHead
        title={t('works.section')}
        count={works.length}
        action={t('works.add')}
        onAction={() => setPickWork(true)}
      />

      {works.map((w, wi) => (
        <WorkCard
          key={`${w.uid}-${wi}`}
          work={w}
          open={openWork === w.uid}
          onToggle={() => setOpenWork(openWork === w.uid ? null : w.uid)}
          onAddPart={() => setPickPartFor(w.uid)}
          onPatchPart={(i, patch) => patchPart(w.uid, i, patch)}
          onEditPrice={(i, p) => setPricing({ uid: w.uid, index: i, part: p })}
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

      <WorkPicker visible={pickWork} onClose={() => setPickWork(false)} onPick={addWork} />
      <PartPicker
        workUid={pickPartFor}
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
  onToggle,
  onAddPart,
  onPatchPart,
  onEditPrice,
  onRemovePart,
  onRemove,
}: {
  work: TicketWork;
  open: boolean;
  onToggle: () => void;
  onAddPart: () => void;
  onPatchPart: (idx: number, patch: Partial<PartRow>) => void;
  onEditPrice: (idx: number, part: PartRow) => void;
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
          </Text>
        </View>
        <Text style={{ fontSize: 20, color: C.mist }}>{open ? '⌄' : '‹'}</Text>
      </Pressable>

      {!open ? null : (
        <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 }}>
          <View style={[s.rowBetween, { paddingVertical: 6 }]}>
            <Text style={[s.body, { fontSize: 13 }]}>{t('works.labor')}</Text>
          </View>

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

          <Button
            label={t('works.addPart')}
            onPress={onAddPart}
            variant="accent"
            style={{ marginTop: 12 }}
          />

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
