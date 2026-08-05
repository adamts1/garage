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
}

export default function InvoiceDetail({
  invoice, docLabel, statusTone, statusLabel, onOpenTicket,
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

        {invoice.pdfUrl && (
          <a className={styles.pdfLink} href={invoice.pdfUrl} target="_blank" rel="noreferrer">
            <IconDoc /> {t('invoices.officialPdf')}
          </a>
        )}
      </div>
    </section>
  );
}
