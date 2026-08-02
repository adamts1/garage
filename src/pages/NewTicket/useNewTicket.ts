import {
  EPICS, TYPES, listCustomers, listVehicles, subscribeToTable, worksSummary,
  type Customer, type Priority, type Ticket, type TicketWork, type Vehicle,
} from '@garage/shared';
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { isConfigured } from '../../lib/supabase';

export interface TicketForm {
  customerSearch: string;
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
  customerSearch: '', customerName: '', customerPhone: '', idNumber: '',
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

export const YEARS = Array.from({ length: 22 }, (_, i) => 2026 - i);

const digits = (s: string) => (s || '').replace(/\D/g, '');

/** Name, or phone once enough digits are typed to be a real search. */
export function matchCustomers(customers: readonly Customer[], query: string): Customer[] {
  const q = query.trim();
  if (!q) return [];
  const qDigits = digits(q);
  return customers
    .filter(
      (c) =>
        c.name.toLowerCase().includes(q.toLowerCase()) ||
        (qDigits.length >= 3 && digits(c.phone ?? '').includes(qDigits)),
    )
    .slice(0, 6);
}

/** dd/mm/yyyy from the date input's yyyy-mm-dd. */
export const toDueDate = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '-');

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

  const set = useCallback(
    <K extends keyof TicketForm>(key: K, value: TicketForm[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
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

  /* Enough to identify the job: a name, a plate, or at least one work. Saving a
     wholly blank ticket creates a row nobody can find again. */
  const canSave =
    Boolean(form.customerName.trim() || form.licensePlate.trim()) || works.length > 0;

  const submit = useCallback(() => {
    if (!canSave) return;

    const maxKey = tickets.reduce((max, t) => Math.max(max, Number(t.k.split('-')[1]) || 0), 0);
    const maxJob = tickets.reduce((max, t) => Math.max(max, Number(t.job.split('-')[1]) || 0), 0);

    const ticket: Ticket = {
      k: `GAR-${maxKey + 1}`,
      st: 'todo',
      type: form.type,
      epic: form.epic,
      prio: form.priority,
      pts: form.points,
      who: form.technician,
      job: `W-${maxJob + 1}`,
      // The works are what the ticket is about.
      title: works.length ? works.map((w) => w.name).join(' + ') : 'כרטיס חדש',
      plate: form.licensePlate || '-',
      car: [form.manufacturer, form.model, form.year].filter(Boolean).join(' ') || '-',
      customer: form.customerName || 'לקוח מזדמן',
      amount: totals.total,
      done: 0,
      // Each chosen work becomes a subtask, so the card's progress bar tracks
      // real work rather than a guess.
      subtasks: works.map((w) => w.name),
      due: toDueDate(form.targetDate),
      flags: [...(form.keyReceived ? ['מפתח התקבל'] : []), 'חדש'],
      works,
      phone: form.customerPhone,
      idNumber: form.idNumber,   // stored on the customer, not the ticket
      email: form.email,
      address: [form.address, form.city].filter(Boolean).join(', '),
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
  }, [canSave, form, onDone, setTickets, tickets, totals.total, works]);

  return {
    form, set, works, setWorks,
    matches, showMatches, setShowMatches,
    vehicleChoices, pickCustomer, pickVehicle,
    totals, canSave, submit,
  };
}
