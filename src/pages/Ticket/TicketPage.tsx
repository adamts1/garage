import {
  assignableWorkers, COLUMNS, VAT, workerChip,
  type Ticket, type TicketPhoto, type Worker, type WorkerMap,
} from '@garage/shared';
import { useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { isClosed, isSettled } from '../../features/ticket/ticketTotals';
import { WorksStep } from '../../features/works';
import {
  IconCar, IconCard, IconChat, IconCheck, IconClock, IconCustomers,
  IconDoc, IconPhoto, IconPrint, IconTrash, IconWhatsapp, IconWrench,
} from '../../icons';
import { printInvoice, printTicket, warnIfBlocked } from '../../lib/print';
import { useTicketPage } from './useTicketPage';
import { waMessage, waNumber } from './waMessage';

const shekel = (n: number) =>
  '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface TicketPageProps {
  ticket: Ticket;
  setTickets: Dispatch<SetStateAction<Ticket[]>>;
  /** The garage's staff. Only the active ones can be assigned new work. */
  workers: Worker[];
  /** Code → chip, retired workers included: this page shows history. */
  workerChips: WorkerMap;
  onBack: () => void;
}

const STEPS = [
  { id: 'tp-details', label: 'ticket.steps.details' },
  { id: 'tp-works', label: 'ticket.steps.works' },
  { id: 'tp-summary', label: 'ticket.steps.summary' },
];

const scrollTo = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** '-' for anything the intake form never filled in, so blanks read as blank,
 *  not as data. */
const Val = ({ children }: { children?: string | number | null }) =>
  children === undefined || children === null || children === ''
    ? <span className="kv-empty">-</span>
    : <>{children}</>;

