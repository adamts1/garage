import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, Text, TextInput, View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTicketsStore } from '../../lib/TicketsProvider';
import { listItems, type Item } from '../../lib/db';
import {
  COLUMNS, EPICS, PRIORITIES, TEAM, TYPES, WORK_CATALOG,
  fromCatalog, partsTotal, workTotal, worksSummary,
} from '../../lib/types';
import type { PartRow, Priority, Status, Ticket, TicketWork } from '../../lib/types';
import { C, rtl, s } from '../../lib/theme';

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

  // Load the ticket into an editable draft. Re-runs if realtime replaces the row
  // while we have nothing pending — but never clobbers edits in progress.
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

  /* The checklist is a prefix: the schema stores `done` as a count, not a flag per
     subtask (see supabase/schema.sql). Tapping row i means "the first i+1 are done";
     tapping the last done row unticks back to i. The web board reads the same number. */
  const toggleSubtask = (i: number) => set('done', draft.done === i + 1 ? i : i + 1);

  const changeStatus = (st: Status) =>
    setDraft((d) => {
      if (!d) return d;
      // Landing in Done ticks everything off — same rule as the web board (Board.tsx:67).
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

  const save = async () => {
    setSaving(true);
    // Keep the headline amount honest: if the ticket has works, it IS their total.
    const next: Ticket = works.length ? { ...draft, amount: sum.total } : draft;
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

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{
          title: draft.k,
          headerLeft: () => (
            <Pressable onPress={confirmLeave} hitSlop={10}>
              <Text style={{ color: '#fff', fontSize: 15 }}>חזרה</Text>
            </Pressable>
          ),
        }}
      />

      <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        {/* ---------- what and for whom ---------- */}
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

        {/* ---------- status ---------- */}
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
          <Field label="תחום">
            <Chips
              options={(Object.keys(EPICS) as (keyof typeof EPICS)[]).map((e) => ({ id: e, label: EPICS[e].t, color: EPICS[e].c }))}
              value={draft.epic}
              onChange={(v) => set('epic', v as keyof typeof EPICS)}
            />
          </Field>
          <Field label="סוג">
            <Chips
              options={(Object.keys(TYPES) as (keyof typeof TYPES)[]).map((t) => ({ id: t, label: `${TYPES[t].i} ${TYPES[t].t}` }))}
              value={draft.type}
              onChange={(v) => set('type', v as keyof typeof TYPES)}
            />
          </Field>
        </View>

        {/* ---------- checklist ---------- */}
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
            המשימות נסגרות לפי הסדר — המסד שומר מונה, לא סימון לכל שורה.
          </Text>
        </View>

        {/* ---------- works and parts ---------- */}
        <View style={[s.card, { gap: 10 }]}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={s.h2}>עבודות</Text>
            <Pressable onPress={() => setPickWork(true)} style={btn}>
              <Text style={btnText}>+ הוסף עבודה</Text>
            </Pressable>
          </View>

          {works.map((w) => (
            <View key={w.uid} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, gap: 8 }}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={[s.h2, { flex: 1 }]}>{w.name}</Text>
                <Pressable onPress={() => removeWork(w.uid)} hitSlop={8}>
                  <Text style={{ color: C.danger, fontSize: 13, fontWeight: '700' }}>מחק</Text>
                </Pressable>
              </View>

              <View style={s.row}>
                <Text style={[s.dim, { flex: 1 }]}>{w.code || 'ללא קוד'}</Text>
                <Text style={s.dim}>עבודה: </Text>
                <NumInput value={w.labor} onChange={(n) => patchWork(w.uid, { labor: n })} width={80} />
              </View>

              {w.items.map((p, i) => (
                <View key={`${w.uid}-${i}`} style={[s.row, { gap: 6 }]}>
                  <Text style={[s.body, { flex: 1, fontSize: 13 }]} numberOfLines={1}>{p.name}</Text>
                  <NumInput value={p.qty} onChange={(n) => patchPart(w.uid, i, { qty: n })} width={48} />
                  <Text style={s.dim}>×</Text>
                  <NumInput value={p.price} onChange={(n) => patchPart(w.uid, i, { price: n })} width={64} />
                  <Pressable onPress={() => removePart(w.uid, i)} hitSlop={8}>
                    <Text style={{ color: C.danger, fontSize: 16 }}>×</Text>
                  </Pressable>
                </View>
              ))}

              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Pressable onPress={() => setPickPartFor(w.uid)} hitSlop={8}>
                  <Text style={{ color: C.slate, fontSize: 13, fontWeight: '700' }}>+ הוסף חלק</Text>
                </Pressable>
                <Text style={[s.dim, { fontWeight: '700', color: C.ink }]}>
                  חלקים ₪{partsTotal(w).toLocaleString('he-IL')} · סה״כ ₪{workTotal(w).toLocaleString('he-IL')}
                </Text>
              </View>
            </View>
          ))}

          {!works.length ? <Text style={s.dim}>לא הוזנו עבודות</Text> : null}

          {works.length ? (
            <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8, gap: 3 }}>
              <Total label="חלקים" v={sum.parts} />
              <Total label="עבודה" v={sum.labor} />
              <Total label="לפני מע״מ" v={sum.net} />
              <Total label="מע״מ 17%" v={sum.vat} />
              <Total label="סה״כ לתשלום" v={sum.total} bold />
            </View>
          ) : null}
        </View>

        {/* ---------- notes ---------- */}
        <View style={[s.card, { gap: 10 }]}>
          <Field label="הערות">
            <TextInput style={[s.input, { minHeight: 70 }]} multiline value={draft.notes ?? ''} onChangeText={(v) => set('notes', v)} />
          </Field>
          <Field label="חסימה (אם יש)">
            <TextInput style={s.input} value={draft.blocked ?? ''} onChangeText={(v) => set('blocked', v || undefined)} />
          </Field>
        </View>
      </ScrollView>

      {/* ---------- save bar ---------- */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: 12, paddingBottom: insets.bottom + 12,
        backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line,
      }}>
        <Pressable
          onPress={save}
          disabled={!dirty || saving}
          style={{
            backgroundColor: dirty && !saving ? C.ink : C.line,
            paddingVertical: 14, borderRadius: 12, alignItems: 'center',
          }}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={{ color: dirty ? '#fff' : C.dim, fontWeight: '800', fontSize: 15 }}>
                {dirty ? 'שמור שינויים' : 'אין שינויים לשמירה'}
              </Text>}
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

