const CHARGE_KEYS = ['Loss', 'Labour', 'ExtraCharges'];
const DUTY_KEYS = ['UndercutPrice', 'NaturalDuties', 'LabDuties', 'GoldDuties', 'SilverAndLabsDuties', 'LossAndLabourDuties'];

function resolveCharges(data, commonCharges = {}) {
  const src = data?.editableCharges ?? commonCharges ?? {};
  return {
    Loss:           parseFloat(src.Loss) || 0,
    Labour:         parseFloat(src.Labour) || 0,
    ExtraCharges:   parseFloat(src.ExtraCharges) || 0,
  };
}

function resolveDutyRates(data, selectedClient, commonCharges = {}) {
  // Merge all sources: dutyRates (stone-dependent edits) → editableCharges (common section edits) → pricingResult → client defaults
  const src = {
    ...(selectedClient?.Pricing ?? {}),
    ...(data?.pricingResult?.Client ?? {}),
    ...(data?.editableCharges ?? {}),
    ...(data?.dutyRates ?? {}),
  };

  const undercutTouched = Boolean(data?.dutyRates?.UndercutPriceTouched);
  let undercutPrice;

  if (undercutTouched) {
    undercutPrice = parseFloat(src.UndercutPrice) || 0;
  } else if (src.UndercutPrice === '' || src.UndercutPrice === undefined || src.UndercutPrice === null) {
    undercutPrice = undefined;
  } else {
    undercutPrice = parseFloat(src.UndercutPrice) || 0;
  }

  return {
    UndercutPrice:        undercutPrice,
    NaturalDuties:        parseFloat(src.NaturalDuties) || 0,
    LabDuties:            parseFloat(src.LabDuties) || 0,
    GoldDuties:           parseFloat(src.GoldDuties) || 0,
    SilverAndLabsDuties:  parseFloat(src.SilverAndLabsDuties) || 0,
    LossAndLabourDuties:  parseFloat(src.LossAndLabourDuties) || 0,
  };
}

export const buildRecalculatePayload = ({ clientId, type, data, metalKt, selectedClient, commonMetal = {}, commonCharges = {} }) => {
  const formattedStones = (Array.isArray(data?.editableStones) ? data.editableStones : [])
    .map(s => ({
      Type: s.Type || type,
      Color: s.Color || '',
      Shape: s.Shape || '',
      MmSize: (s.MmSize || '0').toString(),
      SieveSize: (s.SieveSize || '0').toString(),
      CtWeight: parseFloat(s.CtWeight || 0) || 0,
      Weight: parseFloat(s.Weight || 0) || 0,
      Pcs: parseInt(s.Pcs || 0, 10) || 0,
      Price: parseFloat(s.Price || 0) || 0,
      Markup: parseFloat(s.Markup || 0) || 0,
    }))
    .filter(s => s.Type);

  const previousCharges = resolveCharges(data, commonCharges);
  const previousDutyRates = resolveDutyRates(data, selectedClient, commonCharges);

  return {
    details: {
      Metal: {
        Weight: parseFloat(data?.editableMetal?.Weight || commonMetal.Weight || 0) || 0,
        Quality: data?.editableMetal?.Quality || metalKt,
        Rate: parseFloat(data?.editableMetal?.Rate || commonMetal.Rate || 0) || 0,
      },
      Stones: formattedStones,
      Quantity: 1,
      Loss: previousCharges.Loss,
      Labour: previousCharges.Labour,
      ExtraCharges: previousCharges.ExtraCharges,
      UndercutPrice: previousDutyRates.UndercutPrice,
      NaturalDuties: previousDutyRates.NaturalDuties,
      LabDuties: previousDutyRates.LabDuties,
      GoldDuties: previousDutyRates.GoldDuties,
      SilverAndLabsDuties: previousDutyRates.SilverAndLabsDuties,
      LossAndLabourDuties: previousDutyRates.LossAndLabourDuties,
    },
    clientId,
    isRecalculate: true,
  };
};
