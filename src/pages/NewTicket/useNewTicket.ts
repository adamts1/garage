import {
  EMPTY_FIELD, EPICS, TYPES, addressLabel, carLabel, idNumberConflict,
  intakeFlags, isUsablePhone, listCustomers, listVehicles, matchCustomers, nextTicketNumbers,
  phoneConflict,
  subscribeToTable, subtasksFromWorks, titleFromWorks, worksSummary,
  type Customer, type PhoneConflict, type Priority, type Ticket, type TicketWork, type Vehicle,
} from '@garage/shared';
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { isConfigured } from '../../lib/supabase';

export interface TicketForm {
  customerSearch: string;
  /** Set only by picking a match out of the search box, and cleared the moment
   *  any of the identity fields is typed over — see `set`. It is the difference
   *  between "this customer" and "a customer who looks like this". */
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  idNumber: string;
  address: string;
  email: string;
  city: string;
  zip: string;
  licensePlate: string;
  vehicleCode: string;
  manufacturer: string;
  model: string;
  year: string;
  km: string;
  details: string;
  keyReceived: boolean;
  /** A garage_workers.code, or null for unassigned. Was one of four hardcoded
   *  codes; the garage's own workers are only known at runtime. */
  technician: string | null;
  targetDate: string;
  priority: Priority;
  epic: keyof typeof EPICS;
  type: keyof typeof TYPES;
  points: number;
}

export const emptyForm: TicketForm = {
  customerSearch: '', customerId: null,
  customerName: '', customerPhone: '', idNumber: '',
  address: '', email: '', city: '', zip: '',
  licensePlate: '', vehicleCode: '', manufacturer: '', model: '', year: '', km: '',
  details: '',
  keyReceived: false,
  /* Not 'dk'. A blank form must not pre-assign work to a person, least of all
     one this garage may not employ; the picker defaults to nobody. */
  technician: null,
  targetDate: '',
  priority: 'med',
  epic: 'service',
  type: 'job',
  points: 3,
};

/* Model years, newest first. It was a 22-long window ending in 2005, which is
   not how long cars last: a garage sees 1990s Transits and 1980s pickups, and
   an advisor who cannot pick the year types nothing, which is what makes a
   service history unreadable later.

   Counted from the current year rather than from a literal, so the list does
   not need editing every January. */
export const FIRST_MODEL_YEAR = 1985;

export const YEARS = (() => {
  const latest = new Date().getFullYear();
  return Array.from({ length: latest - FIRST_MODEL_YEAR + 1 }, (_, i) => latest - i);
})();

/** Editing one of these means the form no longer describes the customer that
 *  was picked out of the search box, so the picked id is dropped. */
const IDENTITY_FIELDS = new Set<keyof TicketForm>(['customerName', 'customerPhone', 'idNumber']);

/** dd/mm/yyyy from the date input's yyyy-mm-dd. */
export const toDueDate = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '-');

/** The fields a ticket may not be saved without, in the order they appear on
 *  the form.
 *
 *  Each earns its place. The phone is what identifies the customer on the next
 *  visit — see create_ticket's resolution — so a ticket without one opens a
 *  brand new customer record every time. The plate is the same story for the
 *  car. The maker and the kilometres are what a service history is worth
 *  anything without: a row of plates with no model and no reading cannot say
 *  when a car was last serviced or at what mileage. And the key is the one
 *  physical thing the garage takes custody of.
 *
 *  Required here rather than at the server, which still accepts a bare ticket
 *  for the tests and the older callers. */
export type RequiredField =
  | 'customerName' | 'customerPhone' | 'licensePlate' | 'manufacturer' | 'km' | 'keyReceived';

export function missingRequired(form: TicketForm): RequiredField[] {
  const missing: RequiredField[] = [];
  if (!form.customerName.trim()) missing.push('customerName');
  if (!isUsablePhone(form.customerPhone)) missing.push('customerPhone');
  if (!form.licensePlate.trim()) missing.push('licensePlate');
  if (!form.manufacturer.trim()) missing.push('manufacturer');
  // The field strips to digits as it is typed, so anything left is a reading.
  if (!form.km.trim()) missing.push('km');
  // Not "answered" — ticked. The car does not come in without its key.
  if (!form.keyReceived) missing.push('keyReceived');
  return missing;
}