/** Keeps its own text while you type — committing on every keystroke would fight
    you the moment the field is briefly empty or half-typed ("1." → NaN). */
function NumInput({ value, onChange, width }: { value: number; onChange: (n: number) => void; width: number }) {
  const [text, setText] = useState(String(value));

  useEffect(() => { setText(String(value)); }, [value]);

  return (
    <TextInput
      style={[s.input, { width, textAlign: 'center', paddingVertical: 6, fontSize: 13 }]}
      keyboardType="decimal-pad"
      value={text}
      onChangeText={setText}
      onBlur={() => {
        const n = parseFloat(text.replace(',', '.'));
        const clean = Number.isFinite(n) && n >= 0 ? n : 0;
        setText(String(clean));
        onChange(clean);
      }}
    />
  );
}

function Total({ label, v, bold }: { label: string; v: number; bold?: boolean }) {
  return (
    <View style={[s.row, { justifyContent: 'space-between' }]}>
      <Text style={[s.dim, bold && { color: C.ink, fontWeight: '800', fontSize: 14 }]}>{label}</Text>
      <Text style={[s.dim, bold && { color: C.ink, fontWeight: '800', fontSize: 14 }]}>
        ₪{v.toLocaleString('he-IL')}
      </Text>
    </View>
  );
}

const btn = {
  backgroundColor: C.ink,
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 8,
} as const;

const btnText = { color: '#fff', fontSize: 13, fontWeight: '700' } as const;
