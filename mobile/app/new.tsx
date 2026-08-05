/* The phone route for creating a ticket. The form lives in
   components/tickets/TicketCreate so the tablet two-pane can embed it beside the
   list; here it is a full screen. On save we replace this screen with the freshly
   created ticket rather than stacking on top of it. */

import { useRouter } from 'expo-router';
import TicketCreate from '../components/tickets/TicketCreate';

export default function NewTicketRoute() {
  const router = useRouter();

  return (
    <TicketCreate
      onClose={() => router.back()}
      onCreated={(key) => router.replace(`/ticket/${key}`)}
    />
  );
}
