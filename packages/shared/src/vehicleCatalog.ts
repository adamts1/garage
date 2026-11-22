/* Manufacturers and their models, for the intake form's car fields.
 *
 * An aid, never a gate. Both fields stay free text: this list exists so the
 * common case is two clicks instead of two spellings of "פולקסווגן", not so a
 * car that is not on it cannot be written down. A garage sees imports, grey
 * imports, commercial conversions and thirty-year-old models — a closed list
 * would be wrong within a week.
 *
 * That is also why nothing here is validated against. Typing a model this file
 * has never heard of is a normal Tuesday, and it saves exactly like any other.
 *
 * Israeli market, Hebrew spellings as a service advisor writes them. Adding a
 * make or a model is a one-line edit; no migration, no deploy coupling.
 */

export const VEHICLE_CATALOG: Record<string, readonly string[]> = {
  'טויוטה': ['קורולה', 'יאריס', 'אוריס', 'C-HR', 'RAV4', 'היילקס', 'לנד קרוזר', 'קאמרי', 'אייגו', 'פרואייס'],
  'יונדאי': ['i10', 'i20', 'i25', 'i30', 'i35', 'טוסון', 'סנטה פה', 'קונה', 'איוניק', 'אלנטרה', 'ונואה'],
  'קיה': ['פיקנטו', 'ריו', 'סיד', 'ספורטג׳', 'סורנטו', 'נירו', 'סטוניק', 'סלטוס', 'EV6', 'קרניבל'],
  'מאזדה': ['2', '3', '6', 'CX-3', 'CX-30', 'CX-5', 'CX-60', 'MX-5'],
  'סקודה': ['פאביה', 'סקאלה', 'אוקטביה', 'סופרב', 'קאמיק', 'קארוק', 'קודיאק', 'אניאק'],
  'פולקסווגן': ['פולו', 'גולף', 'ג׳טה', 'פאסאט', 'טיגואן', 'T-רוק', 'טוארג', 'קאדי', 'טרנספורטר', 'ID.4'],
  'ניסאן': ['מיקרה', 'נוט', 'קשקאי', 'ג׳וק', 'X-טרייל', 'ליף', 'נבארה'],
  'מיצובישי': ['ספייס סטאר', 'ASX', 'אאוטלנדר', 'אקליפס קרוס', 'לנסר', 'L200'],
  'סוזוקי': ['סוויפט', 'איגניס', 'ויטרה', 'S-קרוס', 'ג׳ימני', 'באלנו'],
  'הונדה': ['ג׳אז', 'סיוויק', 'HR-V', 'CR-V'],
  'שברולט': ['ספארק', 'אוואו', 'קרוז', 'טראקס', 'קפטיבה'],
  'פורד': ['פיאסטה', 'פוקוס', 'קוגה', 'פומה', 'אקספלורר', 'טרנזיט', 'רנג׳ר'],
  'פיג׳ו': ['108', '208', '308', '2008', '3008', '5008', 'פרטנר', 'בוקסר'],
  'סיטרואן': ['C1', 'C3', 'C4', 'C5 אירקרוס', 'ברלינגו', 'ג׳מפי'],
  'רנו': ['קליאו', 'מגאן', 'קפצ׳ור', 'קדג׳אר', 'קנגו', 'טראפיק', 'זואי'],
  'אאודי': ['A1', 'A3', 'A4', 'A6', 'Q2', 'Q3', 'Q5', 'Q7', 'e-tron'],
  'ב.מ.וו': ['סדרה 1', 'סדרה 3', 'סדרה 5', 'סדרה 7', 'X1', 'X3', 'X5', 'i3'],
  'מרצדס': ['A-קלאס', 'B-קלאס', 'C-קלאס', 'E-קלאס', 'S-קלאס', 'GLA', 'GLC', 'GLE', 'ויטו', 'ספרינטר'],
  'אופל': ['קורסה', 'אסטרה', 'קרוסלנד', 'גרנדלנד', 'מוקה', 'ויוארו'],
  'סיאט': ['איביזה', 'לאון', 'ארונה', 'אטקה', 'טאראקו'],
  'וולוו': ['V40', 'S60', 'S90', 'XC40', 'XC60', 'XC90'],
  'לקסוס': ['CT', 'IS', 'ES', 'UX', 'NX', 'RX'],
  'סובארו': ['אימפרזה', 'XV', 'פורסטר', 'אאוטבק', 'לבורג'],
  'אלפא רומיאו': ['ג׳ולייטה', 'ג׳וליה', 'סטלביו', 'טונאלה'],
  'פיאט': ['500', 'פנדה', 'טיפו', 'דובלו', 'דוקאטו'],
  'ג׳יפ': ['רנגייד', 'קומפאס', 'צ׳ירוקי', 'גרנד צ׳ירוקי', 'רנגלר'],
  'מיני': ['קופר', 'קאנטרימן', 'קלאבמן'],
  'דאצ׳יה': ['סנדרו', 'דאסטר', 'לודג׳י', 'ג׳וגר'],
  'טסלה': ['מודל 3', 'מודל Y', 'מודל S', 'מודל X'],
  'צ׳רי': ['טיגו 4', 'טיגו 7', 'טיגו 8', 'עומודה 5'],
  'MG': ['ZS', 'HS', 'MG3', 'מרוול R', 'MG4'],
  'ג׳ילי': ['ג׳אוקיו', 'קולריי', 'אטלס'],
  'BYD': ['אטו 3', 'דולפין', 'סיל', 'האן'],
  'איסוזו': ['D-מקס'],
  'קרייזלר': ['גרנד ווייג׳ר', 'טאון אנד קאנטרי'],
};

