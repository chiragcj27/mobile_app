import { getStoneCategory, getStoneCategoryLabel } from './stoneTypeMapping';
import { toQualityString } from '../constants/metalQualities';
import { extraChargesValue, extraChargesType } from './extraCharges';

export const groupStoneDataByCategory = (rawMultiData, categoryMap = {}) => {
  const grouped = {};

  Object.entries(rawMultiData).forEach(([type, data]) => {
    if (!data) return;
    const category = getStoneCategory(type, categoryMap);

    if (!grouped[category]) {
      grouped[category] = {
        label: getStoneCategoryLabel(category),
        types: [],
        byType: {},
      };
    }

    grouped[category].types.push(type);
    grouped[category].byType[type] = data;
  });

  return grouped;
};

export const splitGroupedDataForRecalc = (groupedData) => {
  const individual = [];

  Object.values(groupedData).forEach((catData) => {
    catData.types.forEach((type) => {
      const data = catData.byType[type];
      if (data) {
        individual.push({ type, data });
      }
    });
  });

  return individual;
};

export const regroupApiResults = (apiResults, existingGroupedData, categoryMap = {}) => {
  const grouped = {};

  apiResults.forEach(({ type, result }) => {
    const category = getStoneCategory(type, categoryMap);

    if (!grouped[category]) {
      grouped[category] = {
        label: getStoneCategoryLabel(category),
        types: [],
        byType: {},
      };
    }

    if (!grouped[category].types.includes(type)) {
      grouped[category].types.push(type);
    }

    const prev = existingGroupedData?.[category]?.byType?.[type];
    const prevMetal = prev?.editableMetal;
    const prevDuty = prev?.dutyRates;
    const keepPrev = (key, fallback) => (prevDuty?.[key] !== undefined ? prevDuty[key] : fallback);

    grouped[category].byType[type] = {
      imageData: prev?.imageData || null,
      editableStones: result.Stones?.map((s) => ({ Type: type, ...s })) || [],
      editableMetal: {
        Weight: result.Metal?.Weight ?? prevMetal?.Weight ?? 0,
        Quality: toQualityString(result.Metal?.Quality ?? prevMetal?.Quality ?? ''),
        Rate: result.Metal?.Rate ?? prevMetal?.Rate ?? 0,
        Ounce: result.GoldRatePerOunce
          ? String(result.GoldRatePerOunce)
          : prevMetal?.Ounce || '',
      },
      editableCharges: {
        Loss: result.Client?.Loss ?? 0,
        Labour: result.Client?.Labour ?? 0,
        ExtraCharges: extraChargesValue(result.Client?.ExtraCharges),
        ExtraChargesType: extraChargesType(result.Client?.ExtraCharges),
        GoldDuties: result.Client?.GoldDuties ?? 0,
        SilverAndLabsDuties: result.Client?.SilverAndLabsDuties ?? 0,
        LossAndLabourDuties: result.Client?.LossAndLabourDuties ?? 0,
      },
      dutyRates: {
        UndercutPrice: keepPrev('UndercutPrice', result.Client?.UndercutPrice),
        UndercutPriceTouched: prevDuty?.UndercutPriceTouched ?? false,
        NaturalDuties: keepPrev('NaturalDuties', result.Client?.NaturalDuties ?? 0),
        LabDuties: keepPrev('LabDuties', result.Client?.LabDuties ?? 0),
      },
      pricingResult: result,
    };
  });

  return grouped;
};
