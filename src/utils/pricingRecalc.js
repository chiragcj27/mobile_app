import { makeExtraCharges } from './extraCharges';

function resolveCharges(data) {
  const src = data?.editableCharges ?? {};
  return {
    Loss:             parseFloat(src.Loss) || 0,
    Labour:           parseFloat(src.Labour) || 0,
    ExtraCharges:     parseFloat(src.ExtraCharges) || 0,
    ExtraChargesType: src.ExtraChargesType || 'percentage',
  };
}

function resolveDutyRates(data, selectedClient) {
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

  const result = {
    UndercutPrice:        undercutPrice,
    NaturalDuties:        parseFloat(src.NaturalDuties) || 0,
    LabDuties:            parseFloat(src.LabDuties) || 0,
    GoldDuties:           parseFloat(src.GoldDuties) || 0,
    SilverAndLabsDuties:  parseFloat(src.SilverAndLabsDuties) || 0,
    LossAndLabourDuties:  parseFloat(src.LossAndLabourDuties) || 0,
  };

  return result;
}

export const buildRecalculatePayload = ({ clientId, data, metalKt, selectedClient, commonMetal = {}, isRecalculate = true, previousMetalQuality }) => {
  const formattedStones = (Array.isArray(data?.editableStones) ? data.editableStones : [])
    .map(s => ({
      Type: s.Type,
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

  const previousCharges = resolveCharges(data);
  const previousDutyRates = resolveDutyRates(data, selectedClient);

  const metalRate = parseFloat(data?.editableMetal?.Rate ?? commonMetal.Rate);
  const ounceVal = parseFloat(data?.editableMetal?.Ounce ?? commonMetal.Ounce);
  const currentQuality = metalKt || data?.editableMetal?.Quality;
  const lastPricedQuality =
    previousMetalQuality || data?.pricingResult?.Metal?.Quality || currentQuality;

  const metalPayload = {
    Weight: parseFloat(data?.editableMetal?.Weight || commonMetal.Weight || 0) || 0,
    Quality: lastPricedQuality,
  };
  if (ounceVal > 0) {
    metalPayload.GoldRatePerOunce = ounceVal;
  } else if (metalRate > 0) {
    metalPayload.Rate = metalRate;
  }

  const payload = {
    details: {
      Metal: metalPayload,
      Stones: formattedStones,
      Quantity: 1,
      Loss: previousCharges.Loss,
      Labour: previousCharges.Labour,
      ExtraCharges: makeExtraCharges(previousCharges.ExtraCharges, previousCharges.ExtraChargesType),
      UndercutPrice: previousDutyRates.UndercutPrice,
      NaturalDuties: previousDutyRates.NaturalDuties,
      LabDuties: previousDutyRates.LabDuties,
      GoldDuties: previousDutyRates.GoldDuties,
      SilverAndLabsDuties: previousDutyRates.SilverAndLabsDuties,
      LossAndLabourDuties: previousDutyRates.LossAndLabourDuties,
    },
    clientId,
    isRecalculate,
  };

  payload.UpdatedmetalQuality = currentQuality;

  console.log('[pricing] quality old ->', lastPricedQuality, '| new ->', currentQuality);

  return payload;
};
