/* Which screen the app is on, decided before the Stack mounts.

   It wraps TicketsProvider rather than sitting inside it, because that provider
   calls useTickets() which opens a realtime subscription on mount. Mounting it
   before there is a session would open a subscription as anon, then have to tear
   it down and reopen it after login.

   The four states come from @garage/shared's resolveAuth so that web and mobile
   cannot disagree about what a session means. */

import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { signOut } from '@garage/shared';
import { isConfigured } from '../../lib/supabase';
import { useAuth } from '../../lib/useAuth';
import { C, s } from '../../lib/theme';
import { Button } from '../ui';
import Login from './Login';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const auth = useAuth();

  // Unconfigured is the ticket list's own concern — it renders the setup notice
  // with instructions. Letting it through keeps that message in one place.
  if (!isConfigured) return <>{children}</>;

  if (auth.status === 'loading') {
    // Unlike the browser's synchronous localStorage, AsyncStorage genuinely takes
    // a moment on a cold start, so this is visible and worth drawing.
    return (
      <View style={[s.screen, s.centred]}>
        <ActivityIndicator size="large" color={C.ink} />
      </View>
    );
  }

  if (auth.status === 'out') return <Login />;

  if (auth.status === 'no-garage') {
    return (
      <View style={[s.screen, { justifyContent: 'center', padding: 24 }]}>
        <View style={[s.card, { gap: 10 }]}>
          <Text style={s.h1}>{t('auth.noGarage.title')}</Text>
          <Text style={s.body}>
            {auth.error ? t('auth.noGarage.error') : t('auth.noGarage.body')}
          </Text>
          <Button
            label={t('auth.signOut')}
            onPress={() => void signOut()}
            variant="outline"
            style={{ marginTop: 8 }}
          />
        </View>
      </View>
    );
  }

  return <>{children}</>;
}
