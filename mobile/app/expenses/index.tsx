/* The garage's expenses on the phone (2026-11-18): one month at a time, with
   what it came to and what is still owed.

   A month is the month of the invoice's own date, as in the reports and the
   bookkeeping export — so a September invoice scanned in November is under
   September. After a scan is saved the scan screen lands back here on the
   invoice's month with the new expense marked (params month, highlight).

   "Awaiting payment" is the exception: it shows every open bill from every
   month, oldest first, grouped by month — the question it answers is "what do
   we owe", and a September bill is still owed in November. Late ones (past
   the due date, or the invoice date when there is none) are marked. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  expenseTotals, isOverdue, listExpensesForMonth, listUnpaidExpenses, money, monthOf, shiftMonth,
  subscribeToExpenses, type SupplierExpense,
} from '@garage/shared';
import { C, s } from '../../lib/theme';
import { Button, Chip } from '../../components/ui';
import { ExpenseHeader } from '../../components/expenses/ExpenseHeader';

type StatusFilter = 'all' | 'unpaid' | 'paid';

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** D/M — the year is the month bar's. */
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

export default function ExpensesRoute() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ month?: string; highlight?: string }>();
  const thisMonth = monthOf(todayISO());

  const [month, setMonth] = useState(params.month || thisMonth);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [rows, setRows] = useState<SupplierExpense[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Landing back here from a saved scan: its month, its row marked.
  useEffect(() => {
    if (params.month) { setMonth(params.month); setFilter('all'); }
  }, [params.month, params.highlight]);

  /** נובמבר 2026. The names are keyed 1–12 in he.json. */
  const monthName = (m: string) => `${t(`expenses.months.${Number(m.slice(5, 7))}`)} ${m.slice(0, 4)}`;

  const load = useCallback(async () => {
    try {
      setFailed(false);
      setRows(filter === 'unpaid' ? await listUnpaidExpenses() : await listExpensesForMonth(month));
    } catch {
      setFailed(true);
    }
  }, [filter, month]);

  // A different month or filter: a spinner until its rows are in.
  useEffect(() => { setRows(null); }, [filter, month]);
  // Loads on arrival and again on coming back from an expense that was edited
  // or deleted — and with each month or filter, since `load` changes with them.
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // A change made on the web, or on another phone, shows without a refresh.
  useEffect(() => subscribeToExpenses(() => void load()), [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const shown = useMemo(
    () => (rows ?? []).filter((e) => (filter === 'paid' ? e.paid : true)),
    [rows, filter],
  );
  // The month's figures: whichever filter, they are the month's.
  const totals = useMemo(() => expenseTotals(filter === 'unpaid' ? [] : rows ?? []), [rows, filter]);
  const openTotal = useMemo(() => expenseTotals(filter === 'unpaid' ? rows ?? [] : []).unpaid, [rows, filter]);
  const today = todayISO();

  /** Awaiting payment: grouped by month, oldest first. */
  const groups = useMemo(() => {
    if (filter !== 'unpaid') return null;
    const by = new Map<string, SupplierExpense[]>();
    for (const e of shown) {
      const m = monthOf(e.date);
      by.set(m, [...(by.get(m) ?? []), e]);
    }
    return [...by.entries()];
  }, [shown, filter]);

  const row = (e: SupplierExpense) => {
    const late = isOverdue(e, today);
    const marked = e.id === params.highlight;
    const meta = [dayMonth(e.date), e.reference ? t('expenses.invoiceNo', { ref: e.reference }) : null,
      !e.paid && e.dueDate ? t('expenses.dueOn', { date: dayMonth(e.dueDate) }) : null].filter(Boolean).join(' · ');
    return (
      <Pressable
        key={e.id}
        onPress={() => router.push(`/expenses/${e.id}`)}
        accessibilityRole="button"
        style={({ pressed }) => [s.card, {
          gap: 5, paddingVertical: 12,
          backgroundColor: pressed ? C.tint : marked ? C.okBg : C.card,
          borderColor: marked ? C.ok : C.line,
        }]}
      >
        <View style={s.rowBetween}>
          <Text style={[s.h2, { flex: 1 }]} numberOfLines={1}>{e.supplierName ?? '—'}</Text>
          <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }}>{money(e.total)}</Text>
        </View>
        <View style={s.rowBetween}>
          <Text style={[s.dim, { flex: 1 }]} numberOfLines={1}>
            {meta}{e.scanId ? '  📄' : ''}
          </Text>
          <Text style={{
            fontSize: 11, fontWeight: '700', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden',
            color: e.paid ? C.okText : late ? C.danger : C.warnText,
            backgroundColor: e.paid ? C.okBg : late ? C.dangerBg : C.warnBg,
          }}>
            {e.paid ? t('expenses.paid') : late ? t('expenses.overdue') : t('expenses.awaiting')}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={s.screen}>
      <ExpenseHeader title={t('expenses.title')} onBack={() => router.back()} />

      {filter === 'unpaid' ? (
        <View style={[s.rowBetween, { backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line, padding: 12, paddingHorizontal: 16 }]}>
          <View>
            <Text style={s.h2}>{t('expenses.allOpen')}</Text>
            <Text style={s.dim}>{t('expenses.allOpenSub')}</Text>
          </View>
          <Text style={{ fontSize: 19, fontWeight: '800', color: C.warnText }}>{money(openTotal)}</Text>
        </View>
      ) : (
        <>
          <View style={[s.rowBetween, { backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 6, paddingHorizontal: 8 }]}>
            <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))} hitSlop={8} accessibilityRole="button"
              accessibilityLabel={t('expenses.prevMonth')} style={{ width: 48, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 24, color: C.ink }}>›</Text>
            </Pressable>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink }}>{monthName(month)}</Text>
            <Pressable onPress={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= thisMonth} hitSlop={8}
              accessibilityRole="button" accessibilityLabel={t('expenses.nextMonth')}
              style={{ width: 48, height: 40, alignItems: 'center', justifyContent: 'center', opacity: month >= thisMonth ? 0.3 : 1 }}>
              <Text style={{ fontSize: 24, color: C.ink }}>‹</Text>
            </Pressable>
          </View>
          <View style={[s.row, { gap: 10, paddingHorizontal: 16, paddingTop: 12 }]}>
            <View style={[s.card, { flex: 1, paddingVertical: 10 }]}>
              <Text style={s.dim}>{t('expenses.kpiTotal')}</Text>
              <Text style={{ fontSize: 19, fontWeight: '800', color: C.ink, textAlign: 'right' }}>{money(totals.total)}</Text>
            </View>
            <View style={[s.card, { flex: 1, paddingVertical: 10 }]}>
              <Text style={s.dim}>{t('expenses.kpiUnpaid')}</Text>
              <Text style={{ fontSize: 19, fontWeight: '800', color: C.warnText, textAlign: 'right' }}>{money(totals.unpaid)}</Text>
            </View>
          </View>
        </>
      )}

      <View style={[s.row, { gap: 6, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }]}>
        <Chip label={t('expenses.filterAll')} active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label={t('expenses.filterUnpaid')} active={filter === 'unpaid'} onPress={() => setFilter('unpaid')} />
        <Chip label={t('expenses.filterPaid')} active={filter === 'paid'} onPress={() => setFilter('paid')} />
      </View>

      {rows == null && !failed ? (
        <View style={s.centred}><ActivityIndicator color={C.ink} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 8, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        >
          {failed && <Text style={[s.body, { color: C.danger, textAlign: 'center' }]}>{t('expenses.loadFailed')}</Text>}
          {!failed && shown.length === 0 && (
            <View style={[s.centred, { gap: 8, paddingVertical: 40 }]}>
              <Text style={[s.h2, { textAlign: 'center' }]}>
                {filter === 'unpaid' ? t('expenses.emptyUnpaid') : t('expenses.emptyMonth', { month: monthName(month) })}
              </Text>
              {filter !== 'unpaid' && <Text style={[s.dim, { textAlign: 'center' }]}>{t('expenses.emptyMonthBody')}</Text>}
            </View>
          )}
          {groups
            ? groups.map(([m, list]) => (
              <View key={m} style={{ gap: 8 }}>
                <View style={[s.rowBetween, { paddingTop: 6, paddingHorizontal: 2 }]}>
                  <Text style={[s.dim, { fontWeight: '700' }]}>{monthName(m)}</Text>
                  <Text style={[s.dim, { fontWeight: '700' }]}>{money(expenseTotals(list).unpaid)}</Text>
                </View>
                {list.map(row)}
              </View>
            ))
            : shown.map(row)}
        </ScrollView>
      )}

      <View style={{ padding: 12, paddingBottom: 12 + insets.bottom, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card }}>
        <Button label={t('expenses.scan')} onPress={() => router.push('/scan-invoice')} />
      </View>
    </View>
  );
}
