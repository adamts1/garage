/* Presentational pieces and catalog pickers shared by the ticket editor and the
   new-ticket create form. They lived inside ticket/[key].tsx until the create
   screen needed the same Field / Chips / Sheet / WorkPicker / PartPicker — one
   copy here keeps the two forms visually identical and behaviourally in step. */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import {
  fromCatalog, listItems, listWorkDefs, VAT, workTotal, worksSummary,
  type Item, type PartRow, type TicketWork, type WorkDef,
} from '@garage/shared';
import { C, rtl, s } from '../lib/theme';

export const money = (n: number) =>
  '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 050-1234567 -> 972501234567 (wa.me wants digits only, with country code) */
export const waNumber = (phone?: string) => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('972')) return digits;
  return '972' + digits.replace(/^0/, '');
};

/** A fresh work uid. Kept here so both forms mint ids the same way. */
export const workUid = () => `w-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

/* `action` is optional: the photos section puts its buttons below the head, not in it. */
export function SectionHead({ title, count, action, onAction }: {
  title: string; count: number; action?: string; onAction?: () => void;
}) {
  return (
    <View style={[s.row, { justifyContent: 'space-between' }]}>
      <Text style={s.h2}>{title} ({count})</Text>
      {action && <Pressable onPress={onAction} style={{
        flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
        paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
        borderWidth: 1, borderColor: C.mist, backgroundColor: '#eef2f7',
      }}>
        <Text style={{ color: C.slate, fontWeight: '700', fontSize: 13 }}>+ {action}</Text>
      </Pressable>}
    </View>
  );
}

export function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={[s.row, { justifyContent: 'space-between' }]}>
      <Text style={s.dim}>{label}</Text>
      <Text style={[s.body, { fontSize: 13, fontWeight: '600' }]}>{value}</Text>
    </View>
  );
}

/** A small trash-can icon drawn with Views (no icon dependency). */
export function TrashIcon({ color = C.danger, size = 20 }: { color?: string; size?: number }) {
  const bodyW = size * 0.62;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-start', paddingTop: size * 0.14 }}>
      {/* handle */}
      <View style={{ width: bodyW * 0.44, height: size * 0.09, borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: color }} />
      {/* lid */}
      <View style={{ width: bodyW * 1.32, height: size * 0.11, borderRadius: 2, backgroundColor: color, marginTop: size * 0.04 }} />
      {/* can body */}
      <View style={{ width: bodyW, flex: 1, marginTop: size * 0.07, borderWidth: Math.max(1.5, size * 0.1), borderTopWidth: 0, borderColor: color, borderBottomLeftRadius: size * 0.18, borderBottomRightRadius: size * 0.18 }} />
    </View>
  );
}

export function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
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

export function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: boolean }) {
  return (
    <View style={flex ? { flex: 1 } : undefined}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}

export function Chips({ options, value, onChange }: {
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

export function Sheet({ visible, onClose, title, children }: {
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

/* The works list — each work expands to its own parts, with per-work and overall
   totals. Self-contained: it owns the catalog-picker sheets and the "which work is
   open" state, so a caller only hands it `works` and gets a new array back. The
   ticket editor and the new-ticket form render the identical block this way. */
export function WorksSection({ works, onChange }: {
  works: TicketWork[];
  onChange: (works: TicketWork[]) => void;
}) {
  const [openWork, setOpenWork] = useState<string | null>(null);
  const [pickWork, setPickWork] = useState(false);
  const [pickPartFor, setPickPartFor] = useState<string | null>(null);   // work uid

  const sum = worksSummary(works);

  const addWork = (w: TicketWork) => { onChange([...works, w]); setPickWork(false); };

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

  const editPrice = (uid: string, idx: number, p: PartRow) => {
    if (Platform.OS !== 'ios') return;   // Alert.prompt is iOS-only
    Alert.prompt('מחיר ליחידה', p.name, (v) => {
      const n = parseFloat((v ?? '').replace(',', '.'));
      patchPart(uid, idx, { price: Number.isFinite(n) && n >= 0 ? n : p.price });
    }, 'plain-text', String(p.price));
  };

  return (
    <>
      <SectionHead title="עבודות" count={works.length} action="הוסף עבודה" onAction={() => setPickWork(true)} />
      {works.map((w, wi) => {
        const open = openWork === w.uid;
        return (
          <View key={`${w.uid}-${wi}`} style={s.card}>
            {/* work row — tap to reveal its parts */}
            <Pressable onPress={() => setOpenWork(open ? null : w.uid)} style={[s.row, { justifyContent: 'space-between', gap: 10 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.h2} numberOfLines={1}>{w.name}</Text>
                <Text style={[s.dim, { marginTop: 2 }]}>
                  {w.items.length} פריטים · {money(workTotal(w))}
                </Text>
              </View>
              <Text style={{ fontSize: 20, color: C.mist }}>{open ? '⌄' : '‹'}</Text>
            </Pressable>

            {open && (
              <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 }}>
                {/* labor */}
                <View style={[s.row, { justifyContent: 'space-between', paddingVertical: 6 }]}>
                  <Text style={[s.body, { fontSize: 13 }]}>עבודה</Text>
                </View>

                {/* parts of THIS work — name · quantity · price · delete, evenly spaced */}
                {w.items.map((p, i) => (
                  <View key={`${w.uid}-${wi}-${i}`} style={[s.row, { paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line, gap: 10, justifyContent: 'space-between' }]}>
                    <Text style={[s.body, { flex: 1, fontSize: 14, fontWeight: '600', textAlign: 'right' }]} numberOfLines={2}>{p.name}</Text>
                    <Stepper value={p.qty} onChange={(n) => patchPart(w.uid, i, { qty: n })} />
                    <Pressable onPress={() => editPrice(w.uid, i, p)} style={{ width: 90, alignItems: 'center' }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink, ...rtl }}>{money(p.qty * p.price)}</Text>
                    </Pressable>
                    <Pressable onPress={() => removePart(w.uid, i)} hitSlop={8} style={{ width: 30, alignItems: 'center' }}>
                      <TrashIcon />
                    </Pressable>
                  </View>
                ))}
                {!w.items.length ? <Text style={[s.dim, { paddingVertical: 6 }]}>אין פריטים לעבודה זו</Text> : null}

                {/* add a part — large, full-width button */}
                <Pressable
                  onPress={() => setPickPartFor(w.uid)}
                  style={{
                    marginTop: 12, paddingVertical: 15, borderRadius: 12, borderWidth: 1.5,
                    borderColor: C.ink, alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: C.ink, fontWeight: '800', fontSize: 15 }}>+ הוסף פריט לעבודה</Text>
                </Pressable>

                {/* work subtotal */}
                <View style={[s.row, { justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line }]}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink, ...rtl }}>{money(workTotal(w))}</Text>
                  <Text style={[s.body, { fontSize: 14, fontWeight: '700' }]}>סה״כ עבודה</Text>
                </View>

                {/* delete this work — kept, but subtle */}
                <Pressable onPress={() => removeWork(w.uid)} hitSlop={6} style={{ alignSelf: 'center', marginTop: 12 }}>
                  <Text style={{ color: C.danger, fontWeight: '700', fontSize: 13 }}>מחק עבודה</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
      {!works.length ? <Text style={[s.dim, { textAlign: 'center', paddingVertical: 8 }]}>לא הוזנו עבודות</Text> : null}

      {/* overall totals */}
      {works.length ? (
        <View style={[s.card, { gap: 6 }]}>
          <TotalRow label="סה״כ לפני מע״מ" value={money(sum.net)} />
          <TotalRow label={`מע״מ (${Math.round(VAT * 100)}%)`} value={money(sum.vat)} />
          <View style={{ height: 1, backgroundColor: C.line, marginVertical: 4 }} />
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }}>סה״כ לתשלום</Text>
            <Text style={{ fontSize: 20, fontWeight: '800', color: C.slate }}>{money(sum.total)}</Text>
          </View>
        </View>
      ) : null}

      <WorkPicker visible={pickWork} onClose={() => setPickWork(false)} onPick={addWork} />
      <PartPicker
        workUid={pickPartFor}
        onClose={() => setPickPartFor(null)}
        onPick={(part) => pickPartFor && addPart(pickPartFor, part)}
      />
    </>
  );
}

export function WorkPicker({ visible, onClose, onPick }: {
  visible: boolean; onClose: () => void; onPick: (w: TicketWork) => void;
}) {
  /* This garage's catalog, not a constant compiled into the app. Fetched when the
     sheet first opens, then kept. An empty catalog is a real state — a garage
     onboarded without a starter catalog has none — so it gets its own message;
     the free-work button below is the way out either way. */
  const [defs, setDefs] = useState<WorkDef[] | null>(null);

  useEffect(() => {
    if (visible && !defs) listWorkDefs().then(setDefs).catch(() => setDefs([]));
  }, [visible, defs]);

  return (
    <Sheet visible={visible} onClose={onClose} title="בחר עבודה מהקטלוג">
      {defs === null ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <ActivityIndicator color={C.ink} />
        </View>
      ) : (
      <FlatList
        data={defs}
        keyExtractor={(w) => w.id}
        ListEmptyComponent={
          <Text style={[s.dim, { padding: 16, textAlign: 'center' }]}>
            אין עבודות בקטלוג של המוסך.
          </Text>
        }
        contentContainerStyle={{ gap: 8, padding: 12 }}
        ListFooterComponent={
          <Pressable
            onPress={() => onPick({ uid: workUid(), code: '', name: 'עבודה חופשית', labor: 0, items: [], custom: true })}
            style={[s.card, { borderStyle: 'dashed' }]}
          >
            <Text style={[s.h2, { color: C.slate }]}>+ עבודה חופשית (ללא קטלוג)</Text>
          </Pressable>
        }
        renderItem={({ item }) => (
          <Pressable style={s.card} onPress={() => onPick(fromCatalog(item, workUid()))}>
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
      )}
    </Sheet>
  );
}

export function PartPicker({ workUid: forWork, onClose, onPick }: {
  workUid: string | null; onClose: () => void; onPick: (p: PartRow) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState('');

  // The parts list comes from the items table, so prices and stock are the real ones.
  useEffect(() => {
    if (forWork && !items) listItems().then(setItems).catch(() => setItems([]));
  }, [forWork, items]);

  const shown = (items ?? []).filter(
    (i) => !q.trim() || i.name.includes(q.trim()) || i.sku.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <Sheet visible={Boolean(forWork)} onClose={onClose} title="הוסף חלק">
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