export default function TicketPage({
  ticket, setTickets, workers, workerChips, onBack,
}: TicketPageProps) {
  const { t } = useTranslation();
  const page = useTicketPage({ ticket, setTickets, onBack });
  const { photos, invoice, busy, totals, works } = page;

  const [note, setNote] = useState('');
  const [step, setStep] = useState('tp-details');
  const [lightbox, setLightbox] = useState<TicketPhoto | null>(null);

  const itemCount = works.reduce((s, w) => s + w.items.length, 0);
  const column = COLUMNS.find((c) => c.id === ticket.st);
  const closed = isClosed(ticket);
  const settled = isSettled(ticket);
  const wa = waNumber(ticket.phone);
  const chip = workerChip(workerChips, ticket.who);
  const worker = chip.n;

  /* Who this ticket can be handed to: the active staff, plus — when the person
     it is already on has since retired — that person, so opening the picker
     cannot silently rewrite the assignment to somebody else. Choosing them
     again is not offered anywhere else, and losing them is not an option
     either: the ticket says what it says until somebody changes it. */
  const assignable = assignableWorkers(workers);
  const assigneeGone = Boolean(ticket.who) && !assignable.some((w) => w.code === ticket.who);

  return (
    <div className="tp">
      <header className="tp-head">
        <div className="tp-head-bar">
          <div>
            <div className="tp-title">
              <h2>{t('ticket.title', { number: ticket.k.split('-')[1] })}</h2>
              <span className="tp-status" style={{ '--dot': column?.dot } as CSSProperties}>
                <i className="tp-status-dot" />
                {column?.title}
              </span>
            </div>
            <div className="tp-sub">
              <span>{t('ticket.created')}: <Val>{ticket.createdAt}</Val></span>
              <span className="tp-sep">·</span>
              <span>{t('ticket.due')}: <Val>{ticket.due}</Val></span>
              <span className="tp-sep">·</span>
              {/* The assignment, and the one place to change it. It was a line
                  of text — every web-created ticket read "לא הוקצה" and nothing
                  on this screen could put a name on it. */}
              <span className="tp-assign">
                <span className="tp-assign-chip" style={{ background: chip.bg }}>{chip.ini}</span>
                <select
                  className="tp-assign-select"
                  aria-label={t('ticket.assignWorker')}
                  value={ticket.who ?? ''}
                  onChange={(e) => page.assign(e.target.value || null)}
                >
                  <option value="">{t('ticket.unassigned')}</option>
                  {assignable.map((w) => (
                    <option key={w.code} value={w.code}>{w.name}</option>
                  ))}
                  {/* Retired, and still on this ticket. Kept selectable so the
                      control can show the truth; not offered to any other. */}
                  {assigneeGone && (
                    <option value={ticket.who ?? ''}>{t('ticket.workerRetired', { name: worker })}</option>
                  )}
                </select>
              </span>
            </div>
          </div>

          <div className="foot-spacer" />

          <button className="btn ghost" onClick={onBack}>
            {t('ticket.backToList')} <span className="arrow">←</span>
          </button>
        </div>

        <nav className="tabs tp-tabs">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`tab${step === s.id ? ' on' : ''}`}
              onClick={() => { setStep(s.id); scrollTo(s.id); }}
            >
              <span className="tab-num">{step === s.id ? <IconCheck /> : i + 1}</span>
              {t(s.label)}
            </button>
          ))}
        </nav>
      </header>

      <div className="tp-grid">
        {/* ------- main column ------- */}
        <div className="tp-main">
          <div className="tp-row" id="tp-details">
            <section className="card">
              <h3 className="card-title"><IconCar /> {t('ticket.vehicle')}</h3>
              <dl className="kv">
                <dt>{t('ticket.fields.plate')}</dt>
                <dd>{ticket.plate ? <span className="plate">{ticket.plate}</span> : <Val>{null}</Val>}</dd>
                <dt>{t('ticket.fields.model')}</dt><dd><Val>{ticket.car}</Val></dd>
                <dt>{t('ticket.fields.year')}</dt><dd><Val>{ticket.year}</Val></dd>
                <dt>{t('ticket.fields.km')}</dt>
                <dd><Val>{ticket.km ? t('ticket.kmValue', { km: ticket.km }) : null}</Val></dd>
              </dl>
            </section>

            <section className="card">
              <h3 className="card-title"><IconCustomers /> {t('ticket.customer')}</h3>
              <dl className="kv">
                <dt>{t('ticket.fields.name')}</dt><dd><b>{ticket.customer}</b></dd>
                <dt>{t('ticket.fields.phone')}</dt>
                <dd>
                  {ticket.phone
                    ? <a className="kv-link" href={`tel:${ticket.phone}`} dir="ltr">{ticket.phone}</a>
                    : <Val>{null}</Val>}
                </dd>
                <dt>{t('ticket.fields.email')}</dt>
                <dd>
                  {ticket.email
                    ? <a className="kv-link" href={`mailto:${ticket.email}`} dir="ltr">{ticket.email}</a>
                    : <Val>{null}</Val>}
                </dd>
                <dt>{t('ticket.fields.address')}</dt><dd><Val>{ticket.address}</Val></dd>
              </dl>
            </section>
          </div>

          <section className="card" id="tp-works">
            <div className="tp-works-head">
              <h3 className="card-title"><IconWrench /> {t('ticket.worksAndParts')}</h3>
              <span className="card-count">
                {t('ticket.worksCount', { works: works.length, items: itemCount })}
              </span>
            </div>

            <WorksStep
              works={works}
              setWorks={page.setWorks}
              combinedEmpty      /* one toolbox empty-state instead of two */
            />
          </section>

          <section className="card" id="tp-photos">
            <div className="tp-works-head">
              <h3 className="card-title"><IconPhoto /> {t('ticket.photos')}</h3>
              <span className="card-count">{t('ticket.photoCount', { count: photos.length })}</span>
            </div>

            {photos.length === 0 ? (
              <p className="photo-empty">{t('ticket.noPhotos')}</p>
            ) : (
              <div className="photo-grid">
                {photos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="photo-cell"
                    onClick={() => setLightbox(p)}
                    title={p.caption || p.createdAt}
                  >
                    <img
                      src={p.url}
                      alt={p.caption || t('ticket.photoAlt', { key: ticket.k })}
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="tp-row">
            <section className="card">
              <h3 className="card-title"><IconClock /> {t('ticket.history')}</h3>
              <div className="log">
                <div className="log-row">
                  <div className="log-when">{ticket.createdAt ?? '-'}</div>
                  <div className="log-who">{worker}</div>
                  <div className="log-what">{t('ticket.logOpened')}</div>
                </div>
                {works.length > 0 && (
                  <div className="log-row">
                    <div className="log-when">-</div>
                    <div className="log-who">{worker}</div>
                    <div className="log-what">{t('ticket.logWorksAdded', { count: works.length })}</div>
                  </div>
                )}
              </div>
            </section>

            <section className="card">
              <h3 className="card-title"><IconChat /> {t('ticket.notes')}</h3>
              <textarea
                className="note-box"
                placeholder={t('ticket.notesPlaceholder')}
                value={note || ticket.notes || ''}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => page.patch({ notes: note })}
              />
            </section>
          </div>
        </div>

        {/* ------- side column ------- */}
        <aside className="tp-side" id="tp-summary">
          <section className="card">
            <h3 className="card-title"><IconDoc /> {t('ticket.summary')}</h3>
            <div className="sum">
              <div>
                <span>{t('ticket.worksTotal')} <i className="sum-n">{works.length}</i></span>
                <b>{shekel(totals.labour)}</b>
              </div>
              <div>
                <span>{t('ticket.partsTotal')} <i className="sum-n">{itemCount}</i></span>
                <b>{shekel(totals.items)}</b>
              </div>
              <div className="sum-sub">
                <span>{t('ticket.subtotal')}</span>
                <b>{shekel(totals.labour + totals.items)}</b>
              </div>
              <div>
                <span>{t('ticket.vat', { percent: Math.round(VAT * 100) })}</span>
                <b>{shekel(totals.vat)}</b>
              </div>
              <div className="grand">
                <span>{t('ticket.grandTotal')}</span>
                <b>{shekel(totals.total)}</b>
              </div>
            </div>
          </section>

          <section className="card">
            <h3 className="card-title"><IconCard /> {t('ticket.billing')}</h3>
            <div className={`bill-note${ticket.paid ? ' ok' : ''}`}>
              {ticket.doc
                ? t(ticket.paid ? 'ticket.billPaid' : 'ticket.billOpen')
                : t('ticket.billNone')}
            </div>
            <dl className="kv">
              <dt>{t('ticket.fields.status')}</dt>
              <dd>
                <span className="prio-dot" style={{ background: column?.dot }} /> {column?.title}
              </dd>
              <dt>{t('ticket.fields.payment')}</dt>
              <dd>
                {ticket.paid
                  ? t('ticket.paidWith', { method: ticket.payMethod })
                  : ticket.doc ? t('ticket.openCharge') : '-'}
              </dd>
              <dt>{t('ticket.fields.document')}</dt><dd>{ticket.doc ?? '-'}</dd>
            </dl>

            <button className="btn primary block" onClick={() => void page.close()} disabled={settled}>
              <IconCard /> {settled
                ? t('ticket.alreadySettled')
                : ticket.st === 'done'
                  ? t('ticket.collectPayment')   // ready for pickup, still owes money
                  : t('ticket.closeAndCharge')}
            </button>

            {/* ---- invoicing: the real tax document, issued through iCount ----
                 An issued invoice-receipt shows its legal number + PDF and can be
                 cancelled by a credit note; a paid-but-not-yet-invoiced ticket
                 offers the (irreversible) issue button behind a dialog. */}
            {invoice ? (
              <div className="bill-invoice">
                <dl className="kv">
                  <dt>{t('invoices.docType.invoice_receipt')}</dt>
                  <dd>
                    <b>#{invoice.docnum}</b>
                    {invoice.status === 'cancelled' && (
                      <span className="inv-pill overdue" style={{ marginInlineStart: 8 }}>
                        {t('invoices.status.cancelled')}
                      </span>
                    )}
                  </dd>
                  {invoice.allocationNumber && (
                    <>
                      <dt>{t('invoices.fields.allocation')}</dt>
                      <dd>{invoice.allocationNumber}</dd>
                    </>
                  )}
                </dl>
                {invoice.pdfUrl && (
                  <a className="btn ghost block" href={invoice.pdfUrl} target="_blank" rel="noreferrer">
                    <IconDoc /> {t('ticket.viewInvoicePdf')}
                  </a>
                )}
                {/* A readable copy from the stored row — reachable even when the
                    provider PDF is missing, which is the case for every invoice
                    issued before pdfUrl was captured. */}
                <button className="btn ghost block" onClick={() => warnIfBlocked(printInvoice(invoice))}>
                  <IconPrint /> {t('ticket.printInvoice')}
                </button>
                {invoice.status === 'issued' && (
                  <button className="btn ghost block" onClick={() => void page.cancel()} disabled={busy}>
                    {t('ticket.cancelInvoice')}
                  </button>
                )}
              </div>
            ) : settled ? (
              <button className="btn primary block" onClick={() => void page.issue()} disabled={busy}>
                <IconDoc /> {t('ticket.issueInvoice')}
              </button>
            ) : null}

            {closed && (
              wa ? (
                <a
                  className="btn whatsapp block"
                  href={`https://wa.me/${wa}?text=${encodeURIComponent(waMessage(ticket, totals.total, photos))}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <IconWhatsapp /> {t('ticket.messageCustomer')}
                </a>
              ) : (
                <button className="btn ghost block" disabled title={t('ticket.noPhoneTitle')}>
                  <IconWhatsapp /> {t('ticket.noPhone')}
                </button>
              )
            )}

            {/* Not window.print(): that printed the whole screen — sidebar, tabs
                and buttons included. This opens the ticket as a document. */}
            <button
              className="btn ghost block"
              onClick={() => warnIfBlocked(printTicket(
                ticket,
                totals,
                { workerName: worker, photoCount: photos.length },
              ))}
            >
              <IconPrint /> {t('ticket.printTicket')}
            </button>
          </section>
        </aside>
      </div>

      {lightbox && (
        <div
          className="photo-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox.url} alt={lightbox.caption || t('ticket.photoAltPlain')} />
          <div className="photo-lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <span>{lightbox.caption || lightbox.createdAt}</span>
            <button className="btn ghost" onClick={() => setLightbox(null)}>{t('common.close')}</button>
          </div>
        </div>
      )}

      <footer className="tp-foot">
        <button className="btn danger" onClick={() => void page.remove()}>
          <IconTrash /> {t('ticket.deleteTicket')}
        </button>
        <div className="foot-spacer" />
        <button className="btn ghost" onClick={onBack}>{t('common.close')}</button>
        <button className="btn primary lg" onClick={() => scrollTo('tp-works')}>
          {t('common.save')} <span className="arrow">←</span>
        </button>
      </footer>
    </div>
  );
}
