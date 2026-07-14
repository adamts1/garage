import { useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView,
  Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTicketsStore } from '../lib/TicketsProvider';
import { isConfigured } from '../lib/supabase';
import { COLUMNS, EPICS, PRIORITIES, TEAM, TYPES } from '../lib/types';
import type { Status, Ticket } from '../lib/types';
import { C, rtl, s } from '../lib/theme';

const STATUS = Object.fromEntries(COLUMNS.map((c) => [c.id, c])) as Record<
  Status,
  (typeof COLUMNS)[number]
>;

export default function TicketList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tickets, loading, error, refetch } = useTicketsStore();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [refreshing, setRefreshing] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter((t) => {
      if (status !== 'all' && t.st !== status) return false;
      if (!q) return true;
      return [t.k, t.title, t.plate, t.car, t.customer]
        .some((f) => (f ?? '').toLowerCase().includes(q));
    });
  }, [tickets, query, status]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch().catch(() => {});
    setRefreshing(false);
  };

  if (!isConfigured) return <SetupNotice />;

  if (loading) {
    return (
      <View style={[s.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.ink} />
        <Text style={[s.dim, { marginTop: 12 }]}>טוען קריאות…</Text>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <View style={{ padding: 12, gap: 10, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <TextInput
          style={s.input}
          value={query}
          onChangeText={setQuery}
          placeholder="חיפוש לפי מספר, לקוח, רכב או מספר רישוי"
          placeholderTextColor={C.dim}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, flexDirection: 'row-reverse' }}>
          <Chip label={`הכול (${tickets.length})`} active={status === 'all'} onPress={() => setStatus('all')} />
          {COLUMNS.map((col) => {
            const n = tickets.filter((t) => t.st === col.id).length;
            return (
              <Chip
                key={col.id}
                label={`${col.title} (${n})`}
                dot={col.dot}
                active={status === col.id}
                onPress={() => setStatus(col.id)}
              />
            );
          })}
        </ScrollView>
      </View>

      {error ? (
        <View style={{ backgroundColor: '#fdeceb', padding: 10 }}>
          <Text style={[rtl, { color: C.danger, fontSize: 13 }]}>שגיאה: {error}</Text>
        </View>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(t) => t.k}
        contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.ink} />}
        ListEmptyComponent={
          <Text style={[s.dim, { textAlign: 'center', marginTop: 40 }]}>
            {tickets.length ? 'אין קריאות שתואמות את הסינון' : 'אין קריאות'}
          </Text>
        }
        renderItem={({ item }) => (
          <TicketCard ticket={item} onPress={() => router.push(`/ticket/${item.k}`)} />
        )}
      />
    </View>
  );
}

function TicketCard({ ticket: t, onPress }: { ticket: Ticket; onPress: () => void }) {
  const epic = EPICS[t.epic];
  const prio = PRIORITIES[t.prio];
  const col = STATUS[t.st];
  const who = TEAM[t.who];
  const pct = t.subtasks.length ? Math.round((t.done / t.subtasks.length) * 100) : 0;

  return (
    <Pressable style={({ pressed }) => [s.card, { opacity: pressed ? 0.7 : 1, gap: 8 }]} onPress={onPress}>
      <View style={s.row}>
        <View style={[s.row, { flex: 1, gap: 6 }]}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col?.dot ?? C.mist }} />
          <Text style={[s.dim, { fontWeight: '700', color: C.slate }]}>{t.k}</Text>
          <Text style={s.dim}>{TYPES[t.type].i}</Text>
        </View>
        <View style={{ backgroundColor: epic.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
          <Text style={{ color: epic.c, fontSize: 11, fontWeight: '700' }}>{epic.t}</Text>
        </View>
      </View>

      <Text style={s.h2} numberOfLines={2}>{t.title}</Text>

      <Text style={s.dim}>
        {t.customer} · {t.car} · {t.plate}
      </Text>

      {t.blocked ? (
        <Text style={[rtl, { fontSize: 12, color: C.danger }]}>⛔ {t.blocked}</Text>
      ) : null}

      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <View style={[s.row, { gap: 8 }]}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: who.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{who.ini}</Text>
          </View>
          <Text style={{ color: prio.c, fontSize: 12, fontWeight: '700' }}>{prio.t}</Text>
        </View>
        <Text style={s.dim}>✓ {t.done}/{t.subtasks.length} · {pct}%</Text>
      </View>

      <View style={{ height: 4, backgroundColor: C.line, borderRadius: 2, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: 4, backgroundColor: col?.dot ?? C.mist }} />
      </View>

      {t.amount > 0 ? (
        <Text style={[rtl, { fontSize: 13, fontWeight: '700', color: C.ink }]}>₪{t.amount.toLocaleString('he-IL')}</Text>
      ) : null}
    </Pressable>
  );
}

function Chip({ label, dot, active, onPress }: { label: string; dot?: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row-reverse',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: active ? C.ink : C.line,
        backgroundColor: active ? C.ink : C.card,
      }}
    >
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} /> : null}
      <Text style={{ fontSize: 12, fontWeight: '600', color: active ? '#fff' : C.slate }}>{label}</Text>
    </Pressable>
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