export interface UseNewTicketOptions {
  tickets: Ticket[];
  setTickets: Dispatch<SetStateAction<Ticket[]>>;
  onDone: () => void;
}

export function useNewTicket({ tickets, setTickets, onDone }: UseNewTicketOptions) {
  const [form, setForm] = useState<TicketForm>(emptyForm);
  const [works, setWorks] = useState<TicketWork[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [showMatches, setShowMatches] = useState(false);
  const [vehicleChoices, setVehicleChoices] = useState<Vehicle[]>([]);

  /* Known customers and their vehicles, for the search-and-autofill box. */
  useEffect(() => {
    if (!isConfigured) return;
    const loadCustomers = () => listCustomers().then(setCustomers).catch(() => {});
    const loadVehicles = () => listVehicles().then(setVehicles).catch(() => {});
    loadCustomers();
    loadVehicles();
    const offCustomers = subscribeToTable('customers', loadCustomers);
    const offVehicles = subscribeToTable('vehicles', loadVehicles);
    return () => { offCustomers(); offVehicles(); };
  }, []);

  /* Typing over any of the three identity fields drops the picked customer:
     the advisor is no longer describing the record they chose. Everything else
     — address, email, the car — is a detail of that same person and keeps it. */
  const set = useCallback(
    <K extends keyof TicketForm>(key: K, value: TicketForm[K]) =>
      setForm((prev) => ({
        ...prev,
        [key]: value,
        ...(IDENTITY_FIELDS.has(key) ? { customerId: null } : null),
      })),
    [],
  );

  const matches = useMemo(
    () => matchCustomers(customers, form.customerSearch),
    [customers, form.customerSearch],
  );

  const fillVehicle = useCallback((v: Vehicle) => {
    setForm((prev) => ({
      ...prev,
      licensePlate: v.plate ?? '',
      manufacturer: v.manufacturer ?? '',
      model: v.model ?? '',
      year: v.year ?? '',
      km: v.km ?? '',
      vehicleCode: v.vehicle_code ?? '',
    }));
  }, []);

  /** Picking a match fills the customer half, and the vehicle too when it is
   *  unambiguous. Several vehicles means asking; none means nothing to ask. */
  const pickCustomer = useCallback(
    (c: Customer) => {
      setForm((prev) => ({
        ...prev,
        customerSearch: '',
        customerId: c.id,
        customerName: c.name,
        customerPhone: c.phone ?? '',
        idNumber: c.id_number ?? '',
        email: c.email ?? '',
        address: c.address ?? '',
        city: c.city ?? '',
      }));
      setShowMatches(false);

      const owned = vehicles.filter((v) => v.customer_id === c.id);
      if (owned.length === 1) { fillVehicle(owned[0]); setVehicleChoices([]); }
      else setVehicleChoices(owned);
    },
    [fillVehicle, vehicles],
  );

  const pickVehicle = useCallback((v: Vehicle) => {
    fillVehicle(v);
    setVehicleChoices([]);
  }, [fillVehicle]);

  const totals = useMemo(() => worksSummary(works), [works]);

  /* Was: a name, a plate, or one work — any one of the three. That let a ticket
     through with a customer name and nothing else, and since the customer is
     resolved by ת״ז then phone, every such ticket minted another copy of the
     same person. See missingRequired for what each of them is for. */
  const missing = useMemo(() => missingRequired(form), [form]);
  const canSave = missing.length === 0;

  /* Which fields have earned the right to be shown as wrong.
     A form that turns red before it has been filled in is telling somebody off
     for not having typed yet. A field goes red once they have left it, and
     everything goes red once they have tried to save. */
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [attempted, setAttempted] = useState(false);

  const touch = useCallback(
    (field: string) => setTouched((prev) => new Set(prev).add(field)),
    [],
  );

  const invalid = useCallback(
    (field: RequiredField) =>
      missing.includes(field) && (attempted || touched.has(field)),
    [attempted, missing, touched],
  );

  /* The phone is the customer's identity, so a number already on file means the
     ticket is about to be attached to somebody — and if the name does not match,
     to somebody other than the person the advisor thinks they are serving. That
     used to happen silently: the ticket went onto the existing customer while
     the card showed the newly typed name, and no record was ever created for it.
     Reported rather than blocked; only the person at the counter can say whether
     this is the same customer under a nickname or a number typed wrong. */
  const conflict: PhoneConflict<Customer> | null = useMemo(
    () => phoneConflict(customers, {
      phone: form.customerPhone,
      name: form.customerName,
      pickedId: form.customerId,
    }),
    [customers, form.customerPhone, form.customerName, form.customerId],
  );

  /* The ת״ז is not the identity, but it is unique per garage, and the intake
     form is where a mistyped one is born. create_ticket refuses to move a
     number off the customer who holds it — see 20260802020000, which chose that
     over letting a constraint take the whole ticket down — so without this the
     number is simply, silently, not saved. The migration says as much: "the
     mismatch is the intake form's problem to raise". This raises it. */
  const idConflict: PhoneConflict<Customer> | null = useMemo(
    () => idNumberConflict(customers, {
      idNumber: form.idNumber,
      name: form.customerName,
      ownerId: form.customerId,
    }),
    [customers, form.idNumber, form.customerName, form.customerId],
  );

  /** "This is the same customer" — adopt the record that holds the number, the
   *  same way picking it out of the search box would. */
  const adoptConflict = useCallback(() => {
    if (conflict) pickCustomer(conflict.customer);
  }, [conflict, pickCustomer]);

  /* Returns whether it saved, so the page can move focus to the first field it
     objected to rather than leaving somebody to hunt for the red one. */
  const submit = useCallback((): boolean => {
    /* The button is deliberately NOT disabled: a disabled button explains
       nothing, and pressing it is how most people ask what is wrong. So the
       press is what turns the objections on. */
    setAttempted(true);
    if (!canSave) return false;

    const { key, job } = nextTicketNumbers(tickets);

    const ticket: Ticket = {
      k: key,
      st: 'todo',
      type: form.type,
      epic: form.epic,
      prio: form.priority,
      pts: form.points,
      who: form.technician,
      job,
      // The works are what the ticket is about.
      title: titleFromWorks(works),
      plate: form.licensePlate || EMPTY_FIELD,
      car: carLabel(form),
      customer: form.customerName,
      amount: totals.total,
      done: 0,
      // Each chosen work becomes a subtask, so the card's progress bar tracks
      // real work rather than a guess.
      subtasks: subtasksFromWorks(works),
      due: toDueDate(form.targetDate),
      flags: intakeFlags(form.keyReceived),
      works,
      phone: form.customerPhone,
      // Both in transit to the customer record rather than to a ticket column:
      // the id says which record, the ת״ז fills one that has none.
      customerId: form.customerId,
      idNumber: form.idNumber,
      email: form.email,
      address: addressLabel(form),
      km: form.km,
      year: form.year,
      // In transit to the vehicles table, so the next ticket for this customer
      // can auto-fill the car; the ticket keeps the combined `car` above.
      manufacturer: form.manufacturer,
      model: form.model,
      vehicleCode: form.vehicleCode,
      notes: form.details || undefined,
      createdAt: new Date().toLocaleDateString('he-IL'),
    };

    setTickets((prev) => [ticket, ...prev]);
    onDone();
    return true;
  }, [canSave, form, onDone, setTickets, tickets, totals.total, works]);

  return {
    form, set, works, setWorks,
    matches, showMatches, setShowMatches,
    vehicleChoices, pickCustomer, pickVehicle,
    totals, canSave, missing, invalid, touch, conflict, idConflict, adoptConflict, submit,
  };
}
