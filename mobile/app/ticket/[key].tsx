/* The phone route for editing one ticket. The editor lives in
   components/tickets/TicketEditor so the tablet's two-pane layout can embed the
   same thing beside the list; here it is a full screen reached by push. */

import { useLocalSearchParams, useRouter } from 'expo-router';
import TicketEditor from '../../components/tickets/TicketEditor';

export default function EditTicketRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();

  return <TicketEditor ticketKey={key} onClose={() => router.back()} />;
}
