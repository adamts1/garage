import { useMemo, useState } from 'react';
import { EPICS, TEAM, type Ticket } from '@garage/shared';
import { IconClock } from './icons';

interface ArchivePageProps {
  /** already filtered to archived tickets (paid + aged past the cutoff) */
  tickets: Ticket[];
  onOpenTicket: (k: string) => void;
}

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');

export default function ArchivePage({ tickets, onOpenTicket }: ArchivePageProps) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const list = query
      ? tickets.filter((t) =>
          (t.k + t.title + t.plate + t.car + t.customer).toLowerCase().includes(query.toLowerCase()),
        )
      : tickets;
    // newest settled first — createdAtISO is the sortable raw timestamp
    return [...list].sort((a, b) => (b.createdAtISO ?? '').localeCompare(a.createdAtISO ?? ''));
  }, [tickets, query]);

  return (
    <div className="rep">
      <header className="rep-head">
        <div>
          <h2><IconClock /> ארכיון</h2>
          <p className="rep-sub">כרטיסים ששולמו, יומיים לאחר תאריך היעד</p>
        </div>
        <div className="foot-spacer" />
        <input
          className="jb-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש בארכיון"
        />
      </header>

      <section className="card rep-table-card">
        <h3 className="card-title">כרטיסים בארכיון ({rows.length})</h3>

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>מספר</th>
                <th>תיאור</th>
                <th>לקוח</th>
                <th>מספר רישוי</th>
                <th>רכב</th>
                <th>תאריך יעד</th>
                <th>מכונאי</th>
                <th>סכום</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const e = EPICS[t.epic];
                const m = TEAM[t.who];
                return (
                  <tr key={t.k} onClick={() => onOpenTicket(t.k)}>
                    <td className="tbl-key">{t.k}</td>
                    <td>
                      <div className="tbl-title">{t.title}</div>
                      <span className="epic" style={{ background: e.bg, color: e.c }}>{e.t}</span>
                    </td>
                    <td>{t.customer}</td>
                    <td><span className="plate">{t.plate}</span></td>
                    <td>{t.car}</td>
                    <td>{t.due && t.due !== '-' ? t.due : '—'}</td>
                    <td><span className="avatar-sm" style={{ background: m.bg }}>{m.ini}</span></td>
                    <td className="tbl-amount">{t.amount ? shekel(t.amount) : '-'}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="empty-note">אין כרטיסים בארכיון</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
