import {
  assignableWorkers, isBusinessCustomer, modelsFor, shekel, VEHICLE_MAKES, type Ticket, type Worker,
} from '@garage/shared';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { CheckboxField, SelectField, TextAreaField, TextField } from '../../components/Field';
import { WorksStep } from '../../features/works';
import { IconCar, IconCustomers, IconDoc } from '../../icons';
import styles from './NewTicketPage.module.css';
import { useNewTicket, YEARS, type RequiredField } from './useNewTicket';


/** i18n keys for the fields a ticket cannot be saved without, so the footer can
 *  name them in the same words the labels use. */
const REQUIRED_LABELS: Record<RequiredField, string> = {
  customerName: 'customers.fields.name',
  customerPhone: 'customers.fields.phone',
  licensePlate: 'newTicket.fields.plate',
  manufacturer: 'newTicket.fields.manufacturer',
  km: 'newTicket.fields.km',
  keyReceived: 'newTicket.fields.keyReceived',
};

export interface NewTicketPageProps {
  tickets: Ticket[];
  setTickets: Dispatch<SetStateAction<Ticket[]>>;
  /** The garage's staff, for the assignee picker. Empty is valid — a garage
   *  that has entered nobody yet opens tickets unassigned. */
  workers: Worker[];
  onDone: () => void;
  onCancel: () => void;
}

export default function NewTicketPage({
  tickets, setTickets, workers, onDone, onCancel,
}: NewTicketPageProps) {
  const { t } = useTranslation();
  const form = useNewTicket({ tickets, setTickets, onDone });
  const [tab, setTab] = useState<1 | 2>(1);

  const field = (key: 'customerName' | 'customerPhone' | 'idNumber' | 'address' | 'email'
    | 'city' | 'zip' | 'licensePlate' | 'manufacturer' | 'model' | 'vehicleCode' | 'details') => ({
    value: form.form[key],
    onChange: (e: { target: { value: string } }) => form.set(key, e.target.value),
  });

  /* The required half of a field: the marker, the message, and the blur that
     earns the right to show it. Spread after `field`, so it wins on `onBlur`. */
  const required = (key: RequiredField) => ({
    required: true,
    onBlur: () => form.touch(key),
    error: form.invalid(key) ? t(`newTicket.invalid.${key}`) : undefined,
  });

  const models = modelsFor(form.form.manufacturer);

  const goTo = (n: 1 | 2, id: string) => {
    setTab(n);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <form
      className="intake-form"
      onSubmit={(e) => {
        e.preventDefault();
        /* Refused: put them on the first field it objected to, rather than
           leaving them to hunt the page for whichever one went red. */
        if (!form.submit()) {
          document.getElementById('sec-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          setTab(1);
        }
      }}
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
                        {isBusinessCustomer(c.kind) && (
                          <span className={styles.suggestTag}>{t('customers.kinds.business')}</span>
                        )}
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
            <TextField dense label="customers.fields.name" {...field('customerName')} {...required('customerName')} />
            <TextField dense label="customers.fields.phone" type="tel" {...field('customerPhone')} {...required('customerPhone')} />
            <TextField
              dense
              label="customers.fields.id_number"
              inputMode="numeric"
              error={
                form.idConflict
                  ? t('newTicket.idTaken', { name: form.idConflict.customer.name })
                  : undefined
              }
              {...field('idNumber')}
            />
          </div>

          {/* A ת״ז on somebody else's file. Unlike the phone below this is not
              an offer to be waved past: the number is unique per garage, so it
              cannot be saved onto a second person, and a ticket that carries it
              anyway is one claiming to be about somebody it is not. The form
              will not save until this is answered — attach the ticket to the
              holder, or correct the number. */}
          {form.idConflict && (
            <div className={`${styles.conflict} ${styles.conflictWarn}`} role="alert">
              <span>{t('newTicket.idTakenBlocks', { name: form.idConflict.customer.name })}</span>
              <Button onClick={form.adoptIdConflict}>{t('newTicket.useThatCustomer')}</Button>
            </div>
          )}

          {/* The phone is on somebody's file. Said out loud and left to the
              advisor: one line belongs to a couple, to a company, to a parent
              paying for a student's car. Taking the offer attaches this ticket
              to that customer; going ahead without it opens a second customer
              who shares the number, which is a real thing and used to be
              impossible. */}
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
            <TextField dense label="newTicket.fields.plate" {...field('licensePlate')} {...required('licensePlate')} />
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
              {...required('manufacturer')}
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
              {...required('km')}
            />
            <TextField dense label="newTicket.fields.vehicleCode" {...field('vehicleCode')} />
          </div>

          {/* The field existed in the form's state and fed the "מפתח התקבל"
              flag, and no control ever rendered it — so every ticket the web
              app has written said the key was not received. Now it is on the
              screen, and required: the key is the one physical thing the
              garage takes custody of. */}
          <CheckboxField
            label="newTicket.fields.keyReceived"
            checked={form.form.keyReceived}
            onChange={(e) => { form.set('keyReceived', e.target.checked); form.touch('keyReceived'); }}
            error={form.invalid('keyReceived') ? t('newTicket.invalid.keyReceived') : undefined}
          />
        </div>

        <div className="form-section span-2">
          <h3 className="section-title card-title">
            <IconDoc /> {t('newTicket.details')}
          </h3>
          <TextAreaField dense label="newTicket.fields.details" {...field('details')} />

          {/* Who the job goes to. The field has been in the form's state since
              it was written and no control ever rendered it, so every ticket
              the web app opened arrived on the board unassigned — the same way
              "מפתח התקבל" was always false. Active workers only, and nobody is
              the default: a car can come in before anyone is free to take it. */}
          <div className={styles.row2}>
            <SelectField
              dense
              label="newTicket.fields.technician"
              hint="newTicket.technicianHint"
              value={form.form.technician ?? ''}
              onChange={(e) => form.set('technician', e.target.value || null)}
            >
              <option value="">{t('newTicket.unassigned')}</option>
              {assignableWorkers(workers).map((w) => (
                <option key={w.code} value={w.code}>{w.name}</option>
              ))}
            </SelectField>
          </div>
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
        {/* Deliberately NOT disabled. A greyed-out button explains nothing, and
            pressing it is how most people ask what is wrong — so pressing it is
            what turns the field-level objections on. */}
        <Button type="submit" variant="primary" size="lg">
          {t('newTicket.save')} <span className="arrow">←</span>
        </Button>
      </div>
    </form>
  );
}
