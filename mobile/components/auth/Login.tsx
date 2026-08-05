/* The login screen — a branded navy header over a white form card. Auth is email
   and password via signIn; see packages/shared/src/auth.ts. AuthGate swaps this
   in instead of the Stack, so there is no /login route.

   "Forgot password" is not a self-serve reset yet (accounts are operator-created)
   — the link says how to get back in rather than being a dead end. */

import { useState } from 'react';
import { Image, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { signIn } from '@garage/shared';
import { KEYBOARD_BEHAVIOR } from '../../lib/keyboard';
import { C, rtl } from '../../lib/theme';
import { Button, Field } from '../ui';

/** Supabase reports failures in English. Map the ones a mechanic can act on. */
const errorKey = (message: string): string => {
  if (/invalid login credentials/i.test(message)) return 'auth.errors.credentials';
  if (/email not confirmed/i.test(message)) return 'auth.errors.unconfirmed';
  if (/network|fetch/i.test(message)) return 'auth.errors.network';
  return 'auth.errors.generic';
};

export default function Login() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !email || !password) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signIn(email, password);
      // No setBusy(false) on success: AuthGate swaps this screen out, and
      // clearing the spinner first would flash the form back for a frame.
    } catch (err) {
      setError(t(errorKey(err instanceof Error ? err.message : String(err))));
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.ink }} behavior={KEYBOARD_BEHAVIOR}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        {/* ---------- navy brand header ---------- */}
        <View
          style={{
            paddingTop: insets.top + 30,
            paddingBottom: 30,
            alignItems: 'center',
            backgroundColor: C.ink,
          }}
        >
          <Image
            source={require('../../assets/icon.png')}
            style={{ width: 88, height: 88, borderRadius: 20, marginBottom: 12 }}
          />
          <Text style={{ color: C.onInk, fontSize: 30, fontWeight: '800' }}>{t('auth.appName')}</Text>
          <Text style={{ color: C.onInkDim, fontSize: 13, marginTop: 4 }}>{t('auth.tagline')}</Text>
        </View>

        {/* ---------- white form card ---------- */}
        <View
          style={{
            flex: 1,
            backgroundColor: C.card,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 24,
            paddingTop: 26,
            paddingBottom: insets.bottom + 24,
          }}
        >
          <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, textAlign: 'center' }}>
            {t('auth.welcome')}
          </Text>
          <Text
            style={{
              fontSize: 13,
              color: C.dim,
              textAlign: 'center',
              marginTop: 4,
              marginBottom: 22,
            }}
          >
            {t('auth.subtitle')}
          </Text>

          <Field label={t('auth.email')}>
            <View style={field}>
              <Text style={leadingIcon}>✉️</Text>
              <TextInput
                style={input}
                value={email}
                onChangeText={setEmail}
                placeholder={t('auth.emailPlaceholder')}
                placeholderTextColor={C.mist}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                autoComplete="email"
                editable={!busy}
                returnKeyType="next"
              />
            </View>
          </Field>

          <View style={{ height: 12 }} />

          <Field label={t('auth.password')}>
            <View style={field}>
              <Text style={leadingIcon}>🔒</Text>
              <TextInput
                style={input}
                value={password}
                onChangeText={setPassword}
                placeholder={t('auth.passwordPlaceholder')}
                placeholderTextColor={C.mist}
                secureTextEntry={!show}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                autoComplete="current-password"
                editable={!busy}
                returnKeyType="go"
                onSubmitEditing={submit}
              />
              <Pressable
                onPress={() => setShow((v) => !v)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={show ? t('auth.hidePassword') : t('auth.showPassword')}
              >
                <Text style={{ color: C.slate, fontSize: 13, fontWeight: '600' }}>
                  {show ? t('auth.hide') : t('auth.show')}
                </Text>
              </Pressable>
            </View>
          </Field>

          <Pressable
            onPress={() => {
              setNotice(t('auth.forgotNotice'));
              setError(null);
            }}
            hitSlop={6}
            style={{ marginTop: 16, alignSelf: 'flex-start' }}
          >
            <Text style={{ color: C.slate, fontSize: 13, fontWeight: '600' }}>
              {t('auth.forgot')}
            </Text>
          </Pressable>

          {error && (
            <Message text={error} color={C.danger} background={C.dangerBg} live />
          )}
          {notice && <Message text={notice} color={C.slate} background={C.tint} />}

          <Button
            label={t('auth.signIn')}
            onPress={submit}
            busy={busy}
            disabled={!email || !password}
            style={{ marginTop: 20 }}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Message({
  text,
  color,
  background,
  live = false,
}: {
  text: string;
  color: string;
  background: string;
  /** Errors are announced; the forgot-password notice is not worth interrupting for. */
  live?: boolean;
}) {
  return (
    <View style={{ marginTop: 14, padding: 10, borderRadius: 9, backgroundColor: background }}>
      <Text
        style={[rtl, { color, fontSize: 13 }]}
        accessibilityLiveRegion={live ? 'polite' : 'none'}
      >
        {text}
      </Text>
    </View>
  );
}

/* Field styling — row-reverse so the leading icon reads on the right (RTL), the
   input fills, and the show/hide toggle sits on the left. Local to this screen:
   no other form has an icon inside the box. */
const field = {
  flexDirection: 'row-reverse' as const,
  alignItems: 'center' as const,
  gap: 8,
  borderWidth: 1,
  borderColor: C.line,
  borderRadius: 11,
  backgroundColor: C.card,
  paddingHorizontal: 12,
};
const input = {
  flex: 1,
  paddingVertical: 12,
  fontSize: 14,
  color: C.text,
  textAlign: 'right' as const,
};
const leadingIcon = { fontSize: 15 };
