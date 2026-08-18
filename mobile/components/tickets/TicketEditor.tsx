/* The ticket editor.

   Two callers share it: the phone route (a full screen, reached by push) and the
   tablet's master–detail right pane (embedded beside the list). The only things
   that differ are where the ticket key comes from and what "back" means, so both
   arrive as props rather than being read from the router.

   What is left here is orchestration — the draft, the tab bar, saving, the
   WhatsApp send and the printout. Each tab renders itself (tabs/), the photos
   manage themselves (useTicketPhotos), and both things a customer receives are
   built by @garage/shared: waMessage for the message and workOrderHtml for the
   sheet. The web sends and prints the same two. */

import * as Print from 'expo-print';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { listWorkers, waMessage, waNumber, workOrderHtml, worksSummary } from '@garage/shared';
import type { Status, Ticket, TicketWork, Worker } from '@garage/shared';
import { KEYBOARD_BEHAVIOR } from '../../lib/keyboard';
import { useTicketsStore } from '../../lib/TicketsProvider';
import { C, s } from '../../lib/theme';
import { Button } from '../ui';
import { ChecklistTab } from './tabs/ChecklistTab';
import { DetailsTab } from './tabs/DetailsTab';
import { NotesTab } from './tabs/NotesTab';
import { PhotosTab } from './tabs/PhotosTab';
import { useTicketPhotos } from './useTicketPhotos';
import { WorksSection } from './WorksSection';

/* iOS rejects when the print sheet is dismissed without anything being sent to
   a printer — "Printing did not complete". That is somebody changing their
   mind, not a failure, and an alert for it would be the app telling them off
   for closing a dialog. Android resolves in the same case.

   Matched on the message because that is all the module exposes: the native
   exception types do not survive the bridge as codes. */
const isPrintCancelled = (e: unknown): boolean =>
  /did not complete|cancel/i.test(e instanceof Error ? e.message : String(e));

type Tab = 'details' | 'works' | 'photos' | 'history' | 'notes';

