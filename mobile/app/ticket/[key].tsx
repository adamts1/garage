import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable,
  ScrollView, Text, TextInput, View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTicketsStore } from '../../lib/TicketsProvider';
import {
  deleteTicketPhoto, listItems, listTicketPhotos, listWorkDefs, uploadTicketPhoto,
  type Item, type TicketPhoto,
} from '@garage/shared';
import {
  COLUMNS, EPICS, PRIORITIES, TEAM, TYPES, VAT,
  fromCatalog, partsTotal, workTotal, worksSummary,
} from '@garage/shared';
import type { PartRow, Priority, Status, Ticket, TicketWork, WorkDef } from '@garage/shared';
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

type Tab = 'details' | 'works' | 'photos' | 'history' | 'notes';

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
  const [openWork, setOpenWork] = useState<string | null>(null);   // expanded work uid

  /* Photos are their own table and their own bytes, so they save on their own too -
     uploading is immediate and never rides along on the ticket's dirty/save flow. */
  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<TicketPhoto | null>(null);   // full-screen photo

  // Load the ticket into an editable draft. Re-runs if realtime replaces the row
  // while we have nothing pending - but never clobbers edits in progress.
  useEffect(() => {
    if (ticket && !draft) setDraft(ticket);
  }, [ticket, draft]);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    setPhotosLoading(true);
    listTicketPhotos(key)
      .then((p) => alive && setPhotos(p))
      .catch(() => alive && setPhotos([]))   // an empty gallery beats blocking the screen
      .finally(() => alive && setPhotosLoading(false));
    return () => { alive = false; };
  }, [key]);

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
  const column = COLUMNS.find((c) => c.id === draft.st);
  const closed = draft.st === 'done' || draft.st === 'paid';
  const notesCount = [draft.notes, draft.blocked].filter(Boolean).length;

  /* The checklist is a prefix: the schema stores `done` as a count, not a flag per
     subtask (see supabase/schema.sql). Tapping row i means "the first i+1 are done";
     tapping the last done row unticks back to i. The web board reads the same number. */
  const toggleSubtask = (i: number) => set('done', draft.done === i + 1 ? i : i + 1);

  const changeStatus = (st: Status) =>
    setDraft((d) => {
      if (!d) return d;
      // Landing in Done/שולם ticks everything off - same rule as the web board (Board.tsx:67).
      const finished = st === 'done' || st === 'paid';
      return { ...d, st, done: finished ? d.subtasks.length : d.done, paid: st === 'paid' ? true : d.paid };
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

  const editLabor = (w: TicketWork) => {
    if (Platform.OS !== 'ios') return;
    Alert.prompt('מחיר עבודה', w.name, (v) => {
      const n = parseFloat((v ?? '').replace(',', '.'));
      patchWork(w.uid, { labor: Number.isFinite(n) && n >= 0 ? n : w.labor });
    }, 'plain-text', String(w.labor));
  };

  const editPrice = (uid: string, idx: number, p: PartRow) => {
    if (Platform.OS !== 'ios') return;
    Alert.prompt('מחיר ליחידה', p.name, (v) => {
      const n = parseFloat((v ?? '').replace(',', '.'));
      patchPart(uid, idx, { price: Number.isFinite(n) && n >= 0 ? n : p.price });
    }, 'plain-text', String(p.price));
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

  // WhatsApp: a ready-for-pickup notice once the car is prepared (status 'done'),
  // otherwise a quote asking the customer to approve the works.
  const total = works.length ? sum.total : draft.amount;

  /* wa.me carries text only - there is no attachment parameter - so photos travel
     as links. The bucket is public, so they open without a login. Capped at three:
     ten URLs would bury the price the customer is meant to be reading. */
  const WA_PHOTO_LIMIT = 3;
  const photoLines = () => {
    if (!photos.length) return [];
    const shown = photos.slice(0, WA_PHOTO_LIMIT);
    const rest = photos.length - shown.length;
    return [
      '',
      photos.length > 1 ? 'תמונות מהמוסך:' : 'תמונה מהמוסך:',
      ...shown.map((p) => p.url),
      ...(rest > 0 ? [`(ועוד ${rest} תמונות בכרטיס)`] : []),
    ];
  };

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
        ...photoLines(),
        '',
        'מוסך אי-תן · נשמח לראותך',
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
      ...photoLines(),
      '',
      'נא אשרו לביצוע. תודה,',
      'מוסך אי-תן',
    ].join('\n');
  };

  const sendWhatsApp = () => {
    const num = waNumber(draft.phone);
    if (!num) return Alert.alert('אין מספר טלפון', 'לא הוזן מספר טלפון ללקוח בכרטיס.');
    const url = `https://wa.me/${num}?text=${encodeURIComponent(waMessage())}`;
    Linking.openURL(url).catch(() => Alert.alert('שגיאה', 'לא ניתן לפתוח את וואטסאפ במכשיר.'));
  };

  /* Camera or gallery, same upload path. quality 0.7 because a photo of a scratched
     bumper doesn't need 12MP, and the mechanic is usually on cellular. */
  const addPhotos = async (from: 'camera' | 'library') => {
    const perm = from === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      return Alert.alert(
        'אין הרשאה',
        from === 'camera' ? 'יש לאשר גישה למצלמה בהגדרות המכשיר.' : 'יש לאשר גישה לתמונות בהגדרות המכשיר.',
      );
    }

    const res = from === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, base64: true })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'], quality: 0.7, base64: true,
          allowsMultipleSelection: true, selectionLimit: 10,
        });
    if (res.canceled) return;

    setUploading(true);
    try {
      // Sequential: ten parallel uploads on a garage's wifi is how you get timeouts.
      for (const a of res.assets) {
        if (!a.base64) continue;
        const ext = (a.fileName?.split('.').pop() ?? a.uri.split('.').pop() ?? 'jpg').toLowerCase();
        const photo = await uploadTicketPhoto(draft.k, {
          base64: a.base64,
          mime: a.mimeType ?? 'image/jpeg',
          ext,
        });
        setPhotos((p) => [...p, photo]);   // each one appears as it lands
      }
    } catch (e: any) {
      Alert.alert('העלאה נכשלה', e?.message ?? 'לא ניתן להעלות את התמונה.');
    } finally {
      setUploading(false);
    }
  };

  const confirmDeletePhoto = (photo: TicketPhoto) =>
    Alert.alert('מחיקת תמונה', 'למחוק את התמונה מהכרטיס?', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTicketPhoto(photo);
            setPhotos((p) => p.filter((x) => x.id !== photo.id));
            setViewer(null);
          } catch (e: any) {
            Alert.alert('המחיקה נכשלה', e?.message ?? 'לא ניתן למחוק את התמונה.');
          }
        },
      },
    ]);

  const photoCount = photos.length;

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'details', label: 'פרטי כרטיס' },
    { id: 'works', label: 'עבודות ופריטים' },
    { id: 'photos', label: 'תמונות', count: photoCount },
    { id: 'history', label: 'היסטוריה' },
    { id: 'notes', label: 'הערות', count: notesCount },
  ];

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ---------- custom header ---------- */}
      <View style={{ backgroundColor: C.card, paddingTop: insets.top + 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <View style={[s.row, { justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 10 }]}>
          <View style={{ width: 22 }} />
          <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: 0.5 }}>
            {draft.plate || '-'}
          </Text>
          <Pressable onPress={confirmLeave} hitSlop={10}><Text style={{ fontSize: 22, color: C.ink }}>›</Text></Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
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

        {/* ================= WORKS (each expands to its own parts) ================= */}
        {tab === 'works' && (
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
                          {/* item name (right in RTL) */}
                          <Text style={[s.body, { flex: 1, fontSize: 14, fontWeight: '600', textAlign: 'right' }]} numberOfLines={2}>{p.name}</Text>
                          {/* quantity */}
                          <Stepper value={p.qty} onChange={(n) => patchPart(w.uid, i, { qty: n })} />
                          {/* price — tap to edit the unit price */}
                          <Pressable onPress={() => editPrice(w.uid, i, p)} style={{ width: 90, alignItems: 'center' }}>
                            <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink, ...rtl }}>{money(p.qty * p.price)}</Text>
                          </Pressable>
                          {/* delete (left in RTL) */}
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
        {/* ================= PHOTOS ================= */}
        {tab === 'photos' && (
          <>
            <SectionHead title="תמונות" count={photos.length} />

            <View style={[s.row, { gap: 10 }]}>
              {([
                { from: 'camera' as const, label: 'צלם תמונה' },
                { from: 'library' as const, label: 'מהגלריה' },
              ]).map(({ from, label }) => (
                <Pressable
                  key={from}
                  onPress={() => addPhotos(from)}
                  disabled={uploading}
                  style={{
                    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
                    borderWidth: 1, borderColor: C.line, backgroundColor: C.card,
                    opacity: uploading ? 0.5 : 1,
                  }}
                >
                  <Text style={{ color: C.ink, fontWeight: '700', fontSize: 14 }}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {uploading && (
              <View style={[s.row, { justifyContent: 'center', gap: 8, paddingVertical: 4 }]}>
                <Text style={s.dim}>מעלה...</Text>
                <ActivityIndicator color={C.ink} />
              </View>
            )}

            {photosLoading ? (
              <ActivityIndicator color={C.ink} style={{ marginTop: 20 }} />
            ) : photos.length === 0 ? (
              <View style={[s.card, { alignItems: 'center', paddingVertical: 28 }]}>
                <Text style={s.dim}>אין תמונות בכרטיס זה</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
                {photos.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => setViewer(p)}
                    onLongPress={() => confirmDeletePhoto(p)}   // long-press to delete, as everywhere else on the card
                    style={{ width: '31.9%', aspectRatio: 1 }}
                  >
                    <Image
                      source={{ uri: p.url }}
                      style={{ width: '100%', height: '100%', borderRadius: 10, backgroundColor: C.line }}
                    />
                  </Pressable>
                ))}
              </View>
            )}

            {photos.length > 0 && (
              <Text style={[s.dim, { textAlign: 'center' }]}>לחיצה ארוכה על תמונה כדי למחוק</Text>
            )}
          </>
        )}

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
            : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>סיים עבודה</Text>}
        </Pressable>
        <Pressable
          onPress={() => saveWith()}
          disabled={!dirty || saving}
          style={{
            flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
            borderWidth: 1, borderColor: C.line, backgroundColor: C.card,
            opacity: dirty && !saving ? 1 : 0.5,
          }}
        >
          <Text style={{ color: C.ink, fontWeight: '700', fontSize: 14 }}>שמור</Text>
        </Pressable>
      </View>

      {/* ---------- full-screen photo ---------- */}
      <Modal visible={Boolean(viewer)} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setViewer(null)}>
            {viewer && (
              <Image source={{ uri: viewer.url }} style={{ flex: 1 }} resizeMode="contain" />
            )}
          </Pressable>
          <View style={{
            flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 18, paddingTop: 12, paddingBottom: insets.bottom + 12,
          }}>
            <Pressable onPress={() => setViewer(null)} hitSlop={12}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>סגור</Text>
            </Pressable>
            <Text style={{ color: '#8b93a1', fontSize: 12 }}>{viewer?.createdAt}</Text>
            <Pressable onPress={() => viewer && confirmDeletePhoto(viewer)} hitSlop={12}>
              <Text style={{ color: C.danger, fontSize: 15, fontWeight: '700' }}>מחק</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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

/* `action` is optional: the photos section puts its buttons below the head, not in it. */
function SectionHead({ title, count, action, onAction }: {
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

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={[s.row, { justifyContent: 'space-between' }]}>
      <Text style={s.dim}>{label}</Text>
      <Text style={[s.body, { fontSize: 13, fontWeight: '600' }]}>{value}</Text>
    </View>
  );
}

/** A small trash-can icon drawn with Views (no icon dependency). */
function TrashIcon({ color = C.danger, size = 20 }: { color?: string; size?: number }) {
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

/* ---------------- pickers ---------------- */

function WorkPicker({ visible, onClose, onPick }: {
  visible: boolean; onClose: () => void; onPick: (w: TicketWork) => void;
}) {
  const uid = () => `w-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

  /* This garage's catalog, not a constant compiled into the app. Same pattern
     as PartPicker below: fetched when the sheet first opens, then kept.

     An empty catalog is a real state now — a garage onboarded without a starter
     catalog has none — so it needs its own message. Falling through to a blank
     list would read as a failed load, and the free-work button below is still
     the way out either way. */
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
      )}
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
