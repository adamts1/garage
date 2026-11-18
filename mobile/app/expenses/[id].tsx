/* One expense on the phone: its document, details, items and payment, with
   "mark as paid" at hand — the thing most often done from the floor, when the
   supplier's driver is waiting for a cheque. Every worker can edit it, as on
   the web; the document it was entered from does not change with an edit.

   Editing is the same screen in another state, not a second route: the
   expense is already loaded, and backing out of an edit should land on the
   details, not the list. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, Text,
  View, useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_EXPENSE_CATEGORIES, deleteExpense, expenseDocumentFiles, getExpense, linesSubtotal, money,
  setExpensePaid, updateExpense, VAT,
  type DocumentFileLink, type ScanLine, type Supplier, type SupplierExpense,
} from '@garage/shared';
import { KEYBOARD_BEHAVIOR } from '../../lib/keyboard';
import { C, s } from '../../lib/theme';
import { Button, Chip, Field } from '../../components/ui';
import { ExpenseHeader } from '../../components/expenses/ExpenseHeader';
import { Input, LineCard, parseDate, Row, showDate, SupplierPicker } from '../../components/expenses/formParts';

/** D/M/YYYY of a YYYY-MM-DD date, or a dash. */
const day = (iso: string | null) => (iso ? showDate(iso) : '—');

interface EditState {
  supplierId: string;
  supplierLabel: string;
  dateText: string;
  reference: string;
  category: string;
  description: string;
  lines: ScanLine[];
  vatRate: number;
  paid: boolean;
  dueText: string;
  cheque: string;
}

const toEdit = (e: SupplierExpense): EditState => ({
  supplierId: e.supplierId,
  supplierLabel: e.supplierName ?? '',
  dateText: showDate(e.date),
  reference: e.reference ?? '',
  category: e.category ?? '',
  description: e.description ?? '',
  /* An expense from before items (one figure) edits as one line of it. */
  lines: e.lines.length
    ? e.lines.map((l) => ({ desc: l.desc, qty: String(l.qty), unitPrice: String(l.unit_price), flags: [] }))
    : [{ desc: e.description ?? '', qty: '1', unitPrice: String(e.subtotal), flags: [] }],
  vatRate: e.vatRate,
  paid: e.paid,
  dueText: e.dueDate ? showDate(e.dueDate) : '',
  cheque: e.chequeNumber ?? '',
});

/** The edited lines as figures, or null while one is half-filled. */
const editLines = (lines: ScanLine[]) => {
  const out: { desc: string; qty: number; unit_price: number }[] = [];
  for (const l of lines) {
    if (!l.desc.trim() && !l.qty.trim() && !l.unitPrice.trim()) continue;
    const qty = Number(l.qty);
    const unit = Number(l.unitPrice);
    if (!l.desc.trim() || !(qty > 0) || !l.unitPrice.trim() || !(unit >= 0)) return null;
    out.push({ desc: l.desc.trim(), qty, unit_price: unit });
  }
  return out.length ? out : null;
};

