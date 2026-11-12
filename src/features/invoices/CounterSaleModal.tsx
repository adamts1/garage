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

import {
  addressLabel, issueStandaloneInvoice, money, PAY_METHODS, VAT, type Invoice, type PartDef, type StandaloneLine,
} from '@garage/shared';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import Modal from '../../components/Modal/Modal';
import type { ModalComponentProps } from '../../components/Modal/types';
import { IconBox, IconDoc, IconInfo, IconSearch, IconTrash } from '../../icons';
import { payMethodLabel } from '../../lib/payMethodLabel';
import { printInvoice, warnIfBlocked } from '../../lib/print';
import { showError, useAppDispatch } from '../../store';
import { settleModal } from '../../store/useModalResult';
import { usePickPart } from '../works/usePickers';
import styles from './CounterSaleModal.module.css';
import { useCounterSaleLookup, type LookupField, type LookupOption } from './counterSaleLookup';

/** What the dialog hands back. Null when it was dismissed. */
export interface CounterSale {
  idempotencyKey: string;
  customerName: string;
  customerIdNumber: string;
  customerPhone: string;
  customerAddress: string;
  /** The car the sale was for. Required here (2026-11-11): the garage's
   *  documents name a car, and a counter sale is still a sale for one. */
  plate: string;
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
  const [plate, setPlate] = useState('');
  const [docType, setDocType] = useState<CounterSale['docType']>('invoice_receipt');
  const [payMethod, setPayMethod] = useState<string>('cash');
  const [rows, setRows] = useState<Row[]>([blank('r0')]);

  /* The field being typed in, whose suggestions are showing. Set by typing,
     not by focus, so tabbing through a filled form opens nothing. */
  const [looking, setLooking] = useState<LookupField | null>(null);
  const [search, setSearch] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const lookupQuery = looking === 'any' ? search
    : looking === 'name' ? customerName : looking === 'phone' ? customerPhone : plate;
  const options = useCounterSaleLookup(looking, lookupQuery);

  /* Fills what is on file and leaves what is not: a customer with no ת״ז on
     record must not wipe one typed a moment ago. The plate comes only with a
     car — a customer without one keeps whatever plate is in the box. */
  const fillFrom = ({ customer: c, vehicle: v }: LookupOption) => {
    setCustomerName(c.name);
    if (c.phone) setCustomerPhone(c.phone);
    if (c.id_number) setCustomerIdNumber(c.id_number);
    const address = addressLabel({ address: c.address ?? undefined, city: c.city ?? undefined });
    if (address) setCustomerAddress(address);
    if (v) setPlate(v.plate);
    setSearch('');
    setLooking(null);
  };

  /* A customer not on file: the fields start empty, and the search with them. */
  const newCustomer = () => {
    setCustomerName(''); setCustomerPhone(''); setCustomerIdNumber('');
    setCustomerAddress(''); setPlate(''); setSearch(''); setLooking(null);
    nameRef.current?.focus();
  };

  const lookup = (field: LookupField, value: string, set: (v: string) => void, extra: object = {}) => ({
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => { set(e.target.value); setLooking(field); },
    /* Delayed, or the blur lands before the click on a suggestion. */
    onBlur: () => setTimeout(() => setLooking((f) => (f === field ? null : f)), 150),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape' && looking) { e.stopPropagation(); setLooking(null); } },
    autoComplete: 'off',
    ...extra,
  });

