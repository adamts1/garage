/* The intake form's shape, its validation, and the ticket it turns into.

   Pure, and separate from the screen, because this is the part worth being sure
   about: which fields are required, which of them clear a picked customer, and
   exactly what gets written when somebody taps save.

   What actually goes into the row — the flags, the title, the numbering — comes
   from @garage/shared. Those are values the web board reads back, and they used
   to be Hebrew literals written out separately here and in src/pages/NewTicket
   with nothing keeping the two in step. */

import {
  addressLabel,
  carLabel,
  intakeFlags,
  isUsablePhone,
  nextTicketNumbers,
  subtasksFromWorks,
  titleFromWorks,
  worksSummary,
  EMPTY_FIELD,
  type Ticket,
  type TicketWork,
} from '@garage/shared';

export interface TicketForm {
  /** The record picked out of the search box, dropped the moment an identity
   *  field is typed over. Same rule as the web form's TicketForm.customerId. */
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  idNumber: string;
  address: string;
  email: string;
  city: string;
  licensePlate: string;
  vehicleCode: string;
  manufacturer: string;
  model: string;
  year: string;
  km: string;
  details: string;
  keyReceived: boolean;
}

export const EMPTY_FORM: TicketForm = {
  customerId: null,
  customerName: '',
  customerPhone: '',
  idNumber: '',
  address: '',
  email: '',
  city: '',
  licensePlate: '',
  vehicleCode: '',
  manufacturer: '',
  model: '',
  year: '',
  km: '',
  details: '',
  keyReceived: false,
};

/* Typing over name / phone / ת״ז drops the picked customer — the form no longer
   describes the record that was chosen. Address and the car do not. */
export const IDENTITY_FIELDS = new Set<keyof TicketForm>([
  'customerName',
  'customerPhone',
  'idNumber',
]);

/* A union rather than a list of strings, so `create.required.<field>` is
   exhaustive at compile time. The i18n key test cannot see keys built at
   runtime; this is what covers them instead. */
export type RequiredField =
  | 'customerName'
  | 'customerPhone'
  | 'licensePlate'
  | 'manufacturer'
  | 'km'
  | 'keyReceived';

/* Same rule as the web form (useNewTicket.missingRequired). The phone is what
   create_ticket resolves the customer by, so a ticket saved without one opens a
   new customer record every visit. */
export function missingFields(form: TicketForm): RequiredField[] {
  const missing: RequiredField[] = [];
  if (!form.customerName.trim()) missing.push('customerName');
  if (!isUsablePhone(form.customerPhone)) missing.push('customerPhone');
  if (!form.licensePlate.trim()) missing.push('licensePlate');
  if (!form.manufacturer.trim()) missing.push('manufacturer');
  if (!form.km.trim()) missing.push('km');
  if (!form.keyReceived) missing.push('keyReceived');
  return missing;
}

/** Anything typed at all — not "is it valid". A half-filled form is exactly the
    one worth warning about on the way out. */
export function isDirty(form: TicketForm, works: TicketWork[], search: string): boolean {
  return (
    Boolean(form.customerName.trim() || form.customerPhone.trim() || form.licensePlate.trim()) ||
    works.length > 0 ||
    search.trim().length > 0 ||
    form.details.trim().length > 0
  );
}

export function buildNewTicket({
  form,
  works,
  existing,
  now = new Date(),
}: {
  form: TicketForm;
  works: TicketWork[];
  /** Everything currently in the store, for the temporary GAR-/W- numbers. */
  existing: Ticket[];
  now?: Date;
}): Ticket {
  const { key, job } = nextTicketNumbers(existing);

  return {
    k: key,
    job,
    st: 'todo',
    type: 'job',
    epic: 'service',
    prio: 'med',
    pts: 3,
    /* Nobody, not 'dk'. That code was one of four mechanics hardcoded in
       shared/types.ts, and it survived here after the workers became each
       garage's own — so every ticket this form made claimed a person the garage
       may not employ, and in a garage with no workers yet it is a code that does
       not exist at all: the (garage_id, assignee) foreign key rejects the insert
       and the phone cannot open a ticket.

       Unassigned is a real state, which is why assignee is nullable and the key
       is MATCH SIMPLE. The web create form already sends null; the "אחראי"
       picker on the ticket editor is where somebody is chosen. */
    who: null,
    title: titleFromWorks(works),
    plate: form.licensePlate || EMPTY_FIELD,
    car: carLabel(form),
    customer: form.customerName,
    amount: worksSummary(works).total,
    done: 0,
    subtasks: subtasksFromWorks(works),
    /* No target date is asked for on the phone: a garage that promises a car
       "by Thursday" does it at the counter, and a date nobody at intake could
       commit to was one more field to skip. The column stays — the web board
       shows it and the web form still sets it — so what goes in is the dash
       every other unfilled field writes, not an empty string that would print
       as a gap. */
    due: EMPTY_FIELD,
    flags: intakeFlags(form.keyReceived),
    works,
    phone: form.customerPhone,
    // Both ride to the customer record, not to a ticket column: the id says which
    // record, the ת״ז fills one that has none.
    customerId: form.customerId,
    idNumber: form.idNumber,
    email: form.email,
    address: addressLabel(form),
    km: form.km,
    year: form.year,
    manufacturer: form.manufacturer, // in transit to the vehicles table
    model: form.model,
    vehicleCode: form.vehicleCode,
    notes: form.details || undefined,
    createdAt: now.toLocaleDateString('he-IL'),
  };
}
