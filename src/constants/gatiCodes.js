import ITEM_CODE_MASTER from './itemCodeMaster.json';
import SIEVE_MASTER from './sieveMaster.json';

// Gati import code mappings, derived from the CHPDCJ-V2 macro workbook (Sheet2 masters)
// and the Gati item master. The Gati DB expects short codes, not full names.

// Category name -> Gati Category Code (from Gati "category master.xlsx").
const CATEGORY_TO_CODE = {
  RING: 'R', EARRING: 'E', EARRINGS: 'E', HOOPS: 'E',
  BRACELET: 'B', BRACELETS: 'B', BANGLE: 'D', 'NOSE PIN': 'M',
  'CUSTOM PENDANT': 'X', PENDANT: 'P', NECKLACE: 'N', 'NECK-PIECE': 'O',
  'BOX SET': 'S', CUFFLINKS: 'CF', CHAIN: 'C', CHARMS: 'CH', ANKLET: 'AN',
  CROWN: 'CR', CAP: 'CP', 'KEY RING': 'KR', BROOCH: 'BR', TIKA: 'TK',
  BAND: 'BD', BRIDAL: 'BRI', 'HAND CHAIN': 'HC', WATCH: 'WTH',
  'SHOE LACE': 'SL', 'HAIR BAND': 'HB',
};

export const getCategoryCode = (category) => {
  const key = String(category || '').toUpperCase().trim();
  return CATEGORY_TO_CODE[key] || category || '';
};

// Stone type -> Gati code (Sheet2 col A: DIA / LGD / CS)
export const getStoneTypeCode = (type) => {
  const t = String(type || '').toLowerCase();
  if (!t) return '';
  if (t.includes('lab') || t.includes('cvd') || t.includes('lgd')) return 'LGD';
  if (t.includes('natural') || t.includes('diamond') || t === 'dia') return 'DIA';
  return 'CS'; // colour stone (ruby, emerald, sapphire, moissanite, pearl, ...)
};

// Stone Type -> item-master RawMaterial group.
const typeToRawMaterial = (type) => {
  const t = String(type || '').toLowerCase();
  if (t.includes('moissan')) return 'MOISSANITE DIAMOND';
  if (t.includes('cz') || t.includes('cubic') || t.includes('zircon')) return 'CUBIC ZIRCONIA';
  if (t.includes('lab') || t.includes('cvd') || t.includes('lgd')) return 'LABGROWN DIAMOND';
  if (t.includes('natural') || t.includes('diamond') || t === 'dia') return 'DIAMOND';
  return 'LABGROWN DIAMOND'; // default for our lab-grown-centric data
};

// Stone shape code/name -> item-master ShapeName.
const SHAPE_TO_NAME = {
  RD: 'ROUND', ROUND: 'ROUND', BR: 'ROUND',
  RAD: 'RADIANT', RADIANT: 'RADIANT',
  EM: 'EMERALD', EMERALD: 'EMERALD',
  PS: 'PEARS', PE: 'PEARS', PEAR: 'PEARS', PEARS: 'PEARS',
  MQ: 'MARQUISE', MARQUISE: 'MARQUISE',
  PR: 'PRINCESS', PC: 'PRINCESS', PRINCESS: 'PRINCESS',
  CU: 'CUSHION', CUSHION: 'CUSHION',
  AS: 'ASSCHER', AC: 'ASSCHER', ASSCHER: 'ASSCHER',
  OV: 'OVAL', OVAL: 'OVAL',
  BG: 'BUGGETTE', BAG: 'BUGGETTE', BAGUETTE: 'BUGGETTE', BUGGETTE: 'BUGGETTE',
  HS: 'HEART', HEART: 'HEART',
  OCT: 'OCTAGONE', OCTAGON: 'OCTAGONE', OCTAGONE: 'OCTAGONE',
  TR: 'TRIANGLE', TRIANGLE: 'TRIANGLE',
  TC: 'TRILLION CUT', HM: 'HALF MOON',
  TP: 'TAPER', TPZ: 'TRAPEZOID', KT: 'KITE', HX: 'HEXAGON',
};

// Resolve a stone to its Gati item-master code, e.g. lab-grown round -> "LRD".
export const getStoneItemCode = (stone) => {
  const rm = typeToRawMaterial(stone?.Type);
  const shapeName = SHAPE_TO_NAME[String(stone?.Shape || '').toUpperCase().trim()] || 'ROUND';
  const table = ITEM_CODE_MASTER[rm] || {};
  return table[shapeName] || table.ROUND || '';
};

// Convert a stone's MM size to the Gati sieve code (Sheet3 lookup), e.g. LRD 1.5 -> "4.5-5".
export const getStoneSieveCode = (stone) => {
  const shapeCode = getStoneItemCode(stone);
  const table = SIEVE_MASTER[shapeCode];
  const fallback = stone?.SieveSize || '';
  if (!table) return fallback;
  const mm = parseFloat(stone?.MmSize);
  if (!Number.isFinite(mm)) return fallback;
  let best = null;
  let bestDiff = Infinity;
  for (const k of Object.keys(table)) {
    const d = Math.abs(parseFloat(k) - mm);
    if (d < bestDiff) { bestDiff = d; best = k; }
  }
  return best != null ? table[best] : fallback;
};

// Metal colour -> Gati tone code (from tone master.xlsx): W/Y/R/YW/RW/RY/YWR/…
export const getToneCode = (metalColor) => {
  const c = String(metalColor || '').toUpperCase();
  const w = c.includes('WHITE');
  const y = c.includes('YELLOW');
  const r = c.includes('ROSE') || c.includes('PINK');
  const pt = c.includes('PLATINUM');
  const sv = c.includes('SILVER');
  if (y && w && r) return 'YWR';
  if (r && w) return pt ? 'RPT' : sv ? 'RSV' : 'RW';
  if (y && w) return pt ? 'YPT' : sv ? 'YSV' : 'YW';
  if (r && y) return 'RY';
  if (w) return pt ? 'WPT' : sv ? 'WSV' : 'W';
  if (y) return 'Y';
  if (r) return 'R';
  return '';
};

// Metal item code, e.g. gold 18K -> "G18K".
export const getMetalItemCode = (metalQuality) => {
  const q = String(metalQuality || '');
  const initial = /plat|pt/i.test(q) ? 'P' : /silver|925/i.test(q) ? 'S' : 'G';
  const num = q.replace(/[^0-9]/g, '');
  return `${initial}${num}K`;
};

// StockType — Gati master value in the macro's "Studded/Plain <Metal> Jewellery" form.
const metalWord = (metalQuality) => {
  const q = String(metalQuality || '').toLowerCase();
  if (q.includes('plat') || q === 'pt') return 'Platinum';
  if (q.includes('silver') || q.includes('925')) return 'Silver';
  return 'Gold';
};

export const getGatiStockTypes = (metalQuality) => {
  const m = metalWord(metalQuality);
  return [`Studded ${m} Jewellery`, `Plain ${m} Jewellery`];
};

export const getDefaultGatiStockType = (metalQuality, hasStones) => {
  const m = metalWord(metalQuality);
  return `${hasStones ? 'Studded' : 'Plain'} ${m} Jewellery`;
};
