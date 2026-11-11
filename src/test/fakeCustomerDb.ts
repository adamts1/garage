/* A stand-in for the customer searches the database answers
   (search_customers / search_cars, 20261110120000), for tests.

   The screens no longer hold every customer; they ask. These fakes answer the
   same questions over a test's fixture rows with the same matching rules —
   name, email, city, ת״ז, phone by its digits (3+), a car's plate (3+); for
   cars the plate, make, model or an owner's name — so a test can keep
   asserting what a person sees for what they typed. */
import type {
  CarWithOwners, Customer, CustomerWithVehicles, Page, PageQuery, Vehicle,
} from '@garage/shared';

/* Types only from @garage/shared: tests build these fakes inside their
   vi.mock('@garage/shared') factory, where importing the module being mocked
   would wait on itself. The three rules below are copies of identity.ts's. */
const phoneDigits = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '');
const plateKey = (p: string | null | undefined) =>
  (p ?? '').toLowerCase().replace(/[^0-9a-z\u0590-\u05ff]/g, '');
const PAGE_SIZE = 50;
const pageRange = (p: number, size: number): [number, number] => [(p - 1) * size, p * size - 1];

const contains = (hay: string | null | undefined, needle: string) =>
  (hay ?? '').toLowerCase().includes(needle.toLowerCase());

const page = <T>(all: T[], { page: p = 1, pageSize = PAGE_SIZE }: PageQuery): Page<T> => {
  const [from, to] = pageRange(p, pageSize);
  return { rows: all.slice(from, to + 1), total: all.length };
};

export function fakeCustomerDb(
  customers: () => Customer[],
  vehicles: () => Vehicle[] = () => [],
) {
  const withVehicles = (c: Customer): CustomerWithVehicles =>
    ({ ...c, vehicles: vehicles().filter((v) => v.customer_id === c.id) });

  const matchCustomer = (c: Customer, q: string) => {
    const d = phoneDigits(q);
    const p = plateKey(q);
    return contains(c.name, q) || contains(c.email, q) || contains(c.city, q) || contains(c.id_number, q)
      || (d.length >= 3 && phoneDigits(c.phone).includes(d))
      || (p.length >= 3 && vehicles().some((v) => v.customer_id === c.id && plateKey(v.plate).includes(p)));
  };

  return {
    searchCustomers: async (q: PageQuery = {}): Promise<Page<CustomerWithVehicles>> => {
      const query = (q.query ?? '').trim();
      const hits = customers().filter((c) => !query || matchCustomer(c, query));
      return page(hits.map(withVehicles), q);
    },
    getCustomer: async (id: string) => {
      const c = customers().find((x) => x.id === id);
      return c ? withVehicles(c) : null;
    },
    customersWithPhone: async (phone: string | null | undefined) => {
      const d = phoneDigits(phone);
      return d.length < 3 ? [] : customers().filter((c) => phoneDigits(c.phone) === d);
    },
    customerHoldingIdNumber: async (id: string, exceptId?: string | null) =>
      customers().find((c) => c.id_number === id.trim() && c.id !== exceptId) ?? null,
    vehiclesForPlate: async (plate: string) => {
      const k = plateKey(plate);
      return k ? vehicles().filter((v) => plateKey(v.plate) === k) : [];
    },
  };
}

export function fakeCarDb(cars: () => CarWithOwners[]) {
  return {
    searchCars: async (q: PageQuery = {}): Promise<Page<CarWithOwners>> => {
      const query = (q.query ?? '').trim();
      const p = plateKey(query);
      const hits = cars().filter((c) => !query
        || (p && plateKey(c.plate).includes(p))
        || contains(c.manufacturer, query) || contains(c.model, query)
        || c.owners.some((o) => contains(o.name, query)));
      return page(hits, q);
    },
  };
}