export default function ExpenseRoute() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [expense, setExpense] = useState<SupplierExpense | null | undefined>(undefined);
  const [files, setFiles] = useState<DocumentFileLink[]>([]);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const e = await getExpense(id).catch(() => null);
    setExpense(e);
    if (e?.scanId) expenseDocumentFiles(e.scanId).then(setFiles).catch(() => setFiles([]));
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const togglePaid = async () => {
    if (!expense) return;
    setBusy(true);
    try {
      await setExpensePaid(expense.id, !expense.paid);
      setExpense({ ...expense, paid: !expense.paid });
    } catch (e) {
      Alert.alert(t('expenses.edit.saveFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openFile = (f: DocumentFileLink) => {
    if (f.kind === 'pdf') void Linking.openURL(f.url);
    else setZoomed(f.url);
  };

  /* ---------------------------------------------------------- editing */

  const lines = edit ? editLines(edit.lines) : null;
  const date = edit ? parseDate(edit.dateText) : '';
  const due = edit && edit.dueText.trim() ? parseDate(edit.dueText) : '';
  const dueOk = !edit || !edit.dueText.trim() || Boolean(due);
  const canSave = Boolean(edit && lines && date && dueOk && edit.supplierId);
  const editTotal = useMemo(() => {
    if (!edit || !lines) return null;
    const sub = linesSubtotal(lines);
    return Math.round((sub + Math.round(sub * edit.vatRate * 100) / 100) * 100) / 100;
  }, [edit, lines]);

  const patch = (p: Partial<EditState>) => setEdit((e) => (e ? { ...e, ...p } : e));
  const setLine = (i: number, field: 'desc' | 'qty' | 'unitPrice', v: string) =>
    setEdit((e) => (e ? { ...e, lines: e.lines.map((l, j) => (j === i ? { ...l, [field]: v } : l)) } : e));

  const save = async () => {
    if (!expense || !edit || !lines || !canSave) {
      Alert.alert(t('expenses.edit.invalid'));
      return;
    }
    setBusy(true);
    try {
      await updateExpense(expense.id, {
        supplierId: edit.supplierId,
        date,
        reference: edit.reference.trim(),
        category: edit.category,
        description: edit.description.trim(),
        lines,
        subtotal: linesSubtotal(lines),
        vatRate: edit.vatRate,
        paid: edit.paid,
        dueDate: due || null,
        chequeNumber: edit.cheque.trim() || null,
        chequeDate: expense.chequeDate,
      });
      setEdit(null);
      await load();
    } catch (e) {
      Alert.alert(t('expenses.edit.saveFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!expense) return;
    Alert.alert(t('expenses.edit.deleteTitle'), t('expenses.edit.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('expenses.edit.delete'), style: 'destructive',
        onPress: () => {
          void deleteExpense(expense.id)
            .then(() => router.back())
            .catch((e) => Alert.alert(t('expenses.edit.saveFailed'), e instanceof Error ? e.message : String(e)));
        },
      },
    ]);
  };

  /* ---------------------------------------------------------- render */

  if (expense === undefined) {
    return (
      <View style={s.screen}>
        <ExpenseHeader title={t('expenses.title')} onBack={() => router.back()} />
        <View style={s.centred}><ActivityIndicator color={C.ink} /></View>
      </View>
    );
  }
  if (expense === null) {
    return (
      <View style={s.screen}>
        <ExpenseHeader title={t('expenses.title')} onBack={() => router.back()} />
        <View style={s.centred}><Text style={s.h2}>{t('expenses.detail.notFound')}</Text></View>
      </View>
    );
  }

  const vatPercent = Math.round(expense.vatRate * 100);
  const categories = [...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...(edit?.category ? [edit.category] : [])])];

  if (edit) {
    return (
      <View style={s.screen}>
        <ExpenseHeader
          title={t('expenses.edit.title')}
          subtitle={[expense.supplierName, expense.reference].filter(Boolean).join(' · ')}
          onBack={() => setEdit(null)}
        />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD_BEHAVIOR}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
            <View style={[s.card, { gap: 12 }]}>
              <Field label={t('expenses.edit.supplier')}>
                <Pressable onPress={() => setPicking(true)} accessibilityRole="button" style={[s.input, s.rowBetween]}>
                  <Text style={[s.body, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>{edit.supplierLabel}</Text>
                  <Text style={s.dim}>{t('expenses.edit.changeSupplier')}</Text>
                </Pressable>
              </Field>
              <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
                <Field label={t('expenses.edit.date')} flex>
                  <Input value={edit.dateText} keyboardType="numbers-and-punctuation" placeholder={t('expenses.edit.datePlaceholder')}
                    warn={!date} onChangeText={(v) => patch({ dateText: v })} />
                </Field>
                <Field label={t('expenses.edit.reference')} flex>
                  <Input value={edit.reference} onChangeText={(v) => patch({ reference: v })} />
                </Field>
              </View>
              <Field label={t('expenses.edit.category')}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, flexDirection: 'row-reverse' }}>
                  {categories.map((c) => (
                    <Chip key={c} label={c} active={edit.category === c} onPress={() => patch({ category: edit.category === c ? '' : c })} />
                  ))}
                </ScrollView>
              </Field>
              <Field label={t('expenses.edit.description')}>
                <Input value={edit.description} placeholder={t('expenses.edit.optional')} onChangeText={(v) => patch({ description: v })} />
              </Field>
            </View>

            <Text style={[s.h2, { paddingHorizontal: 2 }]}>{t('expenses.edit.items')}</Text>
            {edit.lines.map((l, i) => (
              <LineCard key={i} line={l} onChange={(f, v) => setLine(i, f, v)}
                onRemove={() => patch({ lines: edit.lines.filter((_, j) => j !== i) })} />
            ))}
            <Button variant="secondary" label={t('expenses.edit.addLine')}
              onPress={() => patch({ lines: [...edit.lines, { desc: '', qty: '', unitPrice: '', flags: [] }] })} />

            <View style={[s.card, { gap: 12 }]}>
              <View style={s.rowBetween}>
                <Text style={s.label}>{t('expenses.edit.vat')}</Text>
                <View style={[s.row, { gap: 6 }]}>
                  <Chip label={t('expenses.edit.vat18')} active={edit.vatRate > 0} onPress={() => patch({ vatRate: VAT })} />
                  <Chip label={t('expenses.edit.vatNone')} active={edit.vatRate === 0} onPress={() => patch({ vatRate: 0 })} />
                </View>
              </View>
              <View style={s.rowBetween}>
                <Text style={s.label}>{t('expenses.edit.payment')}</Text>
                <View style={[s.row, { gap: 6 }]}>
                  <Chip label={t('expenses.edit.paid')} active={edit.paid} onPress={() => patch({ paid: true })} />
                  <Chip label={t('expenses.edit.unpaid')} active={!edit.paid} onPress={() => patch({ paid: false })} />
                </View>
              </View>
              <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
                <Field label={t('expenses.edit.dueDate')} flex>
                  <Input value={edit.dueText} keyboardType="numbers-and-punctuation" placeholder={t('expenses.edit.datePlaceholder')}
                    warn={!dueOk} onChangeText={(v) => patch({ dueText: v })} />
                </Field>
                <Field label={t('expenses.edit.cheque')} flex>
                  <Input value={edit.cheque} keyboardType="number-pad" onChangeText={(v) => patch({ cheque: v })} />
                </Field>
              </View>
            </View>
            {expense.scanId && <Text style={[s.dim, { textAlign: 'center' }]}>{t('expenses.edit.docUnchanged')}</Text>}
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={{ padding: 12, paddingBottom: 12 + insets.bottom, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card, gap: 8 }}>
          {editTotal != null && <Row label={t('expenses.edit.totalAfter')} value={money(editTotal)} bold />}
          <Button label={t('expenses.edit.save')} busy={busy} disabled={!canSave} onPress={() => void save()} />
          <Button variant="outline" color={C.danger} label={t('expenses.edit.delete')} onPress={remove} />
        </View>

        <SupplierPicker
          visible={picking}
          onClose={() => setPicking(false)}
          onPick={(sp: Supplier) => { setPicking(false); patch({ supplierId: sp.id, supplierLabel: sp.name }); }}
        />
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <ExpenseHeader
        title={expense.supplierName ?? '—'}
        subtitle={expense.source === 'scan' ? t('expenses.detail.sourceScan') : t('expenses.detail.sourceManual')}
        onBack={() => router.back()}
        action={
          <Pressable onPress={() => setEdit(toEdit(expense))} accessibilityRole="button"
            style={{ borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, marginHorizontal: 6 }}>
            <Text style={{ color: C.onInk, fontSize: 14, fontWeight: '700' }}>{t('expenses.detail.edit')}</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {files.length > 0 && (
          <View style={[s.card, { gap: 10 }]}>
            <Text style={s.h2}>{t('expenses.detail.document')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row-reverse' }}>
              {files.map((f, i) => (
                <Pressable key={f.name} onPress={() => openFile(f)} accessibilityRole="imagebutton"
                  accessibilityLabel={t('expenses.detail.pageN', { n: i + 1 })}
                  style={{ width: 96, height: 128, borderRadius: 8, borderWidth: 1, borderColor: C.line, overflow: 'hidden', backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' }}>
                  {f.kind === 'pdf'
                    ? <Text style={{ fontSize: 16, fontWeight: '800', color: C.slate }}>{t('expenses.detail.pdf')}</Text>
                    : <Image source={{ uri: f.url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />}
                </Pressable>
              ))}
            </ScrollView>
            <Text style={s.dim}>{t('expenses.detail.docHint')}</Text>
          </View>
        )}

        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.h2}>{t('expenses.detail.details')}</Text>
          <Row label={t('expenses.detail.date')} value={day(expense.date)} />
          <Row label={t('expenses.detail.reference')} value={expense.reference || '—'} />
          <Row label={t('expenses.detail.category')} value={expense.category || '—'} />
          {!!expense.description && <Row label={t('expenses.detail.description')} value={expense.description} />}
        </View>

        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.h2}>{t('expenses.detail.items', { count: expense.lines.length })}</Text>
          {expense.lines.map((l, i) => (
            <View key={i} style={[s.rowBetween, { paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.bg }]}>
              <Text style={[s.body, { flex: 1 }]}>{l.desc} <Text style={s.dim}>× {l.qty}</Text></Text>
              <Text style={[s.body, { fontWeight: '600' }]}>{money(Math.round(l.qty * l.unit_price * 100) / 100)}</Text>
            </View>
          ))}
          <Row label={t('expenses.detail.beforeVat')} value={money(expense.subtotal)} />
          <Row label={vatPercent ? t('expenses.detail.vatLine', { percent: vatPercent }) : t('expenses.detail.noVat')} value={money(expense.vat)} />
          <Row label={t('expenses.detail.total')} value={money(expense.total)} bold />
        </View>

        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.h2}>{t('expenses.detail.payment')}</Text>
          <View style={{ borderRadius: 10, padding: 10, backgroundColor: expense.paid ? C.okBg : C.warnBg }}>
            <Text style={{ fontSize: 14, fontWeight: '700', textAlign: 'right', color: expense.paid ? C.okText : C.warnText }}>
              {expense.paid ? t('expenses.detail.statusPaid')
                : expense.dueDate ? t('expenses.detail.statusDue', { date: day(expense.dueDate) })
                : t('expenses.detail.statusAwaiting')}
            </Text>
          </View>
          <Row label={t('expenses.detail.cheque')} value={expense.chequeNumber || t('expenses.detail.none')} />
        </View>
      </ScrollView>

      <View style={{ padding: 12, paddingBottom: 12 + insets.bottom, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card }}>
        <Button
          variant={expense.paid ? 'outline' : 'primary'}
          label={expense.paid ? t('expenses.detail.markUnpaid') : t('expenses.detail.markPaid')}
          busy={busy}
          onPress={() => void togglePaid()}
        />
      </View>

      <Modal visible={zoomed != null} animationType="fade" onRequestClose={() => setZoomed(null)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <ScrollView maximumZoomScale={4} minimumZoomScale={1} centerContent
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
            {zoomed && <Image source={{ uri: zoomed }} style={{ width, height: width * 1.4 }} resizeMode="contain" />}
          </ScrollView>
          <View style={{ position: 'absolute', top: insets.top + 8, right: 12 }}>
            <Button size="sm" variant="secondary" label={t('common.close')} onPress={() => setZoomed(null)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
