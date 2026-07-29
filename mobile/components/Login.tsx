/* The login screen — a branded navy header over a white form card, matching the
   product mockup. Auth is still email + password via signIn; see
   packages/shared/src/auth.ts. AuthGate swaps this in instead of the Stack, so
   there is no /login route.

   "Forgot password" is not a self-serve reset yet (accounts are operator-created)
   — the link says how to get back in rather than being a dead end. "Remember me"
   is surfaced but the client already persists the session. */

import { useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signIn } from '@garage/shared';
import { C } from '../lib/theme';

const hebrewError = (message: string): string => {
  if (/invalid login credentials/i.test(message)) return 'האימייל או הסיסמה שגויים.';
  if (/email not confirmed/i.test(message)) return 'החשבון עדיין לא אושר. פנו לתמיכה.';
  if (/network|fetch/i.test(message)) return 'אין חיבור לרשת. בדקו את החיבור ונסו שוב.';
  return 'ההתחברות נכשלה. נסו שוב, ואם זה חוזר — פנו לתמיכה.';
};

export default function Login() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
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
    } catch (err) {
      setError(hebrewError(err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  };

  const canSubmit = !busy && !!email && !!password;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.ink }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        {/* ---------- navy brand header ---------- */}
        <View style={{ paddingTop: insets.top + 30, paddingBottom: 30, alignItems: 'center', backgroundColor: C.ink }}>
          <Image
            source={require('../assets/icon.png')}
            style={{ width: 88, height: 88, borderRadius: 20, marginBottom: 12 }}
          />
          <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800' }}>מוסך</Text>
          <Text style={{ color: '#b8c4d6', fontSize: 13, marginTop: 4 }}>מערכת ניהול מוסך חכמה</Text>
        </View>

        {/* ---------- white form card ---------- */}
        <View
          style={{
            flex: 1, backgroundColor: '#fff',
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 24, paddingTop: 26, paddingBottom: insets.bottom + 24,
          }}
        >
          <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, textAlign: 'center' }}>ברוכים הבאים</Text>
          <Text style={{ fontSize: 13, color: C.dim, textAlign: 'center', marginTop: 4, marginBottom: 22 }}>
            התחברו כדי להמשיך למערכת
          </Text>

          {/* email */}
          <Text style={label}>אימייל</Text>
          <View style={field}>
            <Text style={leadingIcon}>✉️</Text>
            <TextInput
              style={input}
              value={email}
              onChangeText={setEmail}
              placeholder="הכנס את האימייל שלך"
              placeholderTextColor={C.mist}
              autoCapitalize="none" autoCorrect={false}
              keyboardType="email-address" textContentType="username" autoComplete="email"
              editable={!busy} returnKeyType="next"
            />
          </View>

          {/* password */}
          <Text style={[label, { marginTop: 12 }]}>סיסמה</Text>
          <View style={field}>
            <Text style={leadingIcon}>🔒</Text>
            <TextInput
              style={input}
              value={password}
              onChangeText={setPassword}
              placeholder="הכנס את הסיסמה שלך"
              placeholderTextColor={C.mist}
              secureTextEntry={!show}
              autoCapitalize="none" autoCorrect={false}
              textContentType="password" autoComplete="current-password"
              editable={!busy} returnKeyType="go" onSubmitEditing={submit}
            />
            <Pressable onPress={() => setShow((v) => !v)} hitSlop={8} accessibilityLabel={show ? 'הסתר סיסמה' : 'הצג סיסמה'}>
              <Text style={{ color: C.slate, fontSize: 13, fontWeight: '600' }}>{show ? 'הסתר' : 'הצג'}</Text>
            </Pressable>
          </View>

          {/* forgot (left) + remember (right) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <Pressable onPress={() => { setNotice('לאיפוס סיסמה פנו לתמיכה ונטפל בזה מיד.'); setError(null); }} hitSlop={6}>
              <Text style={{ color: C.slate, fontSize: 13, fontWeight: '600' }}>שכחת סיסמה?</Text>
            </Pressable>
            <Pressable onPress={() => setRemember((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }} hitSlop={6}>
              <View style={{
                width: 18, height: 18, borderRadius: 5, borderWidth: 1.5,
                borderColor: remember ? C.ink : C.line, backgroundColor: remember ? C.ink : 'transparent',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {remember && <Text style={{ color: '#fff', fontSize: 11, lineHeight: 13 }}>✓</Text>}
              </View>
              <Text style={{ fontSize: 13, color: C.dim }}>זכור אותי</Text>
            </Pressable>
          </View>

          {error && (
            <View style={{ marginTop: 14, padding: 10, borderRadius: 9, backgroundColor: '#fdecec' }}>
              <Text style={{ color: C.danger, fontSize: 13, textAlign: 'right', writingDirection: 'rtl' }} accessibilityLiveRegion="polite">
                {error}
              </Text>
            </View>
          )}
          {notice && (
            <View style={{ marginTop: 14, padding: 10, borderRadius: 9, backgroundColor: '#eef2f7' }}>
              <Text style={{ color: C.slate, fontSize: 13, textAlign: 'right', writingDirection: 'rtl' }}>{notice}</Text>
            </View>
          )}

          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            style={{
              marginTop: 20, backgroundColor: canSubmit ? C.ink : C.mist,
              borderRadius: 11, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 50,
            }}
            accessibilityRole="button" accessibilityLabel="כניסה"
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>כניסה</Text>}
          </Pressable>

          <View style={{
            marginTop: 22, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.line,
            flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center',
          }}>
            <Text style={{ fontSize: 12 }}>🛡️</Text>
            <Text style={{ color: C.dim, fontSize: 12 }}>גישה מאובטחת</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* field styling — row-reverse so the leading icon reads on the right (RTL),
   the input fills, and the show/hide toggle sits on the left. */
const field = {
  flexDirection: 'row-reverse' as const,
  alignItems: 'center' as const,
  gap: 8,
  borderWidth: 1,
  borderColor: C.line,
  borderRadius: 11,
  backgroundColor: '#fff',
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
const label = { fontSize: 12, fontWeight: '600' as const, color: C.dim, textAlign: 'right' as const, marginBottom: 6 };
