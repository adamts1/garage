import { garageName, isArchived, listWorkers, subscribeToTable, workerMap, type Ticket, type Worker } from '@garage/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './app/Sidebar';
import { isConfigured } from './lib/supabase';
import { useTickets } from './lib/useTickets';
import { ArchivePage } from './pages/Archive';
import { BoardPage } from './pages/Board';
import { CustomersPage } from './pages/Customers';
import { ExpensesPage } from './pages/Expenses';
import { InvoicesPage } from './pages/Invoices';
import { ItemsPage } from './pages/Items';
import { WorksPage } from './pages/Works';
import { NewTicketPage } from './pages/NewTicket';
import { ReportsPage } from './pages/Reports';
import { SuppliersPage } from './pages/Suppliers';
import { TicketPage } from './pages/Ticket';
import { WorkersPage } from './pages/Workers';
import SetupNotice from './app/SetupNotice';

export const ticketPath = (key: string) => `/tickets/${encodeURIComponent(key)}`;

/* The ticket key comes from the URL, not from state, so this needs its own
   component to call useParams. Kept at module scope — declared inside App it
   would be a new component type on every render, and the ticket page would
   remount, losing its scroll and any half-typed edit, on every keystroke. */
function TicketRoute({ tickets, ...rest }: {
  tickets: Ticket[];
} & Omit<React.ComponentProps<typeof TicketPage>, 'ticket'>) {
  const { t } = useTranslation();
  const { key } = useParams();
  const ticket = tickets.find((x) => x.k === key);

  /* A key that matches nothing is a real case now that the URL is typeable and
     shareable — a deleted ticket, or a link from another garage. Say so rather
     than rendering an empty panel. No loading branch: the routes render only
     once the tickets have arrived. */
  if (!ticket) {
    return (
      <div className="db-error">
        {t('app.ticketNotFound', { key })} <Link to="/">{t('app.backToBoard')}</Link>
      </div>
    );
  }
  return <TicketPage ticket={ticket} {...rest} />;
}

export default function App() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { tickets, setTickets, loading, error } = useTickets();   // Supabase-backed, live

  // Name the browser tab after the garage — several are often open at once.
  useEffect(() => { document.title = garageName(); }, []);

  /* The garage's own staff. Empty is a valid state — a newly onboarded garage
     has entered nobody yet — so every consumer resolves a code through
     workerChip() and falls back to "unassigned" rather than indexing in. */
  const [workers, setWorkers] = useState<Worker[]>([]);

  // Retired workers stay in the map on purpose: a closed ticket must keep
  // showing who did the job, even after they leave.
  const workerChips = useMemo(() => workerMap(workers), [workers]);

  useEffect(() => {
    if (!isConfigured) return;
    let live = true;
    listWorkers()
      .then((team) => { if (live) setWorkers(team); })
      .catch(() => {});   // an empty picker beats a crash
    return () => { live = false; };
  }, []);

  /* The board's avatars and the table's מכונאי column read from this list, so an
     edit on the workers screen has to reach them. Subscribing rather than
     passing a callback down also covers the other device: two people are often
     on the board while a third fixes a name. */
  useEffect(() => {
    if (!isConfigured) return;
    return subscribeToTable('garage_workers', () => {
      listWorkers().then(setWorkers).catch(() => {});   // a stale chip beats a crash
    });
  }, []);

  // The sidebar is a narrow rail that expands on hover, unless pinned open.
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  /* Paid tickets that have aged past the cutoff leave the board for the
     archive. Derived, so it recomputes as time passes — no stored flag to keep
     in sync. */
  const activeTickets = tickets.filter((x) => !isArchived(x));
  const archivedTickets = tickets.filter((x) => isArchived(x));

  const openTicket = (k: string) => navigate(ticketPath(k));

  return (
    <div className={`app-shell${expanded ? '' : ' rail'}`}>
      <Sidebar
        activeCount={activeTickets.length}
        workers={workers}
        expanded={expanded}
        pinned={pinned}
        onPinToggle={() => setPinned((v) => !v)}
        onHoverChange={setHovered}
      />

      {/* The board is the only screen that runs edge to edge — the others need
          their normal vertical scroll, so this is scoped to that route. */}
      <main
        className={`main-content${
          isConfigured && !loading && pathname === '/' ? ' board-full' : ''
        }`}
      >
        <section className="panel">
          {error && <div className="db-error">{t('app.supabaseError', { error })}</div>}

          {!isConfigured ? (
            <SetupNotice />
          ) : loading ? (
            <div className="db-loading">{t('app.loading')}</div>
          ) : (
            <Routes>
              <Route
                path="/tickets/new"
                element={
                  <NewTicketPage
                    tickets={tickets}
                    setTickets={setTickets}
                    workers={workers}
                    onDone={() => navigate('/')}
                    onCancel={() => navigate('/')}
                  />
                }
              />

              <Route
                path="/"
                element={
                  <BoardPage
                    tickets={activeTickets}
                    setTickets={setTickets}
                    workers={workers}
                    workerChips={workerChips}
                    onNewTicket={() => navigate('/tickets/new')}
                    onOpenTicket={openTicket}
                  />
                }
              />

              <Route
                path="/tickets/:key"
                element={
                  <TicketRoute
                    tickets={tickets}
                    setTickets={setTickets}
                    workers={workers}
                    workerChips={workerChips}
                    onBack={() => navigate('/')}
                  />
                }
              />

              <Route path="/invoices" element={<InvoicesPage onOpenTicket={openTicket} tickets={tickets} />} />
              <Route path="/expenses" element={<ExpensesPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/workers" element={<WorkersPage />} />
              <Route path="/items" element={<ItemsPage />} />
              <Route path="/works" element={<WorksPage />} />
              <Route path="/reports" element={<ReportsPage tickets={tickets} />} />
              <Route
                path="/archive"
                element={
                  <ArchivePage
                    tickets={archivedTickets}
                    workerChips={workerChips}
                    onOpenTicket={openTicket}
                  />
                }
              />

              {/* A mistyped or stale URL lands on the board rather than a blank
                  panel. replace, so Back does not bounce off the bad path. */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </section>
      </main>
    </div>
  );
}
