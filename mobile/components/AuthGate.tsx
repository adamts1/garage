/* Which screen the app is on, decided before the Stack mounts.

   It wraps TicketsProvider rather than sitting inside it, because that provider
   calls useTickets() which opens a realtime subscription on mount. Mounting it
   before there is a session would open a subscription as anon, then have to tear
   it down and reopen it after login.

   The four states come from @garage/shared's resolveAuth so that web and mobile
   cannot disagree about what a session means. */

import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { signOut } from '@garage/shared';
import { useAuth } from '../lib/useAuth';
import { isConfigured } from '../lib/supabase';
import { C, s } from '../lib/theme';
import Login from './Login';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  // Unconfigured is the ticket list's own concern — it renders SetupNotice with
  // instructions. Letting it through keeps that message in one place.
  if (!isConfigured) return <>{children}</>;

  if (auth.status === 'loading') {
    // Unlike the browser's synchronous localStorage, AsyncStorage genuinely
    // takes a moment on a cold start, so this is visible and worth drawing.
    return (
      <View style={[s.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.ink} />
      </View>
    );
  }

  if (auth.status === 'out') return <Login />;

  if (auth.status === 'no-garage') {
    return (
      <View style={[s.screen, { justifyContent: 'center', padding: 24 }]}>
        <View style={[s.card, { gap: 10 }]}>
          <Text style={s.h1}>אין הרשאה למוסך</Text>
          <Text style={s.body}>
            {auth.error
              ? 'לא הצלחנו לאמת את ההרשאות. נסו שוב, ואם זה חוזר — פנו לתמיכה.'
              : 'המשתמש קיים אך אינו משויך למוסך. פנו לתמיכה כדי להשלים את ההגדרה.'}
          </Text>
          <Pressable
            onPress={() => void signOut()}
            style={{
              marginTop: 8,
              borderWidth: 1,
              borderColor: C.line,
              borderRadius: 10,
              paddingVertical: 12,
              alignItems: 'center',
              minHeight: 48,
              justifyContent: 'center',
            }}
            accessibilityRole="button"
          >
            <Text style={{ color: C.ink, fontWeight: '600' }}>התנתקות</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return <>{children}</>;
}
