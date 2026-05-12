import secureStorage from '../utils/secureStorage';
import { decodeJWT } from '../utils/helpers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { classifyMetal, classifyStone, readDutyRates } from '../utils/pricingDuties';

const API_BASE_URL = "https://workflowapi-quhn.onrender.com"
const CLIENT_PRICING_CACHE_KEY = '@pricing_engine_client_pricing';
const METAL_PRICES_CACHE_KEY = '@pricing_engine_metal_prices';

const clientPricingCache = {
  clientId: '',
  data: null,
  pendingPromise: null,
};

const metalPricesCache = {
  data: null,
  pendingPromise: null,
};

const firstDefined = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const safeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round3 = (value) => Number(safeNumber(value).toFixed(3));

const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const normalizeDiamondType = (value) => {
  const raw = normalizeKey(value);
  if (!raw) return '';

  // Canonical aliases to avoid client/product vocabulary mismatches.
  if (raw.includes('labgrown') || raw.includes('cvd')) return 'LabGrown';
  if (raw.includes('naturalregular') || raw === 'natural') return 'naturalregular';
  if (raw.includes('naturallower') || raw.includes('naturallow')) return 'naturallower';
  return raw;
};

const parseKtFromQuality = (quality) => {
  const text = String(quality || '').toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)\s*k(?:t)?/i);
  return match ? safeNumber(match[1]) : 0;
};

const getFilterMap = (source) => {
  const filters = Array.isArray(source?.filter) ? source.filter : [];
  return filters.reduce((acc, row) => {
    const key = normalizeKey(row?.filterName);
    if (!key) return acc;
    acc[key] = row?.filterValue;
    return acc;
  }, {});
};

const pickMetalWeightByQuality = (metalWeights = {}, qualityText = '') => {
  const quality = String(qualityText || '').toLowerCase();
  if (quality.includes('silver')) return safeNumber(metalWeights?.silver?.value);
  if (quality.includes('platinum')) return safeNumber(metalWeights?.platinum?.value);
  if (quality.includes('18')) return safeNumber(metalWeights?.gold18K?.value);
  if (quality.includes('14')) return safeNumber(metalWeights?.gold14K?.value);
  if (quality.includes('10')) return safeNumber(metalWeights?.gold10K?.value);
  return safeNumber(
    firstDefined(
      metalWeights?.gold18K?.value,
      metalWeights?.gold14K?.value,
      metalWeights?.gold10K?.value,
      metalWeights?.silver?.value,
      metalWeights?.platinum?.value,
    ),
  );
};

const resolveClientIdFromToken = (token) => {
  const decoded = decodeJWT(token || '');
  return (
    decoded?.clientId ||
    decoded?.ClientId ||
    decoded?.ClientID ||
    decoded?.clientID ||
    decoded?.id ||
    decoded?.Id ||
    ''
  );
};

const resolveClientFromResponse = (response) => response?.client || response?.data || response || null;

const resolvePricingConfig = (client) =>
  client?.pricing || client?.Pricing || client?.clientPricing || client?.ClientPricing || {};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJsonWithRetry = async (url, options, attempts = 3) => {
  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const response = await fetch(url, options);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data?.error || data?.message || `Request failed (${response.status})`;
        throw new Error(message);
      }
      return data;
    } catch (error) {
      lastError = error;
      if (__DEV__) {
        console.log('💎 [PricingEngine] fetch attempt failed', {
          url,
          attempt: i,
          attempts,
          message: error?.message || 'unknown',
        });
      }
      if (i < attempts) {
        await delay(i * 400);
      }
    }
  }
  throw lastError || new Error('Request failed');
};

const normalizeMetalPrices = (response) => {
  const source = response?.prices || response?.data || response || {};
  return {
    gold24k: safeNumber(
      firstDefined(
        source?.gold?.price,
        source?.Gold?.price,
        source?.gold?.Price,
        source?.Gold?.Price,
        source?.gold24k,
        source?.gold24KT,
      ),
    ),
    silver: safeNumber(firstDefined(source?.silver?.price, source?.Silver?.price, source?.silver, source?.Silver)),
    platinum: safeNumber(
      firstDefined(source?.platinum?.price, source?.Platinum?.price, source?.platinum, source?.Platinum),
    ),
  };
};

