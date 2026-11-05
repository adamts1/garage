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
import { money, netFromGross } from '@garage/shared';
import { KEYBOARD_BEHAVIOR } from '../../lib/keyboard';
import { C, s } from '../../lib/theme';
import { Button } from './Button';

export function NumberPrompt({
  visible,
  title,
  subtitle,
  value,
  inclVat = false,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  /** What is being priced — the row this was opened from. */
  subtitle?: string;
  value: number;
  /** A price: offer a button that takes the VAT out of what was typed, so the
   *  line comes back to that figure once VAT is added at the end. */
  inclVat?: boolean;
  onCancel: () => void;
  onSubmit: (value: number) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  /* What was typed before VAT was taken out of it, so the same button can put
     it back rather than take VAT out a second time. */
  const [typed, setTyped] = useState<string | null>(null);

  // Seed on open, not on every render: typing must not be overwritten by the
  // value the prompt was opened with.
  useEffect(() => {
    if (visible) {
      setText(String(value));
      setTyped(null);
    }
  }, [visible, value]);

  /* A comma is what a Hebrew keyboard offers for a decimal point, and "12,50"
     is what people type. Anything that is not a non-negative number is refused
     rather than silently saved as 0. */
  const parsed = Number.parseFloat(text.replace(',', '.'));
  const valid = Number.isFinite(parsed) && parsed >= 0;

  const submit = () => {
    if (valid) onSubmit(parsed);
  };

  const removeVat = () => {
    if (typed !== null) {
      setText(typed);
      setTyped(null);
    } else if (valid && parsed > 0) {
      setTyped(text);
      setText(String(netFromGross(parsed)));
    }
  };

  // Typing over the result ends the undo: the field is a new price now.
  const onType = (next: string) => {
    setText(next);
    setTyped(null);
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
              onChangeText={onType}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={submit}
              accessibilityLabel={title}
            />

            {inclVat ? (
              <View style={{ gap: 4 }}>
                <Button
                  label={t(typed !== null ? 'works.restoreVat' : 'works.removeVat')}
                  onPress={removeVat}
                  disabled={typed === null && !(valid && parsed > 0)}
                  variant="outline"
                />
                {typed !== null ? (
                  <Text style={[s.dim, { fontSize: 12, textAlign: 'center' }]}>
                    {t('works.vatRemoved', { typed: money(Number.parseFloat(typed.replace(',', '.'))) })}
                  </Text>
                ) : null}
              </View>
            ) : null}

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
