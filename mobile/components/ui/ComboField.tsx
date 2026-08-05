/* The phone's answer to the web form's <datalist>: a text input and a dropdown
   at once. React Native has neither, so this is both — type to filter, or tap ▾
   to see the list; either way the value is whatever ends up in the input, so an
   entry the catalog has never heard of is typed straight in and saved like any
   other. The list is an aid, never a gate.

   The panel renders inline rather than absolutely positioned: inside a
   ScrollView an absolute overlay is clipped by the card it sits in, and a modal
   is far too much ceremony for picking "טויוטה". */

import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, s } from '../../lib/theme';
import { Field } from './Field';

/** Long enough to scroll through, short enough that the panel is not the screen. */
const OPTION_LIMIT = 40;

export function ComboField({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const q = value.trim().toLowerCase();
  // Typing filters; an exact hit means the field is settled, so show the whole
  // list again rather than the one option already chosen.
  const exact = q.length > 0 && options.some((o) => o.toLowerCase() === q);
  const shown = (q && !exact ? options.filter((o) => o.toLowerCase().includes(q)) : options).slice(
    0,
    OPTION_LIMIT,
  );

  return (
    <View style={{ gap: 6 }}>
      <Field label={label}>
        <View style={{ position: 'relative', justifyContent: 'center' }}>
          <TextInput
            style={[s.input, { paddingLeft: 40 }]}
            value={value}
            placeholder={placeholder}
            placeholderTextColor={C.dim}
            autoCorrect={false}
            onChangeText={(v) => {
              onChange(v);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          {options.length > 0 && (
            <Pressable
              onPress={() => setOpen((v) => !v)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('ui.openList', { label })}
              style={{ position: 'absolute', left: 10, padding: 4 }}
            >
              <Text style={{ fontSize: 13, color: C.dim }}>{open ? '▲' : '▼'}</Text>
            </Pressable>
          )}
        </View>
      </Field>

      {open && shown.length > 0 && (
        <View style={[s.card, { padding: 0, overflow: 'hidden', maxHeight: 220 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {shown.map((o, i) => (
              <Pressable
                key={o}
                onPress={() => {
                  onChange(o);
                  setOpen(false);
                }}
                style={{
                  paddingVertical: 11,
                  paddingHorizontal: 12,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: C.line,
                }}
              >
                <Text
                  style={{ fontSize: 13.5, fontWeight: '600', color: C.ink, textAlign: 'right' }}
                >
                  {o}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Said plainly, because a list that offers nothing looks broken until you
          know the field takes anything. */}
      {open && shown.length === 0 && value.trim().length > 0 && (
        <Text style={[s.dim, { fontSize: 11.5, paddingHorizontal: 2 }]}>{t('ui.notInList')}</Text>
      )}
    </View>
  );
}
