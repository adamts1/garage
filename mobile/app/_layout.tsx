import { useState } from 'react';
import { Pressable } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { setSupabaseClient } from '@garage/shared';
import AuthGate from '../components/auth/AuthGate';
import { UserSheet } from '../components/auth/UserSheet';
import EnvBadge from '../components/EnvBadge';
import { MenuIcon } from '../components/ui';
import { TicketsProvider } from '../lib/TicketsProvider';
import { projectUrl, supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import '../lib/i18n';

// @garage/shared holds no client of its own. The native build hands it this one,
// which carries the AsyncStorage session config the browser build does not need.
// Module scope, so it runs on import — before any screen renders or fetches.
setSupabaseClient(supabase, projectUrl);

export default function RootLayout() {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <SafeAreaProvider>
      {/* Outside TicketsProvider: that provider opens a realtime subscription on
          mount, and one opened before login would have to be torn down and
          reopened once a session exists. */}
      <AuthGate>
        <TicketsProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: C.ink },
              headerTintColor: C.onInk,
              headerTitleAlign: 'center',
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: C.bg },
            }}
          >
            <Stack.Screen
              name="index"
              options={{
                title: t('nav.tickets'),
                headerLeft: () => (
                  <Pressable
                    onPress={() => setMenuOpen(true)}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t('nav.menu')}
                  >
                    <MenuIcon />
                  </Pressable>
                ),
              }}
            />
            {/* Both render their own header — a plate or a title, with a close
                affordance the native bar has no room for. The routes used to
                repeat headerShown:false themselves; it belongs here, once. */}
            <Stack.Screen name="ticket/[key]" options={{ headerShown: false }} />
            <Stack.Screen name="new" options={{ headerShown: false }} />
          </Stack>
          <UserSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
        </TicketsProvider>
      </AuthGate>
      {/* Last child, and outside AuthGate: it has to be on top of whatever is
          drawn, including the login screen and the pre-session spinner. */}
      <EnvBadge />
    </SafeAreaProvider>
  );
}