const normalizeDiamondPriceRows = (pricingConfig) => {
  const rawRows = firstDefined(
    pricingConfig?.diamonds,
    pricingConfig?.Diamonds,
    pricingConfig?.diamondPricing,
    pricingConfig?.DiamondPricing,
  );
  if (!Array.isArray(rawRows)) return [];
  return rawRows.map((row) => ({
    type: normalizeDiamondType(firstDefined(row?.type, row?.Type, row?.diamondType, row?.DiamondType)),
    shape: normalizeKey(firstDefined(row?.shape, row?.Shape)),
    mmSize: normalizeKey(firstDefined(row?.mmSize, row?.MmSize, row?.size, row?.Size)),
    // Client pricing stores price per carat
    pricePerCarat: safeNumber(firstDefined(row?.price, row?.Price, row?.rate, row?.Rate)),
    carat: safeNumber(firstDefined(row?.carat, row?.Carat, row?.ctWeight, row?.CtWeight)),
  }));
};

const getMetalRateFromQuality = (quality, normalizedMetalPrices) => {
  const qualityText = String(quality || '').toLowerCase();
  if (qualityText.includes('silver')) return normalizedMetalPrices.silver;
  if (qualityText.includes('platinum')) return normalizedMetalPrices.platinum;
  const kt = parseKtFromQuality(qualityText);
  if (!kt || !normalizedMetalPrices.gold24k) return 0;
  return (kt / 24) * normalizedMetalPrices.gold24k;
};

const resolveUnitMetal = (source, selectedFilters = {}) => {
  const snapshot = source?.meta?.productSnapshot || {};
  const filterMap = getFilterMap(source);
  const metalNode = firstDefined(source?.metal, source?.Metal) || {};
  const chosenMetal = firstDefined(
    selectedFilters?.Metal,
    selectedFilters?.metal,
    selectedFilters?.['Metal Type'],
    selectedFilters?.metalType,
    selectedFilters?.metal_type,
    filterMap?.metal,
    filterMap?.metalquality,
    filterMap?.purity,
    snapshot?.metalQuality,
    source?.metalQuality,
  );
  const metalWeights = firstDefined(source?.metalWeights, snapshot?.metalWeights) || {};
  const weightFromMetalWeights = pickMetalWeightByQuality(metalWeights, chosenMetal);
  return {
    quality: firstDefined(
      metalNode?.quality,
      metalNode?.Quality,
      chosenMetal,
      source?.metalQuality,
      source?.MetalQuality,
    ),
    weight: safeNumber(
      firstDefined(
        metalNode?.weight,
        metalNode?.Weight,
        weightFromMetalWeights,
        source?.metalWeight,
        source?.MetalWeight,
        snapshot?.metalWeight,
        snapshot?.MetalWeight,
        source?.grossWeight,
        source?.GrossWeight,
      ),
    ),
  };
};

const resolveUnitDiamonds = (source, selectedFilters = {}) => {
  const snapshot = source?.meta?.productSnapshot || {};
  const filterMap = getFilterMap(source);
  const rows = firstDefined(
    source?.diamonds,
    source?.Diamonds,
    snapshot?.diamonds,
    snapshot?.Diamonds,
    source?.diamondRows,
    source?.DiamondRows,
  );
  if (Array.isArray(rows)) {
    return rows.map((row) => ({
      type: normalizeDiamondType(
        firstDefined(
          selectedFilters?.['Stone Type'],
          selectedFilters?.stoneType,
          selectedFilters?.stone_type,
          row?.type,
          row?.Type,
          selectedFilters?.stone,
          selectedFilters?.Stone,
          filterMap?.stone,
          filterMap?.stonetype,
        ),
      ),
      shape: normalizeKey(
        firstDefined(
          row?.shape,
          row?.Shape,
          selectedFilters?.stoneShape,
          selectedFilters?.StoneShape,
          filterMap?.stoneshape,
        ),
      ),
      mmSize: normalizeKey(firstDefined(row?.mmSize, row?.MmSize, row?.sieveSize, row?.SieveSize, row?.size, row?.Size)),
      count: safeNumber(firstDefined(row?.count, row?.Count, row?.qty, row?.Qty, row?.pieces, row?.Pieces, row?.pcs, row?.Pcs)),
      ctWeight: safeNumber(
        firstDefined(row?.ctWeight, row?.CtWeight, row?.carat, row?.Carat, row?.avgPointer, row?.AvgPointer),
      ),
    }));
  }

  const singleCount = safeNumber(
    firstDefined(source?.diamondCount, source?.DiamondCount, source?.pieces, source?.Pieces, source?.totalPieces),
  );
  if (!singleCount) return [];

  return [
    {
      type: normalizeDiamondType(
        firstDefined(
          selectedFilters?.['Stone Type'],
          selectedFilters?.stoneType,
          selectedFilters?.stone_type,
          selectedFilters?.stone,
          selectedFilters?.Stone,
        ),
      ),
      shape: normalizeKey(firstDefined(selectedFilters?.stoneShape, selectedFilters?.StoneShape)),
      mmSize: normalizeKey(firstDefined(source?.mmSize, source?.MmSize, source?.size, source?.Size)),
      count: singleCount,
      ctWeight: safeNumber(firstDefined(source?.ctWeight, source?.CtWeight, source?.carat, source?.Carat)),
    },
  ];
};