  const suggestions = (field: LookupField) =>
    looking === field && options.length > 0 ? (
      <ul className={styles.suggestions} role="listbox">
        {options.map((o) => (
          <li key={o.key}>
            <button type="button" role="option" aria-selected={false}
              onMouseDown={(e) => e.preventDefault()} onClick={() => fillFrom(o)}>
              <span className={styles.suggestName}>
                {o.customer.name}
                {o.vehicle ? <bdi className={styles.suggestPlate}>{o.vehicle.plate}</bdi> : null}
              </span>
              <span className={styles.suggestMeta}>
                {[
                  o.customer.phone,
                  o.vehicle ? [o.vehicle.manufacturer, o.vehicle.model].filter(Boolean).join(' ') : '',
                  o.customer.city,
                ].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  const nextUid = () => {
    const uid = `r${seq}`;
    setSeq((n) => n + 1);
    return uid;
  };

  const patch = (uid: string, over: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...over } : r)));

  const addFromCatalogue = async () => {
    const parts: PartDef[] | null = await pickPart({ taken: rows.map((r) => r.sku ?? '').filter(Boolean) });
    if (!parts?.length) return;
    setRows((rs) => {
      /* The blank row a fresh dialog starts with is a placeholder, not a line.
         Filling it with the first part beats leaving an empty row above them. */
      const empty = rs.find((r) => !r.desc.trim() && !r.unit_price);
      /* nextUid() reads `seq` from this render, so calling it once per part
         would hand every one the same key. Numbered off it in one go instead. */
      const lines: Row[] = parts.map((part, i) => ({
        uid: i === 0 && empty ? empty.uid : `r${seq + i}`,
        sku: part.sku, desc: part.name, qty: 1, unit_price: part.price,
      }));
      const [first, ...rest] = lines;
      return empty
        ? [...rs.map((r) => (r.uid === empty.uid ? first : r)), ...rest]
        : [...rs, ...lines];
    });
    setSeq((n) => n + parts.length);
  };

  const priced = rows.filter((r) => r.desc.trim() && r.qty > 0);
  const subtotal = priced.reduce((s, r) => s + r.qty * r.unit_price, 0);
  const canIssue = Boolean(customerName.trim()) && Boolean(plate.trim()) && priced.length > 0 && subtotal > 0;

  /* The dialog issues the document itself and closes only once it exists.
     Issuing is a round trip to the provider that can take seconds: until it
     answers, the button spins and nothing can be changed or dismissed. If it
     fails, the form is still here — with the same idempotency key, so trying
     again cannot buy a second legal number. Settles with the issued Invoice,
     or null when dismissed. */
  const dispatch = useAppDispatch();
  const [issuing, setIssuing] = useState(false);

  const answer = (value: Invoice | null) => {
    settleModal(resultId, value);
    onClose();
  };

  const dismiss = () => { if (!issuing) answer(null); };

  const issue = async () => {
    if (issuing || !canIssue) return;
    const sale = result();
    setIssuing(true);
    try {
      const inv = await issueStandaloneInvoice({
        idempotencyKey: sale.idempotencyKey,
        customerName: sale.customerName,
        customerIdNumber: sale.customerIdNumber || null,
        customerPhone: sale.customerPhone || null,
        customerAddress: sale.customerAddress || null,
        vehiclePlate: sale.plate,
        docType: sale.docType,
        payMethod: sale.payMethod,
        lines: sale.lines,
      });
      answer(inv);
    } catch (e) {
      dispatch(showError(e));
      setIssuing(false);
    }
  };

  const total = subtotal * (1 + VAT);
  const result = (): CounterSale => ({
    idempotencyKey,
    customerName: customerName.trim(),
    customerIdNumber: customerIdNumber.trim(),
    customerPhone: customerPhone.trim(),
    customerAddress: customerAddress.trim(),
    plate: plate.trim(),
    docType,
    payMethod: docType === 'invoice_receipt' ? payMethod : null,
    lines: priced.map((r) => ({ desc: r.desc.trim(), qty: r.qty, unit_price: r.unit_price })),
  });

  /* The document as it would print, before it exists. Marked a preview on
     every part of the page (printInvoice's draft mode), and with the build's
     VAT rate — the provider's own rate decides the real one. */
  const preview = () => {
    const sale = result();
    const now = new Date().toISOString();
    const vat = Math.round(subtotal * VAT * 100) / 100;
    warnIfBlocked(printInvoice({
      id: 'preview', ticketId: null, ticketKey: null, docType: sale.docType, provider: '',
      docnum: '', allocationNumber: null, pdfUrl: null, issuedAt: '',   // not issued: printed as '-'
      customerName: sale.customerName || null, customerIdNumber: sale.customerIdNumber || null,
      customerAddress: sale.customerAddress || null, customerPhone: sale.customerPhone || null,
      lines: sale.lines.map((l) => ({ ...l, line_total: Math.round(l.qty * l.unit_price * 100) / 100 })),
      subtotal, vatRate: VAT, vat, total: Math.round((subtotal + vat) * 100) / 100,
      payMethod: sale.payMethod, payReference: null, payments: null,
      vehicle: sale.plate ? { plate: sale.plate, car: null, km: null, openedAt: null, closedAt: null } : null,
      status: 'issued', cancelledBy: null, creditsInvoiceId: null, paysInvoiceId: null, createdAt: now,
    } as Invoice, { draft: true }));
  };

  return (
    <Modal
      title="counterSale.title"
      subtitle="counterSale.subtitle"
      size="lg"
      isTop={isTop}
      stacked={stacked}
      onClose={dismiss}
      actions={
        <div className={styles.footActions}>
          {/* Focus starts on Cancel, as it does on every dialog here that can
              create a document a credit note is the only way out of. */}
          <Button data-autofocus onClick={dismiss} disabled={issuing}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!canIssue || issuing} aria-busy={issuing} onClick={() => void issue()}>
            {issuing ? (
              <><span className={styles.spinner} aria-hidden /> {t('counterSale.issuing')}</>
            ) : t('counterSale.issueAs', { docType: t(`invoices.docType.${docType}`) })}
          </Button>
        </div>
      }
    >
      <fieldset className={styles.form} disabled={issuing}>
      <div className={styles.docType}>
        <label htmlFor="cs-doc-type">{t('counterSale.fields.docType')}</label>
        <select id="cs-doc-type" className="input" value={docType}
          onChange={(e) => setDocType(e.target.value as CounterSale['docType'])}>
          <option value="invoice_receipt">{t('invoices.docType.invoice_receipt')}</option>
          <option value="tax_invoice">{t('invoices.docType.tax_invoice')}</option>
        </select>
      </div>

      <div className={styles.layout}>
        <div className={styles.main}>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h4 className={styles.cardTitle}>{t('counterSale.customer')}</h4>
              <div className={`${styles.lookup} ${styles.search}`}>
                <span className={styles.searchIcon} aria-hidden><IconSearch size={17} /></span>
                <input className="input" type="search"
                  aria-label={t('counterSale.searchPlaceholder')}
                  {...lookup('any', search, setSearch, { placeholder: t('counterSale.searchPlaceholder') })} />
                {suggestions('any')}
              </div>
              <Button size="sm" className={styles.accentBtn} onClick={newCustomer}>
                ＋ {t('counterSale.newCustomer')}
              </Button>
            </div>

            <div className={styles.grid3}>
              <Field label={t('counterSale.fields.name')}>
                <div className={styles.lookup}>
                  <input className="input" ref={nameRef}
                    {...lookup('name', customerName, setCustomerName,
                      { placeholder: t('counterSale.fields.namePlaceholder') })} />
                  {suggestions('name')}
                </div>
              </Field>
              <Field label={t('counterSale.fields.phone')}>
                <div className={styles.lookup}>
                  <input className="input" dir="ltr" inputMode="tel"
                    {...lookup('phone', customerPhone, setCustomerPhone)} />
                  {suggestions('phone')}
                </div>
              </Field>
              <Field label={t('counterSale.fields.idNumber')}>
                <input className="input" dir="ltr" inputMode="numeric"
                  placeholder={t('counterSale.fields.idPlaceholder')}
                  value={customerIdNumber} onChange={(e) => setCustomerIdNumber(e.target.value)} />
              </Field>
            </div>
            <div className={styles.grid2}>
              <Field label={t('counterSale.fields.plate')}>
                <div className={styles.lookup}>
                  <input className="input" dir="ltr" required {...lookup('plate', plate, setPlate)} />
                  {suggestions('plate')}
                </div>
              </Field>
              <Field label={t('counterSale.fields.address')}>
                <input className="input" value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)} />
              </Field>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h4 className={styles.cardTitle}>{t('counterSale.lines')}</h4>
              <Button size="sm" className={styles.accentBtn} onClick={() => void addFromCatalogue()}>
                <IconBox /> {t('counterSale.fromCatalogue')}
              </Button>
            </div>

