/* The phone route for creating a ticket. The form lives in components/TicketCreate
   so the tablet two-pane can embed it beside the list; here it's a full screen with
   its own custom header, so the native Stack header is hidden. On save we replace
   this screen with the freshly-created ticket rather than stacking on top of it. */

import { Stack, useRouter } from 'expo-router';
import TicketCreate from '../components/TicketCreate';

export default function NewTicketRoute() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TicketCreate
        onClose={() => router.back()}
        onCreated={(key) => router.replace(`/ticket/${key}`)}
      />
    </>
  );
}
