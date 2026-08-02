import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setSupabaseClient } from '@garage/shared';
import AuthGate from '../components/AuthGate';
import EnvBadge from '../components/EnvBadge';
import { UserSheet } from '../components/UserSheet';
import { TicketsProvider } from '../lib/TicketsProvider';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';

// @garage/shared holds no client of its own. The native build hands it this one,
// which carries the AsyncStorage session config the browser build does not need.
// Module scope, so it runs on import — before any screen renders or fetches.
setSupabaseClient(supabase);

/* The account menu opener — a hamburger on the header's left. Sign-out and the
   signed-in identity live in the sheet it opens, not in the header itself. */
function MenuButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} accessibilityRole="button" accessibilityLabel="תפריט">
      <View style={{ gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ width: 22, height: 2, borderRadius: 1, backgroundColor: '#fff' }} />
        ))}
      </View>
    </Pressable>
  );
}

export default function RootLayout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <SafeAreaProvider>
      {/* Outside TicketsProvider: that provider opens a realtime subscription
          on mount, and one opened before login would have to be torn down and
          reopened once a session exists. */}
      <AuthGate>
        <TicketsProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: C.ink },
              headerTintColor: '#fff',
              headerTitleAlign: 'center',
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: C.bg },
            }}
          >
            <Stack.Screen
              name="index"
              options={{ title: 'עבודות', headerLeft: () => <MenuButton onPress={() => setMenuOpen(true)} /> }}
            />
            <Stack.Screen name="ticket/[key]" options={{ title: 'עריכת קריאה' }} />
            {/* new.tsx renders its own header, so the native one is hidden there */}
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