/** The makes, in the order the list declares them. */
export const VEHICLE_MAKES: readonly string[] = Object.keys(VEHICLE_CATALOG);

/** The models for a make, matched leniently — the field is free text, so what
 *  arrives here is whatever was typed, spacing and all. Nothing for a make the
 *  list has never heard of, which is a normal state and not an error: the model
 *  field simply offers no suggestions and takes what it is given. */
export function modelsFor(make: string | null | undefined): readonly string[] {
  const q = (make ?? '').trim();
  if (!q) return [];
  if (VEHICLE_CATALOG[q]) return VEHICLE_CATALOG[q];
  const hit = VEHICLE_MAKES.find((m) => m.toLowerCase() === q.toLowerCase());
  return hit ? VEHICLE_CATALOG[hit] : [];
}

/* ---------------------------------------------------------------------------
 * What this garage has already typed.
 *
 * The list above cannot know every grey import, so the suggestions also carry
 * every make and model already saved on one of the garage's cars
 * (garage_vehicle_models). Typed once, offered the next time (2026-11-22).
 * Nothing extra is stored: the cars are the list, so a typo leaves the
 * suggestions as soon as the car is corrected.
 */

/** One (make, model) pair as saved on the garage's cars, and on how many. */
export interface LearnedVehicleModel {
  manufacturer: string;
  model: string | null;
  uses: number;
}

export interface VehicleSuggestions {
  /** Makes to offer: the garage's most used first, then the rest of the list. */
  makes: readonly string[];
  /** Models to offer for whatever was typed as the make, the same order. */
  modelsFor: (make: string | null | undefined) => readonly string[];
}

/** Spellings that are the same word: case, spacing, and the three ways a
 *  keyboard writes a geresh or gershayim. "ג'יפ" and "ג׳יפ" are one make. */
export function vehicleNameKey(s: string | null | undefined): string {
  return (s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/['’`׳]/g, '׳')
    .replace(/["”״]/g, '״')
    .toLowerCase();
}

interface Entry {
  label: string;
  /** How many cars carry the spelling shown — a learned name shows its most
   *  common spelling; a listed one always keeps the list's. */
  labelUses: number;
  listed: boolean;
  uses: number;
  order: number;
}

const bump = (map: Map<string, Entry>, key: string, spelling: string, uses: number) => {
  const e = map.get(key);
  if (!e) {
    map.set(key, { label: spelling, labelUses: uses, listed: false, uses, order: Infinity });
    return;
  }
  e.uses += uses;
  if (!e.listed && uses > e.labelUses) { e.label = spelling; e.labelUses = uses; }
};

const ranked = (map: Map<string, Entry>): string[] =>
  [...map.values()]
    .sort((a, b) => b.uses - a.uses || a.order - b.order || a.label.localeCompare(b.label, 'he'))
    .map((e) => e.label);

const NO_MODELS: readonly string[] = [];

/** The list above and what the garage has typed, as one set of suggestions. */
export function mergeVehicleCatalog(learned: readonly LearnedVehicleModel[] = []): VehicleSuggestions {
  const makes = new Map<string, Entry>();
  const models = new Map<string, Map<string, Entry>>();

  VEHICLE_MAKES.forEach((make, i) => {
    const key = vehicleNameKey(make);
    makes.set(key, { label: make, labelUses: 0, listed: true, uses: 0, order: i });
    models.set(key, new Map(VEHICLE_CATALOG[make].map((m, j) => [
      vehicleNameKey(m), { label: m, labelUses: 0, listed: true, uses: 0, order: j },
    ])));
  });

  for (const row of learned) {
    const make = (row.manufacturer ?? '').trim().replace(/\s+/g, ' ');
    const makeKey = vehicleNameKey(make);
    if (!makeKey) continue;
    const uses = Math.max(1, row.uses || 0);
    bump(makes, makeKey, make, uses);
    const model = (row.model ?? '').trim().replace(/\s+/g, ' ');
    const modelKey = vehicleNameKey(model);
    if (!modelKey) continue;
    if (!models.has(makeKey)) models.set(makeKey, new Map());
    bump(models.get(makeKey)!, modelKey, model, uses);
  }

  const makeList = ranked(makes);
  const modelLists = new Map([...models].map(([k, m]) => [k, ranked(m)]));
  return {
    makes: makeList,
    modelsFor: (make) => modelLists.get(vehicleNameKey(make)) ?? NO_MODELS,
  };
}
