import type { Ticket } from '@garage/shared';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { SelectField, TextAreaField, TextField } from '../../components/Field';
import { WorksStep } from '../../features/works';
import { IconCar, IconCustomers, IconDoc } from '../../icons';
import styles from './NewTicketPage.module.css';
import { useNewTicket, YEARS } from './useNewTicket';

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');

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
            <TextField dense label="customers.fields.name" {...field('customerName')} />
            <TextField dense label="customers.fields.phone" type="tel" {...field('customerPhone')} />
            <TextField dense label="customers.fields.id_number" inputMode="numeric" {...field('idNumber')} />
          </div>
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
            <TextField dense label="newTicket.fields.plate" {...field('licensePlate')} />
            <TextField dense label="newTicket.fields.manufacturer" {...field('manufacturer')} />
          </div>
          <div className={styles.row2}>
            <TextField dense label="newTicket.fields.model" {...field('model')} />
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
        <div className="foot-spacer" />
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={!form.canSave}
          title={form.canSave ? undefined : t('newTicket.needSomething')}
        >
          {t('newTicket.save')} <span className="arrow">←</span>
        </Button>
      </div>
    </form>
  );
}
