
export const EXTRA_CHARGE_TYPES = ['percentage', 'fixed'];

export const normalizeExtraCharges = (raw) => {
  if (raw && typeof raw === 'object') {
    const value = Number(raw.Value);
    return {
      Type: raw.Type === 'fixed' ? 'fixed' : 'percentage',
      Value: Number.isFinite(value) ? value : 0,
    };
  }
  const value = Number(raw);
  return { Type: 'percentage', Value: Number.isFinite(value) ? value : 0 };
};

export const extraChargesValue = (raw) => normalizeExtraCharges(raw).Value;

export const extraChargesType = (raw) => normalizeExtraCharges(raw).Type;

export const makeExtraCharges = (value, type) => {
  const num = Number(value);
  return {
    Type: type === 'fixed' ? 'fixed' : 'percentage',
    Value: Number.isFinite(num) ? num : 0,
  };
};

export const extraChargesSuffix = (type) => (type === 'fixed' ? '$' : '%');

export const formatExtraChargesLabel = (raw) => {
  const { Type, Value } = normalizeExtraCharges(raw);
  return Type === 'fixed' ? `$${Value}` : `${Value}%`;
};