const computeDiamondPrice = (diamondRows, clientDiamondPrices) => {
  if (!diamondRows.length) return { total: 0, breakdown: [] };
  let total = 0;
  const breakdown = [];
  for (const row of diamondRows) {
    const matched = clientDiamondPrices.find(
      (priceRow) => priceRow.type === row.type && priceRow.shape === row.shape && priceRow.mmSize === row.mmSize,
    );
    if (!matched) {
      return {
        total: 0,
        breakdown: [
          ...breakdown,
          {
            ...row,
            matched: false,
            rowTotal: 0,
          },
        ],
      };
    }

    // Price is per-carat in client pricing:
    // diamondsPrice += CtWeight * qty * ratePerCarat
    const ctWeight = safeNumber(row.ctWeight) || safeNumber(matched.carat);
    const qty = safeNumber(row.count);
    const ratePerCarat = safeNumber(matched.pricePerCarat);
    const rowTotal = ctWeight * ratePerCarat;
    total += rowTotal;
    breakdown.push({
      type: row.type,
      shape: row.shape,
      mmSize: row.mmSize,
      count: qty,
      ctWeight,
      ratePerCarat,
      matched: true,
      rowTotal: round3(rowTotal),
      formula: `${ctWeight} * ${ratePerCarat}`,
    });
  }
  return { total: round3(total), breakdown };
};