export default function TicketEditor({
  ticketKey,
  onClose,
  embedded = false,
}: {
  ticketKey: string;
  onClose: () => void;
  /** Rendered inside the tablet pane (below the index header) rather than full-screen. */
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { tickets, loading, saveTicket } = useTicketsStore();
  const photos = useTicketPhotos(ticketKey);
  const workers = useGarageWorkers();

  const ticket = tickets.find((x) => x.k === ticketKey);

  const [draft, setDraft] = useState<Ticket | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('works');

  /* The draft is keyed to the ticket: switching which ticket the pane shows
     (tablet) must drop the previous draft, or the new ticket would open showing
     the old one's edits. Resetting on ticketKey change also re-syncs after a
     realtime update lands while nothing is pending. */
  useEffect(() => {
    setDraft(null);
  }, [ticketKey]);

  // Load the ticket into an editable draft once it's known and nothing is pending.
  useEffect(() => {
    if (ticket && !draft) setDraft(ticket);
  }, [ticket, draft]);

  const dirty = useMemo(
    () => Boolean(draft && ticket && JSON.stringify(draft) !== JSON.stringify(ticket)),
    [draft, ticket],
  );

  const worksChanged = useMemo(
    () =>
      Boolean(
        draft && ticket && JSON.stringify(draft.works ?? []) !== JSON.stringify(ticket.works ?? []),
      ),
    [draft, ticket],
  );

  if (loading || (!ticket && !draft)) {
    return (
      <View style={[s.screen, s.centred]}>
        {loading ? (
          <ActivityIndicator color={C.ink} />
        ) : (
          <Text style={s.dim}>{t('ticket.notFound', { key: ticketKey })}</Text>
        )}
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

  /* The checklist is a prefix: the schema stores `done` as a count, not a flag
     per subtask. Tapping row i means "the first i+1 are done"; tapping the last
     done row unticks back to i. */
  const toggleSubtask = (i: number) => set('done', draft.done === i + 1 ? i : i + 1);

  const changeStatus = (st: Status) =>
    setDraft((d) => {
      if (!d) return d;
      /* The phone never moves a ticket into שולם. The picker does not offer it
         (see DetailsTab), and this refuses it too: the money is taken on the
         web, where the invoice and the payment are, and a status that says paid
         without either is a claim nobody can back up. */
      if (st === 'paid') return d;
      // Landing in done ticks everything off — same rule as the web board.
      return { ...d, st, done: st === 'done' ? d.subtasks.length : d.done };
    });

  const saveWith = async (over?: Partial<Ticket>) => {
    setSaving(true);
    const base: Ticket = { ...draft, ...over };
    // Keep the headline amount honest: if the ticket has works, it IS their total.
    const next: Ticket = works.length ? { ...base, amount: sum.total } : base;
    await saveTicket(next, worksChanged);
    setSaving(false);
    setDraft(null); // drop the draft so the screen re-syncs from the store
    onClose();
  };

  const confirmLeave = () => {
    if (!dirty) return onClose();
    Alert.alert(t('ticket.leave.title'), t('ticket.leave.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('ticket.leave.confirm'), style: 'destructive', onPress: onClose },
    ]);
  };

  const sendWhatsApp = () => {
    const number = waNumber(draft.phone);
    if (!number) {
      return Alert.alert(t('ticket.whatsapp.noPhoneTitle'), t('ticket.whatsapp.noPhoneBody'));
    }
    /* The message itself is shared with the web app and deliberately not
       translated — it goes to a customer, not to the operator, so the app's
       language setting must not change what the garage sends out. */
    const text = waMessage({
      ticket: draft,
      closed,
      total: works.length ? sum.total : draft.amount,
      photos: photos.photos,
    });
    Linking.openURL(`https://wa.me/${number}?text=${encodeURIComponent(text)}`).catch(() =>
      Alert.alert(t('common.error'), t('ticket.whatsapp.openFailed')),
    );
  };

  /* The same sheet the web prints, through the platform's own print dialog:
     AirPrint on iOS, the Android print framework on Android. Both offer "save
     as PDF" beside the printers, which is how a garage with no printer in the
     bay still gets a copy to send.

     The totals are handed over rather than recomputed inside the document, so
     the sheet cannot disagree with the figures on this screen — and a ticket
     with no works is its own amount, exactly as the WhatsApp message treats it.

     printAsync resolves when the sheet is dismissed and rejects when it is
     cancelled on iOS, which is not an error worth an alert. */
  const [printing, setPrinting] = useState(false);
  const printTicket = async () => {
    setPrinting(true);
    try {
      await Print.printAsync({
        html: workOrderHtml(
          draft,
          { labour: sum.labor, items: sum.parts, vat: sum.vat, total: works.length ? sum.total : draft.amount },
          { photoCount: photos.photos.length },
        ),
      });
    } catch (e) {
      if (!isPrintCancelled(e)) Alert.alert(t('common.error'), t('ticket.print.failed'));
    } finally {
      setPrinting(false);
    }
  };

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'details', label: t('ticket.tabs.details') },
    { id: 'works', label: t('ticket.tabs.works') },
    { id: 'photos', label: t('ticket.tabs.photos'), count: photos.photos.length },
    { id: 'history', label: t('ticket.tabs.history') },
    { id: 'notes', label: t('ticket.tabs.notes'), count: notesCount },
  ];

  return (
    <KeyboardAvoidingView style={s.screen} behavior={KEYBOARD_BEHAVIOR}>
      <View
        style={{
          backgroundColor: C.card,
          paddingTop: embedded ? 12 : insets.top + 6,
          borderBottomWidth: 1,
          borderBottomColor: C.line,
        }}
      >
        <View style={[s.rowBetween, { paddingHorizontal: 14, paddingBottom: 10 }]}>
          <View style={{ width: 22 }} />
          <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: 0.5 }}>
            {draft.plate || '-'}
          </Text>
          <Pressable
            onPress={confirmLeave}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Text style={{ fontSize: 22, color: C.ink }}>{embedded ? '✕' : '›'}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        <Button
          label={closed ? t('ticket.whatsapp.ready') : t('ticket.whatsapp.quote')}
          onPress={sendWhatsApp}
          color={C.whatsapp}
        />

        <Button
          label={t('ticket.print.action')}
          onPress={() => void printTicket()}
          variant="outline"
          busy={printing}
        />

        <TabBar tabs={TABS} active={tab} onSelect={setTab} />

        {tab === 'works' && <WorksSection works={works} onChange={setWorks} />}
        {tab === 'details' && (
          <DetailsTab draft={draft} onSet={set} onStatus={changeStatus} workers={workers} />
        )}
        {tab === 'photos' && <PhotosTab photos={photos} />}
        {tab === 'history' && (
          <ChecklistTab subtasks={draft.subtasks} done={draft.done} onToggle={toggleSubtask} />
        )}
        {tab === 'notes' && <NotesTab draft={draft} onSet={set} />}
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          flexDirection: 'row-reverse',
          alignItems: 'center',
          gap: 10,
          padding: 12,
          paddingBottom: insets.bottom + 10,
          backgroundColor: C.card,
          borderTopWidth: 1,
          borderTopColor: C.line,
        }}
      >
        <Button
          label={t('ticket.finish')}
          onPress={() => saveWith({ st: 'done', done: draft.subtasks.length })}
          busy={saving}
          style={{ flex: 1 }}
        />
        <Button
          label={t('common.save')}
          onPress={() => saveWith()}
          variant="outline"
          disabled={!dirty || saving}
          style={{ flex: 1 }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function TabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: Tab; label: string; count?: number }[];
  active: Tab;
  onSelect: (id: Tab) => void;
}) {
  return (
    <View style={{ flexDirection: 'row-reverse', borderBottomWidth: 1, borderBottomColor: C.line }}>
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onSelect(tab.id)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 12, gap: 6 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text
              style={{ fontSize: 12.5, fontWeight: on ? '800' : '600', color: on ? C.ink : C.dim }}
            >
              {tab.label}
              {tab.count ? ` (${tab.count})` : ''}
            </Text>
            <View
              style={{
                height: 2,
                width: 28,
                backgroundColor: on ? C.ink : 'transparent',
                borderRadius: 2,
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/* The garage's staff, for the "אחראי" picker. Loaded here rather than passed in,
   matching how the pickers pull the works catalog and the parts list. An empty
   list is valid — a garage that has entered no workers yet — and leaves only the
   "unassigned" chip, which is honest rather than broken. */
function useGarageWorkers(): Worker[] {
  const [workers, setWorkers] = useState<Worker[]>([]);

  useEffect(() => {
    let alive = true;
    listWorkers()
      .then((w) => {
        if (alive) setWorkers(w);
      })
      .catch(() => {
        if (alive) setWorkers([]); // an empty picker beats a broken tab
      });
    return () => {
      alive = false;
    };
  }, []);

  return workers;
}
