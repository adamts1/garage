// @vitest-environment jsdom
import type { CustomerWithVehicles, Vehicle } from '@garage/shared';
import { describe, expect, it } from 'vitest';
import { lookupOptions } from './counterSaleLookup';

const car = (id: string, customerId: string, plate: string): Vehicle => ({
  id, customer_id: customerId, plate, manufacturer: 'Mazda', model: '3', year: null, km: null, vehicle_code: null,
});

const customer = (id: string, name: string, phone: string | null, vehicles: Vehicle[]): CustomerWithVehicles => ({
  id, name, phone, email: null, address: null, city: null, kind: 'private', id_number: null, vehicles,
});

const dana = customer('c1', 'דנה כהן', '050-1234567', [car('v1', 'c1', '12-345-67'), car('v2', 'c1', '98-765-43')]);
const yossi = customer('c2', 'יוסי לוי', '0521112222', [car('v3', 'c2', '11-222-33')]);
const noCar = customer('c3', 'דני', '0501234000', []);
const all = [dana, yossi, noCar];

describe('lookupOptions', () => {
  it('offers one row per car, so a two-car customer is a choice between them', () => {
    const rows = lookupOptions(all, 'phone', '0501234567');
    expect(rows.map((r) => r.vehicle?.plate)).toEqual(['12-345-67', '98-765-43']);
    expect(rows.every((r) => r.customer.id === 'c1')).toBe(true);
  });

  it('matches a phone by its digits, however it was typed', () => {
    expect(lookupOptions(all, 'phone', '050 1234').map((r) => r.customer.id)).toEqual(['c1', 'c1', 'c3']);
  });

  it('keeps a customer with no car on file, without a car', () => {
    const rows = lookupOptions(all, 'name', 'דני');
    expect(rows).toHaveLength(1);
    expect(rows[0].vehicle).toBeNull();
  });

  it('by plate offers only the car that matched, not the owner’s others', () => {
    const rows = lookupOptions(all, 'plate', '1234567');
    expect(rows.map((r) => r.vehicle?.id)).toEqual(['v1']);
  });

  it('ignores fragments too short to mean anything', () => {
    expect(lookupOptions(all, 'name', 'ד')).toEqual([]);
    expect(lookupOptions(all, 'phone', '05')).toEqual([]);
    expect(lookupOptions(all, 'plate', '12')).toEqual([]);
  });
});
