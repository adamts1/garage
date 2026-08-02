import { modelsFor, VEHICLE_MAKES, type Ticket } from '@garage/shared';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { SelectField, TextAreaField, TextField } from '../../components/Field';
import { WorksStep } from '../../features/works';
import { IconCar, IconCustomers, IconDoc } from '../../icons';
import styles from './NewTicketPage.module.css';
import { useNewTicket, YEARS } from './useNewTicket';

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');

/** i18n keys for the fields a ticket cannot be saved without, so the footer can
 *  name them in the same words the labels use. */
const REQUIRED_LABELS = {
  customerName: 'customers.fields.name',
  customerPhone: 'customers.fields.phone',
  licensePlate: 'newTicket.fields.plate',
} as const;

export interface NewTicketPageProps {
  tickets: Ticket[];
  setTickets: Dispatch<SetStateAction<Ticket[]>>;
  onDone: () => void;
  onCancel: () => void;
}

export default function NewTicketPage({ tickets, setTickets, onDone, onCancel }: NewTicketPageProps) {
  const { t } = useTranslation();
  const form = useNewTicket({ tickets, setTickets, onDone });
  const [tab, setTab] = useState<1 | 2>(1);

  const field = (key: 'customerName' | 'customerPhone' | 'idNumber' | 'address' | 'email'
    | 'city' | 'zip' | 'licensePlate' | 'manufacturer' | 'model' | 'vehicleCode' | 'details') => ({
    value: form.form[key],
    onChange: (e: { target: { value: string } }) => form.set(key, e.target.value),
  });

  const models = modelsFor(form.form.manufacturer);

  const goTo = (n: 1 | 2, id: string) => {
    setTab(n);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <form
      className="intake-form"
      onSubmit={(e) => { e.preventDefault(); form.submit(); }}
      onKeyDown={(e) => {
        /* Enter belongs to the works tables' inputs — it must not submit the
           ticket from halfway through filling one in. */
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
        }
      }}
    >
      <div className="form-head">
        <h2 className="form-title">{t('newTicket.title')}</h2>
        <div className="foot-spacer" />
        <div className="tabs">
          <button type="button" className={`tab${tab === 1 ? ' on' : ''}`} onClick={() => goTo(1, 'sec-details')}>
            <span className="tab-num">1</span> {t('newTicket.tabDetails')}
          </button>
          <button type="button" className={`tab${tab === 2 ? ' on' : ''}`} onClick={() => goTo(2, 'sec-works')}>
            <span className="tab-num">2</span> {t('newTicket.tabWorks')}
          </button>
        </div>
        <Button onClick={onCancel}>{t('newTicket.backToBoard')} ←</Button>
      </div>

      <div className="step1-grid" id="sec-details">
        <div className={`form-section span-2 ${styles.searchWrap}`}>
          <input
            type="text"
            className={styles.search}
            placeholder={t('newTicket.searchCustomer')}
            aria-label={t('newTicket.searchCustomer')}
            value={form.form.customerSearch}
            onChange={(e) => { form.set('customerSearch', e.target.value); form.setShowMatches(true); }}
            onFocus={() => form.setShowMatches(true)}
            /* Delayed, or the blur fires before the click on a suggestion and
               the list disappears out from under the pointer. */
            onBlur={() => setTimeout(() => form.setShowMatches(false), 150)}
            autoComplete="off"
          />

          {form.showMatches && form.form.customerSearch.trim() && (
            <ul className={styles.suggestions}>
              {form.matches.length ? (
                form.matches.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => form.pickCustomer(c)}
                    >
                      <span className={styles.suggestName}>{c.name}</span>
                      <span className={styles.suggestMeta}>
                        {[c.phone, c.city].filter(Boolean).join(' · ')}
                        {c.kind === 'עסקי' && <span className={styles.suggestTag}>{c.kind}</span>}
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className={styles.suggestEmpty}>{t('newTicket.noCustomerMatch')}</li>
              )}
            </ul>
          )}

          {form.vehicleChoices.length > 0 && (
            <div className={styles.vehiclePicker}>
              <span className={styles.vehicleLabel}>{t('newTicket.pickVehicle')}</span>
              <div className={styles.vehicleList}>
                {form.vehicleChoices.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={styles.vehicleChip}
                    onClick={() => form.pickVehicle(v)}
                  >
                    <b>{[v.manufacturer, v.model].filter(Boolean).join(' ') || v.plate}</b>
                    <span>
                      {[v.plate, v.year, v.km && t('newTicket.kmValue', { km: v.km })]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="form-section">
          <h3 className="section-title card-title">
            <IconCustomers /> {t('newTicket.customerDetails')}
          </h3>
          <div className={styles.row3}>
            <TextField dense required label="customers.fields.name" {...field('customerName')} />
            <TextField dense required label="customers.fields.phone" type="tel" {...field('customerPhone')} />
            <TextField dense label="customers.fields.id_number" inputMode="numeric" {...field('idNumber')} />
          </div>

          {/* The number is already on file. Said out loud rather than resolved
              quietly: the ticket is about to be attached to whoever holds it,
              and if that is not who the advisor has in front of them, they are
              the only one who can tell. */}
          {form.conflict && (
            <div
              className={`${styles.conflict}${form.conflict.differentName ? ` ${styles.conflictWarn}` : ''}`}
              role="status"
            >
              <span>
                {t(
                  form.conflict.differentName
                    ? 'newTicket.phoneTakenByOther'
                    : 'newTicket.phoneKnown',
                  { name: form.conflict.customer.name },
                )}
              </span>
              <Button onClick={form.adoptConflict}>{t('newTicket.useThatCustomer')}</Button>
            </div>
          )}
          <TextField dense label="customers.fields.address" {...field('address')} />
          <div className={styles.row3}>
            <TextField dense label="customers.fields.email" type="email" {...field('email')} />
            <TextField dense label="customers.fields.city" {...field('city')} />
            <TextField dense label="newTicket.fields.zip" {...field('zip')} />
          </div>
        </div>

        <div className="form-section">
          <h3 className="section-title card-title">
            <IconCar /> {t('newTicket.vehicleDetails')}
          </h3>
          <div className={styles.row2}>
            <TextField dense required label="newTicket.fields.plate" {...field('licensePlate')} />
            {/* A list, not a menu: `list` offers the known makes while the input
                stays free text, so a grey import or a thirty-year-old model is
                typed straight into the same field. See VEHICLE_CATALOG. */}
            <TextField
              dense
              label="newTicket.fields.manufacturer"
              list="vehicle-makes"
              autoComplete="off"
              hint="newTicket.pickOrType"
              {...field('manufacturer')}
            />
            <datalist id="vehicle-makes">
              {VEHICLE_MAKES.map((m) => <option key={m} value={m} />)}
            </datalist>
          </div>
          <div className={styles.row2}>
            {/* The models of whichever make was typed above — nothing at all for
                a make the list does not know, which is not an error. */}
            <TextField
              dense
              label="newTicket.fields.model"
              list="vehicle-models"
              autoComplete="off"
              hint={models.length ? 'newTicket.pickOrType' : undefined}
              {...field('model')}
            />
            <datalist id="vehicle-models">
              {models.map((m) => <option key={m} value={m} />)}
            </datalist>
            <SelectField
              dense
              label="newTicket.fields.year"
              value={form.form.year}
              onChange={(e) => form.set('year', e.target.value)}
            >
              <option value="">{t('newTicket.pickYear')}</option>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </SelectField>
          </div>
          <div className={styles.row2}>
            <TextField
              dense
              label="newTicket.fields.km"
              inputMode="numeric"
              value={form.form.km}
              /* Digits only, stripped as typed — the field feeds a numeric
                 column and a stray "ק״מ" would be silently dropped later. */
              onChange={(e) => form.set('km', e.target.value.replace(/\D/g, ''))}
            />
            <TextField dense label="newTicket.fields.vehicleCode" {...field('vehicleCode')} />
          </div>
        </div>

        <div className="form-section span-2">
          <h3 className="section-title card-title">
            <IconDoc /> {t('newTicket.details')}
          </h3>
          <TextAreaField dense label="newTicket.fields.details" {...field('details')} />
        </div>

        <div className="form-section span-2 works-wrap" id="sec-works">
          <WorksStep works={form.works} setWorks={form.setWorks} />
        </div>
      </div>

      <div className="form-foot">
        <div className="total-card">
          <span>{t('newTicket.totalWithVat')}</span>
          <b>{shekel(form.totals.total)}</b>
        </div>
        {/* Spelled out rather than left to the disabled button's tooltip: a
            disabled button does not reliably show one, and "why can I not
            save" is the question this has to answer. */}
        {form.missing.length > 0 && (
          <p className={styles.missing} role="status">
            {t('newTicket.needRequired', {
              fields: form.missing.map((k) => t(REQUIRED_LABELS[k])).join(', '),
            })}
          </p>
        )}
        <div className="foot-spacer" />
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={!form.canSave}
        >
          {t('newTicket.save')} <span className="arrow">←</span>
        </Button>
      </div>
    </form>
  );
}
