import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TicketsProvider } from '../lib/TicketsProvider';
import { C } from '../lib/theme';

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
