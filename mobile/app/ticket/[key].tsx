import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable,
  ScrollView, Text, TextInput, View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTicketsStore } from '../../lib/TicketsProvider';
import { listItems, type Item } from '../../lib/db';
import {
  COLUMNS, EPICS, PRIORITIES, TEAM, TYPES, WORK_CATALOG, VAT,
  fromCatalog, partsTotal, workTotal, worksSummary,
} from '../../lib/types';
import type { PartRow, Priority, Status, Ticket, TicketWork } from '../../lib/types';
import { C, rtl, s } from '../../lib/theme';

const money = (n: number) =>
  '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 050-1234567 -> 972501234567 (wa.me wants digits only, with country code) */
const waNumber = (phone?: string) => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('972')) return digits;
  return '972' + digits.replace(/^0/, '');
};

type Tab = 'details' | 'works' | 'history' | 'notes';

export default function EditTicket() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tickets, loading, saveTicket } = useTicketsStore();

  const ticket = tickets.find((t) => t.k === key);

  const [draft, setDraft] = useState<Ticket | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickWork, setPickWork] = useState(false);
  const [pickPartFor, setPickPartFor] = useState<string | null>(null);   // work uid
  const [tab, setTab] = useState<Tab>('works');

  // Load the ticket into an editable draft. Re-runs if realtime replaces the row
  // while we have nothing pending - but never clobbers edits in progress.
  useEffect(() => {
    if (ticket && !draft) setDraft(ticket);
  }, [ticket, draft]);

  const dirty = useMemo(
    () => Boolean(draft && ticket && JSON.stringify(draft) !== JSON.stringify(ticket)),
    [draft, ticket],
  );

  const worksChanged = useMemo(
    () => Boolean(draft && ticket && JSON.stringify(draft.works ?? []) !== JSON.stringify(ticket.works ?? [])),
    [draft, ticket],
  );

  if (loading || (!ticket && !draft)) {
    return (
      <View style={[s.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        {loading ? <ActivityIndicator color={C.ink} /> : <Text style={s.dim}>הקריאה {key} לא נמצאה</Text>}
      </View>
    );
  }
  if (!draft) return null;

  const set = <K extends keyof Ticket>(field: K, value: Ticket[K]) =>
    setDraft((d) => (d ? { ...d, [field]: value } : d));

  const setWorks = (works: TicketWork[]) => setDraft((d) => (d ? { ...d, works } : d));

  const works = draft.works ?? [];
  const sum = worksSummary(works);
  const itemCount = works.reduce((n, w) => n + w.items.length, 0);
  const column = COLUMNS.find((c) => c.id === draft.st);
  const closed = draft.st === 'done';
  const notesCount = [draft.notes, draft.blocked].filter(Boolean).length;

  /* The checklist is a prefix: the schema stores `done` as a count, not a flag per
     subtask (see supabase/schema.sql). Tapping row i means "the first i+1 are done";
     tapping the last done row unticks back to i. The web board reads the same number. */
  const toggleSubtask = (i: number) => set('done', draft.done === i + 1 ? i : i + 1);

  const changeStatus = (st: Status) =>
    setDraft((d) => {
      if (!d) return d;
      // Landing in Done ticks everything off - same rule as the web board (Board.tsx:67).
      return { ...d, st, done: st === 'done' ? d.subtasks.length : d.done };
    });

  const addWork = (w: TicketWork) => { setWorks([...works, w]); setPickWork(false); };

  const patchWork = (uid: string, patch: Partial<TicketWork>) =>
    setWorks(works.map((w) => (w.uid === uid ? { ...w, ...patch } : w)));

  const removeWork = (uid: string) => setWorks(works.filter((w) => w.uid !== uid));

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

  // "+ הוסף פריט" is global in the mock; a part still belongs to a work, so it
  // attaches to the last work (or nudges you to add a work first).
  const addPartGlobal = () => {
    if (!works.length) return Alert.alert('אין עבודות', 'הוסף עבודה לפני הוספת פריט.');
    setPickPartFor(works[works.length - 1].uid);
  };

  const editLabor = (w: TicketWork) => {
    if (Platform.OS !== 'ios') return;
    Alert.prompt('מחיר עבודה', w.name, (v) => {
      const n = parseFloat((v ?? '').replace(',', '.'));
      patchWork(w.uid, { labor: Number.isFinite(n) && n >= 0 ? n : w.labor });
    }, 'plain-text', String(w.labor));
  };

  const saveWith = async (over?: Partial<Ticket>) => {
    setSaving(true);
    const base: Ticket = { ...draft, ...over };
    // Keep the headline amount honest: if the ticket has works, it IS their total.
    const next: Ticket = works.length ? { ...base, amount: sum.total } : base;
    await saveTicket(next, worksChanged);
    setSaving(false);
    setDraft(null);      // drop the draft so the screen re-syncs from the store
    router.back();
  };

  const confirmLeave = () => {
    if (!dirty) return router.back();
    Alert.alert('לצאת בלי לשמור?', 'יש שינויים שלא נשמרו.', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'צא בלי לשמור', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const moreActions = () =>
    Alert.alert('אפשרויות', '', [
      { text: dirty ? 'שמור וצא' : 'סגור', onPress: () => saveWith() },
      { text: 'ביטול', style: 'cancel' },
    ]);

  // WhatsApp: a ready-for-pickup notice once the car is prepared (status 'done'),
  // otherwise a quote asking the customer to approve the works.
  const total = works.length ? sum.total : draft.amount;
  const waMessage = () => {
    const car = `${draft.car || 'הרכב'} (${draft.plate || '-'})`;
    if (closed) {
      return [
        `שלום ${draft.customer || ''},`,
        `הרכב ${car} מוכן לאיסוף 🚗`,
        '',
        ...(works.length ? ['העבודות שבוצעו:', ...works.map((w) => `• ${w.name}`), ''] : []),
        `סה״כ לתשלום: ${money(total)}`,
        draft.paid ? `שולם ${draft.payMethod ? `ב${draft.payMethod} ` : ''}- תודה!` : 'התשלום יתבצע בעת האיסוף.',
        '',
        'מוסך פרו · נשמח לראותך',
      ].join('\n');
    }
    return [
      `שלום ${draft.customer || ''},`,
      `לרכב ${car} נדרש אישורך לביצוע העבודות הבאות:`,
      '',
      ...(works.length
        ? works.map((w) => `• ${w.name} - ${money(workTotal(w))}`)
        : [`• ${draft.title || 'טיפול'}`]),
      '',
      `סה״כ לפני מע״מ: ${money(sum.net)}`,
      `מע״מ (${Math.round(VAT * 100)}%): ${money(sum.vat)}`,
      `סה״כ לתשלום: ${money(sum.total)}`,
      '',
      'נא אשרו לביצוע. תודה,',
      'מוסך פרו',
    ].join('\n');
  };

  const sendWhatsApp = () => {
    const num = waNumber(draft.phone);
    if (!num) return Alert.alert('אין מספר טלפון', 'לא הוזן מספר טלפון ללקוח בכרטיס.');
    const url = `https://wa.me/${num}?text=${encodeURIComponent(waMessage())}`;
    Linking.openURL(url).catch(() => Alert.alert('שגיאה', 'לא ניתן לפתוח את וואטסאפ במכשיר.'));
  };

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'details', label: 'פרטי כרטיס' },
    { id: 'works', label: 'עבודות ופריטים' },
    { id: 'history', label: 'היסטוריה' },
    { id: 'notes', label: 'הערות', count: notesCount },
  ];

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ---------- custom header ---------- */}
      <View style={{ backgroundColor: C.card, paddingTop: insets.top + 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <View style={[s.row, { justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 4 }]}>
          <Pressable onPress={moreActions} hitSlop={10}><Text style={{ fontSize: 22, color: C.ink }}>⋮</Text></Pressable>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>
              כרטיס עבודה #{draft.k.includes('-') ? draft.k.split('-')[1] : draft.k}
            </Text>
            <View style={{
              paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999,
              backgroundColor: closed ? '#e6ede6' : C.sand,
            }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: closed ? C.ok : '#8a6b28' }}>
                {closed ? 'סגור' : 'פתוח'}
              </Text>
            </View>
          </View>
          <Pressable onPress={confirmLeave} hitSlop={10}><Text style={{ fontSize: 22, color: C.ink }}>›</Text></Pressable>
        </View>
        <Text style={[s.dim, { textAlign: 'center', paddingBottom: 10, fontSize: 11.5 }]}>
          נוצר: {draft.createdAt || '-'} · {TEAM[draft.who].n}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        {/* ---------- vehicle + customer, side by side ---------- */}
        <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
          <InfoCard title="פרטי רכב">
            <View style={{ alignSelf: 'flex-end', backgroundColor: C.sand, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginBottom: 2 }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink, ...rtl }}>{draft.plate || '-'}</Text>
            </View>
            <Text style={[s.body, { fontWeight: '600' }]}>{draft.car || '-'}</Text>
            <Text style={s.dim}>{[draft.year, draft.km && `${draft.km} ק״מ`].filter(Boolean).join(' · ') || '-'}</Text>
          </InfoCard>

          <InfoCard title="לקוח">
            <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink, ...rtl }}>{draft.customer || '-'}</Text>
            <Text style={s.dim}>טל׳ {draft.phone || '-'}</Text>
            <Text style={s.dim} numberOfLines={2}>{draft.address || '-'}</Text>
          </InfoCard>
        </View>

        {/* ---------- whatsapp ---------- */}
        <Pressable
          onPress={sendWhatsApp}
          style={{
            flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8,
            backgroundColor: '#25D366', paddingVertical: 13, borderRadius: 12,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>
            {closed ? 'שלח עדכון: הרכב מוכן לאיסוף' : 'שלח הצעה לאישור הלקוח'}
          </Text>
        </Pressable>

        {/* ---------- tab bar ---------- */}
        <View style={{ flexDirection: 'row-reverse', borderBottomWidth: 1, borderBottomColor: C.line }}>
          {TABS.map((t) => {
            const on = t.id === tab;
            return (
              <Pressable key={t.id} onPress={() => setTab(t.id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, gap: 6 }}>
                <Text style={{ fontSize: 12.5, fontWeight: on ? '800' : '600', color: on ? C.ink : C.dim }}>
                  {t.label}{t.count ? ` (${t.count})` : ''}
                </Text>
                <View style={{ height: 2, width: 28, backgroundColor: on ? C.ink : 'transparent', borderRadius: 2 }} />
              </Pressable>
            );
          })}
        </View>

        {/* ================= WORKS + ITEMS ================= */}
        {tab === 'works' && (
          <>
            {/* works */}
            <SectionHead title="עבודות" count={works.length} action="הוסף עבודה" onAction={() => setPickWork(true)} />
            {works.map((w) => (
              <View key={w.uid} style={[s.card, { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }]}>
                <Text style={{ color: C.dim, fontSize: 16 }}>⠿</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.h2]} numberOfLines={1}>{w.name}</Text>
                  <View style={[s.row, { gap: 5, marginTop: 2 }]}>
                    <Text style={{ color: C.ok, fontSize: 12, fontWeight: '700' }}>✓ תקין</Text>
                  </View>
                </View>
                <Pressable onPress={() => editLabor(w)}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }}>{money(w.labor)}</Text>
                </Pressable>
                <Pressable
                  onPress={() => Alert.alert(w.name, '', [
                    { text: 'ערוך מחיר עבודה', onPress: () => editLabor(w) },
                    { text: 'מחק עבודה', style: 'destructive', onPress: () => removeWork(w.uid) },
                    { text: 'ביטול', style: 'cancel' },
                  ])}
                  hitSlop={8}
                >
                  <Text style={{ color: C.dim, fontSize: 18 }}>⋮</Text>
                </Pressable>
              </View>
            ))}
            {!works.length ? <Text style={[s.dim, { textAlign: 'center', paddingVertical: 8 }]}>לא הוזנו עבודות</Text> : null}

            {/* items */}
            <View style={{ height: 4 }} />
            <SectionHead title="פריטים" count={itemCount} action="הוסף פריט" onAction={addPartGlobal} />
            {itemCount ? (
              <View style={s.card}>
                <View style={[s.row, { paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.line }]}>
                  <Text style={[colName, s.dim]}>פריט</Text>
                  <Text style={[colQty, s.dim, { textAlign: 'center' }]}>כמות</Text>
                  <Text style={[colNum, s.dim, { textAlign: 'center' }]}>מחיר</Text>
                  <Text style={[colNum, s.dim, { textAlign: 'center' }]}>סה״כ</Text>
                  <View style={{ width: 24 }} />
                </View>
                {works.flatMap((w) => w.items.map((p, i) => (
                  <View key={`${w.uid}-${i}`} style={[s.row, { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line }]}>
                    <View style={colName}>
                      <Text style={[s.body, { fontSize: 13, fontWeight: '600' }]} numberOfLines={1}>{p.name}</Text>
                      <Text style={[s.dim, { fontSize: 11 }]} numberOfLines={1}>{p.sku}</Text>
                    </View>
                    <View style={colQty}>
                      <Stepper value={p.qty} onChange={(n) => patchPart(w.uid, i, { qty: n })} />
                    </View>
                    <Pressable style={colNum} onPress={() => {
                      if (Platform.OS !== 'ios') return;
                      Alert.prompt('מחיר', p.name, (v) => {
                        const n = parseFloat((v ?? '').replace(',', '.'));
                        patchPart(w.uid, i, { price: Number.isFinite(n) && n >= 0 ? n : p.price });
                      }, 'plain-text', String(p.price));
                    }}>
                      <Text style={{ ...rtl, textAlign: 'center', fontSize: 12.5, color: C.text }}>{money(p.price)}</Text>
                    </Pressable>
                    <Text style={[colNum, { ...rtl, textAlign: 'center', fontSize: 12.5, fontWeight: '700', color: C.ink }]}>
                      {money(p.qty * p.price)}
                    </Text>
                    <Pressable style={{ width: 24, alignItems: 'center' }} onPress={() => removePart(w.uid, i)} hitSlop={6}>
                      <Text style={{ color: C.danger, fontSize: 17, fontWeight: '700' }}>✕</Text>
                    </Pressable>
                  </View>
                )))}

                {/* totals */}
                <View style={{ paddingTop: 12, gap: 6 }}>
                  <TotalRow label="סה״כ לפני מע״מ" value={money(sum.net)} />
                  <TotalRow label={`מע״מ (${Math.round(VAT * 100)}%)`} value={money(sum.vat)} />
                  <View style={{ height: 1, backgroundColor: C.line, marginVertical: 4 }} />
                  <View style={[s.row, { justifyContent: 'space-between' }]}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }}>סה״כ לתשלום</Text>
                    <Text style={{ fontSize: 20, fontWeight: '800', color: C.slate }}>{money(sum.total)}</Text>
                  </View>
                </View>
              </View>
            ) : (
              <Text style={[s.dim, { textAlign: 'center', paddingVertical: 8 }]}>לא הוזנו פריטים</Text>
            )}
          </>
        )}

        {/* ================= DETAILS ================= */}
        {tab === 'details' && (
          <>
            <View style={[s.card, { gap: 10 }]}>
              <Field label="תיאור התקלה">
                <TextInput style={[s.input, { minHeight: 60 }]} multiline value={draft.title} onChangeText={(v) => set('title', v)} />
              </Field>
              <View style={s.row}>
                <Field label="לקוח" flex>
                  <TextInput style={s.input} value={draft.customer} onChangeText={(v) => set('customer', v)} />
                </Field>
                <Field label="טלפון" flex>
                  <TextInput style={s.input} keyboardType="phone-pad" value={draft.phone ?? ''} onChangeText={(v) => set('phone', v)} />
                </Field>
              </View>
              <Field label="כתובת">
                <TextInput style={s.input} value={draft.address ?? ''} onChangeText={(v) => set('address', v)} />
              </Field>
              <View style={s.row}>
                <Field label="רכב" flex>
                  <TextInput style={s.input} value={draft.car} onChangeText={(v) => set('car', v)} />
                </Field>
                <Field label="מספר רישוי" flex>
                  <TextInput style={s.input} value={draft.plate} onChangeText={(v) => set('plate', v)} />
                </Field>
              </View>
              <View style={s.row}>
                <Field label="קילומטראז'" flex>
                  <TextInput style={s.input} keyboardType="numeric" value={draft.km ?? ''} onChangeText={(v) => set('km', v)} />
                </Field>
                <Field label="שנה" flex>
                  <TextInput style={s.input} keyboardType="numeric" value={draft.year ?? ''} onChangeText={(v) => set('year', v)} />
                </Field>
                <Field label="יעד" flex>
                  <TextInput style={s.input} value={draft.due} onChangeText={(v) => set('due', v)} />
                </Field>
              </View>
            </View>

            <View style={[s.card, { gap: 10 }]}>
              <Field label="סטטוס">
                <Chips
                  options={COLUMNS.map((c) => ({ id: c.id, label: c.title, color: c.dot }))}
                  value={draft.st}
                  onChange={(v) => changeStatus(v as Status)}
                />
              </Field>
              <Field label="דחיפות">
                <Chips
                  options={(Object.keys(PRIORITIES) as Priority[]).map((p) => ({ id: p, label: PRIORITIES[p].t, color: PRIORITIES[p].c }))}
                  value={draft.prio}
                  onChange={(v) => set('prio', v as Priority)}
                />
              </Field>
              <Field label="אחראי">
                <Chips
                  options={(Object.keys(TEAM) as (keyof typeof TEAM)[]).map((w) => ({ id: w, label: TEAM[w].n, color: TEAM[w].bg }))}
                  value={draft.who}
                  onChange={(v) => set('who', v as keyof typeof TEAM)}
                />
              </Field>
            </View>
          </>
        )}

        {/* ================= HISTORY / CHECKLIST ================= */}
        {tab === 'history' && (
          <View style={[s.card, { gap: 8 }]}>
            <Text style={s.h2}>משימות ({draft.done}/{draft.subtasks.length})</Text>
            {draft.subtasks.map((task, i) => {
              const checked = i < draft.done;
              return (
                <Pressable key={i} onPress={() => toggleSubtask(i)} style={[s.row, { paddingVertical: 8, gap: 10 }]}>
                  <View style={{
                    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
                    borderColor: checked ? C.ok : C.line,
                    backgroundColor: checked ? C.ok : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {checked ? <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>✓</Text> : null}
                  </View>
                  <Text style={[s.body, { flex: 1, color: checked ? C.dim : C.text, textDecorationLine: checked ? 'line-through' : 'none' }]}>
                    {task}
                  </Text>
                </Pressable>
              );
            })}
            {!draft.subtasks.length ? <Text style={s.dim}>אין משימות</Text> : null}
            <Text style={[s.dim, { fontSize: 11 }]}>
              המשימות נסגרות לפי הסדר - המסד שומר מונה, לא סימון לכל שורה.
            </Text>
          </View>
        )}

        {/* ================= NOTES ================= */}
        {tab === 'notes' && (
          <View style={[s.card, { gap: 10 }]}>
            <Field label="הערות">
              <TextInput style={[s.input, { minHeight: 90 }]} multiline value={draft.notes ?? ''} onChangeText={(v) => set('notes', v)} />
            </Field>
            <Field label="חסימה (אם יש)">
              <TextInput style={s.input} value={draft.blocked ?? ''} onChangeText={(v) => set('blocked', v || undefined)} />
            </Field>
          </View>
        )}
      </ScrollView>

      {/* ---------- action bar ---------- */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
        padding: 12, paddingBottom: insets.bottom + 10,
        backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line,
      }}>
        <Pressable
          onPress={() => saveWith({ st: 'done', done: draft.subtasks.length })}
          disabled={saving}
          style={{ flex: 1, backgroundColor: C.ink, paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}
        >
          {saving ? <ActivityIndicator color="#fff" />
            : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>סיים עבודה וחייב לקוח</Text>}
        </Pressable>
        <Pressable
          onPress={() => saveWith()}
          disabled={!dirty || saving}
          style={{
            paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12,
            borderWidth: 1, borderColor: C.line, backgroundColor: C.card,
            opacity: dirty && !saving ? 1 : 0.5,
          }}
        >
          <Text style={{ color: C.ink, fontWeight: '700', fontSize: 14 }}>שמור טיוטה</Text>
        </Pressable>
        <Pressable onPress={moreActions} style={{
          paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.line,
        }} hitSlop={6}>
          <Text style={{ color: C.ink, fontSize: 18, fontWeight: '800' }}>⋯</Text>
        </Pressable>
      </View>

      <WorkPicker visible={pickWork} onClose={() => setPickWork(false)} onPick={addWork} />
      <PartPicker
        workUid={pickPartFor}
        onClose={() => setPickPartFor(null)}
        onPick={(part) => pickPartFor && addPart(pickPartFor, part)}
      />
    </KeyboardAvoidingView>
  );
}

