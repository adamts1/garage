/* The ticket list — search box, status chips, and the cards.

   Extracted from the index screen so both layouts can use it: on a phone it
   fills the screen and selecting a card pushes the editor; on a tablet it is the
   left pane and selecting a card just updates which ticket the right pane shows
   (highlighted via selectedKey). The "+ new ticket" button lives here so it is
   present in both. */

import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { COLUMNS, isArchived, type Status, type Ticket } from '@garage/shared';
import { useTicketsStore } from '../../lib/TicketsProvider';
import { C, rtl, s } from '../../lib/theme';
import { Chip, ChipRow } from '../ui';

/** 'archive' is a view, not a status — the board's chips only cover live work. */
type Filter = Status | 'all' | 'archive';

export default function TicketList({
  onSelect,
  onNew,
  selectedKey,
}: {
  onSelect: (key: string) => void;
  onNew: () => void;
  /** Highlights the open ticket in the tablet two-pane; undefined on phone. */
  selectedKey?: string | null;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { tickets, error, refetch } = useTicketsStore();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);

  /* Paid tickets that have aged past the cutoff leave the list, the way they
     leave the web board — same isArchived, so the two products agree on what is
     still open work. Derived on every render, not stored: a ticket archives
     itself as it ages and comes straight back if it is moved out of 'שולם'. The
     archive is not lost, only behind its own chip. */
  const { active, archived } = useMemo(() => {
    const now = new Date();
    return {
      active: tickets.filter((x) => !isArchived(x, now)),
      archived: tickets.filter((x) => isArchived(x, now)),
    };
  }, [tickets]);

  const pool = status === 'archive' ? archived : active;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool.filter((x) => {
      if (status !== 'all' && status !== 'archive' && x.st !== status) return false;
      if (!q) return true;
      return [x.k, x.title, x.plate, x.car, x.customer].some((f) =>
        (f ?? '').toLowerCase().includes(q),
      );
    });
  }, [pool, query, status]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch().catch(() => {});
    setRefreshing(false);
  };

  const emptyMessage =
    status === 'archive'
      ? t('tickets.archiveEmpty')
      : tickets.length
        ? t('tickets.noMatch')
        : t('tickets.empty');

  return (
    <View style={s.screen}>
      <View
        style={{
          padding: 12,
          gap: 10,
          backgroundColor: C.card,
          borderBottomWidth: 1,
          borderBottomColor: C.line,
        }}
      >
        <View style={[s.row, { gap: 10 }]}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={query}
            onChangeText={setQuery}
            placeholder={t('tickets.searchPlaceholder')}
            placeholderTextColor={C.dim}
          />
          <Pressable
            onPress={onNew}
            hitSlop={6}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: C.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityRole="button"
            accessibilityLabel={t('tickets.new')}
          >
            <Text style={{ color: C.onInk, fontSize: 26, fontWeight: '700', marginTop: -2 }}>+</Text>
          </Pressable>
        </View>

        <ChipRow>
          <Chip
            label={t('tickets.chip', { title: t('tickets.all'), n: active.length })}
            active={status === 'all'}
            onPress={() => setStatus('all')}
          />
          {COLUMNS.map((col) => (
            <Chip
              key={col.id}
              label={t('tickets.chip', {
                title: col.title,
                n: active.filter((x) => x.st === col.id).length,
              })}
              dot={col.dot}
              active={status === col.id}
              onPress={() => setStatus(col.id)}
            />
          ))}
          <Chip
            label={t('tickets.chip', { title: t('tickets.archive'), n: archived.length })}
            dot={C.mist}
            active={status === 'archive'}
            onPress={() => setStatus('archive')}
          />
        </ChipRow>
      </View>

      {status === 'archive' ? (
        <Text style={[s.dim, { textAlign: 'center', paddingTop: 10, paddingHorizontal: 12 }]}>
          {t('tickets.archiveHint')}
        </Text>
      ) : null}

      {error ? (
        <View style={{ backgroundColor: C.dangerBg, padding: 10 }}>
          <Text style={[rtl, { color: C.danger, fontSize: 13 }]}>
            {t('tickets.error', { message: error })}
          </Text>
        </View>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(x) => x.k}
        contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.ink} />
        }
        ListEmptyComponent={
          <Text style={[s.dim, { textAlign: 'center', marginTop: 40 }]}>{emptyMessage}</Text>
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

/** One ticket in the list: the plate, big, and what the car is. */
function TicketCard({
  ticket,
  onPress,
  selected,
}: {
  ticket: Ticket;
  onPress: () => void;
  selected?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.card,
        s.rowBetween,
        {
          opacity: pressed ? 0.7 : 1,
          paddingVertical: 18,
          borderColor: selected ? C.ink : C.line,
          borderWidth: selected ? 2 : 1,
          backgroundColor: selected ? C.tint : C.card,
        },
      ]}
    >
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        {/* the vehicle number, shown like a license plate */}
        <View
          style={{
            backgroundColor: C.sand,
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 8,
          }}
        >
          <Text style={{ fontSize: 24, fontWeight: '800', color: C.ink, letterSpacing: 1 }}>
            {ticket.plate || t('common.none')}
          </Text>
        </View>
        <Text style={[rtl, { fontSize: 17, fontWeight: '600', color: C.slate }]}>
          {ticket.car || t('tickets.unnamedCar')}
        </Text>
      </View>

      <Text style={{ fontSize: 28, color: C.mist }}>‹</Text>
    </Pressable>
  );
}
