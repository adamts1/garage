/* Issuing a document with no work order behind it — a counter sale.
 *
 * Every other bill in this system is derived: a ticket has works, a work has a
 * price only an admin could set, and the invoice is what those add up to. Here
 * the amounts are typed, which makes this the one screen where somebody decides
 * what a customer is charged in the moment. Two things follow from that, and
 * both are deliberate:
 *
 *   * It is admin-only, enforced in the Edge Function rather than here — a
 *     hidden button is a preference, not a rule.
 *
 *   * The idempotency key is minted when the dialog OPENS. Every press of this
 *     dialog's button carries the same one, so a slow request and a second
 *     click produce one tax document instead of two legal numbers that then
 *     need crediting back.
 *
 * Lines come from the garage's own parts catalogue where possible: a counter
 * sale is usually a part off the shelf, and picking it brings its real price
 * rather than one typed from memory. A free line is there for everything else.
 */

import { money, PAY_METHODS, VAT, type PartDef, type StandaloneLine } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import Modal from '../../components/Modal/Modal';
import type { ModalComponentProps } from '../../components/Modal/types';
import { IconBox, IconDoc, IconTrash } from '../../icons';
import { payMethodLabel } from '../../lib/payMethodLabel';
import { settleModal } from '../../store/useModalResult';
import { usePickPart } from '../works/usePickers';
import styles from './CounterSaleModal.module.css';

/** What the dialog hands back. Null when it was dismissed. */
export interface CounterSale {
  idempotencyKey: string;
  customerName: string;
  customerIdNumber: string;
  customerPhone: string;
  customerAddress: string;
  docType: 'invoice_receipt' | 'tax_invoice';
  payMethod: string | null;
  lines: StandaloneLine[];
}

interface Row extends StandaloneLine {
  /** Local only — React needs a stable key and a sku is not always there. */
  uid: string;
  sku: string | null;
}

const blank = (uid: string): Row => ({ uid, sku: null, desc: '', qty: 1, unit_price: 0 });

/* PAY_METHODS is imported from the shared vocabulary rather than retyped: a
   code this dialog offers that payment.ts has never heard of would be written
   straight onto a real document. */

