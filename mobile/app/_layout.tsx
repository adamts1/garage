import { Alert, Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setSupabaseClient, signOut } from '@garage/shared';
import AuthGate from '../components/AuthGate';
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

/* Confirmed, because it is a header button next to a back arrow on a phone
   handed between oily hands, and the cost of a mis-tap is re-entering a password
   the mechanic probably does not know — the operator set it. */
function SignOutButton() {
  return (
    <Pressable
      onPress={() =>
        Alert.alert('התנתקות', 'להתנתק מהמערכת?', [
          { text: 'ביטול', style: 'cancel' },
          { text: 'התנתקות', style: 'destructive', onPress: () => void signOut() },
        ])
      }
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="התנתקות"
    >
      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>יציאה</Text>
    </Pressable>
  );
}

export default function RootLayout() {
  const fontsLoaded = useHeebo();

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
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: C.bg },
            }}
          >
            <Stack.Screen
              name="index"
              options={{ title: 'קריאות שירות', headerLeft: () => <SignOutButton /> }}
            />
            <Stack.Screen name="ticket/[key]" options={{ title: 'עריכת קריאה' }} />
          </Stack>
        </TicketsProvider>
      </AuthGate>
    </SafeAreaProvider>
  );
}
