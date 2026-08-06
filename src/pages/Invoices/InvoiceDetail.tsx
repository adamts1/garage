import { money } from '@garage/shared';
import type { Invoice } from '@garage/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Pill } from '../../components/Pill';
import { Table, type Column } from '../../components/Table';
import { IconCard, IconCustomers, IconDoc, IconPrint, IconWrench } from '../../icons';
import { printInvoice, warnIfBlocked } from '../../lib/print';
import styles from './InvoicesPage.module.css';

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('he-IL') : '-');

type Line = Invoice['lines'][number];

export interface InvoiceDetailProps {
  invoice: Invoice;
  docLabel: (t: Invoice['docType']) => string;
  statusTone: (s: Invoice['status']) => 'ok' | 'danger';
  statusLabel: (s: Invoice['status']) => string;
  onOpenTicket: (key: string) => void;
  /** What is still creditable on this document — 0 for a credit note, for a
   *  cancelled invoice, and for one already given back in full. */
  creditable: number;
  /** Whether the signed-in user may hand money back at all. */
  canCredit: boolean;
  onCredit: () => void;
  busy: boolean;
}

export default function InvoiceDetail({
  invoice, docLabel, statusTone, statusLabel, onOpenTicket, creditable, canCredit, onCredit, busy,
}: InvoiceDetailProps) {
  const { t } = useTranslation();

  const lineColumns: Column<Line>[] = [
    { key: 'desc', header: 'invoices.lines.desc', render: (l) => l.desc },
    { key: 'qty', header: 'invoices.lines.qty', width: 80, cellClassName: styles.muted, render: (l) => l.qty },
    { key: 'unit', header: 'invoices.lines.unit', width: 110, cellClassName: styles.muted, render: (l) => money(l.unit_price) },
    { key: 'total', header: 'invoices.lines.total', width: 120, render: (l) => <strong>{money(l.line_total)}</strong> },
  ];

  return (
    <section className={styles.detail}>
      <div className={styles.detailHead}>
        <h3 className={styles.detailTitle}>
          <IconDoc /> {docLabel(invoice.docType)} {invoice.docnum}
        </h3>
        <Pill tone={statusTone(invoice.status)}>{statusLabel(invoice.status)}</Pill>
      </div>

      <div className={styles.detailGrid}>
        <dl className={styles.kv}>
          <dt><IconCustomers /> {t('invoices.detail.customer')}</dt>
          <dd><b>{invoice.customerName ?? '-'}</b></dd>

          {invoice.customerIdNumber && (
            <>
              <dt><IconDoc /> {t('invoices.detail.idNumber')}</dt>
              <dd>{invoice.customerIdNumber}</dd>
            </>
          )}

          <dt><IconDoc /> {t('invoices.detail.docType')}</dt>
          <dd>{docLabel(invoice.docType)}</dd>

          <dt><IconCard /> {t('invoices.detail.issuedAt')}</dt>
          <dd>{fmt(invoice.issuedAt)}</dd>

          <dt><IconDoc /> {t('invoices.detail.allocation')}</dt>
          <dd>{invoice.allocationNumber ?? <span className={styles.muted}>-</span>}</dd>

          <dt><IconCard /> {t('invoices.detail.payMethod')}</dt>
          <dd>{invoice.payMethod ?? <span className={styles.muted}>-</span>}</dd>
        </dl>

        <div className={styles.sum}>
          <div>
            <span>{t('invoices.detail.subtotal')}</span>
            <b>{money(invoice.subtotal)}</b>
          </div>
          <div>
            <span>{t('invoices.detail.vat', { percent: Math.round(invoice.vatRate * 100) })}</span>
            <b>{money(invoice.vat)}</b>
          </div>
          <div className={styles.grand}>
            <span>{t('invoices.detail.total')}</span>
            <b>{money(invoice.total)}</b>
          </div>
          {/* A live invoice with money already handed back: the total above is
              what was billed, and this is what the garage kept. Both belong on
              screen — one is the document, the other is the money. */}
          {invoice.docType === 'invoice_receipt' && invoice.status === 'issued'
            && creditable < invoice.total && (
            <div>
              <span>{t('invoices.detail.credited')}</span>
              <b>{money(invoice.total - creditable)}</b>
            </div>
          )}
        </div>
      </div>

      {invoice.lines.length > 0 && (
        <Table
          columns={lineColumns}
          rows={invoice.lines}
          /* Line items have no id — they are a frozen JSON array on the
             document, never sorted, so position is their identity. */
          rowKey={(_line, i) => String(i)}
          className={styles.lines}
        />
      )}

      <div className={styles.actions}>
        {invoice.ticketKey && (
          <Button variant="primary" onClick={() => onOpenTicket(invoice.ticketKey!)}>
            <IconWrench /> {t('invoices.openTicket', { number: invoice.ticketKey.split('-')[1] })}
          </Button>
        )}

        {/* The stored row, laid out as a document. Printing the page itself gave
            you the sidebar, the KPI cards and the filter bar around a table —
            and nothing at all when no provider PDF existed. */}
        <Button onClick={() => warnIfBlocked(printInvoice(invoice))}>
          <IconPrint /> {t('invoices.printCopy')}
        </Button>

        {/* Give the customer money back — some of it or the rest of it. The
            dialog says which of the two the amount amounts to. */}
        {canCredit && creditable > 0 && (
          <Button onClick={onCredit} disabled={busy}>
            <IconDoc /> {t('invoices.creditCustomer')}
          </Button>
        )}

        {invoice.pdfUrl && (
          <a className={styles.pdfLink} href={invoice.pdfUrl} target="_blank" rel="noreferrer">
            <IconDoc /> {t('invoices.officialPdf')}
          </a>
        )}
      </div>
    </section>
  );
}
