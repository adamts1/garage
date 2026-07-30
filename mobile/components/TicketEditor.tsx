/* The ticket editor, as a standalone component.

   It used to be the whole of app/ticket/[key].tsx. Pulling the body out here lets
   two callers share it: the phone route (a full screen, reached by push) and the
   tablet's master–detail right pane (embedded beside the list). The only things
   that differ between those are where the ticket key comes from and what "back"
   means — so both arrive as props instead of being read from the router. */

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable,
  ScrollView, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTicketsStore } from '../lib/TicketsProvider';
import {
  deleteTicketPhoto, listTicketPhotos, uploadTicketPhoto,
  type TicketPhoto,
} from '@garage/shared';
import {
  COLUMNS, PRIORITIES, VAT,
  assignableWorkers, listWorkers, workTotal, worksSummary,
} from '@garage/shared';
import type { Priority, Status, Ticket, TicketWork, Worker } from '@garage/shared';
import { C, s } from '../lib/theme';
import { Chips, Field, money, SectionHead, waNumber, WorksSection } from './ticketUi';

type Tab = 'details' | 'works' | 'photos' | 'history' | 'notes';

export default function TicketEditor({ ticketKey, onClose, embedded = false }: {
  ticketKey: string;
  onClose: () => void;
  /** Rendered inside the tablet pane (below the index header) rather than full-screen. */
  embedded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { tickets, loading, saveTicket } = useTicketsStore();

  const ticket = tickets.find((t) => t.k === ticketKey);

  const [draft, setDraft] = useState<Ticket | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('works');

  /* Photos are their own table and their own bytes, so they save on their own too -
     uploading is immediate and never rides along on the ticket's dirty/save flow. */
  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<TicketPhoto | null>(null);   // full-screen photo

  /* The garage's staff, for the "אחראי" picker. Loaded here rather than passed in,
     matching how ticketUi.tsx pulls the works catalog and the parts list. An empty
     list is valid — a garage that has entered no workers yet — and leaves only the
     "unassigned" chip, which is honest rather than broken. */
  const [workers, setWorkers] = useState<Worker[]>([]);
  useEffect(() => {
    let alive = true;
    listWorkers()
      .then((w) => { if (alive) setWorkers(w); })
      .catch(() => { if (alive) setWorkers([]); });   // an empty picker beats a broken tab
    return () => { alive = false; };
  }, []);

  /* The draft is keyed to the ticket: switching which ticket the pane shows (tablet)
     must drop the previous draft, or the new ticket would open showing the old one's
     edits. Resetting on ticketKey change also re-syncs after a realtime update lands
     while nothing is pending. */
  useEffect(() => { setDraft(null); }, [ticketKey]);

  // Load the ticket into an editable draft once it's known and nothing is pending.
  useEffect(() => {
    if (ticket && !draft) setDraft(ticket);
  }, [ticket, draft]);

  useEffect(() => {
    if (!ticketKey) return;
    let alive = true;
    setPhotosLoading(true);
    listTicketPhotos(ticketKey)
      .then((p) => alive && setPhotos(p))
      .catch(() => alive && setPhotos([]))   // an empty gallery beats blocking the screen
      .finally(() => alive && setPhotosLoading(false));
    return () => { alive = false; };
  }, [ticketKey]);

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
        {loading ? <ActivityIndicator color={C.ink} /> : <Text style={s.dim}>הקריאה {ticketKey} לא נמצאה</Text>}
      </View>
    );
  }
  if (!draft) return null;

  const set = <K extends keyof Ticket>(field: K, value: Ticket[K]) =>
    setDraft((d) => (d ? { ...d, [field]: value } : d));

  const setWorks = (works: TicketWork[]) => setDraft((d) => (d ? { ...d, works } : d));

  const works = draft.works ?? [];
  const sum = worksSummary(works);
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

  const saveWith = async (over?: Partial<Ticket>) => {
    setSaving(true);
    const base: Ticket = { ...draft, ...over };
    // Keep the headline amount honest: if the ticket has works, it IS their total.
    const next: Ticket = works.length ? { ...base, amount: sum.total } : base;
    await saveTicket(next, worksChanged);
    setSaving(false);
    setDraft(null);      // drop the draft so the screen re-syncs from the store
    onClose();
  };

  const confirmLeave = () => {
    if (!dirty) return onClose();
    Alert.alert('לצאת בלי לשמור?', 'יש שינויים שלא נשמרו.', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'צא בלי לשמור', style: 'destructive', onPress: onClose },
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
      {/* ---------- custom header ---------- */}
      <View style={{ backgroundColor: C.card, paddingTop: embedded ? 12 : insets.top + 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <View style={[s.row, { justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 10 }]}>
          <View style={{ width: 22 }} />
          <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: 0.5 }}>
            {draft.plate || '-'}
          </Text>
          <Pressable onPress={confirmLeave} hitSlop={10}>
            <Text style={{ fontSize: 22, color: C.ink }}>{embedded ? '✕' : '›'}</Text>
          </Pressable>
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
        {tab === 'works' && <WorksSection works={works} onChange={setWorks} />}

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
                {/* Active workers only, plus an explicit way to say nobody.
                    Without that option an assignment could never be undone —
                    Chips has no deselect — and unassigned is a real state now. */}
                <Chips
                  options={[
                    { id: '', label: 'לא הוקצה', color: '#8d99ae' },
                    ...assignableWorkers(workers).map((w) => ({ id: w.code, label: w.name, color: w.color })),
                  ]}
                  value={draft.who ?? ''}
                  onChange={(v) => set('who', v || null)}
                />
              </Field>
            </View>
          </>
        )}

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
    </KeyboardAvoidingView>
  );
}