export default function CounterSaleModal({ props, isTop, stacked, onClose }: ModalComponentProps) {
  const { t } = useTranslation();
  const pickPart = usePickPart();
  const resultId = String(props.resultId ?? '');

  /* Minted once, on mount. See the note at the top — this is the whole guard
     against a double-click buying a second legal number. */
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [seq, setSeq] = useState(1);

  const [customerName, setCustomerName] = useState('');
  const [customerIdNumber, setCustomerIdNumber] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [docType, setDocType] = useState<CounterSale['docType']>('invoice_receipt');
  const [payMethod, setPayMethod] = useState<string>('cash');
  const [rows, setRows] = useState<Row[]>([blank('r0')]);

  const nextUid = () => {
    const uid = `r${seq}`;
    setSeq((n) => n + 1);
    return uid;
  };

  const patch = (uid: string, over: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...over } : r)));

  const addFromCatalogue = async () => {
    const part: PartDef | null = await pickPart({ taken: rows.map((r) => r.sku ?? '').filter(Boolean) });
    if (!part) return;
    setRows((rs) => {
      /* The blank row a fresh dialog starts with is a placeholder, not a line.
         Filling it beats leaving an empty row above the part just picked. */
      const empty = rs.find((r) => !r.desc.trim() && !r.unit_price);
      const filled: Row = { uid: empty?.uid ?? nextUid(), sku: part.sku, desc: part.name, qty: 1, unit_price: part.price };
      return empty ? rs.map((r) => (r.uid === empty.uid ? filled : r)) : [...rs, filled];
    });
  };

  const priced = rows.filter((r) => r.desc.trim() && r.qty > 0);
  const subtotal = priced.reduce((s, r) => s + r.qty * r.unit_price, 0);
  const canIssue = Boolean(customerName.trim()) && priced.length > 0 && subtotal > 0;

  const answer = (value: CounterSale | null) => {
    settleModal(resultId, value);
    onClose();
  };

  return (
    <Modal
      title="counterSale.title"
      size="md"
      isTop={isTop}
      stacked={stacked}
      onClose={() => answer(null)}
      actions={
        <>
          {/* Focus starts on Cancel, as it does on every dialog here that can
              create a document a credit note is the only way out of. */}
          <Button data-autofocus onClick={() => answer(null)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!canIssue}
            onClick={() => answer({
              idempotencyKey,
              customerName: customerName.trim(),
              customerIdNumber: customerIdNumber.trim(),
              customerPhone: customerPhone.trim(),
              customerAddress: customerAddress.trim(),
              docType,
              payMethod: docType === 'invoice_receipt' ? payMethod : null,
              lines: priced.map((r) => ({ desc: r.desc.trim(), qty: r.qty, unit_price: r.unit_price })),
            })}
          >
            <IconDoc /> {t('counterSale.issue')}
          </Button>
        </>
      }
    >
      <p className={styles.lede}>{t('counterSale.lede')}</p>

      <section className={styles.block}>
        <h4 className={styles.blockTitle}>{t('counterSale.customer')}</h4>
        <div className={styles.grid}>
          <Field label={t('counterSale.fields.name')}>
            <input
              className="input"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={t('counterSale.fields.namePlaceholder')}
            />
          </Field>
          <Field label={t('counterSale.fields.idNumber')}>
            <input className="input" dir="ltr" inputMode="numeric"
              value={customerIdNumber} onChange={(e) => setCustomerIdNumber(e.target.value)} />
          </Field>
          <Field label={t('counterSale.fields.phone')}>
            <input className="input" dir="ltr" inputMode="tel"
              value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
          </Field>
          <Field label={t('counterSale.fields.address')}>
            <input className="input" value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h4 className={styles.blockTitle}>{t('counterSale.lines')}</h4>
          <Button size="sm" onClick={() => void addFromCatalogue()}>
            <IconBox /> {t('counterSale.fromCatalogue')}
          </Button>
        </div>

        <div className={styles.lines}>
          {rows.map((r) => (
            <div className={styles.line} key={r.uid}>
              <input
                className="input"
                value={r.desc}
                placeholder={t('counterSale.fields.descPlaceholder')}
                aria-label={t('counterSale.fields.desc')}
                onChange={(e) => patch(r.uid, { desc: e.target.value, sku: null })}
              />
              <input
                className="input" type="number" min={0} step="1"
                aria-label={t('counterSale.fields.qty')}
                value={r.qty}
                onChange={(e) => patch(r.uid, { qty: Number(e.target.value) || 0 })}
              />
              <input
                className="input" type="number" min={0} step="0.01"
                aria-label={t('counterSale.fields.unitPrice')}
                value={r.unit_price}
                onChange={(e) => patch(r.uid, { unit_price: Number(e.target.value) || 0 })}
              />
              <strong className={styles.lineTotal}>{money(r.qty * r.unit_price)}</strong>
              <Button
                variant="ghostDanger" size="sm"
                aria-label={t('counterSale.removeLine')}
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}
              >
                <IconTrash />
              </Button>
            </div>
          ))}
        </div>

        <button type="button" className={styles.addRow} onClick={() => setRows((rs) => [...rs, blank(nextUid())])}>
          ＋ {t('counterSale.addLine')}
        </button>
      </section>

      <section className={styles.block}>
        <h4 className={styles.blockTitle}>{t('counterSale.document')}</h4>
        <div className={styles.grid}>
          <Field label={t('counterSale.fields.docType')}>
            <select className="input" value={docType}
              onChange={(e) => setDocType(e.target.value as CounterSale['docType'])}>
              <option value="invoice_receipt">{t('invoices.docType.invoice_receipt')}</option>
              <option value="tax_invoice">{t('invoices.docType.tax_invoice')}</option>
            </select>
          </Field>
          {/* A tax invoice records no payment — the money has not arrived. */}
          {docType === 'invoice_receipt' && (
            <Field label={t('counterSale.fields.payMethod')}>
              <select className="input" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                {PAY_METHODS.map((m) => (
                  <option key={m} value={m}>{payMethodLabel(t, m)}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </section>

      <div className={styles.totals}>
        <div><span>{t('counterSale.subtotal')}</span><b>{money(subtotal)}</b></div>
        {/* The provider adds VAT at the rate configured for this garage, which
            the browser does not hold. So the figure below is this build's
            standard rate and is labelled an estimate; the document decides. */}
        <div className={styles.est}>
          <span>{t('counterSale.vatEstimate', { percent: Math.round(VAT * 100) })}</span>
          <b>{money(subtotal * VAT)}</b>
        </div>
        <div className={styles.grand}>
          <span>{t('counterSale.totalEstimate')}</span>
          <b>{money(subtotal * (1 + VAT))}</b>
        </div>
      </div>

      <p className={styles.warning}>{t('counterSale.warning')}</p>
    </Modal>
  );
}
