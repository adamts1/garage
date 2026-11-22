import { describe, expect, it } from 'vitest';
import { mergeVehicleCatalog, VEHICLE_CATALOG, VEHICLE_MAKES, vehicleNameKey } from './vehicleCatalog';

describe('mergeVehicleCatalog', () => {
  it('with nothing learned, is the built-in list in its own order', () => {
    const s = mergeVehicleCatalog();
    expect(s.makes).toEqual(VEHICLE_MAKES);
    expect(s.modelsFor('טויוטה')).toEqual(VEHICLE_CATALOG['טויוטה']);
    expect(s.modelsFor('לא קיים')).toEqual([]);
  });

  it('offers a model typed once on a listed make, the next time', () => {
    const s = mergeVehicleCatalog([{ manufacturer: 'יונדאי', model: 'באיון', uses: 1 }]);
    expect(s.modelsFor('יונדאי')).toContain('באיון');
    expect(s.modelsFor('יונדאי')).toContain('i20');
  });

  it('offers a new make and its models', () => {
    const s = mergeVehicleCatalog([
      { manufacturer: 'ג׳ייאיסי', model: 'ג׳ייאס 4', uses: 2 },
      { manufacturer: 'ג׳ייאיסי', model: null, uses: 1 },
    ]);
    expect(s.makes).toContain('ג׳ייאיסי');
    expect(s.modelsFor('ג׳ייאיסי')).toEqual(['ג׳ייאס 4']);
    expect(s.modelsFor("ג'ייאיסי")).toEqual(['ג׳ייאס 4']);
  });

  it('puts the garage\'s most used first, ahead of the untouched list', () => {
    const s = mergeVehicleCatalog([
      { manufacturer: 'קיה', model: 'נירו', uses: 5 },
      { manufacturer: 'קיה', model: 'ריו', uses: 9 },
      { manufacturer: 'טויוטה', model: 'קורולה', uses: 3 },
    ]);
    expect(s.makes.slice(0, 2)).toEqual(['קיה', 'טויוטה']);
    expect(s.modelsFor('קיה').slice(0, 2)).toEqual(['ריו', 'נירו']);
  });

  it('folds spellings that differ only in case, spacing or geresh', () => {
    const s = mergeVehicleCatalog([
      { manufacturer: ' mg ', model: 'zs', uses: 1 },
      { manufacturer: 'פולקסווגן', model: "ג'טה", uses: 1 },
      { manufacturer: 'יונדאי', model: 'באיון', uses: 1 },
      { manufacturer: 'יונדאי', model: 'באיון ', uses: 1 },
      { manufacturer: 'יונדאי', model: 'Bayon', uses: 3 },
      { manufacturer: 'יונדאי', model: 'BAYON', uses: 1 },
    ]);
    expect(s.makes.filter((m) => vehicleNameKey(m) === 'mg')).toEqual(['MG']);
    expect(s.modelsFor('MG').filter((m) => m.toLowerCase() === 'zs')).toHaveLength(1);
    expect(s.modelsFor('פולקסווגן').filter((m) => vehicleNameKey(m) === 'ג׳טה')).toEqual(['ג׳טה']);
    const bayon = s.modelsFor('יונדאי').filter((m) => vehicleNameKey(m) === 'bayon');
    expect(bayon).toEqual(['Bayon']);
    expect(s.modelsFor('יונדאי').filter((m) => m.startsWith('באיון'))).toEqual(['באיון']);
  });

  it('ignores a blank make', () => {
    const s = mergeVehicleCatalog([{ manufacturer: '  ', model: 'x', uses: 4 }]);
    expect(s.makes).toEqual(VEHICLE_MAKES);
  });
});
