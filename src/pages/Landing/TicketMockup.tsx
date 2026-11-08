/* A tablet showing an open ticket, drawn in markup rather than shot: it stays
   sharp at any width, speaks the page's language, and the totals are computed,
   so they always add up. */

import type { LandingCopy } from './copy';
import styles from './landing.module.css';

const PLATES = ['45-218-37', '71-604-52', '30-952-81'];
/* Parts count and pre-VAT price for each work in copy.mock.works, in order. */
const LINES = [{ parts: 2, price: 620 }, { parts: 3, price: 410 }, { parts: 1, price: 250 }];
const VAT = 0.18;
const ACTIVE_TAB = 1;

const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });

export default function TicketMockup({ copy }: { copy: LandingCopy['mock'] }) {
  const net = LINES.reduce((sum, l) => sum + l.price, 0);
  const vat = net * VAT;

  return (
    <div className={styles.tablet} aria-hidden="true">
      <div className={styles.screen}>
        <div className={styles.screenBar}>{copy.header}</div>
        <div className={styles.screenBody}>
          <div className={styles.queue}>
            <div className={styles.search}>{copy.search}</div>
            {PLATES.map((plate, i) => (
              <div key={plate} className={i === 0 ? `${styles.car} ${styles.carActive}` : styles.car}>
                <span className={styles.plate}>{plate}</span>
                <span>{copy.cars[i]}</span>
              </div>
            ))}
          </div>

          <div className={styles.detail}>
            <div className={styles.detailPlate}>{PLATES[0]}</div>
            <div className={styles.notify}>{copy.notify}</div>
            <div className={styles.tabs}>
              {copy.tabs.map((tab, i) => (
                <span key={tab} className={i === ACTIVE_TAB ? styles.tabActive : undefined}>{tab}</span>
              ))}
            </div>
            <strong>{copy.tabs[ACTIVE_TAB]} ({LINES.length})</strong>
            {LINES.map((line, i) => (
              <div key={copy.works[i]} className={styles.work}>
                <strong>{copy.works[i]}</strong>
                <span>{copy.parts(line.parts)} · {ils.format(line.price)}</span>
              </div>
            ))}
            <div className={styles.work}>
              <div className={styles.line}><span>{copy.net}</span><span>{ils.format(net)}</span></div>
              <div className={styles.line}><span>{copy.vat(VAT * 100)}</span><span>{ils.format(vat)}</span></div>
              <div className={`${styles.line} ${styles.total}`}><span>{copy.total}</span><span>{ils.format(net + vat)}</span></div>
            </div>
            <div className={styles.actions}>
              <span className={styles.finish}>{copy.finish}</span>
              <span className={styles.save}>{copy.save}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
