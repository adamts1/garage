import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setSupabaseClient } from '@garage/shared';
import { TicketsProvider } from '../lib/TicketsProvider';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';

// @garage/shared holds no client of its own. The native build hands it this one,
// which carries the AsyncStorage session config the browser build does not need.
// Module scope, so it runs on import — before any screen renders or fetches.
setSupabaseClient(supabase);

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <TicketsProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: C.ink },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: C.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'קריאות שירות' }} />
          <Stack.Screen name="ticket/[key]" options={{ title: 'עריכת קריאה' }} />
        </Stack>
      </TicketsProvider>
    </SafeAreaProvider>
  );
}
