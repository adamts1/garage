/* Checking what was read against the paper, fixing it, and saving it.

   Amber marks what failed a check (see scanChecks in @garage/shared): a field
   the model left blank, a line whose quantity × price is not its printed total,
   a tax id with a wrong check digit. The footer compares the items with the
   invoice's own totals — before VAT when it has VAT, the total when it has
   none — and a difference beyond rounding must be acknowledged to save. */

import { useMemo, useState } from 'react';
import {
  Alert, Image, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  applyDocumentDiscount, DuplicateInvoiceError, money, scanChecks, scanLines, VAT,
  type ExtractResponse, type ScanDraft,
} from '@garage/shared';
import { KEYBOARD_BEHAVIOR } from '../../lib/keyboard';
import { C, s } from '../../lib/theme';
import { Button, Checkbox, Chip, Field } from '../ui';
import { Banner, Input, LineCard, parseDate, Row, showDate, SupplierPicker, warnStyle } from './formParts';
import type { ReviewChoices } from './useInvoiceScan';

export function ScanReview({
  response,
  draft,
  choices,
  pageUrls,
  onDraft,
  onChoices,
  onSave,
  onSaved,
}: {
  response: ExtractResponse;
  draft: ScanDraft;
  choices: ReviewChoices;
  pageUrls: string[];
  onDraft: (d: ScanDraft) => void;
  onChoices: (c: ReviewChoices) => void;
  onSave: (allowDuplicate: boolean) => Promise<string>;
  /** The new expense, how many items it has, and its date — the list opens
   *  on that date's month. */
  onSaved: (itemCount: number, expenseId: string, date: string) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [showPages, setShowPages] = useState(true);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dateText, setDateText] = useState(showDate(draft.date));

  const checks = useMemo(
    () => scanChecks(draft, { supplierChosen: choices.supplierId != null }),
    [draft, choices.supplierId],
  );
  const ex = response.extraction;

  const set = (patch: Partial<ScanDraft>) => onDraft({ ...draft, ...patch });
  const choose = (patch: Partial<ReviewChoices>) => onChoices({ ...choices, ...patch });

  const setLine = (i: number, field: 'desc' | 'qty' | 'unitPrice', value: string) =>
    set({
      lines: draft.lines.map((l, j) => (j === i
        ? { ...l, [field]: value, flags: l.flags.filter((f) => f !== field) }
        : l)),
    });
  const removeLine = (i: number) => set({ lines: draft.lines.filter((_, j) => j !== i) });
  const addLine = () => set({ lines: [...draft.lines, { desc: '', qty: '', unitPrice: '', flags: [] }] });

  const blocked = checks.missing.length > 0 || checks.incomplete
    || (checks.mismatch != null && !choices.acceptMismatch);

  const doSave = async (allowDuplicate: boolean) => {
    setSaving(true);
    try {
      const id = await onSave(allowDuplicate);
      onSaved(scanLines(draft).lines.length, id, draft.date);
    } catch (e) {
      if (e instanceof DuplicateInvoiceError) {
        Alert.alert(t('scan.review.dupConfirmTitle'), t('scan.review.dupConfirmBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('scan.review.dupSave'), style: 'destructive', onPress: () => void doSave(true) },
        ]);
      } else {
        Alert.alert(t('scan.review.saveFailed'), e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const vatNote = draft.vatRate === 0
    ? (draft.vatBasis === 'exempt_dealer' ? t('scan.review.vatExempt')
      : draft.vatBasis === 'no_vat_on_document' ? t('scan.review.vatNoneFound') : null)
    : (draft.vatBasis === 'unclear' ? t('scan.review.vatUnclear') : null);

  const footerState = checks.expected == null ? 'none' : checks.mismatch == null ? 'match' : 'mismatch';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD_BEHAVIOR}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {/* The original, to compare against. */}
        {pageUrls.length > 0 && (
          <View style={{ backgroundColor: '#2a2e33' }}>
            {showPages && (
              <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                {pageUrls.map((u, i) => (
                  <Pressable
                    key={u}
                    onPress={() => setZoomed(u)}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={t('scan.review.pageOf', { n: i + 1, count: pageUrls.length })}
                  >
                    <Image source={{ uri: u }} style={{ width, height: 260 }} resizeMode="contain" />
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable onPress={() => setShowPages((v) => !v)} style={{ padding: 12, alignItems: 'center' }} accessibilityRole="button">
              <Text style={{ color: C.onInkDim, fontSize: 13, fontWeight: '600' }}>
                {showPages ? t('scan.review.hidePages') : t('scan.review.showPages', { count: pageUrls.length })}
              </Text>
            </Pressable>
          </View>
        )}

        <View style={{ padding: 16, gap: 12 }}>
          {!!response.duplicate_of && (
            <Banner tone="danger" title={t('scan.review.duplicateTitle')} body={t('scan.review.duplicateBody')} />
          )}
          {!!ex.unreadable && <Banner tone="warn" body={t('scan.review.unreadable', { text: ex.unreadable })} />}

          {/* Supplier, number, date, payment. */}
          <View style={[s.card, { gap: 12 }]}>
            {choices.supplierId ? (
              <Field label={t('scan.review.supplier')}>
                <View style={[s.rowBetween, s.input, choices.matchedBy === 'name' ? warnStyle : null]}>
                  <Text style={[s.body, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>{choices.supplierLabel}</Text>
                  {choices.matchedBy && (
                    <Text style={{
                      fontSize: 11, fontWeight: '700', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
                      color: choices.matchedBy === 'tax_id' ? C.okText : C.warnText,
                      backgroundColor: choices.matchedBy === 'tax_id' ? C.okBg : C.card,
                    }}>
                      {choices.matchedBy === 'tax_id' ? t('scan.review.matchedTax') : t('scan.review.matchedName')}
                    </Text>
                  )}
                </View>
                <View style={[s.row, { marginTop: 6, gap: 6 }]}>
                  <Button size="sm" variant="link" label={t('scan.review.changeSupplier')} onPress={() => setPicking(true)} />
                  <Button size="sm" variant="link" label={t('scan.review.useNew')}
                    onPress={() => choose({ supplierId: null, supplierLabel: null, matchedBy: null })} />
                </View>
              </Field>
            ) : (
              <View style={{ gap: 10 }}>
                <View style={s.rowBetween}>
                  <Text style={s.label}>{t('scan.review.supplier')}</Text>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: C.slate, backgroundColor: C.tint, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                    {t('scan.review.newSupplier')}
                  </Text>
                </View>
                <Field label={t('scan.review.supplierName')}>
                  <Input value={draft.supplierName} warn={!draft.supplierName.trim()}
                    onChangeText={(v) => set({ supplierName: v })} />
                </Field>
                <Field label={t('scan.review.taxId')}>
                  <Input value={draft.supplierTaxId} keyboardType="number-pad" warn={checks.taxIdInvalid}
                    onChangeText={(v) => set({ supplierTaxId: v })} />
                  {checks.taxIdInvalid && (
                    <Text style={[s.dim, { color: C.warnText, marginTop: 4 }]}>{t('scan.review.taxIdInvalid')}</Text>
                  )}
                </Field>
                <Button size="sm" variant="link" label={t('scan.review.pickExisting')} onPress={() => setPicking(true)} />
              </View>
            )}

            <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
              <Field label={t('scan.review.reference')} flex>
                <Input value={draft.reference} warn={!draft.reference.trim()} onChangeText={(v) => set({ reference: v })} />
              </Field>
              <Field label={t('scan.review.date')} flex>
                <Input
                  value={dateText}
                  placeholder={t('scan.review.datePlaceholder')}
                  keyboardType="numbers-and-punctuation"
                  warn={!draft.date}
                  onChangeText={(v) => { setDateText(v); set({ date: parseDate(v) }); }}
                />
              </Field>
            </View>

            <Field label={t('scan.review.payment')}>
              <View style={[s.row, { gap: 6 }]}>
                <Chip label={t('scan.review.paid')} active={choices.paid} onPress={() => choose({ paid: true })} />
                <Chip label={t('scan.review.unpaid')} active={!choices.paid} onPress={() => choose({ paid: false })} />
              </View>
            </Field>
            {choices.paid && (
              <Field label={t('scan.review.chequeNumber')}>
                <Input value={choices.chequeNumber} keyboardType="number-pad" onChangeText={(v) => choose({ chequeNumber: v })} />
              </Field>
            )}
          </View>

          {/* The items. */}
          <View style={[s.rowBetween, { paddingHorizontal: 2 }]}>
            <Text style={s.h2}>{t('scan.review.items', { count: draft.lines.length })}</Text>
            <Text style={s.dim}>{draft.vatRate === 0 ? t('scan.review.pricesNoVat') : t('scan.review.pricesBeforeVat')}</Text>
          </View>
          {draft.converted === 'from_incl_vat' && <Banner tone="info" body={t('scan.review.convertedInclVat')} />}
          {draft.documentDiscount != null && (
            <Banner tone="warn" title={t('scan.review.discountTitle', { amount: money(draft.documentDiscount) })}>
              <Button size="sm" variant="secondary" label={t('scan.review.discountApply')}
                onPress={() => onDraft(applyDocumentDiscount(draft))} />
            </Banner>
          )}

          {draft.lines.map((l, i) => (
            <LineCard key={i} line={l} onChange={(f, v) => setLine(i, f, v)} onRemove={() => removeLine(i)} />
          ))}
          <Button variant="secondary" label={t('scan.review.addLine')} onPress={addLine} />

          {/* VAT and what the invoice itself says. */}
          <View style={[s.card, { gap: 8 }]}>
            <View style={s.rowBetween}>
              <Text style={s.label}>{t('scan.review.vat')}</Text>
              <View style={[s.row, { gap: 6 }]}>
                <Chip label={t('scan.review.vat18')} active={draft.vatRate > 0} onPress={() => set({ vatRate: VAT })} />
                <Chip label={t('scan.review.vatNone')} active={draft.vatRate === 0} onPress={() => set({ vatRate: 0 })} />
              </View>
            </View>
            {!!vatNote && <Text style={[s.dim, draft.vatBasis === 'unclear' ? { color: C.warnText } : null]}>{vatNote}</Text>}
            <View style={{ height: 1, backgroundColor: C.line }} />
            <Text style={s.label}>{t('scan.review.fromInvoice')}</Text>
            {draft.vatRate > 0 && ex.subtotal != null && <Row label={t('scan.review.beforeVat')} value={money(ex.subtotal)} />}
            {draft.vatRate > 0 && ex.vat_amount != null && <Row label={t('scan.review.vatAmount')} value={money(ex.vat_amount)} />}
            {ex.total != null && <Row label={t('scan.review.total')} value={money(ex.total)} bold />}
            {checks.vatMismatch && <Text style={[s.dim, { color: C.warnText }]}>{t('scan.review.vatOff')}</Text>}
          </View>
        </View>
      </ScrollView>

      {/* What the items come to, against the invoice, and save. */}
      <View style={{ padding: 12, paddingBottom: 12 + insets.bottom, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card, gap: 8 }}>
        <View style={{
          borderRadius: 10, padding: 10, gap: 2,
          backgroundColor: footerState === 'match' ? C.okBg : footerState === 'mismatch' ? C.dangerBg : C.tint,
        }}>
          {footerState === 'match' && (
            <Row label={t('scan.review.match')} value={money(checks.linesSubtotal)} color={C.okText} bold />
          )}
          {footerState === 'none' && (
            <Row label={t('scan.review.noTotals')} value={money(checks.linesSubtotal)} color={C.slate} bold />
          )}
          {footerState === 'mismatch' && (
            <>
              <Row label={t('scan.review.linesSum')} value={money(checks.linesSubtotal)} color={C.danger} />
              <Row label={t('scan.review.expected')} value={money(checks.expected ?? 0)} color={C.danger} />
              <Text style={[s.dim, { color: C.danger, fontWeight: '600' }]}>
                {(checks.mismatch ?? 0) < 0
                  ? t('scan.review.short', { amount: money(-(checks.mismatch ?? 0)) })
                  : t('scan.review.over', { amount: money(checks.mismatch ?? 0) })}
              </Text>
            </>
          )}
        </View>
        {footerState === 'mismatch' && (
          <Checkbox checked={choices.acceptMismatch} onChange={(v) => choose({ acceptMismatch: v })} label={t('scan.review.acceptMismatch')} />
        )}
        {checks.missing.length > 0 && (
          <Text style={[s.dim, { color: C.danger }]}>
            {checks.missing.map((m) => t(m === 'supplier' ? 'scan.review.missingSupplier'
              : m === 'date' ? 'scan.review.missingDate' : 'scan.review.missingLines')).join(' · ')}
          </Text>
        )}
        {checks.incomplete && <Text style={[s.dim, { color: C.danger }]}>{t('scan.review.incomplete')}</Text>}
        <Button label={t('scan.review.save')} busy={saving} disabled={blocked} onPress={() => void doSave(false)} />
      </View>

      <SupplierPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(sp) => {
          setPicking(false);
          choose({ supplierId: sp.id, supplierLabel: sp.name, matchedBy: null });
        }}
      />

      <Modal visible={zoomed != null} transparent={false} animationType="fade" onRequestClose={() => setZoomed(null)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <ScrollView
            maximumZoomScale={4}
            minimumZoomScale={1}
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
            centerContent
          >
            {zoomed && <Image source={{ uri: zoomed }} style={{ width: '100%', aspectRatio: 0.7 }} resizeMode="contain" />}
          </ScrollView>
          <View style={{ position: 'absolute', top: insets.top + 8, right: 12 }}>
            <Button size="sm" variant="secondary" label={t('common.close')} onPress={() => setZoomed(null)} />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
