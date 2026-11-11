import {
  CUSTOMER_MATCH_LIMIT, isUsablePhone, searchCustomers,
  type Customer, type CustomerWithVehicles,
} from '@garage/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isConfigured } from '../../../lib/supabase';
import { useDebouncedValue } from '../../../lib/useDebouncedValue';
import styles from './SwitchCustomer.module.css';

interface SwitchCustomerProps {
  /** The customer the ticket is on now — not offered as a destination. */
  currentId: string | null;
  /** Resolves true once the ticket has moved. */
  onPick: (to: Customer | { name: string; phone: string }) => Promise<boolean>;
  onClose: () => void;
}

/** Moving a ticket to a different customer: one already on file, found the way
 *  the intake form finds them (name, phone, plate), or a new one from a name
 *  and a phone. */
export default function SwitchCustomer({ currentId, onPick, onClose }: SwitchCustomerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  /* Searched in the database — name, phone, plate — once typing pauses. A
     reply to an older query is dropped rather than shown under a newer one. */
  const settled = useDebouncedValue(query.trim());
  const [found, setFound] = useState<{ q: string; rows: CustomerWithVehicles[] }>({ q: '', rows: [] });
  useEffect(() => {
    if (!isConfigured || !settled) return;
    let alive = true;
    searchCustomers({ query: settled, pageSize: CUSTOMER_MATCH_LIMIT + 1 })
      .then((p) => alive && setFound({ q: settled, rows: p.rows }))
      .catch(() => {});
    return () => { alive = false; };
  }, [settled]);

  const matches = useMemo(
    () => (query.trim() && found.q === query.trim() ? found.rows : [])
      .filter((c) => c.id !== currentId)
      .slice(0, CUSTOMER_MATCH_LIMIT) as Customer[],
    [found, query, currentId],
  );

  const pick = async (to: Customer | { name: string; phone: string }) => {
    if (await onPick(to)) onClose();
  };

  const canCreate = name.trim() !== '' && isUsablePhone(phone);

  return (
    <div className={styles.panel}>
      <input
        className={styles.input}
        autoFocus
        placeholder={t('ticket.switchCustomerSearch')}
        aria-label={t('ticket.switchCustomerSearch')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() && (
        <ul className={styles.list}>
          {matches.length ? matches.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => void pick(c)}>
                <b>{c.name}</b>
                <span className={styles.meta} dir="ltr">{c.phone}</span>
              </button>
            </li>
          )) : (
            <li className={styles.empty}>{t('ticket.switchCustomerNoMatch')}</li>
          )}
        </ul>
      )}

      <span className={styles.label}>{t('ticket.switchCustomerNew')}</span>
      <div className={styles.newRow}>
        <input
          className={styles.input}
          placeholder={t('customers.fields.name')}
          aria-label={t('customers.fields.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={styles.input}
          type="tel"
          dir="ltr"
          placeholder={t('customers.fields.phone')}
          aria-label={t('customers.fields.phone')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button
          type="button"
          className="btn ghost"
          disabled={!canCreate}
          onClick={() => void pick({ name, phone })}
        >
          {t('ticket.switchCustomerCreate')}
        </button>
      </div>

      <button type="button" className="btn ghost" onClick={onClose}>
        {t('ticket.switchCustomerClose')}
      </button>
    </div>
  );
}