export const fetchClientPricing = async () => {
  const token = await secureStorage.getItem('token');
  const clientId = resolveClientIdFromToken(token);
  if (!clientId) throw new Error('Could not resolve client from token.');
  if (__DEV__) {
    console.log('💎 [PricingEngine] fetchClientPricing start', { clientId, hasToken: !!token });
  }

  if (clientPricingCache.clientId === clientId && clientPricingCache.data) return clientPricingCache.data;
  if (clientPricingCache.pendingPromise) return clientPricingCache.pendingPromise;

  clientPricingCache.pendingPromise = fetchJsonWithRetry(
    `${API_BASE_URL}/api/clients/${clientId}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
    3,
  )
    .then(async (data) => {
      await AsyncStorage.setItem(CLIENT_PRICING_CACHE_KEY, JSON.stringify(data)).catch(() => {});
      if (__DEV__) {
        console.log('💎 [PricingEngine] fetchClientPricing success', {
          clientId,
          hasPricing: !!(data?.Pricing || data?.pricing),
          diamondsCount: Array.isArray(data?.Pricing?.Diamonds || data?.pricing?.diamonds)
            ? (data?.Pricing?.Diamonds || data?.pricing?.diamonds).length
            : 0,
        });
      }
      return data;
    })
    .then((response) => {
      const client = resolveClientFromResponse(response);
      clientPricingCache.clientId = clientId;
      clientPricingCache.data = client;
      return client;
    })
    .catch(async (error) => {
      const raw = await AsyncStorage.getItem(CLIENT_PRICING_CACHE_KEY).catch(() => null);
      const cached = raw ? JSON.parse(raw) : null;
      if (cached) {
        if (__DEV__) {
          console.log('💎 [PricingEngine] using cached client pricing fallback', {
            message: error?.message || 'network error',
          });
        }
        const client = resolveClientFromResponse(cached);
        clientPricingCache.clientId = clientId;
        clientPricingCache.data = client;
        return client;
      }
      throw error;
    })
    .finally(() => {
      clientPricingCache.pendingPromise = null;
    });

  return clientPricingCache.pendingPromise;
};

export const fetchLatestMetalPrices = async () => {
  if (metalPricesCache.data) return metalPricesCache.data;
  if (metalPricesCache.pendingPromise) return metalPricesCache.pendingPromise;

  const token = await secureStorage.getItem('token');
  if (__DEV__) {
    console.log('💎 [PricingEngine] fetchLatestMetalPrices start', { hasToken: !!token });
  }
  metalPricesCache.pendingPromise = fetchJsonWithRetry(
    `${API_BASE_URL}/api/metal-prices/latest`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
    3,
  )
    .then(async (data) => {
      await AsyncStorage.setItem(METAL_PRICES_CACHE_KEY, JSON.stringify(data)).catch(() => {});
      if (__DEV__) {
        console.log('💎 [PricingEngine] fetchLatestMetalPrices success', data);
      }
      return data;
    })
    .then((response) => {
      const normalized = normalizeMetalPrices(response);
      metalPricesCache.data = normalized;
      return normalized;
    })
    .catch(async (error) => {
      const raw = await AsyncStorage.getItem(METAL_PRICES_CACHE_KEY).catch(() => null);
      const cached = raw ? JSON.parse(raw) : null;
      if (cached) {
        if (__DEV__) {
          console.log('💎 [PricingEngine] using cached metal prices fallback', {
            message: error?.message || 'network error',
          });
        }
        const normalized = normalizeMetalPrices(cached);
        metalPricesCache.data = normalized;
        return normalized;
      }
      throw error;
    })
    .finally(() => {
      metalPricesCache.pendingPromise = null;
    });

  return metalPricesCache.pendingPromise;
};

export const getPricingContext = async () => {
  const [clientPricing, metalPrices] = await Promise.all([fetchClientPricing(), fetchLatestMetalPrices()]);
  if (__DEV__) {
    console.log('💎 [PricingEngine] getPricingContext ready', {
      hasClientPricing: !!clientPricing,
      metalPrices,
    });
  }
  return { clientPricing, metalPrices };
};

export const computeUnitPriceFromSource = (source, selectedFilters = {}, pricingContext) => {
  const pricingConfig = resolvePricingConfig(pricingContext?.clientPricing || {});
  const clientDiamondPrices = normalizeDiamondPriceRows(pricingConfig);
  const loss = safeNumber(firstDefined(pricingConfig?.loss, pricingConfig?.Loss));
  const labour = safeNumber(firstDefined(pricingConfig?.labour, pricingConfig?.Labour));
  const extraCharges = safeNumber(firstDefined(pricingConfig?.extraCharges, pricingConfig?.ExtraCharges));
  const dutyRates = readDutyRates(pricingConfig);

  const { quality, weight } = resolveUnitMetal(source, selectedFilters);
  const metalRate = getMetalRateFromQuality(quality, pricingContext?.metalPrices || {});
  const metalRateWithLoss = metalRate * (1 + loss / 100);
  const metalPerGram = metalRateWithLoss + labour;
  const metalPrice = round3(weight * metalPerGram);

  const diamondRows = resolveUnitDiamonds(source, selectedFilters);
  const diamondComputation = computeDiamondPrice(diamondRows, clientDiamondPrices);
  const diamondPrice = round3(diamondComputation.total);

  // Five-bucket duty math — mirrors server semantics from /api/enquiries/pricingCalculate.
  // The catalog engine treats extraCharges as a flat addition (legacy behavior); we leave
  // that intact and compute duty bases against the same metalPrice/stone values.
  const metalKind = classifyMetal(quality);
  const labStoneValue = diamondComputation.breakdown.reduce(
    (acc, row) => acc + (classifyStone(row.type) === 'lab' ? safeNumber(row.rowTotal) : 0),
    0,
  );
  const naturalStoneValue = diamondComputation.breakdown.reduce(
    (acc, row) => acc + (classifyStone(row.type) === 'natural' ? safeNumber(row.rowTotal) : 0),
    0,
  );
  const lossAmount = weight * metalRate * (loss / 100);
  const labourAmount = weight * labour;

  const dutiesBreakdown = {
    NaturalDuties: naturalStoneValue * (dutyRates.NaturalDuties / 100),
    LabDuties: metalKind === 'gold' ? labStoneValue * (dutyRates.LabDuties / 100) : 0,
    GoldDuties: metalKind === 'gold' ? metalPrice * (dutyRates.GoldDuties / 100) : 0,
    SilverAndLabsDuties:
      metalKind === 'silver'
        ? (labStoneValue + metalPrice) * (dutyRates.SilverAndLabsDuties / 100)
        : 0,
    LossAndLabourDuties: (lossAmount + labourAmount) * (dutyRates.LossAndLabourDuties / 100),
  };
  const dutiesAmount =
    dutiesBreakdown.NaturalDuties +
    dutiesBreakdown.LabDuties +
    dutiesBreakdown.GoldDuties +
    dutiesBreakdown.SilverAndLabsDuties +
    dutiesBreakdown.LossAndLabourDuties;

  const subtotal = metalPrice + diamondPrice + extraCharges;
  const total = Math.ceil(subtotal + dutiesAmount);

  if (__DEV__) {
    const lengthFilter =
      selectedFilters?.Length ||
      selectedFilters?.length ||
      selectedFilters?.['Chain Length'] ||
      selectedFilters?.chainLength ||
      selectedFilters?.chain_length ||
      '';
    const diamondPayloadPreview = diamondRows.map((row) => ({
      Type: row.type,
      Shape: row.shape,
      MmSize: row.mmSize,
      Count: row.count,
    }));
    const firstUnmatched = diamondRows.find(
      (row) =>
        !clientDiamondPrices.some(
          (priceRow) => priceRow.type === row.type && priceRow.shape === row.shape && priceRow.mmSize === row.mmSize,
        ),
    );
    const productKey = source?.styleNo || source?._id || source?.name || 'unknown';
    const finalBeforeRound = round3(subtotal + dutiesAmount);
    const formulaSummary = [
      `metalRateWithLoss = ${round3(metalRate)} * (1 + ${round3(loss)}/100) = ${round3(metalRateWithLoss)}`,
      `metalPerGram = ${round3(metalRateWithLoss)} + labour(${round3(labour)}) = ${round3(metalPerGram)}`,
      `metalPrice = weight(${round3(weight)}) * ${round3(metalPerGram)} = ${round3(metalPrice)}`,
      `diamondPrice = ${diamondComputation.breakdown.length ? diamondComputation.breakdown.map((row) => row.formula).join(' + ') : '0'} = ${round3(diamondPrice)}`,
      `subtotal = metalPrice(${round3(metalPrice)}) + diamondPrice(${round3(diamondPrice)}) + extraCharges(${round3(extraCharges)}) = ${round3(subtotal)}`,
      `dutiesAmount = ${round3(dutiesAmount)} [natural=${round3(dutiesBreakdown.NaturalDuties)}, lab=${round3(dutiesBreakdown.LabDuties)}, gold=${round3(dutiesBreakdown.GoldDuties)}, silverLab=${round3(dutiesBreakdown.SilverAndLabsDuties)}, lossLabour=${round3(dutiesBreakdown.LossAndLabourDuties)}]`,
      `final = ceil(${round3(finalBeforeRound)}) = ${total}`,
    ];

    console.log('💎 [PricingEngine] computeUnitPriceFromSource', {
      styleNo: productKey,
      selectedFilters: {
        Metal:
          selectedFilters?.Metal ||
          selectedFilters?.metal ||
          selectedFilters?.['Metal Type'] ||
          selectedFilters?.metalType ||
          selectedFilters?.metal_type ||
          '',
        StoneType:
          selectedFilters?.['Stone Type'] ||
          selectedFilters?.stoneType ||
          selectedFilters?.stone_type ||
          selectedFilters?.stone ||
          selectedFilters?.Stone ||
          '',
        Length: lengthFilter,
      },
      resolvedMetal: { quality, weight, metalRate, metalPrice, metalKind },
      pricingConfig: { loss, labour, extraCharges, dutyRates },
      diamondPayloadPreview,
      diamondRowsCount: diamondRows.length,
      diamondBreakdown: diamondComputation.breakdown,
      unmatchedDiamondRow: firstUnmatched || null,
      computed: { diamondPrice, subtotal, dutiesAmount, dutiesBreakdown, total },
      formulaSummary,
    });
  }

  return total;
};

