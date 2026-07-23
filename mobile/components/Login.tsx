/* The login screen. Email and password — see packages/shared/src/auth.ts.

   Not an expo-router route. AuthGate swaps this in instead of the Stack, so
   there is no /login path, no redirect and no window in which the router is
   mounted but unauthenticated. On a phone nobody types a URL, so a route would
   buy navigation we do not want and cost a class of race we would have to
   defend against. */

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signIn } from '@garage/shared';
import { C, rtl, s } from '../lib/theme';

/** Supabase answers in English; these are the two a user can actually cause. */
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !email || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      // No navigation: useAuth is subscribed to the auth state and AuthGate
      // swaps this screen out the moment the session lands.
    } catch (err) {
      setError(hebrewError(err instanceof Error ? err.message : String(err)));
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      // The one platform branch in the app, and it was here before auth:
      // iOS pushes content above the keyboard, Android resizes the window.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[s.card, { gap: 6 }]}>
          <Text style={[s.h1, { marginBottom: 2 }]}>מוסך</Text>
          <Text style={[s.dim, { marginBottom: 14 }]}>התחברות למערכת</Text>

          <Text style={s.label}>אימייל</Text>
          <TextInput
            style={[s.input, { textAlign: 'left', writingDirection: 'ltr' }]}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            editable={!busy}
            returnKeyType="next"
          />

          <Text style={[s.label, { marginTop: 10 }]}>סיסמה</Text>
          <TextInput
            style={[s.input, { textAlign: 'left', writingDirection: 'ltr' }]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            autoComplete="current-password"
            editable={!busy}
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          {error && (
            <View
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 9,
                backgroundColor: '#fdecec',
              }}
            >
              {/* accessibilityLiveRegion so TalkBack announces a failed attempt;
                  without it the only feedback is visual. */}
              <Text style={[rtl, { color: C.danger, fontSize: 13 }]} accessibilityLiveRegion="polite">
                {error}
              </Text>
            </View>
          )}

          <Pressable
            onPress={submit}
            disabled={busy || !email || !password}
            style={{
              marginTop: 18,
              backgroundColor: busy || !email || !password ? C.mist : C.ink,
              borderRadius: 10,
              paddingVertical: 13,
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 48,
            }}
            accessibilityRole="button"
            accessibilityLabel="כניסה"
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>כניסה</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
