/* The home screen. One list, two layouts:

   - Phone: the list fills the screen; a card pushes the editor route and "+" pushes
     the create route (app/ticket/[key].tsx, app/new.tsx).
   - Tablet: master–detail. The list is a fixed-width left pane; the right pane shows
     the selected ticket or the new-ticket form inline, so the list stays in view.

   The editor and create form are the same components either way (TicketEditor /
   TicketCreate) — only how they're reached differs. */

import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTicketsStore } from '../lib/TicketsProvider';
import { isConfigured } from '../lib/supabase';
import { useIsTablet } from '../lib/useDeviceType';
import TicketListPane from '../components/TicketListPane';
import TicketEditor from '../components/TicketEditor';
import TicketCreate from '../components/TicketCreate';
import { C, s } from '../lib/theme';

export default function Home() {
  const isTablet = useIsTablet();
  const { loading } = useTicketsStore();

  if (!isConfigured) return <SetupNotice />;

  if (loading) {
    return (
      <View style={[s.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.ink} />
        <Text style={[s.dim, { marginTop: 12 }]}>טוען קריאות…</Text>
      </View>
    );
  }

  return isTablet ? <TabletHome /> : <PhoneHome />;
}

/* ---------------- phone: list fills the screen, everything else is a route ---------------- */
function PhoneHome() {
  const router = useRouter();
  return (
    <TicketListPane
      onSelect={(key) => router.push(`/ticket/${key}`)}
      onNew={() => router.push('/new')}
    />
  );
}

/* ---------------- tablet: list beside a detail pane ---------------- */
type Selection = { mode: 'ticket'; key: string } | { mode: 'new' } | null;

function TabletHome() {
  const [selection, setSelection] = useState<Selection>(null);
  const selectedKey = selection?.mode === 'ticket' ? selection.key : null;

  return (
    <View style={{ flex: 1, flexDirection: 'row-reverse', backgroundColor: C.bg }}>
      {/* list — fixed width on the right (RTL leading edge) */}
      <View style={{ width: 340, borderLeftWidth: 1, borderLeftColor: C.line }}>
        <TicketListPane
          onSelect={(key) => setSelection({ mode: 'ticket', key })}
          onNew={() => setSelection({ mode: 'new' })}
          selectedKey={selectedKey}
        />
      </View>

      {/* detail */}
      <View style={{ flex: 1 }}>
        {selection?.mode === 'new' ? (
          <TicketCreate
            embedded
            onClose={() => setSelection(null)}
            onCreated={(key) => setSelection({ mode: 'ticket', key })}
          />
        ) : selection?.mode === 'ticket' ? (
          <TicketEditor
            key={selection.key}   /* remount when the chosen ticket changes, so its draft resets */
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
  return (
    <View style={[s.screen, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
      <Text style={{ fontSize: 40, marginBottom: 12 }}>🚗</Text>
      <Text style={s.h2}>בחר קריאה מהרשימה</Text>
      <Text style={[s.dim, { marginTop: 6, textAlign: 'center' }]}>
        או הקש + כדי לפתוח כרטיס עבודה חדש
      </Text>
    </View>
  );
}

function SetupNotice() {
  return (
    <View style={[s.screen, { padding: 24, justifyContent: 'center', gap: 12 }]}>
      <Text style={s.h1}>חסרה הגדרת Supabase</Text>
      <Text style={s.body}>
        צור קובץ <Text style={{ fontWeight: '700' }}>mobile/.env</Text> לפי{' '}
        <Text style={{ fontWeight: '700' }}>.env.example</Text>, עם הכתובת והמפתח של אותו פרויקט
        Supabase שהאתר משתמש בו:
      </Text>
      <View style={[s.card, { backgroundColor: C.ink }]}>
        <Text style={{ color: C.sand, fontFamily: 'Courier', fontSize: 12 }}>
          EXPO_PUBLIC_SUPABASE_URL=…{'\n'}EXPO_PUBLIC_SUPABASE_ANON_KEY=…
        </Text>
      </View>
      <Text style={s.dim}>אחרי השמירה יש להפעיל מחדש: npx expo start -c</Text>
    </View>
  );
}
