import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { post } from '../../api/client';
import type { EnvId, GarageOverview } from '../../api/types';
import { ConfirmDialog, Note, Toggle } from '../../components';
import styles from './GaragesPage.module.css';
import { providerName } from './serviceStatus';

/** Invoicing on or off for one garage — provider and credentials are kept.
 *  Off, the app issues no documents for the garage (and on staging, switching
 *  off while a card payment page is open is how a charge with no receipt is
 *  reproduced). Only for a garage that has credentials stored: switching on
 *  one without them would only move the failure to the next receipt.
 *  Asks first; production also needs its name typed, which the server checks
 *  again. */
export function InvoicingSwitch({ env, garage, onChanged, showLabel = false, onDialog }: {
  env: EnvId;
  garage: GarageOverview;
  onChanged: () => void;
  /** "iCount · פעיל" beside the switch — in the table it is the column. */
  showLabel?: boolean;
  /** Told when the confirmation opens and closes — a drawer underneath stops
   *  answering Escape meanwhile, or one key would close both. */
  onDialog?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [asking, setAskingState] = useState(false);
  const setAsking = (open: boolean) => {
    setAskingState(open);
    onDialog?.(open);
  };
  const b = garage.invoicing;
  if (!b?.credentials) return null;
  const next = !b.active;

  return (
    <span className={styles.switchRow}>
      <Toggle
        checked={b.active}
        onChange={() => setAsking(true)}
        label={t(b.active ? 'console.invoicing.switchOff' : 'console.invoicing.switchOn')}
      />
      <span className={b.active ? styles.on : styles.off}>
        {showLabel && `${providerName(b.provider)} `}
        {t(b.active ? 'console.invoicing.isOn' : 'console.invoicing.isOff')}
      </span>
      {asking && (
        <ConfirmDialog
          env={env}
          title={next ? 'console.invoicing.switchOnTitle' : 'console.invoicing.switchOffTitle'}
          titleValues={{ name: garage.name }}
          confirmLabel={next ? 'console.invoicing.switchOn' : 'console.invoicing.switchOff'}
          danger={!next}
          stacked={onDialog !== undefined}
          onClose={() => setAsking(false)}
          onConfirm={async (confirmEnv) => {
            await post('/api/invoicing', { env, garageId: garage.id, active: next, confirmEnv });
            onChanged();
          }}
        >
          <Note tone={next ? 'muted' : 'warn'}>{t(next ? 'console.invoicing.confirmOn' : 'console.invoicing.confirmOff')}</Note>
        </ConfirmDialog>
      )}
    </span>
  );
}
