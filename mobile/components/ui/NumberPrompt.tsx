/* Ask for one number.

   This exists because `Alert.prompt` is iOS-only. The part-price row used it
   directly and returned early on Android, so the tap target was there and the
   price never changed — a mechanic on a Pixel could not correct a price at all,
   and nothing said why.

   Deliberately used on both platforms rather than branching: one code path is
   one behaviour to reason about, and a garage runs whatever phones it has. */

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { KEYBOARD_BEHAVIOR } from '../../lib/keyboard';
import { C, s } from '../../lib/theme';
import { Button } from './Button';

export function NumberPrompt({
  visible,
  title,
  subtitle,
  value,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  /** What is being priced — the row this was opened from. */
  subtitle?: string;
  value: number;
  onCancel: () => void;
  onSubmit: (value: number) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');

  // Seed on open, not on every render: typing must not be overwritten by the
  // value the prompt was opened with.
  useEffect(() => {
    if (visible) setText(String(value));
  }, [visible, value]);

  /* A comma is what a Hebrew keyboard offers for a decimal point, and "12,50"
     is what people type. Anything that is not a non-negative number is refused
     rather than silently saved as 0. */
  const parsed = Number.parseFloat(text.replace(',', '.'));
  const valid = Number.isFinite(parsed) && parsed >= 0;

  const submit = () => {
    if (valid) onSubmit(parsed);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD_BEHAVIOR}>
        <View style={[s.centred, { padding: 28 }]}>
          {/* Tapping the backdrop dismisses, like every other sheet in the app. */}
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]}
            onPress={onCancel}
            accessibilityLabel={t('common.cancel')}
          />

          <View style={[s.card, { width: '100%', maxWidth: 360, gap: 12 }]}>
            <View>
              <Text style={s.h2}>{title}</Text>
              {subtitle ? (
                <Text style={[s.dim, { marginTop: 2 }]} numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </View>

            <TextInput
              style={[s.input, { fontSize: 18, fontWeight: '700', textAlign: 'center' }]}
              value={text}
              onChangeText={setText}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={submit}
              accessibilityLabel={title}
            />

            <View style={[s.row, { gap: 10 }]}>
              <Button
                label={t('common.save')}
                onPress={submit}
                disabled={!valid}
                style={{ flex: 1 }}
              />
              <Button
                label={t('common.cancel')}
                onPress={onCancel}
                variant="outline"
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
