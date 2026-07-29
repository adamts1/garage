/* The phone route for editing one ticket. The editor itself lives in
   components/TicketEditor.tsx so the tablet's two-pane layout can embed the same
   thing beside the list; here it's a full screen reached by push, with its own
   custom header, so the native Stack header is hidden. */

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import TicketEditor from '../../components/TicketEditor';

export default function EditTicketRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TicketEditor ticketKey={key} onClose={() => router.back()} />
    </>
  );
}
