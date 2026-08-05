/* A pill that is either on or off.

   Two shapes had grown separately — the list's status filters and the ticket
   form's status/priority/assignee pickers — differing only in whether they drew
   a coloured dot. One component, two callers.

   ChipGroup is the form case: pick exactly one of a set. The list's filters
   stay a plain row of Chips because they scroll horizontally and mix in counts. */

import { Pressable, ScrollView, Text, View } from 'react-native';
import { C } from '../../lib/theme';

export type ChipOption = { id: string; label: string; color?: string };

export function Chip({
  label,
  active,
  onPress,
  dot,
  color = C.ink,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  /** A leading dot — used where the option carries a colour of its own. */
  dot?: string;
  /** The fill once selected. Defaults to the app's ink. */
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        flexDirection: 'row-reverse',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: active ? color : C.line,
        backgroundColor: active ? color : C.card,
      }}
    >
      {dot ? (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
      ) : null}
      <Text style={{ fontSize: 12, fontWeight: '600', color: active ? C.onInk : C.slate }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Pick one of a set. Wraps onto as many lines as it needs. */
export function ChipGroup({
  options,
  value,
  onChange,
}: {
  options: ChipOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => (
        <Chip
          key={o.id}
          label={o.label}
          color={o.color}
          active={o.id === value}
          onPress={() => onChange(o.id)}
        />
      ))}
    </View>
  );
}

/** A single scrolling line of chips, for when there are more than fit. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6, flexDirection: 'row-reverse' }}
    >
      {children}
    </ScrollView>
  );
}
