/* The home screen. One list, two layouts:

   - Phone: the list fills the screen; a card pushes the editor route and "+"
     pushes the create route (app/ticket/[key].tsx, app/new.tsx).
   - Tablet: master–detail. The list is a fixed-width left pane; the right pane
     shows the selected ticket or the new-ticket form inline, so the list stays
     in view.

   The editor and the create form are the same components either way — only how
   they are reached differs. */

import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import SetupNotice from '../components/SetupNotice';
import TicketCreate from '../components/tickets/TicketCreate';
import TicketEditor from '../components/tickets/TicketEditor';
import TicketList from '../components/tickets/TicketList';
import { isConfigured } from '../lib/supabase';
import { C, s } from '../lib/theme';
import { useTicketsStore } from '../lib/TicketsProvider';
import { useIsTablet } from '../lib/useDeviceType';

/** The width the list keeps on a tablet, leaving the rest to the detail pane. */
const LIST_PANE_WIDTH = 340;

export default function Home() {
  const { t } = useTranslation();
  const isTablet = useIsTablet();
  const { loading } = useTicketsStore();

  if (!isConfigured) return <SetupNotice />;

  if (loading) {
    return (
      <View style={[s.screen, s.centred]}>
        <ActivityIndicator size="large" color={C.ink} />
        <Text style={[s.dim, { marginTop: 12 }]}>{t('tickets.loading')}</Text>
      </View>
    );
  }

  return isTablet ? <TabletHome /> : <PhoneHome />;
}

/* ---------------- phone: the list fills the screen, everything else is a route ---------------- */

function PhoneHome() {
  const router = useRouter();
  return (
    <TicketList onSelect={(key) => router.push(`/ticket/${key}`)} onNew={() => router.push('/new')} />
  );
}

/* ---------------- tablet: the list beside a detail pane ---------------- */

type Selection = { mode: 'ticket'; key: string } | { mode: 'new' } | null;

function TabletHome() {
  const [selection, setSelection] = useState<Selection>(null);
  const selectedKey = selection?.mode === 'ticket' ? selection.key : null;

  return (
    <View style={{ flex: 1, flexDirection: 'row-reverse', backgroundColor: C.bg }}>
      {/* the list — fixed width on the right (the RTL leading edge) */}
      <View style={{ width: LIST_PANE_WIDTH, borderLeftWidth: 1, borderLeftColor: C.line }}>
        <TicketList
          onSelect={(key) => setSelection({ mode: 'ticket', key })}
          onNew={() => setSelection({ mode: 'new' })}
          selectedKey={selectedKey}
        />
      </View>

      <View style={{ flex: 1 }}>
        {selection?.mode === 'new' ? (
          <TicketCreate
            embedded
            onClose={() => setSelection(null)}
            onCreated={(key) => setSelection({ mode: 'ticket', key })}
          />
        ) : selection?.mode === 'ticket' ? (
          <TicketEditor
            key={selection.key} /* remount when the chosen ticket changes, so its draft resets */
            embedded
            ticketKey={selection.key}
            onClose={() => setSelection(null)}
          />
        ) : (
          <DetailPlaceholder />
        )}
      </View>
    </View>
  );
}

function DetailPlaceholder() {
  const { t } = useTranslation();
  return (
    <View style={[s.screen, s.centred, { padding: 24 }]}>
      <Text style={{ fontSize: 40, marginBottom: 12 }}>🚗</Text>
      <Text style={s.h2}>{t('tickets.detail.title')}</Text>
      <Text style={[s.dim, { marginTop: 6, textAlign: 'center' }]}>{t('tickets.detail.hint')}</Text>
    </View>
  );
}
