/* מחיר סופי לכרטיס — the price the customer pays for the whole visit.
 *
 * An admin types one figure, VAT included. Below what the lines come to, the
 * difference becomes a discount on the ticket (the summary names it, the
 * invoice spreads it over the lines). Above it, the price is not applied: the
 * difference is offered as more labour on one of the works, because a charge
 * with no line behind it is not something to put on a customer's bill.
 *
 * Kept in the draft like everything else on the page; nothing is written until
 * save. The database refuses it from a non-admin and under a live bill. */

import { finalPriceExcess, money, type TicketWork } from '@garage/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import styles from './FinalPrice.module.css';

interface Props {
  works: readonly TicketWork[];
  finalPrice: number | null | undefined;
  /** What the lines come to with VAT, before any final price. */
  linesTotal: number;
  /** The ticket's total as it stands, final price applied. */
  total: number;
  locked: boolean;
  onSet: (price: number | null) => void;
  onRaise: (workUid: string, price: number) => void;
}

export function FinalPrice({ works, finalPrice, linesTotal, total, locked, onSet, onRaise }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState(finalPrice ? String(finalPrice) : '');
  /* A price above the lines, waiting for the admin to say where it goes. */
  const [above, setAbove] = useState<{ price: number; excess: number } | null>(null);
  const [into, setInto] = useState('');

  /* Follows the draft when it changes from outside — a discard, or another
     admin's save adopted by the page. */
  useEffect(() => {
    setText(finalPrice ? String(finalPrice) : '');
    setAbove(null);
  }, [finalPrice]);

  const typed = Number(text.replace(/,/g, ''));
  const valid = text.trim() !== '' && Number.isFinite(typed) && typed > 0;
  const changed = valid && typed !== (finalPrice ?? 0);
  /* Set, but the works have since shrunk below it: it no longer applies. */
  const stale = finalPrice ? finalPriceExcess(works, finalPrice) : 0;

  const apply = () => {
    if (!valid) return;
    const excess = finalPriceExcess(works, typed);
    if (excess > 0) {
      setAbove({ price: typed, excess });
      setInto(works.find((w) => w.labor > 0)?.uid ?? works[0]?.uid ?? '');
      return;
    }
    onSet(typed);
  };

  if (!works.length) return null;

  return (
    <div className={styles.box}>
      <label className={styles.label} htmlFor="final-price">{t('ticket.finalPrice.label')}</label>
      <div className={styles.row}>
        <input
          id="final-price"
          className="input"
          type="number" min={0} step="0.01" inputMode="decimal" dir="ltr"
          placeholder={money(linesTotal)}
          value={text}
          disabled={locked}
          onChange={(e) => { setText(e.target.value); setAbove(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
        />
        <Button size="sm" variant="primary" disabled={locked || !changed} onClick={apply}>
          {t('ticket.finalPrice.apply')}
        </Button>
        {finalPrice ? (
          <Button size="sm" disabled={locked} onClick={() => onSet(null)}>
            {t('ticket.finalPrice.remove')}
          </Button>
        ) : null}
      </div>
      <p className={styles.hint}>{t('ticket.finalPrice.hint', { amount: money(linesTotal) })}</p>

      {/* VAT is rounded to the agora on the document, so about one price in
          six cannot be reached exactly; the total then stops an agora short. */}
      {finalPrice && !stale && Math.round(total * 100) !== Math.round(finalPrice * 100) && (
        <p className={styles.hint}>{t('ticket.finalPrice.rounded', { amount: money(total) })}</p>
      )}

      {stale > 0 && !above && (
        <p className={styles.warn}>
          {t('ticket.finalPrice.notApplied', { amount: money(finalPrice ?? 0) })}
        </p>
      )}

      {above && (
        <div className={styles.offer} role="alert">
          <p>{t('ticket.finalPrice.above', { amount: money(above.excess) })}</p>
          <label htmlFor="final-price-into">{t('ticket.finalPrice.raiseInto')}</label>
          <select id="final-price-into" className="input" value={into} onChange={(e) => setInto(e.target.value)}>
            {works.map((w) => (
              <option key={w.uid} value={w.uid}>{w.name} · {money(w.labor)}</option>
            ))}
          </select>
          <div className={styles.row}>
            <Button size="sm" variant="primary" disabled={!into}
              onClick={() => { onRaise(into, above.price); setAbove(null); }}>
              {t('ticket.finalPrice.raise')}
            </Button>
            <Button size="sm" onClick={() => setAbove(null)}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
