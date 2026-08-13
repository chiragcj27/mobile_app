import referenceData from './referenceData.json';

// Reference data sourced from the client's master sheets:
//  - STOCK TYPE.xlsx  -> stockTypes (name + inferred metal group)
//  - SIZE OF ITEMS.xlsx -> sizes (name + inferred unit)
export const STOCK_TYPES = referenceData.stockTypes;
export const SIZES = referenceData.sizes;

// Which size unit applies to each product category.
//  Ring     -> US ring sizes + letter sizes
//  Bracelet -> inch / cm
//  Necklace / Chain -> inch
const CATEGORY_SIZE_UNITS = {
  ring: ['us', 'letter'],
  bracelet: ['inch', 'cm'],
  bangle: ['mm', 'inch'],
  necklace: ['inch'],
  chain: ['inch'],
  pendant: ['inch'],
};

export const getSizeOptionsForCategory = (category) => {
  const key = String(category || '').toLowerCase().trim();
  const units = CATEGORY_SIZE_UNITS[key];
  if (!units) return SIZES;
  return SIZES.filter((s) => units.includes(s.unit));
};

// First numeric token in the text, e.g. "Necklace Length: 18 inch, ..." -> 18
const numOf = (name) => {
  const m = String(name).match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

// Snap a user-entered size to the catalog value from SIZE OF ITEMS,
// e.g. "16" for a bracelet -> "16 INCH", "7" for a ring -> "7 US".
// Falls back to the entered value if nothing matches.
export const matchSizeToCatalog = (rawValue, category) => {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  const opts = getSizeOptionsForCategory(category);

  // 1) exact name match (case-insensitive)
  const exact = opts.find((o) => o.name.toLowerCase() === raw.toLowerCase());
  if (exact) return exact.name;

  // 2) numeric match, preferring the category's unit order (ring: us; bracelet: inch then cm)
  const target = numOf(raw);
  if (target !== null) {
    const hits = opts.filter((o) => numOf(o.name) === target);
    if (hits.length) {
      const units = CATEGORY_SIZE_UNITS[String(category || '').toLowerCase().trim()];
      if (units) {
        for (const u of units) {
          const hit = hits.find((o) => o.unit === u);
          if (hit) return hit.name;
        }
      }
      return hits[0].name;
    }
  }

  return raw;
};

// Infer the metal group from the enquiry's metal quality / stone type,
// then return matching stock types (for a dropdown). Gold shows gold rows,
// silver shows silver rows, platinum shows platinum rows.
export const getMetalGroup = (metalQuality) => {
  const q = String(metalQuality || '').toLowerCase();
  if (q.includes('plat') || q === 'pt') return 'platinum';
  if (q.includes('silver') || q.includes('925')) return 'silver';
  return 'gold';
};

export const getStockTypesForMetal = (metalQuality) => {
  const group = getMetalGroup(metalQuality);
  return STOCK_TYPES.filter((s) => s.metal === group);
};

export const getDefaultStockType = (metalQuality, stoneType, hasStones) => {
  const group = getMetalGroup(metalQuality);
  const list = STOCK_TYPES.filter((s) => s.metal === group);
  if (list.length === 0) return '';
  const stone = String(stoneType || '').toLowerCase();
  const lab = stone.includes('lab') || stone.includes('cvd');
  const wantStudded = !!hasStones;

  const isLabName = (n) => n.includes('labgrown') || n.includes('lab grown');
  const score = (name) => {
    const n = name.toLowerCase();
    let s = 0;
    if (wantStudded && n.includes('studded')) s += 2;
    if (!wantStudded && (n.includes('plain') || n.includes('mount'))) s += 2;
    // Match lab-grown vs natural to the right master entry.
    if (lab) {
      if (isLabName(n)) s += 3;
    } else {
      if (isLabName(n)) s -= 3;        // natural must NOT pick a lab-grown stock type
      else if (n.includes('diamond')) s += 2;
    }
    if (n.includes('semi mount')) s -= 1; // prefer full studded over semi-mount
    if (n.includes(' ic')) s -= 1;         // de-prioritise IC variants
    return s;
  };

  return list.slice().sort((a, b) => score(b.name) - score(a.name))[0].name;
};