/* ---------------- presentational pieces ---------------- */

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={[s.card, { flex: 1, gap: 4 }]}>
      <Text style={[s.dim, { textAlign: 'right', marginBottom: 2 }]}>{title}</Text>
      {children}
    </View>
  );
}

function SectionHead({ title, count, action, onAction }: {
  title: string; count: number; action: string; onAction: () => void;
}) {
  return (
    <View style={[s.row, { justifyContent: 'space-between' }]}>
      <Text style={s.h2}>{title} ({count})</Text>
      <Pressable onPress={onAction} style={{
        flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
        paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
        borderWidth: 1, borderColor: C.mist, backgroundColor: '#eef2f7',
      }}>
        <Text style={{ color: C.slate, fontWeight: '700', fontSize: 13 }}>+ {action}</Text>
      </Pressable>
    </View>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={[s.row, { justifyContent: 'space-between' }]}>
      <Text style={s.dim}>{label}</Text>
      <Text style={[s.body, { fontSize: 13, fontWeight: '600' }]}>{value}</Text>
    </View>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const btn = {
    width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.line,
    alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: C.card,
  };
  return (
    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
      <Pressable style={btn} onPress={() => onChange(value + 1)} hitSlop={4}>
        <Text style={{ fontSize: 16, color: C.ink }}>+</Text>
      </Pressable>
      <Text style={{ minWidth: 18, textAlign: 'center', fontSize: 14, fontWeight: '700', color: C.ink }}>{value}</Text>
      <Pressable style={btn} onPress={() => onChange(Math.max(1, value - 1))} hitSlop={4}>
        <Text style={{ fontSize: 16, color: C.ink }}>−</Text>
      </Pressable>
    </View>
  );
}

const colName = { flex: 1 } as const;
const colQty = { width: 96 } as const;
const colNum = { width: 62 } as const;

/* ---------------- pickers ---------------- */

function WorkPicker({ visible, onClose, onPick }: {
  visible: boolean; onClose: () => void; onPick: (w: TicketWork) => void;
}) {
  const uid = () => `w-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

  return (
    <Sheet visible={visible} onClose={onClose} title="בחר עבודה מהקטלוג">
      <FlatList
        data={WORK_CATALOG}
        keyExtractor={(w) => w.id}
        contentContainerStyle={{ gap: 8, padding: 12 }}
        ListFooterComponent={
          <Pressable
            onPress={() => onPick({ uid: uid(), code: '', name: 'עבודה חופשית', labor: 0, items: [], custom: true })}
            style={[s.card, { borderStyle: 'dashed' }]}
          >
            <Text style={[s.h2, { color: C.slate }]}>+ עבודה חופשית (ללא קטלוג)</Text>
          </Pressable>
        }
        renderItem={({ item }) => (
          <Pressable style={s.card} onPress={() => onPick(fromCatalog(item, uid()))}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={s.h2}>{item.name}</Text>
              <Text style={s.dim}>{item.code}</Text>
            </View>
            <Text style={s.dim}>
              עבודה ₪{item.labor} · {item.hours} שע׳ · {item.items.length} חלקים
            </Text>
          </Pressable>
        )}
      />
    </Sheet>
  );
}

function PartPicker({ workUid, onClose, onPick }: {
  workUid: string | null; onClose: () => void; onPick: (p: PartRow) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState('');

  // The parts list comes from the items table, so prices and stock are the real ones.
  useEffect(() => {
    if (workUid && !items) listItems().then(setItems).catch(() => setItems([]));
  }, [workUid, items]);

  const shown = (items ?? []).filter(
    (i) => !q.trim() || i.name.includes(q.trim()) || i.sku.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <Sheet visible={Boolean(workUid)} onClose={onClose} title="הוסף חלק">
      <View style={{ padding: 12 }}>
        <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="חיפוש חלק או מק״ט" placeholderTextColor={C.dim} />
      </View>
      {!items ? (
        <ActivityIndicator color={C.ink} style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ gap: 8, padding: 12, paddingTop: 0 }}
          ListEmptyComponent={<Text style={[s.dim, { textAlign: 'center' }]}>לא נמצאו חלקים</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={s.card}
              onPress={() => onPick({ sku: item.sku, name: item.name, qty: 1, price: item.price })}
            >
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={[s.h2, { flex: 1 }]}>{item.name}</Text>
                <Text style={[s.dim, { fontWeight: '700', color: C.ink }]}>₪{item.price}</Text>
              </View>
              <Text style={[s.dim, { color: item.stock === 0 ? C.danger : C.dim }]}>
                {item.sku} · {item.stock === 0 ? 'אזל מהמלאי' : `במלאי: ${item.stock}`}
              </Text>
            </Pressable>
          )}
        />
      )}
    </Sheet>
  );
}

/* ---------------- small pieces ---------------- */

function Sheet({ visible, onClose, title, children }: {
  visible: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={s.screen}>
        <View style={[s.row, { justifyContent: 'space-between', padding: 14, backgroundColor: C.ink }]}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: '#fff', fontSize: 15 }}>סגור</Text>
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: boolean }) {
  return (
    <View style={flex ? { flex: 1 } : undefined}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}

function Chips({ options, value, onChange }: {
  options: { id: string; label: string; color?: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
              paddingHorizontal: 10, paddingVertical: 8, borderRadius: 16, borderWidth: 1,
              borderColor: active ? (o.color ?? C.ink) : C.line,
              backgroundColor: active ? (o.color ?? C.ink) : C.card,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: active ? '#fff' : C.slate }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