            <div className={styles.table} role="table">
              <div className={`${styles.line} ${styles.lineHead}`} role="row">
                <span role="columnheader">{t('counterSale.fields.desc')}</span>
                <span role="columnheader">{t('counterSale.fields.qty')}</span>
                <span role="columnheader">{t('counterSale.fields.unitPrice')}</span>
                <span role="columnheader">{t('counterSale.fields.lineTotal')}</span>
                <span />
              </div>
              {rows.map((r) => (
                <div className={styles.line} key={r.uid} role="row">
                  <input
                    className={styles.cell}
                    value={r.desc}
                    placeholder={t('counterSale.fields.descPlaceholder')}
                    aria-label={t('counterSale.fields.desc')}
                    onChange={(e) => patch(r.uid, { desc: e.target.value, sku: null })}
                  />
                  <input
                    className={styles.cell} type="number" min={0} step="1" dir="ltr"
                    aria-label={t('counterSale.fields.qty')}
                    value={r.qty}
                    onChange={(e) => patch(r.uid, { qty: Number(e.target.value) || 0 })}
                  />
                  <input
                    className={styles.cell} type="number" min={0} step="0.01" dir="ltr"
                    aria-label={t('counterSale.fields.unitPrice')}
                    value={r.unit_price}
                    onChange={(e) => patch(r.uid, { unit_price: Number(e.target.value) || 0 })}
                  />
                  <span className={styles.lineTotal}>{money(r.qty * r.unit_price)}</span>
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

            <div className={styles.tableFoot}>
              <button type="button" className={styles.addRow}
                onClick={() => setRows((rs) => [...rs, blank(nextUid())])}>
                ＋ {t('counterSale.addLine')}
              </button>
              <span className={styles.muted}>{t('counterSale.pricesBeforeVat')}</span>
            </div>
          </section>

          {/* A tax invoice records no payment — the money has not arrived. */}
          {docType === 'invoice_receipt' && (
            <section className={styles.card}>
              <h4 className={styles.cardTitle}>{t('counterSale.payment')}</h4>
              <div className={styles.grid2}>
                <Field label={t('counterSale.fields.payMethod')}>
                  <select className="input" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                    {PAY_METHODS.map((m) => (
                      <option key={m} value={m}>{payMethodLabel(t, m)}</option>
                    ))}
                  </select>
                </Field>
                {/* An invoice-receipt says the whole bill was paid, so the
                    amount is the total — shown, not typed. */}
                <Field label={t('counterSale.fields.received')}>
                  <input className="input" dir="ltr" readOnly tabIndex={-1} value={money(total)} />
                </Field>
              </div>
            </section>
          )}
        </div>

        <aside className={styles.side}>
          <h4 className={styles.cardTitle}>{t('counterSale.summary')}</h4>
          <div className={styles.sumRow}>
            <span>{t('counterSale.subtotal')}</span><b>{money(subtotal)}</b>
          </div>
          {/* The provider adds VAT at the rate configured for this garage, which
              the browser does not hold; the note below says so. */}
          <div className={styles.sumRow}>
            <span>{t('counterSale.vat', { percent: Math.round(VAT * 100) })}</span><b>{money(subtotal * VAT)}</b>
          </div>
          <div className={styles.sumGrand}>
            <span>{t('counterSale.total')}</span><b>{money(total)}</b>
          </div>
          {issuing && (
            <div className={styles.issuingNote} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden /> {t('counterSale.issuingLong')}
            </div>
          )}
          <Button className={`${styles.accentBtn} ${styles.previewBtn}`} onClick={preview} disabled={priced.length === 0}>
            <IconDoc /> {t('counterSale.preview')}
          </Button>
          <div className={styles.note}>
            <IconInfo size={18} />
            <div>
              <p>{t('counterSale.final')}</p>
              <p className={styles.muted}>{t('counterSale.vatNote')}</p>
            </div>
          </div>
        </aside>
      </div>
      </fieldset>
    </Modal>
  );
}
