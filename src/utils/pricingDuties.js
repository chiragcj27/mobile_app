// Duty-field metadata and server-parity math for the five-bucket pricing model.
// Mirrors backend /api/enquiries/pricingCalculate semantics so the client can
// preview Applicable flags and compute dutiesAmount without a round-trip.

export const DUTY_FIELDS = [
  { key: 'NaturalDuties', formKey: 'naturalDuties', label: 'Natural Duties (%)' },
  { key: 'LabDuties', formKey: 'labDuties', label: 'Lab Duties (%)' },
  { key: 'GoldDuties', formKey: 'goldDuties', label: 'Gold Duties (%)' },
  { key: 'SilverAndLabsDuties', formKey: 'silverAndLabsDuties', label: 'Silver+Lab Duties (%)' },
  { key: 'LossAndLabourDuties', formKey: 'lossAndLabourDuties', label: 'Loss+Labour Duties (%)' },
];

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export const classifyMetal = (quality) => {
  const q = String(quality || '').trim();
  if (/silver\s*925/i.test(q)) return 'silver';
  if (/^platinum$/i.test(q)) return 'platinum';
  if (/^\d{1,2}K$/i.test(q)) return 'gold';
  return 'other';
};

export const classifyStone = (type) => {
  const t = String(type || '').trim();
  if (/^(CVDLabGrown|LabGrown)$/i.test(t)) return 'lab';
  return 'natural';
};

const stoneValue = (stone) =>
  num(stone?.CtWeight ?? stone?.ctWeight) *
  (num(stone?.Price ?? stone?.price) + num(stone?.Markup ?? stone?.markup));

const sumStoneValueBy = (stones, predicate) =>
  (Array.isArray(stones) ? stones : []).reduce(
    (acc, s) => (predicate(s) ? acc + stoneValue(s) : acc),
    0,
  );

// metalPrice = weight × (rate × (1 + loss/100) + labour)
const computeMetalPrice = ({ weight, rate, loss, labour }) => {
  const w = num(weight);
  const r = num(rate);
  const l = num(loss);
  const lab = num(labour);
  return w * (r * (1 + l / 100) + lab);
};

// Returns the Applicable map for the given snapshot/details shape.
// Accepts both backend (Metal/Stones/Loss/...) and form-state shapes.
export const computeApplicable = ({ Metal, Stones, Loss, Labour, metal, stones, loss, labour } = {}) => {
  const m = Metal || metal || {};
  const stoneList = Stones || stones || [];
  const metalKind = classifyMetal(m.Quality || m.quality);
  const metalWeight = num(m.Weight ?? m.weight);

  const naturalValue = sumStoneValueBy(stoneList, (s) => classifyStone(s.Type || s.type) === 'natural');
  const labValue = sumStoneValueBy(stoneList, (s) => classifyStone(s.Type || s.type) === 'lab');

  const lossAmount = metalWeight * num(m.Rate ?? m.rate) * (num(Loss ?? loss) / 100);
  const labourAmount = metalWeight * num(Labour ?? labour);

  return {
    NaturalDuties: naturalValue > 0,
    LabDuties: metalKind === 'gold' && labValue > 0,
    GoldDuties: metalKind === 'gold' && metalWeight > 0,
    SilverAndLabsDuties: metalKind === 'silver' && (labValue > 0 || metalWeight > 0),
    LossAndLabourDuties: lossAmount + labourAmount > 0,
  };
};

// Computes the total dutiesAmount for the given snapshot, replicating §4 of the spec.
// Returns { dutiesAmount, breakdown } where breakdown is the per-bucket amount.
export const computeDutiesAmount = ({
  Metal,
  Stones,
  Loss = 0,
  Labour = 0,
  NaturalDuties = 0,
  LabDuties = 0,
  GoldDuties = 0,
  SilverAndLabsDuties = 0,
  LossAndLabourDuties = 0,
  Quantity = 1,
} = {}) => {
  const metalKind = classifyMetal(Metal?.Quality);
  const metalWeight = num(Metal?.Weight);
  const metalRate = num(Metal?.Rate);

  const metalPrice = computeMetalPrice({
    weight: metalWeight,
    rate: metalRate,
    loss: Loss,
    labour: Labour,
  });

  const naturalValue = sumStoneValueBy(Stones, (s) => classifyStone(s.Type) === 'natural');
  const labValue = sumStoneValueBy(Stones, (s) => classifyStone(s.Type) === 'lab');

  const lossAmount = metalWeight * metalRate * (num(Loss) / 100);
  const labourAmount = metalWeight * num(Labour);
  const qty = Math.max(1, num(Quantity) || 1);

  const breakdown = {
    NaturalDuties: naturalValue * (num(NaturalDuties) / 100) * qty,
    LabDuties: metalKind === 'gold' ? labValue * (num(LabDuties) / 100) * qty : 0,
    GoldDuties: metalKind === 'gold' ? metalPrice * (num(GoldDuties) / 100) * qty : 0,
    SilverAndLabsDuties:
      metalKind === 'silver'
        ? (labValue + metalPrice) * (num(SilverAndLabsDuties) / 100) * qty
        : 0,
    LossAndLabourDuties: (lossAmount + labourAmount) * (num(LossAndLabourDuties) / 100) * qty,
  };

  const dutiesAmount =
    breakdown.NaturalDuties +
    breakdown.LabDuties +
    breakdown.GoldDuties +
    breakdown.SilverAndLabsDuties +
    breakdown.LossAndLabourDuties;

  return { dutiesAmount, breakdown };
};

// Pulls duty-rate fields from a pricing entry / snapshot / form-state object,
// defaulting missing values to 0. Handles both PascalCase and camelCase keys.
export const readDutyRates = (source = {}) => ({
  NaturalDuties: num(source.NaturalDuties ?? source.naturalDuties),
  LabDuties: num(source.LabDuties ?? source.labDuties),
  GoldDuties: num(source.GoldDuties ?? source.goldDuties),
  SilverAndLabsDuties: num(source.SilverAndLabsDuties ?? source.silverAndLabsDuties),
  LossAndLabourDuties: num(source.LossAndLabourDuties ?? source.lossAndLabourDuties),
});
