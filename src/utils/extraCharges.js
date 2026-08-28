export const makeExtraCharges = (value, type) => {
  const num = Number(value);
  return {
    Type: type === 'fixed' ? 'fixed' : 'percentage',
    Value: Number.isFinite(num) ? num : 0,
  };
};

export const normalizeExtraCharges = (raw) =>
  raw && typeof raw === 'object'
    ? makeExtraCharges(raw.Value, raw.Type)
    : makeExtraCharges(raw, 'percentage');

export const extraChargesValue = (raw) => normalizeExtraCharges(raw).Value;

export const extraChargesType = (raw) => normalizeExtraCharges(raw).Type;

export const extraChargesSuffix = (type) => (type === 'fixed' ? '$' : '%');

export const formatExtraChargesLabel = (raw) => {
  const { Type, Value } = normalizeExtraCharges(raw);
  return Type === 'fixed' ? `$${Value}` : `${Value}%`;
};
