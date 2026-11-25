import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { post } from '../../api/client';
import type { EnvId } from '../../api/types';
import { Button, Note, TextField } from '../../components';
import styles from './GaragesPage.module.css';

/** Invoicing on or off for one garage — provider and credentials are kept.
 *  Off, the app issues no documents for the garage (and on staging, switching
 *  off while a card payment page is open is how a charge with no receipt is
 *  reproduced). Asks first; production also needs its name typed, which the
 *  server checks again. */
export function InvoicingSwitch({ env, garageId, active, onChanged }: {
  env: EnvId;
  garageId: string;
  active: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = !active;
  const needsTyping = env === 'production';
  const ready = !needsTyping || typed.trim() === 'production';

  const apply = async () => {
    setWorking(true);
    setError(null);
    try {
      await post('/api/invoicing', { env, garageId, active: next, confirmEnv: typed.trim() });
      setAsking(false);
      setTyped('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  if (!asking) {
    return (
      <div className={styles.switch}>
        <Button variant={active ? 'ghost' : 'primary'} onClick={(e) => { e.stopPropagation(); setAsking(true); }}>
          {t(active ? 'console.invoicing.switchOff' : 'console.invoicing.switchOn')}
        </Button>
      </div>
    );
  }

  return (
    // Inside an expandable row: a click here must not fold the row.
    <div className={styles.switch} onClick={(e) => e.stopPropagation()}>
      <Note tone={next ? 'muted' : 'warn'}>{t(next ? 'console.invoicing.confirmOn' : 'console.invoicing.confirmOff')}</Note>
      {needsTyping && (
        <TextField
          label="console.invoicing.typeEnv"
          dir="ltr"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      )}
      {error && <Note tone="danger">{t('console.common.error', { message: error })}</Note>}
      <div className={styles.switchButtons}>
        <Button variant={next ? 'primary' : 'danger'} onClick={() => void apply()} disabled={!ready || working}>
          {working ? t('console.common.loading') : t(next ? 'console.invoicing.switchOn' : 'console.invoicing.switchOff')}
        </Button>
        <Button variant="ghost" onClick={() => { setAsking(false); setTyped(''); setError(null); }} disabled={working}>
          {t('console.invoicing.cancel')}
        </Button>
      </div>
    </div>
  );
}
