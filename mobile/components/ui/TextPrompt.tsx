/* Ask for a line of text. NumberPrompt's sibling, for the same reason it exists:
   `Alert.prompt` is iOS-only, and a garage runs whatever phones it has. */

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { KEYBOARD_BEHAVIOR } from '../../lib/keyboard';
import { C, s } from '../../lib/theme';
import { Button } from './Button';

export function TextPrompt({
  visible,
  title,
  subtitle,
  placeholder,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  /** A line under the title — what the text is for, or where it will go. */
  subtitle?: string;
  placeholder?: string;
  onCancel: () => void;
  /** Called with the text trimmed; never with an empty string. */
  onSubmit: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');

  // Empty on every open: the last description is not a default for the next.
  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const value = text.trim();
  const submit = () => {
    if (value) onSubmit(value);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD_BEHAVIOR}>
        <View style={[s.centred, { padding: 28 }]}>
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

            {/* Multiline: a description of work runs to a sentence. Saving is
                the button, not the return key, which here starts a new line. */}
            <TextInput
              style={[s.input, { minHeight: 72 }]}
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
              placeholder={placeholder}
              placeholderTextColor={C.dim}
              accessibilityLabel={title}
            />

            <View style={[s.row, { gap: 10 }]}>
              <Button label={t('common.save')} onPress={submit} disabled={!value} style={{ flex: 1 }} />
              <Button label={t('common.cancel')} onPress={onCancel} variant="outline" style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
