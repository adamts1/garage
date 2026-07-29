/* The ticket list — search box, status chips, and the cards. Extracted from the
   index screen so both layouts can use it: on a phone it fills the screen and
   selecting a card pushes the editor; on a tablet it's the left pane and selecting
   a card just updates which ticket the right pane shows (highlighted via
   selectedKey). The "+ new ticket" button lives here so it's present in both. */

import { useMemo, useState } from 'react';
import {
  FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTicketsStore } from '../lib/TicketsProvider';
import { COLUMNS } from '@garage/shared';
import type { Status, Ticket } from '@garage/shared';
import { C, rtl, s } from '../lib/theme';

export default function TicketListPane({ onSelect, onNew, selectedKey }: {
  onSelect: (key: string) => void;
  onNew: () => void;
  /** highlights the open ticket in the tablet two-pane; undefined on phone */
  selectedKey?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const { tickets, error, refetch } = useTicketsStore();

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

  return (
    <View style={s.screen}>
      <View style={{ padding: 12, gap: 10, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <View style={[s.row, { gap: 10 }]}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={query}
            onChangeText={setQuery}
            placeholder="חיפוש לפי מספר, לקוח, רכב או מספר רישוי"
            placeholderTextColor={C.dim}
          />
          <Pressable
            onPress={onNew}
            hitSlop={6}
            style={{
              width: 44, height: 44, borderRadius: 12, backgroundColor: C.ink,
              alignItems: 'center', justifyContent: 'center',
            }}
            accessibilityRole="button"
            accessibilityLabel="כרטיס חדש"
          >
            <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700', marginTop: -2 }}>+</Text>
          </Pressable>
        </View>
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
          <TicketCard
            ticket={item}
            selected={item.k === selectedKey}
            onPress={() => onSelect(item.k)}
          />
        )}
      />
    </View>
  );
}

function TicketCard({ ticket: t, onPress, selected }: {
  ticket: Ticket; onPress: () => void; selected?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        s.card,
        {
          opacity: pressed ? 0.7 : 1,
          flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
          paddingVertical: 18,
          borderColor: selected ? C.ink : C.line,
          borderWidth: selected ? 2 : 1,
          backgroundColor: selected ? '#eef2f7' : C.card,
        },
      ]}
      onPress={onPress}
    >
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        {/* vehicle number, shown like a license plate */}
        <View style={{ backgroundColor: C.sand, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: C.ink, letterSpacing: 1 }}>
            {t.plate || '—'}
          </Text>
        </View>
        {/* vehicle name */}
        <Text style={[rtl, { fontSize: 17, fontWeight: '600', color: C.slate }]}>
          {t.car || 'רכב ללא שם'}
        </Text>
      </View>

      <Text style={{ fontSize: 28, color: C.mist }}>‹</Text>
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
