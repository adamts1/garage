import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setSupabaseClient } from '@garage/shared';
import AuthGate from '../components/AuthGate';
import { UserSheet } from '../components/UserSheet';
import { TicketsProvider } from '../lib/TicketsProvider';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import { applyHeebo, useHeebo } from '../lib/fonts';

// @garage/shared holds no client of its own. The native build hands it this one,
// which carries the AsyncStorage session config the browser build does not need.
// Module scope, so it runs on import — before any screen renders or fetches.
setSupabaseClient(supabase);

// Route all Text/TextInput through Heebo, once, before anything renders.
applyHeebo();

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
  const fontsLoaded = useHeebo();
  const [menuOpen, setMenuOpen] = useState(false);

  // Hold on the brand navy until Heebo is ready, so text doesn't flash in the
  // system font and reflow. Bundled assets, so this is a blink after first launch.
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: C.ink }} />;

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
          </Stack>
          <UserSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
        </TicketsProvider>
      </AuthGate>
    </SafeAreaProvider>
  );
}
