import {
  assignableWorkers, COLUMNS, isCancelled, money, VAT, waMessage, waNumber, workerChip,
  type Ticket, type TicketPhoto, type Worker, type WorkerMap,
} from '@garage/shared';
import { Fragment, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { isClosed, isSettled } from '../../features/ticket/ticketTotals';
import { WorksStep } from '../../features/works';
import {
  IconCar, IconCard, IconChat, IconCheck, IconClock, IconCustomers,
  IconDoc, IconEye, IconEyeOff, IconPhoto, IconPrint, IconTrash, IconWhatsapp, IconWrench,
} from '../../icons';
import { payMethodLabel } from '../../lib/payMethodLabel';
import { printInvoice, printTicket, warnIfBlocked } from '../../lib/print';
import { useTicketPage } from './useTicketPage';

export interface TicketPageProps {
  ticket: Ticket;
  setTickets: Dispatch<SetStateAction<Ticket[]>>;
  /** The garage's staff. Only the active ones can be assigned new work. */
  workers: Worker[];
  /** Code → chip, retired workers included: this page shows history. */
  workerChips: WorkerMap;
  onBack: () => void;
  /** Cancels the ticket; throws when the server refuses. */
  onCancelTicket: (key: string, reason: string) => Promise<void>;
  /** Told whenever the page gains or loses unsaved edits, so the shell can ask
   *  before any way out of the page throws them away. */
  onDirtyChange?: (dirty: boolean) => void;
}

const STEPS = [
  { id: 'tp-details', label: 'ticket.steps.details' },
  { id: 'tp-works', label: 'ticket.steps.works' },
  { id: 'tp-summary', label: 'ticket.steps.summary' },
];

const scrollTo = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** The vehicle card, in the order the intake form asks for it. */
const VEHICLE_FIELDS: {
  field: 'plate' | 'car' | 'year' | 'km' | 'vehicleCode';
  label: string;
  ltr?: boolean;
  numeric?: boolean;
}[] = [
  { field: 'plate', label: 'ticket.fields.plate', ltr: true },
  { field: 'car', label: 'ticket.fields.model' },
  { field: 'year', label: 'ticket.fields.year', ltr: true, numeric: true },
  { field: 'km', label: 'ticket.fields.km', ltr: true, numeric: true },
  { field: 'vehicleCode', label: 'ticket.fields.vehicleCode', ltr: true },
];

/** '-' for anything the intake form never filled in, so blanks read as blank,
 *  not as data. */
const Val = ({ children }: { children?: string | number | null }) =>
  children === undefined || children === null || children === ''
    ? <span className="kv-empty">-</span>
    : <>{children}</>;

export default function TicketPage({
  ticket, setTickets, workers, workerChips, onBack, onCancelTicket, onDirtyChange,
}: TicketPageProps) {
  const { t } = useTranslation();
  const page = useTicketPage({ ticket, setTickets, onBack, onCancelTicket, onDirtyChange });
  const { photos, invoice, busy, totals, works, dirty } = page;

  /* Everything on this screen reads the DRAFT, not the row. The row is what the
     database holds; the draft is what the person is looking at, and until they
     press save the two are allowed to differ. */
  const draft = page.draft;

  const [step, setStep] = useState('tp-details');
  const [lightbox, setLightbox] = useState<TicketPhoto | null>(null);

  const itemCount = works.reduce((s, w) => s + w.items.length, 0);
  const column = COLUMNS.find((c) => c.id === draft.st);
  /* Kept for good, changed never: the database refuses any write to it, so the
     page offers none. Everything below the header sits in a disabled fieldset
     rather than threading a flag through every control. */
  const cancelled = isCancelled(ticket);
  /* A live bill freezes the vehicle and the works — the database enforces
     both, this only stops offering an edit it would refuse. */
  const billLocked = cancelled || invoice?.status === 'issued';
  const closed = isClosed(draft);
  const settled = isSettled(draft);
  const wa = waNumber(draft.phone);
  const chip = workerChip(workerChips, draft.who);
  const worker = chip.n;

  /* Who this ticket can be handed to: the active staff, plus — when the person
     it is already on has since retired — that person, so opening the picker
     cannot silently rewrite the assignment to somebody else. Choosing them
     again is not offered anywhere else, and losing them is not an option
     either: the ticket says what it says until somebody changes it. */
  const assignable = assignableWorkers(workers);
  const assigneeGone = Boolean(draft.who) && !assignable.some((w) => w.code === draft.who);

  return (
    <div className="tp">
      <header className="tp-head">
        <div className="tp-head-bar">
          <div>
            <div className="tp-title">
              <h2>{t('ticket.title', { number: ticket.k.split('-')[1] })}</h2>
              <span
                className={`tp-status${cancelled ? ' cancelled' : ''}`}
                style={{ '--dot': column?.dot } as CSSProperties}
              >
                <i className="tp-status-dot" />
                {cancelled ? t('ticket.statusCancelled') : column?.title}
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
                  disabled={cancelled}
                  className="tp-assign-select"
                  aria-label={t('ticket.assignWorker')}
                  value={draft.who ?? ''}
                  onChange={(e) => page.assign(e.target.value || null)}
                >
                  <option value="">{t('ticket.unassigned')}</option>
                  {assignable.map((w) => (
                    <option key={w.code} value={w.code}>{w.name}</option>
                  ))}
                  {/* Retired, and still on this ticket. Kept selectable so the
                      control can show the truth; not offered to any other. */}
                  {assigneeGone && (
                    <option value={draft.who ?? ''}>{t('ticket.workerRetired', { name: worker })}</option>
                  )}
                </select>
              </span>
            </div>
          </div>

          <div className="foot-spacer" />

          {/* Both ways out ask first when something is unsaved. */}
          <button className="btn ghost" onClick={() => void page.leave()}>
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

      {cancelled && (
        <div className="tp-cancelled" role="status">
          <b>{t('ticket.cancelledBanner', {
            date: ticket.cancelledAt ? new Date(ticket.cancelledAt).toLocaleDateString('he-IL') : '',
          })}</b>
          <span>{t('ticket.cancelledReason', { reason: ticket.cancelReason ?? '' })}</span>
        </div>
      )}

      <fieldset className="tp-grid tp-frozen" disabled={cancelled}>
        {/* ------- main column ------- */}
        <div className="tp-main">
          <div className="tp-row" id="tp-details">
            <section className="card">
              <h3 className="card-title"><IconCar /> {t('ticket.vehicle')}</h3>
              {/* Editable like the phone's details tab, until the ticket is
                  billed: the invoice was printed with this plate and this
                  reading, and the database refuses to let the two disagree
                  (tickets_vehicle_follows_invoice). A save also carries the
                  edit into the customer's own vehicle record. */}
              <dl className="kv">
                {VEHICLE_FIELDS.map(({ field, label, ltr, numeric }) => (
                  <Fragment key={field}>
                    <dt>{t(label)}</dt>
                    <dd>
                      <input
                        className="kv-input"
                        dir={ltr ? 'ltr' : 'auto'}
                        inputMode={numeric ? 'numeric' : undefined}
                        aria-label={t(label)}
                        placeholder="-"
                        value={draft[field] ?? ''}
                        disabled={billLocked}
                        title={billLocked ? t('ticket.vehicleLocked') : undefined}
                        onChange={(e) => page.patch({ [field]: e.target.value })}
                      />
                    </dd>
                  </Fragment>
                ))}
              </dl>
              {billLocked && !cancelled && (
                <div className="tp-note">{t('ticket.vehicleLocked')}</div>
              )}
            </section>

            <section className="card">
              <h3 className="card-title"><IconCustomers /> {t('ticket.customer')}</h3>
              <dl className="kv">
                <dt>{t('ticket.fields.name')}</dt>
                <dd>
                  {/* Every ticket of theirs, cancelled ones included, is one
                      click away — the customer page is where the full record
                      lives. */}
                  {draft.customerId
                    ? <Link className="kv-link" to={`/customers/${draft.customerId}`}><b>{draft.customer}</b></Link>
                    : <b>{draft.customer}</b>}
                </dd>
                <dt>{t('ticket.fields.phone')}</dt>
                <dd>
                  {draft.phone
                    ? <a className="kv-link" href={`tel:${draft.phone}`} dir="ltr">{draft.phone}</a>
                    : <Val>{null}</Val>}
                </dd>
                <dt>{t('ticket.fields.email')}</dt>
                <dd>
                  {draft.email
                    ? <a className="kv-link" href={`mailto:${draft.email}`} dir="ltr">{draft.email}</a>
                    : <Val>{null}</Val>}
                </dd>
                <dt>{t('ticket.fields.address')}</dt><dd><Val>{draft.address}</Val></dd>

                {/* The one editable thing about the customer on this screen.
                    It is a column on `customers`, not on the ticket — a person
                    has one ת״ז, not one per visit — so it is saved to the
                    record this ticket belongs to. Blank is a real answer: most
                    walk-ins never give it. */}
                <dt>{t('ticket.fields.idNumber')}</dt>
                <dd>
                  <input
                    className={`kv-input${page.idConflict ? ' invalid' : ''}`}
                    inputMode="numeric"
                    dir="ltr"
                    aria-label={t('ticket.fields.idNumber')}
                    placeholder={page.customer ? t('ticket.idPlaceholder') : ''}
                    value={page.idNumber}
                    disabled={!page.customer}
                    title={page.customer ? undefined : t('ticket.noCustomerRecord')}
                    onChange={(e) => page.setIdNumber(e.target.value)}
                  />
                </dd>
              </dl>

              {/* Taken, and by whom — the same courtesy the intake form pays
                  a phone number that is already on file. The database would
                  refuse the save anyway; this says so before the typing is
                  finished, and names the person instead of a constraint. */}
              {page.idConflict && (
                <div className="tp-warn" role="status">
                  {t(
                    page.idConflict.differentName
                      ? 'ticket.idTakenByOther'
                      : 'ticket.idTakenBySame',
                    { name: page.idConflict.customer.name },
                  )}
                </div>
              )}
              {!page.customer && (
                <div className="tp-note">{t('ticket.noCustomerRecord')}</div>
              )}
            </section>
          </div>

          <section className="card" id="tp-works">
            <div className="tp-works-head">
              <h3 className="card-title"><IconWrench /> {t('ticket.worksAndParts')}</h3>
              <span className="card-count">
                {t('ticket.worksCount', { works: works.length, items: itemCount })}
              </span>
            </div>

            {/* Frozen with the vehicle once billed: the invoice was built from
                these lines, and the database refuses a change to them
                (works_follow_ticket_lock). */}
            <fieldset className="tp-frozen" disabled={billLocked}>
              <WorksStep
                works={works}
                setWorks={page.setWorks}
                combinedEmpty      /* one toolbox empty-state instead of two */
              />
            </fieldset>
            {billLocked && !cancelled && (
              <div className="tp-note">{t('ticket.worksLocked')}</div>
            )}
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
              {/* Typed into the draft. It used to write to the database on
                  every blur — a note was final the moment the cursor left it. */}
              <textarea
                className="note-box"
                placeholder={t('ticket.notesPlaceholder')}
                value={draft.notes ?? ''}
                onChange={(e) => page.patch({ notes: e.target.value })}
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
                <b>{money(totals.labour)}</b>
              </div>
              <div>
                <span>{t('ticket.partsTotal')} <i className="sum-n">{itemCount}</i></span>
                <b>{money(totals.items)}</b>
              </div>
              <div className="sum-sub">
                <span>{t('ticket.subtotal')}</span>
                <b>{money(totals.labour + totals.items)}</b>
              </div>
              {/* Said, not subtracted: the lines above are already after it. */}
              {totals.discount > 0 && (
                <div>
                  <span>{t('ticket.discountIncluded')}</span>
                  <b>-{money(totals.discount)}</b>
                </div>
              )}
              <div>
                <span>{t('ticket.vat', { percent: Math.round(VAT * 100) })}</span>
                <b>{money(totals.vat)}</b>
              </div>
              <div className="grand">
                <span>{t('ticket.grandTotal')}</span>
                <b>{money(totals.total)}</b>
              </div>
            </div>
          </section>

          <section className="card">
            <h3 className="card-title"><IconCard /> {t('ticket.billing')}</h3>
            <div className={`bill-note${draft.paid ? ' ok' : ''}`}>
              {draft.doc
                ? t(draft.paid ? 'ticket.billPaid' : 'ticket.billOpen')
                : t('ticket.billNone')}
            </div>
            <dl className="kv">
              <dt>{t('ticket.fields.status')}</dt>
              <dd>
                <span className="prio-dot" style={{ background: column?.dot }} /> {column?.title}
              </dd>
              <dt>{t('ticket.fields.payment')}</dt>
              <dd>
                {draft.paid
                  ? t('ticket.paidWith', { method: payMethodLabel(t, draft.payMethod) ?? '-' })
                  : draft.doc ? t('ticket.openCharge') : '-'}
              </dd>
              <dt>{t('ticket.fields.document')}</dt><dd>{draft.doc ?? '-'}</dd>
            </dl>

            {/* The one money button on this screen. What it opens follows the
                ticket: a bill still owed on is collected, anything else goes
                through the close-and-charge drawer — page.close() routes it.

                An outstanding balance keeps it live even on a ticket marked
                שולם. That pairing should not arise, but it does on any ticket
                closed while the drawer was issuing nothing and settling the
                ticket anyway; disabling on `settled` alone would leave those
                with a debt at the provider and no way in the app to collect it. */}
            <button
              className="btn primary block"
              onClick={() => void page.close()}
              disabled={settled && page.owed <= 0}
            >
              <IconCard /> {page.owed > 0
                ? t('ticket.collectPayment')     // an open bill, whatever the ticket says
                : settled
                  ? t('ticket.alreadySettled')
                  : draft.st === 'done'
                    ? t('ticket.collectPayment') // ready for pickup, still owes money
                    : t('ticket.closeAndCharge')}
            </button>

            {/* ---- invoicing: the real tax document, issued through iCount ----
                 An issued invoice-receipt shows its legal number + PDF and can be
                 cancelled by a credit note; a paid-but-not-yet-invoiced ticket
                 offers the (irreversible) issue button behind a dialog. */}
            {invoice ? (
              <div className="bill-invoice">
                <dl className="kv">
                  <dt>{t(`invoices.docType.${invoice.docType}`)}</dt>
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
                <button className="btn ghost block" onClick={() => warnIfBlocked(printInvoice(invoice, { ticket: draft }))}>
                  <IconPrint /> {t('ticket.printInvoice')}
                </button>
                {/* Money back to the customer — part of the bill or the rest of
                    it, in one place. Cancelling the whole invoice is the same
                    act with the amount left alone, so it is the same dialog and
                    not a second button beside it.

                    Offered only while something is left to credit, and only to
                    an admin: the Edge Function refuses a member outright, and a
                    button that always fails is worse than no button. */}
                {page.creditable > 0 && page.canCredit && (
                  <button className="btn ghost block" onClick={() => void page.credit()} disabled={busy}>
                    {t('ticket.creditCustomer')}
                  </button>
                )}
                {/* Already partly given back — so the number above is not what
                    the garage kept, and the panel should not imply that it is. */}
                {invoice.status === 'issued' && page.creditable < invoice.total && (
                  <p className="muted">
                    {t('credit.alreadyOnInvoice', {
                      credited: money(invoice.total - page.creditable),
                      remaining: money(page.creditable),
                    })}
                  </p>
                )}

                {/* An open חשבונית מס: what the customer still owes. Nothing
                    here for a מס-קבלה, which was paid the moment it was issued.

                    Stating it only — the button that records the money arriving
                    is the primary one above, which reads "גבה תשלום" and opens
                    the same dialog this one did. Two buttons for one act, on one
                    screen, is a choice the advisor has to make and cannot get
                    right, since both did the same thing. */}
                {page.owed > 0 && (
                  <p className="muted">{t('collect.outstanding', { owed: money(page.owed) })}</p>
                )}
              </div>
            ) : settled ? (
              <button className="btn primary block" onClick={() => void page.issue('invoice_receipt')} disabled={busy}>
                <IconDoc /> {t('ticket.issueInvoice')}
              </button>
            ) : closed ? (
              /* Work finished, money not in. This is the case a חשבונית מס
                 exists for: bill the customer now, collect later. A מס-קבלה is
                 not offered here — it would claim money that has not arrived. */
              <button className="btn ghost block" onClick={() => void page.issue('tax_invoice')} disabled={busy}>
                <IconDoc /> {t('ticket.issueTaxInvoice')}
              </button>
            ) : null}

            {/* WhatsApp, on any ticket rather than only a finished one.
                A closed ticket sends the pickup notice it always did; an open
                one sends the quote — the works, their parts and the total —
                and asks the customer to approve it. That is the message a
                garage needs BEFORE the work is done, and until now the only
                way to send it from the web was to retype it by hand.

                Both come from the shared builder, which switches on `closed`;
                nothing about the wording is decided here. */}
            {wa ? (
              <a
                className="btn whatsapp block"
                href={`https://wa.me/${wa}?text=${encodeURIComponent(waMessage({ ticket: draft, closed, total: totals.total, photos }))}`}
                target="_blank"
                rel="noreferrer"
              >
                <IconWhatsapp /> {t(closed ? 'ticket.messageCustomer' : 'ticket.requestApproval')}
              </a>
            ) : (
              <button className="btn ghost block" disabled title={t('ticket.noPhoneTitle')}>
                <IconWhatsapp /> {t('ticket.noPhone')}
              </button>
            )}

            {/* Not window.print(): that printed the whole screen — sidebar, tabs
                and buttons included. This opens the ticket as a document. */}
            <button
              className="btn ghost block"
              onClick={() => warnIfBlocked(printTicket(
                draft,
                totals,
                { photoCount: photos.length },
              ))}
            >
              <IconPrint /> {t('ticket.printTicket')}
            </button>

            {/* The board's eye button, from inside the ticket. The table view
                lists it either way. */}
            <button
              className="btn ghost block"
              onClick={() => page.setBoardHidden(!ticket.boardHidden)}
            >
              {ticket.boardHidden ? <IconEye /> : <IconEyeOff />}{' '}
              {t(ticket.boardHidden ? 'board.showOnBoard' : 'board.hideFromBoard')}
            </button>
          </section>
        </aside>
      </fieldset>

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

      {/* The save button used to scroll the page to the works table. Nothing on
          this screen saved anything, because everything already had. */}
      {cancelled ? (
        <footer className="tp-foot">
          {/* The one action left: a kept record has to be printable. It sits
              here because the panel's own print button is inside the frozen
              fieldset. */}
          <button
            className="btn ghost"
            onClick={() => warnIfBlocked(printTicket(draft, totals, { photoCount: photos.length }))}
          >
            <IconPrint /> {t('ticket.printTicket')}
          </button>
          <div className="foot-spacer" />
          <button className="btn ghost" onClick={() => void page.leave()}>{t('common.close')}</button>
        </footer>
      ) : (
        <footer className="tp-foot">
          <button className="btn danger" onClick={() => void page.cancel()}>
            <IconTrash /> {t('ticket.cancelTicket')}
          </button>
          <div className="foot-spacer" />
          {dirty && <span className="tp-unsaved" role="status">{t('ticket.unsaved')}</span>}
          <button className="btn ghost" onClick={page.discard} disabled={!dirty || busy}>
            {t('ticket.discard')}
          </button>
          <button className="btn ghost" onClick={() => void page.leave()}>{t('common.close')}</button>
          <button
            className="btn primary lg"
            onClick={() => void page.save()}
            disabled={!dirty || busy}
          >
            {t('common.save')} <span className="arrow">←</span>
          </button>
        </footer>
      )}
    </div>
  );
}
