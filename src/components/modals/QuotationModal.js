import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Animated,
  Keyboard,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Clipboard from '@react-native-clipboard/clipboard';
import Icon from '../common/Icon';
import BrandedAlert from '../common/BrandedAlert';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import {
  useCalculatePricingMutation,
  useGetMetalPricesQuery,
  useSavePricingMutation,
  useGetEnquiryByIdQuery,
  useGetClientByIdQuery,
  useUpdateAssetDataMutation,
} from '../../store/api';
import { buildCombinedHtml } from '../../screens/Pricing/previewScreen';
import { LOGO_BASE64 } from '../../constants/logo';
import {
  normalizeExtraCharges,
  extraChargesType,
  extraChargesValue,
} from '../../utils/extraCharges';
import { buildRecalculatePayload } from '../../utils/pricingRecalc';
import CompareRefrences from './CompareRefrences';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: true,
};
const triggerHaptic = (type = 'impactMedium') =>
  ReactNativeHapticFeedback.trigger(type, hapticOptions);

const METAL_QUALITY_OPTIONS = [
  '3K',
  '9K',
  '10K',
  '14K',
  '18K',
  '22K',
  'Silver 925',
  'Platinum',
];

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
let _idSeed = 0;
const makeId = () => `d-${Date.now()}-${_idSeed++}`;

const createBlankEntry = metalPricesData => {
  const prices = metalPricesData?.prices || {};
  let autoRate = '';
  if (prices.gold?.price) autoRate = String(prices.gold.price);
  return {
    id: makeId(),
    metalQuality: '10K',
    metalWeight: '',
    metalRate: autoRate,
    metalOunce: '',
    stones: [],
    missingIndices: new Set(),
    inlineEditIndex: null,
    inlineEditPrice: '',
    editedPrices: {},
    result: null,
    clientMsg: '',
    isOnlyMetalDesign: false,
  };
};

const getEffectiveStonePrice = (entry, index) =>
  num(entry?.editedPrices?.[index] ?? entry?.stones?.[index]?.Price);

const getMissingFields = entries => {
  const fields = [];
  (entries || []).forEach((entry, entryIndex) => {
    if (num(entry?.metalWeight) <= 0)
      fields.push({ entryIndex, type: 'metalWeight' });
    if (num(entry?.metalRate) <= 0)
      fields.push({ entryIndex, type: 'metalRate' });
    (entry?.stones || []).forEach((stone, stoneIndex) => {
      if (getEffectiveStonePrice(entry, stoneIndex) <= 0) {
        fields.push({ entryIndex, type: 'stone', stoneIndex, stone });
      }
    });
  });
  return fields;
};

const areAllInputsComplete = entries =>
  (entries || []).length > 0 && getMissingFields(entries).length === 0;

const getAllPricing = enquiry => {
  const pool = [
    ...(Array.isArray(enquiry?.Cad) ? enquiry.Cad : []),
    ...(Array.isArray(enquiry?.Coral) ? enquiry.Coral : []),
  ];
  if (!pool.length) return [];
  pool.sort(
    (a, b) => new Date(b.CreatedDate || 0) - new Date(a.CreatedDate || 0),
  );
  const pricing = pool[0]?.Pricing || pool[0]?.pricing;
  if (!pricing) return [];
  if (Array.isArray(pricing)) return pricing;
  if (typeof pricing === 'object' && Object.keys(pricing).length > 0)
    return [pricing];
  return [];
};

const getLatestPricing = enquiry => getAllPricing(enquiry)[0] || null;

const getAllStones = entries =>
  (entries || []).flatMap((e, ei) =>
    (Array.isArray(e?.Stones) ? e.Stones : []).map(s => ({
      ...s,
      _entryIdx: ei,
    })),
  );

const splitStonesByEntry = stones => {
  const map = {};
  (stones || []).forEach(s => {
    const k = String(s?._entryIdx ?? 0);
    if (!map[k]) map[k] = [];
    const { _entryIdx, ...clean } = s || {};
    map[k].push(clean);
  });
  return map;
};

const MSG_SEPARATOR = '\n\n---\n\n';
const joinClientMessages = entries =>
  (entries || [])
    .map(e => e?.ClientPricingMessage || '')
    .filter(Boolean)
    .join(MSG_SEPARATOR);

const buildCombinedEntries = ({
  pricingEntries,
  stones,
  metalQuality,
  clientName,
  result,
  isClientPreview,
  perTypeResults,
}) => {
  if (Array.isArray(perTypeResults) && perTypeResults.length > 1) {
    const entries = buildEntriesFromPerType(perTypeResults);
    if (entries.length > 1) {
      return {
        html: buildCombinedHtml(
          entries,
          clientName,
          metalQuality,
          null,
          isClientPreview,
        ),
        isCombined: true,
      };
    }
  }
  if (!Array.isArray(pricingEntries) || pricingEntries.length <= 1) {
    return { html: '', isCombined: false };
  }
  const byType = splitStonesByEntry(stones);
  const entries = Object.keys(byType).map(key => {
    const base = pricingEntries[Number(key)] || pricingEntries[0] || {};
    const normalizedStones = byType[key].map(st => ({
      Type: st.Type || '',
      Color: st.Color || '',
      Shape: st.Shape || '',
      MmSize: String(st.MmSize ?? '0'),
      SieveSize: String(st.SieveSize || '0'),
      CtWeight: num(st.Carat),
      Weight: num(st.Weight),
      Pcs: Math.round(num(st.Pcs)),
      Price: num(st.Price),
      Markup: num(st.Markup),
    }));
    return {
      ...(result || {}),
      ...base,
      Stones: normalizedStones,
      ClientPricingMessage:
        base.ClientPricingMessage || result?.ClientPricingMessage || '',
      Metal: { ...(base.Metal || {}), ...(result?.Metal || {}) },
      Client: { ...(base.Client || {}), ...(result?.Client || {}) },
    };
  });
  return {
    html: buildCombinedHtml(
      entries,
      clientName,
      metalQuality,
      null,
      isClientPreview,
    ),
    isCombined: true,
  };
};

const buildEntriesFromPerType = perTypeResults =>
  (perTypeResults || [])
    .filter(p => p?.result)
    .map(({ result }) => ({
      ...result,
      Stones: (result.Stones || []).map(st => ({
        Type: st.Type || '',
        Color: st.Color || '',
        Shape: st.Shape || '',
        MmSize: String(st.MmSize ?? '0'),
        SieveSize: String(st.SieveSize || '0'),
        CtWeight: num(st.CtWeight ?? st.Carat),
        Weight: num(st.Weight),
        Pcs: Math.round(num(st.Pcs)),
        Price: num(st.Price),
        Markup: num(st.Markup),
      })),
      ClientPricingMessage: result.ClientPricingMessage || '',
    }));

const buildHtml = ({
  pricingResult,
  stones,
  metal,
  charges,
  clientName,
  sourcePricing,
}) => {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const stoneTypes = [...new Set(stones.map(s => s.Type).filter(Boolean))];
  const diamondTypeLabel =
    stoneTypes.length > 0 ? stoneTypes.join(', ') : 'NATURAL';

  const stonesHtml = stones
    .map(
      s => `
    <tr style="border-bottom:1px solid #E6F0F1;">
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${
        s.Type || 'NATURAL'
      }</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${
        s.Color || '-'
      }</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${
        s.Shape || 'RD'
      }</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${
        s.MmSize || '-'
      }</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${num(
        s.Weight,
      ).toFixed(3)}</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${num(
        s.Markup || 0,
      ).toFixed(0)}</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">$${num(
        s.Price,
      ).toFixed(0)}</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${
        s.Pcs || 0
      }</td>
    </tr>`,
    )
    .join('');

  const PR = pricingResult || {};
  const metalQuality = metal.Quality || PR.MetalKT || '';

  const hasRichData =
    PR.Duties &&
    typeof PR.Duties === 'object' &&
    Object.keys(PR.Duties).length > 0;

  const SP = sourcePricing || {};
  const hasLabStone = stones.some(s => /lab/i.test(s.Type));
  const dutyLabels = {
    Natural: 'Natural',
    Lab: 'Lab',
    Gold: 'Gold',
    LossAndLabour: 'Loss + Labour',
    SilverAndLabs: hasLabStone ? 'Silver & Labs' : 'Silver',
  };

  if (hasRichData) {
    const dutiesEntries = Object.entries(PR.Duties).filter(
      ([, d]) => d && typeof d === 'object',
    );
    const undercutPrice = num(PR.Client?.UndercutPrice || 0);
    const hasNaturalDuty = dutiesEntries.some(([k]) => k === 'Natural');
    const totalDutiesWithUndercut = num(PR.TotalDutiesWithUndercut);

    const dutiesHtml =
      dutiesEntries.length > 0
        ? `
    <table style="width:100%;border-collapse:collapse;margin-top:12px;border:1px solid #E6F0F1;">
      <thead>
        <tr style="background-color:#143F45;color:#ffffff;text-align:center;font-size:10px;font-weight:700;">
          <th colspan="3" style="padding:6px;border:1px solid #0F3236;background-color:#D4AF37;color:#1A1A1A;">DUTIES BREAKDOWN</th>
        </tr>
        <tr style="background-color:#235A63;color:#ffffff;text-align:center;font-size:9px;font-weight:700;">
          <th style="padding:4px;border:1px solid #0F3236;">Duty Type</th>
          <th style="padding:4px;border:1px solid #0F3236;">Rate Ã— Base Amount</th>
          <th style="padding:4px;border:1px solid #0F3236;">Amount</th>
        </tr>
      </thead>
      <tbody>${dutiesEntries
        .map(([key, duty]) => {
          const label =
            dutyLabels[key] || key.replace(/([A-Z])/g, ' $1').trim();
          return `
        <tr style="text-align:center;font-size:11px;">
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">${label}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">${num(
            duty.Rate,
          ).toFixed(0)}% Ã— $${num(duty.BaseAmount).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">$${num(
            duty.Amount,
          ).toFixed(2)}</td>
        </tr>`;
        })
        .join('')}
        ${
          hasNaturalDuty && undercutPrice > 0
            ? `
        <tr style="text-align:center;font-size:11px;background-color:#FFF8E1;">
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#1A1A1A;" colspan="2">Total Duties</td>
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#143F45;">$${totalDutiesWithUndercut.toFixed(
            2,
          )}</td>
        </tr>`
            : `
        <tr style="text-align:center;font-size:11px;background-color:#FFF8E1;">
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#1A1A1A;" colspan="2">Duties Amount</td>
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#143F45;">$${num(
            PR.DutiesAmount,
          ).toFixed(2)}</td>
        </tr>`
        }
      </tbody>
    </table>`
        : '';

    const extraChargesHtml =
      num(PR.ExtraChargesPercent) > 0 || num(PR.ExtraChargesAmount) > 0
        ? `
    <div style="margin-top:12px;padding:8px;background:#FFF8E1;border:1px solid #D4AF37;border-radius:4px;display:flex;justify-content:space-between;font-size:11px;font-weight:600;">
      <span>Extra Charges ${
        PR.ExtraChargesType === 'fixed'
          ? '(Fixed)'
          : `(${num(PR.ExtraChargesPercent).toFixed(0)}%)`
      }</span>
      <span>$${num(PR.ExtraChargesAmount).toFixed(2)}</span>
    </div>`
        : '';

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=0.6, maximum-scale=3.0, user-scalable=yes">
    <title>Chandra Jewels - Quotation</title>
    <style>
      @page{margin:0;padding:0}
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,sans-serif;background:#fff;color:#1A1A1A;padding:24px}
      .hdr{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:20px}
      .hdr-logo{height:44px;width:auto}
      .hdr-title{font-size:24px;color:#D4AF37;font-weight:700;letter-spacing:.15em;text-transform:uppercase;margin-bottom:2px}
      .hdr-sub{font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:.2em}
      .divider{height:1px;background:#E6F0F1;margin:6px 0}
      table{width:100%;border-collapse:collapse;margin:0 0 12px}
      th{background:#143F45;color:#fff;padding:6px;text-align:center;font-size:9px;font-weight:700;border:1px solid #0F3236}
      td{padding:6px;border:1px solid #E6F0F1;text-align:center;font-size:11px}
    </style></head><body>
    <div class="hdr">
      <img src="data:image/png;base64,${LOGO_BASE64}" class="hdr-logo" />
      <div>
        <h2 class="hdr-title">CHANDRA JEWELS</h2>
        <div class="divider"></div>
        <p class="hdr-sub">Quotation (${date})</p>
      </div>
    </div>

    <table>
      <thead><tr><th>Date</th><th>KT & Diamond Type</th><th>Client</th></tr></thead>
      <tbody>
        <tr style="text-align:center;font-size:12px;font-weight:700;color:#1A1A1A;">
          <td style="padding:10px;border:1px solid #E6F0F1;">${date}</td>
          <td style="padding:10px;border:1px solid #E6F0F1;background-color:#FFF8E1;">${
            PR.MetalKT || metalQuality
          } & ${diamondTypeLabel}</td>
          <td style="padding:10px;border:1px solid #E6F0F1;">${
            clientName || '-'
          }</td>
        </tr>
      </tbody>
    </table>

    <table>
      <thead><tr>
        <th>KT</th><th>Metal Rate 24K</th><th>Metal Rate/g</th>
        <th style="background-color:#143F45;">Loss</th><th style="background-color:#143F45;">Labour ($/g)</th>
        <th>Metal Amt</th><th>Loss Amt</th><th>Labour Amt</th><th>Metal Weight</th>
      </tr></thead>
      <tbody>
        <tr style="text-align:center;font-weight:600;font-size:11px;">
          <td style="padding:6px;border:1px solid #E6F0F1;">${
            PR.MetalKT || metalQuality
          }</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">$${num(
            PR.GoldRate24K,
          ).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">$${num(
            PR.GoldRateKT,
          ).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;color:#EF4444;">${num(
            PR.LossPercent,
          )}%</td>
          <td style="padding:6px;border:1px solid #E6F0F1;color:#EF4444;">$${num(
            PR.LabourPercent,
          ).toFixed(2)}/g</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">$${num(
            PR.GoldAmount,
          ).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">$${num(
            PR.LossAmount,
          ).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">$${num(
            PR.LabourAmount,
          ).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;">${num(
            PR.GoldWeight,
          ).toFixed(1)}</td>
        </tr>
      </tbody>
    </table>

    ${
      stones.length
        ? `
    <table style="border:1px solid #E6F0F1;">
      <thead><tr><th>Type</th><th>Color</th><th>Shape</th><th>MM</th><th>AVG CT</th><th>Markup</th><th>Rate</th><th>Qty</th></tr></thead>
      <tbody>${stonesHtml}</tbody>
    </table>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin:6px 0;flex-wrap:wrap;">
      <div style="background:#143F45;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
        <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Total Pieces</div>
        <div style="font-size:13px;font-weight:700;color:#fff;">${num(
          PR.TotalPieces,
        ).toFixed(0)}</div>
      </div>
      <div style="background:#143F45;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
        <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Dia Wt</div>
        <div style="font-size:13px;font-weight:700;color:#fff;">${num(
          PR.DiamondWeight,
        ).toFixed(3)}</div>
      </div>
      <div style="background:#D4AF37;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
        <div style="font-size:7px;color:#1A1A1A;text-transform:uppercase;letter-spacing:.05em;">Dia Price</div>
        <div style="font-size:13px;font-weight:700;color:#1A1A1A;">$${num(
          PR.DiamondsPrice,
        ).toFixed(0)}</div>
      </div>
    </div>`
        : ''
    }

    ${dutiesHtml}

    ${extraChargesHtml}

    <div style="display:flex;justify-content:flex-end;align-items:center;margin-top:10px;gap:8px;padding:6px 10px;background:#143F45;border-radius:6px;">
      <div style="text-align:center;flex:1;">
        <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Metal</div>
        <div style="font-size:11px;font-weight:700;color:#fff;">$${num(
          PR.MetalPrice,
        ).toFixed(0)}</div>
      </div>
      <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);">
        <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Dia Price</div>
        <div style="font-size:11px;font-weight:700;color:#fff;">$${num(
          PR.DiamondsPrice,
        ).toFixed(0)}</div>
      </div>
      <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);">
        <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Duties</div>
        <div style="font-size:11px;font-weight:700;color:#fff;">$${num(
          PR.DutiesAmount,
        ).toFixed(0)}</div>
      </div>
      <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);background:#D4AF37;border-radius:4px;padding:4px 6px;">
        <div style="font-size:7px;color:#1A1A1A;text-transform:uppercase;letter-spacing:.05em;">Total</div>
        <div style="font-size:13px;font-weight:800;color:#1A1A1A;">$${num(
          PR.TotalPrice,
        ).toFixed(0)}</div>
      </div>
    </div>
    </body></html>`;
  }

  const dutyMap = [
    { key: 'Natural', value: num(SP.NaturalDuties) },
    { key: 'Lab', value: num(SP.LabDuties) },
    { key: 'Gold', value: num(SP.GoldDuties) },
    { key: 'LossAndLabour', value: num(SP.LossAndLabourDuties) },
    { key: 'SilverAndLabs', value: num(SP.SilverAndLabsDuties) },
  ].filter(({ value }) => value > 0);

  const dutiesHtml =
    dutyMap.length > 0
      ? `
  <table style="width:100%;border-collapse:collapse;margin-top:12px;border:1px solid #E6F0F1;">
    <thead>
      <tr style="background-color:#D4AF37;color:#1A1A1A;text-align:center;font-size:10px;font-weight:700;">
        <th colspan="2" style="padding:6px;border:1px solid #B8942E;">DUTIES BREAKDOWN</th>
      </tr>
      <tr style="background-color:#235A63;color:#fff;text-align:center;font-size:9px;font-weight:700;">
        <th style="padding:4px;border:1px solid #0F3236;">Duty Type</th>
        <th style="padding:4px;border:1px solid #0F3236;">Rate</th>
      </tr>
    </thead>
    <tbody>${dutyMap
      .map(
        ({ key, value }) => `
      <tr style="text-align:center;font-size:11px;">
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">${
          dutyLabels[key] || key
        }</td>
        <td style="padding:6px;border:1px solid #E6F0F1;">${value}%</td>
      </tr>`,
      )
      .join('')}
      <tr style="text-align:center;font-size:11px;background-color:#FFF8E1;">
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#1A1A1A;">Duties Amount</td>
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#143F45;">$${num(
          PR.DutiesAmount,
        ).toFixed(2)}</td>
      </tr>
    </tbody>
  </table>`
      : '';

  const extraChargesHtml =
    num(PR.ExtraChargesPercent) > 0 || num(PR.ExtraChargesAmount) > 0
      ? `
  <div style="margin-top:12px;padding:8px;background:#FFF8E1;border:1px solid #D4AF37;border-radius:4px;display:flex;justify-content:space-between;font-size:11px;font-weight:600;">
    <span>Extra Charges ${
      PR.ExtraChargesType === 'fixed'
        ? '(Fixed)'
        : `(${num(PR.ExtraChargesPercent).toFixed(0)}%)`
    }</span>
    <span>$${num(PR.ExtraChargesAmount).toFixed(2)}</span>
  </div>`
      : '';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=0.6, maximum-scale=3.0, user-scalable=yes">
  <title>Chandra Jewels - Quotation</title>
  <style>
    @page{margin:0;padding:0}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;background:#fff;color:#1A1A1A;padding:24px}
    .hdr{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:20px}
    .hdr-logo{height:44px;width:auto}
    .hdr-title{font-size:24px;color:#D4AF37;font-weight:700;letter-spacing:.15em;text-transform:uppercase;margin-bottom:2px}
    .hdr-sub{font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:.2em}
    .divider{height:1px;background:#E6F0F1;margin:6px 0}
    table{width:100%;border-collapse:collapse;margin:0 0 12px}
    th{background:#143F45;color:#fff;padding:6px;text-align:center;font-size:9px;font-weight:700;border:1px solid #0F3236}
    td{padding:6px;border:1px solid #E6F0F1;text-align:center;font-size:11px}
  </style></head><body>
  <div class="hdr">
    <img src="data:image/png;base64,${LOGO_BASE64}" class="hdr-logo" />
    <div>
      <h2 class="hdr-title">CHANDRA JEWELS</h2>
      <div class="divider"></div>
      <p class="hdr-sub">Quotation (${date})</p>
    </div>
  </div>

  <table>
    <thead><tr><th>Date</th><th>KT & Diamond Type</th><th>Client</th></tr></thead>
    <tbody>
      <tr style="text-align:center;font-size:12px;font-weight:700;color:#1A1A1A;">
        <td style="padding:10px;border:1px solid #E6F0F1;">${date}</td>
        <td style="padding:10px;border:1px solid #E6F0F1;background-color:#FFF8E1;">${metalQuality} & ${diamondTypeLabel}</td>
        <td style="padding:10px;border:1px solid #E6F0F1;">${
          clientName || '-'
        }</td>
      </tr>
    </tbody>
  </table>

  <table>
    <thead><tr><th>KT</th><th>Metal Rate/g</th><th>Loss</th><th>Labour</th><th>Metal Weight</th></tr></thead>
    <tbody>
      <tr style="text-align:center;font-weight:600;font-size:11px;">
        <td style="padding:6px;border:1px solid #E6F0F1;">${metalQuality}</td>
        <td style="padding:6px;border:1px solid #E6F0F1;">$${num(
          metal.Rate,
        ).toFixed(2)}/g</td>
        <td style="padding:6px;border:1px solid #E6F0F1;color:#EF4444;">${num(
          charges.Loss,
        )}%</td>
        <td style="padding:6px;border:1px solid #E6F0F1;color:#EF4444;">$${num(
          charges.Labour,
        ).toFixed(2)}/g</td>
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;">${num(
          metal.Weight,
        ).toFixed(1)}</td>
      </tr>
    </tbody>
  </table>

  ${
    stones.length
      ? `
  <table style="border:1px solid #E6F0F1;">
    <thead><tr><th>Type</th><th>Color</th><th>Shape</th><th>MM</th><th>AVG CT</th><th>Markup</th><th>Rate</th><th>Qty</th></tr></thead>
    <tbody>${stonesHtml}</tbody>
  </table>
  <div style="display:flex;justify-content:flex-end;gap:8px;margin:6px 0;flex-wrap:wrap;">
    <div style="background:#143F45;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
      <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Total Pieces</div>
      <div style="font-size:13px;font-weight:700;color:#fff;">${num(
        PR.TotalPieces,
      ).toFixed(0)}</div>
    </div>
    <div style="background:#143F45;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
      <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Dia Wt</div>
      <div style="font-size:13px;font-weight:700;color:#fff;">${num(
        PR.DiamondWeight,
      ).toFixed(3)}</div>
    </div>
    <div style="background:#D4AF37;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
      <div style="font-size:7px;color:#1A1A1A;text-transform:uppercase;letter-spacing:.05em;">Dia Price</div>
      <div style="font-size:13px;font-weight:700;color:#1A1A1A;">$${num(
        PR.DiamondsPrice,
      ).toFixed(0)}</div>
    </div>
  </div>`
      : ''
  }

  ${dutiesHtml}

  ${extraChargesHtml}

  ${
    num(charges.UndercutPrice) > 0
      ? `
  <div style="margin-top:8px;padding:8px;background:#FFF8E1;border:1px solid #D4AF37;border-radius:4px;display:flex;justify-content:space-between;font-size:11px;font-weight:600;">
    <span>Undercut Price</span><span>$${num(charges.UndercutPrice).toFixed(
      2,
    )}/ct</span>
  </div>`
      : ''
  }

  <div style="display:flex;justify-content:flex-end;align-items:center;margin-top:10px;gap:8px;padding:6px 10px;background:#143F45;border-radius:6px;">
    <div style="text-align:center;flex:1;">
      <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Metal</div>
      <div style="font-size:11px;font-weight:700;color:#fff;">$${num(
        PR.MetalPrice,
      ).toFixed(0)}</div>
    </div>
    <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);">
      <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Dia Price</div>
      <div style="font-size:11px;font-weight:700;color:#fff;">$${num(
        PR.DiamondsPrice,
      ).toFixed(0)}</div>
    </div>
    <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);">
      <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Duties</div>
      <div style="font-size:11px;font-weight:700;color:#fff;">$${num(
        PR.DutiesAmount,
      ).toFixed(0)}</div>
    </div>
    <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);background:#D4AF37;border-radius:4px;padding:4px 6px;">
      <div style="font-size:7px;color:#1A1A1A;text-transform:uppercase;letter-spacing:.05em;">Total</div>
      <div style="font-size:13px;font-weight:800;color:#1A1A1A;">$${num(
        PR.TotalPrice,
      ).toFixed(0)}</div>
    </div>
  </div>
  </body></html>`;
};

const ChargeInput = ({
  label,
  value,
  onChangeText,
  placeholder = '0',
  keyboardType = 'decimal-pad',
}) => (
  <View style={s.chargeItem}>
    <Text style={s.chargeLabel}>{label}</Text>
    <TextInput
      style={s.chargeInput}
      value={String(value ?? '')}
      onChangeText={onChangeText}
      keyboardType={keyboardType}
      placeholder={placeholder}
      placeholderTextColor={colors.textSecondary}
    />
  </View>
);

export {
  num,
  makeId,
  getLatestPricing,
  getAllPricing,
  getAllStones,
  joinClientMessages,
  buildHtml,
  METAL_QUALITY_OPTIONS,
  ChargeInput,
};

const QuotationModal = ({ visible, enquiryId, onClose }) => {
  const {
    data: fullEnquiryData,
    isFetching: isFetchingEnquiry,
    refetch: refetchEnquiry,
  } = useGetEnquiryByIdQuery(enquiryId, {
    skip: !visible || !enquiryId,
    refetchOnMountOrArgChange: true,
  });

  const [refreshing, setRefreshing] = useState(false);

  const handlePullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchEnquiry();
    } finally {
      setRefreshing(false);
    }
  }, [refetchEnquiry]);

  const pullRefreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handlePullRefresh}
      tintColor={colors.primary}
      colors={[colors.primary]}
    />
  );

  const rawEnquiry = fullEnquiryData?._originalData || fullEnquiryData;
  const fullEnquiry = rawEnquiry;

  const sourcePricing = useMemo(
    () => getLatestPricing(fullEnquiry),
    [fullEnquiry],
  );
  const sourcePricingList = useMemo(
    () => getAllPricing(fullEnquiry),
    [fullEnquiry],
  );

  const clientIdResolved = fullEnquiry?.ClientId || fullEnquiry?.clientId;
  const { data: clientData } = useGetClientByIdQuery(clientIdResolved, {
    skip: !visible || !clientIdResolved || isFetchingEnquiry,
  });
  const resolvedClientName = useMemo(() => {
    return (
      clientData?.name ||
      clientData?.Name ||
      fullEnquiry?.ClientName ||
      fullEnquiry?.clientName ||
      ''
    );
  }, [clientData, fullEnquiry?.ClientName, fullEnquiry?.clientName]);

  const [pricingEntries, setPricingEntries] = useState([]);
  const [activeEntryIndex, setActiveEntryIndex] = useState(0);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const [qualityPickerIdx, setQualityPickerIdx] = useState(0);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showAddEntryModal, setShowAddEntryModal] = useState(false);
  const [addStoneType, setAddStoneType] = useState('');
  const [addMetalQuality, setAddMetalQuality] = useState('');
  const [isAddingEntry, setIsAddingEntry] = useState(false);
  const pricingEntriesRef = useRef([]);
  const inputRefs = useRef({});
  const initialFocusRef = useRef(null);

  const updateEntry = useCallback((idx, updater) => {
    const current = pricingEntriesRef.current;
    const entry = current[idx];
    if (!entry) return current;
    const next = [...current];
    next[idx] =
      typeof updater === 'function'
        ? updater({ ...entry })
        : { ...entry, ...updater };
    pricingEntriesRef.current = next;
    setPricingEntries(next);
    return next;
  }, []);

  const fillCommonFields = useCallback(() => {
    const METAL_KEYS = ['metalWeight', 'metalRate', 'metalOunce'];
    setPricingEntries(prev => {
      if (prev.length < 2) return prev;
      const blank = v => String(v ?? '').trim() === '' || num(v) === 0;
      const common = {};
      METAL_KEYS.forEach(k => {
        const donor = prev.find(e => !blank(e[k]));
        if (donor) common[k] = donor[k];
      });
      const stoneDonor = prev.find(e => (e.stones || []).length > 0);
      let changed = false;
      const next = prev.map(entry => {
        const patch = {};
        METAL_KEYS.forEach(k => {
          if (common[k] !== undefined && blank(entry[k])) patch[k] = common[k];
        });
        if (
          stoneDonor &&
          !entry.isOnlyMetalDesign &&
          (entry.stones || []).length === 0
        ) {
          patch.stones = stoneDonor.stones.map(st => ({
            ...st,
            localId: makeId(),
          }));
          patch.missingIndices = new Set(
            patch.stones
              .map((st, i) => (num(st.Price) > 0 ? -1 : i))
              .filter(i => i >= 0),
          );
        }
        if (Object.keys(patch).length === 0) return entry;
        changed = true;
        return { ...entry, ...patch };
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    fillCommonFields();
  }, [pricingEntries, fillCommonFields]);

  const active = pricingEntries[activeEntryIndex] || null;

  const metalWeight = active?.metalWeight || '';
  const metalQuality = active?.metalQuality || '10K';
  const metalRate = active?.metalRate || '';
  const diamonds = active?.stones || [];
  const editedPrices = active?.editedPrices || {};
  const pricingResult = active?.result || null;

  const entryDirtyRef = useRef(false);
  pricingEntriesRef.current = pricingEntries;
  const activeIdxRef = useRef(activeEntryIndex);
  activeIdxRef.current = activeEntryIndex;

  const onEntryMetalChange = useCallback(
    (idx, key, v) => {
      entryDirtyRef.current = true;
      activeIdxRef.current = idx;
      setActiveEntryIndex(idx);
      updateEntry(idx, { [key]: v });
    },
    [updateEntry],
  );

  const onEntryMetalQualityPick = useCallback(
    (idx, v) => {
      entryDirtyRef.current = true;
      activeIdxRef.current = idx;
      setActiveEntryIndex(idx);
      updateEntry(idx, { metalQuality: v });
    },
    [updateEntry],
  );

  const [calculatePricing, { isLoading: isCalculating }] =
    useCalculatePricingMutation();
  const [savePricing] = useSavePricingMutation();
  const [updateAssetData] = useUpdateAssetDataMutation();
  const navigation = useNavigation();

  const lastHistory = useMemo(() => {
    const hist = fullEnquiry?.StatusHistory;
    if (!Array.isArray(hist) || hist.length === 0) return null;
    return hist[hist.length - 1];
  }, [fullEnquiry]);
  const currentSubStatus =
    fullEnquiry?.CurrentSubStatus ?? lastHistory?.SubStatus ?? null;
  const isQRPhase = currentSubStatus === 'Quotation Review';

  const { data: metalPricesData } = useGetMetalPricesQuery(false);

  const [alertCfg, setAlertCfg] = useState({
    visible: false,
    title: '',
    message: '',
    type: 'info',
    buttons: [],
  });
  const showAlert = useCallback(
    (title, message, type = 'info', buttons = []) =>
      setAlertCfg({ visible: true, title, message, type, buttons }),
    [],
  );
  const hideAlert = useCallback(
    () => setAlertCfg(p => ({ ...p, visible: false })),
    [],
  );

  const seededForRef = useRef(null);
  const navigatingToPreviewRef = useRef(false);
  const [navigatingToPreview, setNavigatingToPreview] = useState(false);
  const [reseedToken, setReseedToken] = useState(0);
  const prevEnquiryRef = useRef(fullEnquiry);

  useEffect(() => {
    if (!visible || isFetchingEnquiry || !fullEnquiry) return;
    const needsReseed = reseedToken > 0 || seededForRef.current !== enquiryId;
    if (!needsReseed) {
      prevEnquiryRef.current = fullEnquiry;
      return;
    }
    const dataChanged = prevEnquiryRef.current !== fullEnquiry;
    prevEnquiryRef.current = fullEnquiry;
    if (reseedToken > 0 && !dataChanged) return;
    seededForRef.current = enquiryId;

    const enq = fullEnquiry || {};
    const mpd = metalPricesData;

    const seeded =
      sourcePricingList && sourcePricingList.length > 0
        ? sourcePricingList.map(entry => {
            const p = entry || {};
            const rawStones = (Array.isArray(p.Stones) ? p.Stones : []).map(
              st => ({
                localId: makeId(),
                Type: st.Type || '',
                Shape: st.Shape || '',
                Carat: num(st.CtWeight ?? st.Carat),
                MmSize: num(st.MmSize),
                SieveSize: st.SieveSize || '',
                Price: num(st.Price),
                Color: st.Color || '',
                Weight: num(st.Weight),
                Pcs: Math.round(num(st.Pcs)),
                Markup: num(st.Markup),
              }),
            );
            const autoRate = (() => {
              if (p.Metal?.Rate) return String(p.Metal.Rate);
              const prices = mpd?.prices || {};
              const q = p.Metal?.Quality || enq?.Metal?.Quality || '10K';
              if (/silver\s*925/i.test(q))
                return String(prices.silver?.price ?? 0);
              if (/platinum/i.test(q))
                return String(prices.platinum?.price ?? 0);
              const base = prices.gold?.price || 0;
              return base ? String(base) : '0';
            })();
            const missing = new Set(
              rawStones.reduce((acc, st, i) => {
                if (num(st.Price) <= 0) acc.push(i);
                return acc;
              }, []),
            );
            return {
              id: makeId(),
              metalQuality: p.Metal?.Quality || enq?.Metal?.Quality || '10K',
              metalWeight: String(p.Metal?.Weight ?? p.GoldWeight ?? 0),
              metalRate: autoRate,
              metalOunce:
                p.Metal?.Ounce != null
                  ? String(p.Metal.Ounce)
                  : p.GoldRatePerOunce
                  ? String(p.GoldRatePerOunce)
                  : '0',
              stones: rawStones,
              missingIndices: missing,
              inlineEditIndex: null,
              inlineEditPrice: '',
              editedPrices: {},
              result: p,
              clientMsg: p.ClientPricingMessage || '',
              isSentForApproaval: !!p.IsSentForApproaval,
              isOnlyMetalDesign: rawStones.length === 0,
            };
          })
        : [createBlankEntry(metalPricesData)];

    pricingEntriesRef.current = seeded;
    setPricingEntries(seeded);
    setActiveEntryIndex(0);
    setShowCompareModal(false);

    if (reseedToken !== 0) setReseedToken(0);

    console.log(
      '[QuotationModal] pricing data on open:',
      JSON.stringify(
        {
          enquiryId,
          enquiryName: enq?.Name,
          clientId: enq?.ClientId,
          currentSubStatus,
          storedEntryCount: (sourcePricingList || []).length,
          storedPricingEntries: sourcePricingList,
          seededEntries: seeded.map(e => ({
            id: e.id,
            metalQuality: e.metalQuality,
            metalWeight: e.metalWeight,
            metalRate: e.metalRate,
            metalOunce: e.metalOunce,
            stoneCount: e.stones.length,
            stones: e.stones,
            missingIndices: [...e.missingIndices],
            isOnlyMetalDesign: e.isOnlyMetalDesign,
            clientMsg: e.clientMsg,
            result: e.result,
          })),
        },
        null,
        2,
      ),
    );
  }, [
    visible,
    isFetchingEnquiry,
    fullEnquiry,
    enquiryId,
    sourcePricing,
    sourcePricingList,
    metalPricesData,
    reseedToken,
  ]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (!navigatingToPreviewRef.current) return;
      navigatingToPreviewRef.current = false;
      setNavigatingToPreview(false);
      setReseedToken(t => t + 1);
      refetchEnquiry();
    });
    return unsub;
  }, [navigation, refetchEnquiry]);

  const handleEntryDeleteDiamond = useCallback(
    (idx, stoneIndex) => {
      showAlert('Delete Stone', 'Remove this stone entry?', 'info', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            updateEntry(idx, prev => {
              const stones = (prev.stones || []).filter(
                (_, i) => i !== stoneIndex,
              );
              return {
                ...prev,
                stones,
                editedPrices: {},
                missingIndices: new Set(
                  stones.reduce((all, stone, index) => {
                    if (num(stone.Price) <= 0) all.push(index);
                    return all;
                  }, []),
                ),
                inlineEditIndex: null,
                inlineEditPrice: '',
              };
            }),
        },
      ]);
    },
    [showAlert, updateEntry],
  );

  const getFieldKey = useCallback(field => {
    const entry = pricingEntriesRef.current[field.entryIndex];
    if (!entry) return '';
    return field.type === 'stone'
      ? `${entry.id}:stone:${field.stoneIndex}`
      : `${entry.id}:${field.type}`;
  }, []);

  const focusMissingField = useCallback(
    field => {
      if (!field) return;
      activeIdxRef.current = field.entryIndex;
      setActiveEntryIndex(field.entryIndex);
      if (field.type === 'stone') {
        const entry = pricingEntriesRef.current[field.entryIndex];
        const value =
          entry?.editedPrices?.[field.stoneIndex] ??
          entry?.stones?.[field.stoneIndex]?.Price ??
          '';
        updateEntry(field.entryIndex, {
          inlineEditIndex: field.stoneIndex,
          inlineEditPrice: num(value) > 0 ? String(value) : '',
        });
      }
      setTimeout(() => {
        inputRefs.current[getFieldKey(field)]?.focus();
      }, 120);
    },
    [getFieldKey, updateEntry],
  );

  const focusNextMissingField = useCallback(() => {
    const next = getMissingFields(pricingEntriesRef.current)[0];
    if (next) focusMissingField(next);
    else Keyboard.dismiss();
  }, [focusMissingField]);

  const startEntryInlineEdit = useCallback(
    (idx, stoneIndex, diamond) => {
      focusMissingField({
        entryIndex: idx,
        type: 'stone',
        stoneIndex,
        stone: diamond,
      });
    },
    [focusMissingField],
  );

  const handleStonePriceChange = useCallback(
    (idx, stoneIndex, value) => {
      entryDirtyRef.current = true;
      activeIdxRef.current = idx;
      setActiveEntryIndex(idx);
      updateEntry(idx, prev => ({
        ...prev,
        inlineEditIndex: stoneIndex,
        inlineEditPrice: value,
        editedPrices: { ...(prev.editedPrices || {}), [stoneIndex]: value },
      }));
    },
    [updateEntry],
  );

  const saveEntryInlineEdit = useCallback(
    idx => {
      const entry = pricingEntriesRef.current[idx];
      if (!entry || entry.inlineEditIndex === null) return;
      const stoneIndex = entry.inlineEditIndex;
      const price = num(
        entry.editedPrices?.[stoneIndex] ?? entry.inlineEditPrice,
      );
      if (price <= 0) {
        focusMissingField({ entryIndex: idx, type: 'stone', stoneIndex });
        return;
      }
      updateEntry(idx, prev => {
        const stones = (prev.stones || []).map((stone, index) =>
          index === stoneIndex ? { ...stone, Price: price } : stone,
        );
        const editedPrices = { ...(prev.editedPrices || {}) };
        delete editedPrices[stoneIndex];
        return {
          ...prev,
          stones,
          editedPrices,
          missingIndices: new Set(
            stones.reduce((all, stone, index) => {
              if (num(editedPrices[index] ?? stone.Price) <= 0) all.push(index);
              return all;
            }, []),
          ),
          inlineEditIndex: null,
          inlineEditPrice: '',
        };
      });
      setTimeout(focusNextMissingField, 80);
    },
    [focusMissingField, focusNextMissingField, updateEntry],
  );

  useEffect(() => {
    if (!visible) {
      initialFocusRef.current = null;
      return;
    }
    if (isQRPhase || pricingEntries.length === 0) return;
    const sessionKey = `${enquiryId}:${pricingEntries[0]?.id || ''}`;
    if (initialFocusRef.current === sessionKey) return;
    const first = getMissingFields(pricingEntries)[0];
    if (!first) return;
    initialFocusRef.current = sessionKey;
    const timer = setTimeout(() => focusMissingField(first), 250);
    return () => clearTimeout(timer);
  }, [visible, isQRPhase, enquiryId, pricingEntries, focusMissingField]);

  const entryToPricing = useCallback(e => {
    const r = e?.result || {};
    const stones = (e?.stones || []).map(st => ({
      Type: st.Type || '',
      Color: st.Color || '',
      Shape: st.Shape || '',
      MmSize: String(st.MmSize ?? '0'),
      SieveSize: String(st.SieveSize || '0'),
      CtWeight: num(st.Carat),
      Weight: num(st.Weight),
      Pcs: Math.round(num(st.Pcs)),
      Price: num(st.Price),
      Markup: num(st.Markup),
    }));
    return {
      isOnlyMetalDesign: e?.isOnlyMetalDesign === true && stones.length === 0,
      IsSentForApproaval: !!e?.isSentForApproaval,
      Metal: {
        Weight: num(e?.metalWeight),
        Quality: e?.metalQuality || '10K',
        Rate: num(r.Metal?.Rate ?? e?.metalRate),
      },
      Stones: stones,
      Loss: num(r.Client?.Loss ?? r.LossPercent ?? r.Loss ?? 0),
      Labour: num(r.Client?.Labour ?? r.LabourPercent ?? r.Labour ?? 0),
      ExtraCharges: normalizeExtraCharges(
        r.Client?.ExtraCharges ?? r.ExtraCharges,
      ),
      UndercutPrice: num(r.Client?.UndercutPrice ?? r.UndercutPrice ?? 0),
      NaturalDuties: num(r.Client?.NaturalDuties ?? r.NaturalDuties ?? 0),
      LabDuties: num(r.Client?.LabDuties ?? r.LabDuties ?? 0),
      GoldDuties: num(r.Client?.GoldDuties ?? r.GoldDuties ?? 0),
      SilverAndLabsDuties: num(
        r.Client?.SilverAndLabsDuties ?? r.SilverAndLabsDuties ?? 0,
      ),
      LossAndLabourDuties: num(
        r.Client?.LossAndLabourDuties ?? r.LossAndLabourDuties ?? 0,
      ),
      MetalPrice: num(r.MetalPrice),
      DiamondsPrice: num(r.DiamondsPrice),
      DutiesAmount: num(r.DutiesAmount),
      TotalPrice: num(r.TotalPrice),
      DiamondWeight: num(r.DiamondWeight),
      TotalPieces: num(r.TotalPieces),
      ClientPricingMessage: r.ClientPricingMessage || e?.clientMsg || '',
    };
  }, []);

  const isEntryComplete = useCallback(e => {
    const stones = e?.stones || [];
    const ep = e?.editedPrices || {};
    const stonesOk =
      stones.length === 0 ||
      stones.every((s, i) => {
        const p = ep[i] !== undefined ? num(ep[i]) : num(s.Price);
        return p > 0;
      });
    return (
      stonesOk &&
      num(e?.metalWeight) > 0 &&
      num(e?.metalRate) > 0 &&
      num(e?.result?.TotalPrice) > 0
    );
  }, []);

  const [isAutoRecalculating, setIsAutoRecalculating] = useState(false);
  const recalculateInProgressRef = useRef(false);
  const autoRecalculateTimerRef = useRef(null);
  const keyboardVisibleRef = useRef(false);
  const lastRecalcSigRef = useRef(null);
  const fullEnquiryRef = useRef(fullEnquiry);
  fullEnquiryRef.current = fullEnquiry;

  const canRecalculateAll = useMemo(
    () => areAllInputsComplete(pricingEntries),
    [pricingEntries],
  );

  /** Fingerprint of every input that affects the calculation. */
  const buildRecalcSignature = entries =>
    JSON.stringify(
      entries.map(e => ({
        q: e.metalQuality,
        w: num(e.metalWeight),
        r: num(e.metalRate),
        o: num(e.metalOunce),
        s: (e.stones || []).map((st, i) => [
          st.Type,
          getEffectiveStonePrice(e, i),
          num(st.Markup),
        ]),
      })),
    );

  const handleRecalculateAll = useCallback(
    async ({ force = false } = {}) => {
      if (
        recalculateInProgressRef.current ||
        !areAllInputsComplete(pricingEntriesRef.current)
      )
        return;
      const enq = fullEnquiryRef.current || {};
      const clientId = enq?.ClientId || enq?.clientId;
      const entries = pricingEntriesRef.current;
      if (!clientId || entries.length === 0) return;

      // Nothing changed since the last completed recalculation — skip the
      // duplicate batch (auto triggers can fire twice for one edit).
      const signature = buildRecalcSignature(entries);
      if (!force && signature === lastRecalcSigRef.current) {
        entryDirtyRef.current = false;
        return;
      }

      entryDirtyRef.current = false;
      recalculateInProgressRef.current = true;
      setIsAutoRecalculating(true);
      let failedStep = 'calculate';
      const recalculationTrace = {
        enquiryId: enq?._id || enq?.id || enq?.Id,
        clientId,
        entryCount: entries.length,
        payloads: null,
        rawResults: null,
        normalizedResults: null,
        invalidResultIndexes: [],
        savePayload: null,
        saveResult: null,
      };
      try {
        const payloads = entries.map(entry => {
          const result = entry.result || {};
          const ounce = num(entry.metalOunce);

          // Shared payload builder — keeps duty/charge fallback logic and the
          // UpdatedmetalQuality contract identical to the rest of the app.
          return buildRecalculatePayload({
            clientId,
            data: {
              editableStones: (entry.stones || []).map((stone, index) => ({
                Type: stone.Type || '',
                Color: stone.Color || '',
                Shape: stone.Shape || '',
                MmSize: String(stone.MmSize ?? '0'),
                SieveSize: String(stone.SieveSize || '0'),
                CtWeight: num(stone.Carat),
                Weight: num(stone.Weight),
                Pcs: Math.round(num(stone.Pcs)),
                Price: getEffectiveStonePrice(entry, index),
                Markup: num(stone.Markup),
              })),
              editableMetal: {
                Weight: num(entry.metalWeight),
                Quality: entry.metalQuality || '10K',
                ...(ounce > 0
                  ? { Ounce: ounce }
                  : { Rate: num(entry.metalRate) }),
              },
              editableCharges: {
                Loss: num(
                  result.Client?.Loss ?? result.LossPercent ?? result.Loss ?? 0,
                ),
                Labour: num(
                  result.Client?.Labour ??
                    result.LabourPercent ??
                    result.Labour ??
                    0,
                ),
                ExtraCharges: extraChargesValue(
                  result.Client?.ExtraCharges ?? result.ExtraCharges,
                ),
                ExtraChargesType:
                  extraChargesType(
                    result.Client?.ExtraCharges ?? result.ExtraCharges,
                  ) || 'percentage',
              },
              pricingResult: entry.result || {},
            },
            metalKt: entry.metalQuality,
            selectedClient: clientData || null,
            isRecalculate: true,
            quantity: enq?.Quantity || 1,
          });
        });

        recalculationTrace.payloads = payloads;
        if (__DEV__) {
          console.log(
            '[QuotationModal][recalc-all] outgoing payloads:',
            JSON.stringify(
              payloads.map(p => ({
                Metal: p.details.Metal,
                stonePrices: (p.details.Stones || []).map(st => ({
                  Type: st.Type,
                  Price: st.Price,
                })),
              })),
              null,
              2,
            ),
          );
        }
        const rawResults = await Promise.all(
          payloads.map(payload => calculatePricing(payload).unwrap()),
        );
        recalculationTrace.rawResults = rawResults;

        const results = rawResults.map(
          response =>
            response?.data?.result ||
            response?.data?.pricing ||
            response?.data ||
            response?.result ||
            response?.pricing ||
            response,
        );
        recalculationTrace.normalizedResults = results;
        recalculationTrace.invalidResultIndexes = results.reduce(
          (indexes, result, index) => {
            if (!result || num(result.TotalPrice) <= 0) indexes.push(index);
            return indexes;
          },
          [],
        );
        if (recalculationTrace.invalidResultIndexes.length > 0) {
          throw new Error('Pricing calculation returned an invalid result');
        }

        const updated = entries.map((entry, index) => {
          const result = results[index];
          const priced = result.Stones || [];
          return {
            ...entry,
            result,
            clientMsg: result.ClientPricingMessage || entry.clientMsg,
            metalQuality: entry.metalQuality || '10K',
            metalRate:
              num(entry.metalRate) > 0
                ? entry.metalRate
                : String(result.Metal?.Rate || ''),
            metalOunce: result.GoldRatePerOunce
              ? String(result.GoldRatePerOunce)
              : entry.metalOunce,
            stones: (entry.stones || []).map((stone, stoneIndex) => ({
              ...stone,
              Price: num(
                priced[stoneIndex]?.Price ??
                  getEffectiveStonePrice(entry, stoneIndex),
              ),
              Markup: num(priced[stoneIndex]?.Markup ?? stone.Markup),
            })),
            editedPrices: {},
            missingIndices: new Set(),
            inlineEditIndex: null,
            inlineEditPrice: '',
          };
        });

        const pool = [
          ...(Array.isArray(enq?.Cad)
            ? enq.Cad.map(item => ({ ...item, _type: 'cad' }))
            : []),
          ...(Array.isArray(enq?.Coral)
            ? enq.Coral.map(item => ({ ...item, _type: 'coral' }))
            : []),
        ];
        pool.sort(
          (a, b) => new Date(b.CreatedDate || 0) - new Date(a.CreatedDate || 0),
        );
        const latestDesign = pool[0];
        const resolvedId = enq?._id || enq?.id || enq?.Id;
        if (!resolvedId || latestDesign?.Version == null)
          throw new Error('Design version not found');

        const pricingData = updated.map(entryToPricing);
        failedStep = 'save';
        const savePayload = {
          enquiryId: resolvedId,
          designType: latestDesign._type,
          version: latestDesign.Version,
          pricingData,
          isOnlyMetalDesign: pricingData.every(
            item => item.isOnlyMetalDesign === true,
          ),
        };
        recalculationTrace.savePayload = savePayload;
        recalculationTrace.saveResult = await savePricing(savePayload).unwrap();

        pricingEntriesRef.current = updated;
        setPricingEntries(updated);
        lastRecalcSigRef.current = signature;
        refetchEnquiry().catch(() => {});
      } catch (error) {
        console.error('[QuotationModal][recalculation-error]', {
          ...recalculationTrace,
          failedStep,
          error: {
            status: error?.status,
            message: error?.message,
            data: error?.data,
            name: error?.name,
          },
        });
        showAlert(
          failedStep === 'save' ? 'Save Failed' : 'Calculation Failed',
          error?.data?.message ||
            error?.message ||
            (failedStep === 'save'
              ? 'Failed to save pricing.'
              : 'Failed to calculate pricing.'),
          'error',
          [{ text: 'OK' }],
        );
      } finally {
        recalculateInProgressRef.current = false;
        setIsAutoRecalculating(false);
      }
    },
    [
      calculatePricing,
      entryToPricing,
      savePricing,
      showAlert,
      refetchEnquiry,
      clientData,
    ],
  );

  const scheduleAutoRecalculation = useCallback(() => {
    if (autoRecalculateTimerRef.current)
      clearTimeout(autoRecalculateTimerRef.current);
    autoRecalculateTimerRef.current = setTimeout(() => {
      if (!entryDirtyRef.current) return;
      if (!areAllInputsComplete(pricingEntriesRef.current)) {
        entryDirtyRef.current = false;
        return;
      }
      entryDirtyRef.current = false;
      handleRecalculateAll();
    }, 180);
  }, [handleRecalculateAll]);

  useEffect(() => {
    if (!visible || isQRPhase) return;
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      keyboardVisibleRef.current = true;
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisibleRef.current = false;
      scheduleAutoRecalculation();
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
      if (autoRecalculateTimerRef.current)
        clearTimeout(autoRecalculateTimerRef.current);
    };
  }, [visible, isQRPhase, scheduleAutoRecalculation]);

  useEffect(() => {
    if (!visible || isQRPhase || keyboardVisibleRef.current) return;
    if (!entryDirtyRef.current || !canRecalculateAll) return;
    scheduleAutoRecalculation();
  }, [
    visible,
    isQRPhase,
    canRecalculateAll,
    pricingEntries,
    scheduleAutoRecalculation,
  ]);

  const handleCompareImages = useCallback(() => {
    setShowCompareModal(true);
  }, []);

  const hasMissingStones = useMemo(
    () =>
      pricingEntries.some(e => {
        const stones = e?.stones || [];
        const miss = e?.missingIndices || new Set();
        if (stones.length === 0) return false;
        return stones.some((d, i) => {
          if (!miss.has(i)) return false;
          const effectivePrice =
            e?.editedPrices?.[i] !== undefined
              ? num(e.editedPrices[i])
              : num(d.Price);
          return effectivePrice <= 0;
        });
      }),
    [pricingEntries],
  );
  const hasMissingMetal = useMemo(
    () =>
      pricingEntries.some(
        e => num(e?.metalWeight) <= 0 || num(e?.metalRate) <= 0,
      ),
    [pricingEntries],
  );

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (hasMissingStones) {
      const loop = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(shakeAnim, {
              toValue: 1,
              duration: 80,
              useNativeDriver: true,
            }),
            Animated.timing(shakeAnim, {
              toValue: -1,
              duration: 80,
              useNativeDriver: true,
            }),
            Animated.timing(shakeAnim, {
              toValue: 1,
              duration: 80,
              useNativeDriver: true,
            }),
            Animated.timing(shakeAnim, {
              toValue: 0,
              duration: 80,
              useNativeDriver: true,
            }),
            Animated.delay(1000),
          ]),
          Animated.sequence([
            Animated.timing(scaleAnim, {
              toValue: 1.08,
              duration: 150,
              useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
              toValue: 0.92,
              duration: 150,
              useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
              toValue: 1.08,
              duration: 150,
              useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
              toValue: 1,
              duration: 150,
              useNativeDriver: true,
            }),
            Animated.delay(1000),
          ]),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
  }, [hasMissingStones]);

  const vibrateOnMountRef = useRef(null);
  useEffect(() => {
    if (!visible || isQRPhase) return;
    if (vibrateOnMountRef.current === enquiryId) return;
    vibrateOnMountRef.current = enquiryId;

    const t1 = setTimeout(() => triggerHaptic('notificationWarning'), 0);
    const t2 = hasMissingMetal
      ? setTimeout(() => triggerHaptic('notificationWarning'), 900)
      : null;
    const t3 = hasMissingStones
      ? setTimeout(() => triggerHaptic('notificationWarning'), 1300)
      : null;
    return () => {
      clearTimeout(t1);
      if (t2) clearTimeout(t2);
      if (t3) clearTimeout(t3);
    };
  }, [visible, isQRPhase, enquiryId, hasMissingMetal, hasMissingStones]);

  const [copiedCardIdx, setCopiedCardIdx] = useState(null);
  const handleCopyCardMsg = useCallback((idx, msg) => {
    if (!msg) return;
    Clipboard.setString(msg);
    setCopiedCardIdx(idx);
    setTimeout(() => setCopiedCardIdx(null), 2000);
  }, []);

  const renderStonesSectionFor = (entry, idx) => {
    const stones = entry?.stones || [];
    const missing = entry?.missingIndices || new Set();
    const edited = entry?.editedPrices || {};
    const inlineEditIndex = entry?.inlineEditIndex ?? null;
    const inlineEditPrice = entry?.inlineEditPrice ?? '';

    const missingStones = stones
      .map((d, i) => ({ d, i }))
      .filter(({ i }) => missing.has(i));

    return (
      <>
        <View style={s.sectionRow}>
          <Text style={s.sectionTitle}>
            {missingStones.length > 0
              ? `Stones needing price (${missingStones.length})`
              : ''}
          </Text>
        </View>

        {missingStones.length === 0 ? null : (
          <View style={s.stoneTable}>
            <View style={s.stoneTableHeader}>
              <Text style={[s.stoneCol, s.stoneColType, s.stoneTh]}>Type</Text>
              <Text style={[s.stoneCol, s.stoneColShape, s.stoneTh]}>
                Shape
              </Text>
              <Text style={[s.stoneCol, s.stoneColNum, s.stoneTh]}>MM</Text>
              <Text style={[s.stoneCol, s.stoneColNum, s.stoneTh]}>AVG Ct</Text>
              <Text style={[s.stoneCol, s.stoneColNum, s.stoneTh]}>Pcs</Text>
              <Text style={[s.stoneCol, s.stoneColPrice, s.stoneTh]}>$/Ct</Text>
              <View style={s.stoneColActions} />
            </View>
            {missingStones.map(({ d, i }, rowIdx) => {
              const effectivePrice =
                edited[i] !== undefined ? num(edited[i]) : num(d.Price);
              const isEdited = edited[i] !== undefined && effectivePrice > 0;
              const isEditing = inlineEditIndex === i;
              return (
                <Animated.View
                  key={d.localId || i}
                  style={[
                    s.stoneRow,
                    rowIdx % 2 === 1 && s.stoneRowAlt,
                    !isEdited && s.stoneRowMissing,
                    !isEdited && {
                      transform: [
                        { translateX: shakeAnim },
                        { scale: scaleAnim },
                      ],
                    },
                  ]}
                >
                  <Text
                    style={[s.stoneCol, s.stoneColType, s.stoneTd]}
                    numberOfLines={1}
                  >
                    {d.Type || ''}
                  </Text>
                  <Text
                    style={[s.stoneCol, s.stoneColShape, s.stoneTd]}
                    numberOfLines={1}
                  >
                    {d.Shape || ''}
                  </Text>
                  <Text style={[s.stoneCol, s.stoneColNum, s.stoneTd]}>
                    {num(d.MmSize).toFixed(2)}
                  </Text>
                  <Text style={[s.stoneCol, s.stoneColNum, s.stoneTd]}>
                    {num(d.Carat).toFixed(2)}
                  </Text>
                  <Text style={[s.stoneCol, s.stoneColNum, s.stoneTd]}>
                    {num(d.Pcs)}
                  </Text>

                  {isEditing ? (
                    <TextInput
                      ref={node => {
                        const key = `${entry.id}:stone:${i}`;
                        if (node) inputRefs.current[key] = node;
                        else delete inputRefs.current[key];
                      }}
                      style={[s.stoneCol, s.stoneColPrice, s.inlinePriceInput]}
                      value={inlineEditPrice}
                      onChangeText={v => handleStonePriceChange(idx, i, v)}
                      keyboardType="decimal-pad"
                      placeholder="$/Ct"
                      placeholderTextColor="#A0A0A0"
                      onSubmitEditing={() => saveEntryInlineEdit(idx)}
                      returnKeyType="next"
                      blurOnSubmit={false}
                    />
                  ) : (
                    <Text
                      style={[
                        s.stoneCol,
                        s.stoneColPrice,
                        s.stoneTd,
                        !isEdited && s.stonePriceMissing,
                      ]}
                    >
                      {effectivePrice > 0
                        ? `$${effectivePrice.toFixed(2)}`
                        : '-'}
                    </Text>
                  )}

                  <View style={s.stoneColActions}>
                    {!isEditing && (
                      <TouchableOpacity
                        onPress={() => startEntryInlineEdit(idx, i, d)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 4 }}
                        style={[
                          s.inlineActionBtn,
                          { borderColor: colors.primary },
                        ]}
                      >
                        <Icon name="edit" size={14} color={colors.primary} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => handleEntryDeleteDiamond(idx, i)}
                      hitSlop={{ top: 6, bottom: 6, left: 4, right: 6 }}
                      style={[
                        s.inlineActionBtn,
                        { borderColor: colors.error || '#EF4444' },
                      ]}
                    >
                      <Icon
                        name="delete-outline"
                        size={14}
                        color={colors.error || '#EF4444'}
                      />
                    </TouchableOpacity>
                  </View>
                </Animated.View>
              );
            })}
          </View>
        )}
      </>
    );
  };

  const renderQualityPicker = () => {
    if (!showQualityPicker) return null;
    const pickerEntry = pricingEntries[qualityPickerIdx];
    const pickerQuality = pickerEntry?.metalQuality || '10K';
    return (
      <View style={s.pickerAbsOverlay}>
        <TouchableOpacity
          style={s.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowQualityPicker(false)}
        >
          <TouchableOpacity activeOpacity={1} style={s.pickerSheet}>
            <Text style={s.pickerTitle}>Select Metal Quality</Text>
            {METAL_QUALITY_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt}
                style={[
                  s.pickerOption,
                  pickerQuality === opt && s.pickerOptionSelected,
                ]}
                onPress={() => {
                  onEntryMetalQualityPick(qualityPickerIdx, opt);
                  setShowQualityPicker(false);
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    s.pickerOptionText,
                    pickerQuality === opt && s.pickerOptionTextSelected,
                  ]}
                >
                  {opt}
                </Text>
                {pickerQuality === opt && (
                  <Icon name="check" size={16} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </View>
    );
  };

  const handleAddEntry = useCallback(() => {
    setAddStoneType('');
    setAddMetalQuality('10K');
    setShowAddEntryModal(true);
  }, []);

  const handleConfirmAddEntry = useCallback(async () => {
    if (isAddingEntry) return;

    const resolvedEnquiryId =
      fullEnquiry?._id || fullEnquiry?.id || fullEnquiry?.Id;
    if (!resolvedEnquiryId) {
      showAlert('Error', 'Could not identify the enquiry.', 'error', [
        { text: 'OK' },
      ]);
      return;
    }

    const pool = [
      ...(Array.isArray(fullEnquiry?.Cad)
        ? fullEnquiry.Cad.map(e => ({ ...e, _type: 'cad' }))
        : []),
      ...(Array.isArray(fullEnquiry?.Coral)
        ? fullEnquiry.Coral.map(e => ({ ...e, _type: 'coral' }))
        : []),
    ];
    pool.sort(
      (a, b) => new Date(b.CreatedDate || 0) - new Date(a.CreatedDate || 0),
    );
    const latestDesign = pool[0];
    if (!latestDesign?.Version) {
      showAlert('Error', 'No design version found.', 'error', [{ text: 'OK' }]);
      return;
    }

    const isOnlyMetalDesign = addStoneType
      ? false
      : !(
          latestDesign?.Pricing?.length > 0 &&
          latestDesign.Pricing.some(
            p => Array.isArray(p.Stones) && p.Stones.length > 0,
          )
        );

    setIsAddingEntry(true);
    try {
      const sp = sourcePricing || {};
      const existingStones = Array.isArray(sp.Stones) ? sp.Stones : [];
      const mergedStones = [];
      if (addStoneType) {
        if (existingStones.length > 0) {
          existingStones.forEach(st => {
            mergedStones.push({
              Type: addStoneType,
              Color: st.Color || '',
              Shape: st.Shape || '',
              MmSize: String(st.MmSize ?? '0'),
              SieveSize: st.SieveSize || '',
              CtWeight: num(st.CtWeight ?? st.Carat),
              Weight: num(st.Weight),
              Pcs: Math.round(num(st.Pcs)),
              Price: num(st.Price),
              Markup: num(st.Markup),
            });
          });
        } else {
          mergedStones.push({
            Type: addStoneType,
            Color: '',
            Shape: '',
            MmSize: '0',
            SieveSize: '',
            CtWeight: 0,
            Weight: 0,
            Pcs: 0,
            Price: 0,
            Markup: 0,
          });
        }
      } else if (existingStones.length > 0) {
        existingStones.forEach(st => {
          mergedStones.push({
            Type: st.Type || '',
            Color: st.Color || '',
            Shape: st.Shape || '',
            MmSize: String(st.MmSize ?? '0'),
            SieveSize: st.SieveSize || '',
            CtWeight: num(st.CtWeight ?? st.Carat),
            Weight: num(st.Weight),
            Pcs: Math.round(num(st.Pcs)),
            Price: num(st.Price),
            Markup: num(st.Markup),
          });
        });
      }

      const metalRateForQuality = (() => {
        const prices = metalPricesData?.prices || {};
        const q = addMetalQuality || '10K';
        if (/silver\s*925/i.test(q)) return num(prices.silver?.price ?? 0);
        if (/platinum/i.test(q)) return num(prices.platinum?.price ?? 0);
        return num(prices.gold?.price ?? 0);
      })();

      const newEntry = {
        Metal: {
          Weight: num(sp.Metal?.Weight ?? sp.GoldWeight ?? 0),
          Quality: addMetalQuality,
          Rate: metalRateForQuality,
        },
        Stones: mergedStones,
        Loss: num(sp.Loss ?? 0),
        Labour: num(sp.Labour ?? 0),
        ExtraCharges: normalizeExtraCharges(sp.ExtraCharges),
        UndercutPrice: num(sp.UndercutPrice ?? 0),
        NaturalDuties: num(sp.NaturalDuties ?? 0),
        LabDuties: num(sp.LabDuties ?? 0),
        GoldDuties: num(sp.GoldDuties ?? 0),
        SilverAndLabsDuties: num(sp.SilverAndLabsDuties ?? 0),
        LossAndLabourDuties: num(sp.LossAndLabourDuties ?? 0),
        ClientPricingMessage: sp.ClientPricingMessage || '',
      };

      let calcResult = null;
      // Only hit pricingCalculate when every copied stone actually has a
      // price — otherwise the backend just returns TotalPrice 0.
      const copiedStonesPriced =
        mergedStones.length === 0 ||
        mergedStones.every(st => num(st.Price) > 0);
      if (copiedStonesPriced) {
        try {
          const calcPayload = {
            details: {
              isOnlyMetalDesign,
              Metal: newEntry.Metal,
              Stones: mergedStones,
              Loss: newEntry.Loss,
              Labour: newEntry.Labour,
              ExtraCharges: newEntry.ExtraCharges,
              UndercutPrice: newEntry.UndercutPrice,
              NaturalDuties: newEntry.NaturalDuties,
              LabDuties: newEntry.LabDuties,
              GoldDuties: newEntry.GoldDuties,
              SilverAndLabsDuties: newEntry.SilverAndLabsDuties,
              LossAndLabourDuties: newEntry.LossAndLabourDuties,
              Quantity: fullEnquiry?.Quantity || 1,
            },
            clientId: clientIdResolved,
            isRecalculate: false,
            isOnlyMetalDesign,
          };
          calcResult = await calculatePricing(calcPayload).unwrap();
        } catch (_) {
          calcResult = null;
        }
      }

      if (calcResult) {
        newEntry.MetalPrice = num(calcResult.MetalPrice);
        newEntry.DiamondsPrice = num(calcResult.DiamondsPrice);
        newEntry.DutiesAmount = num(calcResult.DutiesAmount);
        newEntry.TotalPrice = num(calcResult.TotalPrice);
        newEntry.DiamondWeight = num(calcResult.DiamondWeight);
        newEntry.TotalPieces = num(calcResult.TotalPieces);
        newEntry.TotalMetalWeight = num(calcResult.TotalMetalWeight);
        newEntry.ClientPricingMessage =
          calcResult.ClientPricingMessage || newEntry.ClientPricingMessage;
      } else {
        newEntry.MetalPrice = num(sp.MetalPrice ?? 0);
        newEntry.DiamondsPrice = num(sp.DiamondsPrice ?? 0);
        newEntry.DutiesAmount = num(sp.DutiesAmount ?? 0);
        newEntry.TotalPrice = num(sp.TotalPrice ?? 0);
        newEntry.DiamondWeight = num(sp.DiamondWeight ?? 0);
        newEntry.TotalPieces = num(sp.TotalPieces ?? 0);
      }

      const existingPricing = Array.isArray(latestDesign?.Pricing)
        ? latestDesign.Pricing
        : latestDesign?.Pricing
        ? [latestDesign.Pricing]
        : [];
      const cleanExisting = existingPricing.map(p => {
        const { _id, ...rest } = p || {};
        return rest;
      });

      await updateAssetData({
        enquiryId: resolvedEnquiryId,
        type: latestDesign._type,
        version: String(latestDesign.Version),
        data: {
          Pricing: [...cleanExisting, newEntry],
          IsOnlyMetalDesign: isOnlyMetalDesign,
        },
      }).unwrap();

      setShowAddEntryModal(false);
      setReseedToken(t => t + 1);
      await refetchEnquiry();
      showAlert('Added', 'New quotation added successfully.', 'success', [
        { text: 'OK' },
      ]);
    } catch (e) {
      showAlert(
        'Failed',
        e?.data?.message || 'Could not add quotation. Please try again.',
        'error',
        [{ text: 'OK' }],
      );
    } finally {
      setIsAddingEntry(false);
    }
  }, [
    isAddingEntry,
    fullEnquiry,
    sourcePricing,
    metalPricesData,
    addStoneType,
    addMetalQuality,
    clientIdResolved,
    calculatePricing,
    updateAssetData,
    refetchEnquiry,
    showAlert,
  ]);

  const handleDeleteEntry = useCallback(
    idx => {
      if (pricingEntriesRef.current.length <= 1) {
        showAlert(
          'Cannot Delete',
          'At least one quotation is required.',
          'info',
          [{ text: 'OK' }],
        );
        return;
      }
      showAlert('Delete Quotation', 'Remove this quotation?', 'info', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const remaining = pricingEntriesRef.current.filter(
              (_, i) => i !== idx,
            );
            const stillHasDefault = remaining.some(e => e.isSentForApproaval);
            const cleaned = remaining.map((e, i) => ({
              ...e,
              isSentForApproaval: stillHasDefault
                ? e.isSentForApproaval
                : i === 0,
            }));
            pricingEntriesRef.current = cleaned;
            setPricingEntries(cleaned);
            setActiveEntryIndex(prev => Math.min(prev, cleaned.length - 1));

            const enq = fullEnquiryRef.current || {};
            const pool = [
              ...(Array.isArray(enq?.Cad)
                ? enq.Cad.map(e => ({ ...e, _type: 'cad' }))
                : []),
              ...(Array.isArray(enq?.Coral)
                ? enq.Coral.map(e => ({ ...e, _type: 'coral' }))
                : []),
            ];
            pool.sort(
              (a, b) =>
                new Date(b.CreatedDate || 0) - new Date(a.CreatedDate || 0),
            );
            const latestDesign = pool[0];
            const resolvedId = enq?._id || enq?.id || enq?.Id;
            if (!resolvedId || !latestDesign?.Version) return;

            const pricingData = cleaned.map(entryToPricing);
            try {
              await savePricing({
                enquiryId: resolvedId,
                designType: latestDesign._type,
                version: latestDesign.Version,
                pricingData,
                isOnlyMetalDesign: pricingData.every(
                  p => p.isOnlyMetalDesign === true,
                ),
              }).unwrap();
              setReseedToken(t => t + 1);
              await refetchEnquiry();
            } catch (err) {
              console.warn(
                '[QuotationModal][deleteEntry] failed',
                err?.status,
                err?.data?.message || err?.message,
              );
              showAlert(
                'Delete Failed',
                'Could not delete quotation. Please try again.',
                'error',
                [{ text: 'OK' }],
              );
            }
          },
        },
      ]);
    },
    [showAlert, entryToPricing, savePricing, refetchEnquiry],
  );

  const handleViewPricing = useCallback(
    idx => {
      const entry = pricingEntries[idx];
      if (!entry) return;

      const resolvedEnquiryId =
        fullEnquiry?._id || fullEnquiry?.id || fullEnquiry?.Id;
      const modClientId = fullEnquiry?.ClientId || fullEnquiry?.clientId;

      const pool = [
        ...(Array.isArray(fullEnquiry?.Cad)
          ? fullEnquiry.Cad.map(e => ({ ...e, _type: 'cad' }))
          : []),
        ...(Array.isArray(fullEnquiry?.Coral)
          ? fullEnquiry.Coral.map(e => ({ ...e, _type: 'coral' }))
          : []),
      ];
      pool.sort(
        (a, b) => new Date(b.CreatedDate || 0) - new Date(a.CreatedDate || 0),
      );
      const latestDesign = pool[0];
      if (!resolvedEnquiryId || !latestDesign?.Version) {
        showAlert('Error', 'No design version found to preview.', 'error', [
          { text: 'OK' },
        ]);
        return;
      }

      const merged = (entry.stones || []).map(d => ({
        Type: d.Type || '',
        Color: d.Color || '',
        Shape: d.Shape || '',
        MmSize: String(d.MmSize ?? '0'),
        SieveSize: String(d.SieveSize || '0'),
        CtWeight: num(d.Carat),
        Weight: num(d.Weight),
        Pcs: Math.round(num(d.Pcs)),
        Price: num(d.Price),
        Markup: num(d.Markup),
      }));

      const ounceVal = num(entry.metalOunce);
      const result = entry.result || {};
      const previewEntry = {
        ...result,
        MetalKT: entry.metalQuality,
        Metal: {
          Weight: num(entry.metalWeight),
          Quality: entry.metalQuality,
          Rate: num(entry.metalRate),
          ...(ounceVal > 0 ? { GoldRatePerOunce: ounceVal } : {}),
        },
        Stones: merged.filter(st => st.Type),
      };

      navigatingToPreviewRef.current = true;
      setNavigatingToPreview(true);
      navigation.navigate('PricingPreview', {
        pricingEntries: [previewEntry],
        clientName: resolvedClientName,
        metalKt: entry.metalQuality,
        modify: true,
        clientId: modClientId,
        selectedClient: { name: resolvedClientName },
        isEnquiry: true,
        enquiryId: resolvedEnquiryId,
        designType: latestDesign._type,
        version: latestDesign.Version,
        clientMessage: entry.clientMsg,
        preservedPricing: sourcePricingList,
        activePricingIndex: idx,
      });
    },
    [
      pricingEntries,
      fullEnquiry,
      resolvedClientName,
      navigation,
      showAlert,
      sourcePricingList,
    ],
  );

  const handleSetDefault = useCallback(
    idx => {
      const target = pricingEntriesRef.current[idx];
      if (!target || target.isSentForApproaval) return;
      const updated = pricingEntriesRef.current.map((en, i) => ({
        ...en,
        isSentForApproaval: i === idx,
      }));
      pricingEntriesRef.current = updated;
      setPricingEntries(updated);

      const enq = fullEnquiryRef.current || {};
      const pool = [
        ...(Array.isArray(enq?.Cad)
          ? enq.Cad.map(e => ({ ...e, _type: 'cad' }))
          : []),
        ...(Array.isArray(enq?.Coral)
          ? enq.Coral.map(e => ({ ...e, _type: 'coral' }))
          : []),
      ];
      pool.sort(
        (a, b) => new Date(b.CreatedDate || 0) - new Date(a.CreatedDate || 0),
      );
      const latestDesign = pool[0];
      const resolvedId = enq?._id || enq?.id || enq?.Id;
      if (!resolvedId || !latestDesign?.Version) return;

      const pricingData = updated.map(entryToPricing);
      savePricing({
        enquiryId: resolvedId,
        designType: latestDesign._type,
        version: latestDesign.Version,
        pricingData,
        isOnlyMetalDesign: pricingData.every(p => p.isOnlyMetalDesign === true),
      })
        .unwrap()
        .catch(err =>
          console.warn(
            '[QuotationModal][setDefault] failed',
            err?.status,
            err?.data?.message || err?.message,
          ),
        );
    },
    [entryToPricing, savePricing],
  );

  const clientStoneTypes = useMemo(() => {
    const raw =
      clientData?.ApplicableStoneTypes ||
      clientData?.applicableStoneTypes ||
      [];
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return raw.filter(Boolean);
  }, [clientData]);

  const renderAddEntryModal = () => {
    if (!showAddEntryModal) return null;
    return (
      <View style={s.pickerAbsOverlay}>
        <TouchableOpacity
          style={s.pickerOverlay}
          activeOpacity={1}
          onPress={() => {
            if (!isAddingEntry) setShowAddEntryModal(false);
          }}
        >
          <TouchableOpacity activeOpacity={1} style={s.pickerSheet}>
            <Text style={s.pickerTitle}>Add New Quotation</Text>

            {clientStoneTypes.length > 0 && (
              <>
                <Text style={s.pickerSectionLabel}>Stone Type</Text>
                <View style={s.addEntryChipWrap}>
                  {clientStoneTypes.map(type => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        s.addEntryChip,
                        addStoneType === type && s.addEntryChipSelected,
                      ]}
                      onPress={() =>
                        setAddStoneType(addStoneType === type ? '' : type)
                      }
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          s.addEntryChipText,
                          addStoneType === type && s.addEntryChipTextSelected,
                        ]}
                      >
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={s.pickerSectionLabel}>Metal Quality</Text>
            <View style={s.addEntryChipWrap}>
              {METAL_QUALITY_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt}
                  style={[
                    s.addEntryChip,
                    addMetalQuality === opt && s.addEntryChipSelected,
                  ]}
                  onPress={() => setAddMetalQuality(opt)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      s.addEntryChipText,
                      addMetalQuality === opt && s.addEntryChipTextSelected,
                    ]}
                  >
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.addEntryBtnRow}>
              <TouchableOpacity
                style={[s.addEntryBtn, s.addEntryBtnCancel]}
                onPress={() => setShowAddEntryModal(false)}
                activeOpacity={0.8}
                disabled={isAddingEntry}
              >
                <Text style={s.addEntryBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.addEntryBtn, s.addEntryBtnConfirm]}
                onPress={handleConfirmAddEntry}
                activeOpacity={0.85}
                disabled={isAddingEntry}
              >
                {isAddingEntry ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={s.addEntryBtnConfirmText}>Add Quotation</Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </View>
    );
  };

  const renderQRPhase = () => (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.header}>
              <View style={{ flex: 1 }}>
                <Text style={s.headerTitle} numberOfLines={1}>
                  View Quotation
                </Text>
                {fullEnquiry?.Name ? (
                  <Text style={s.headerSub} numberOfLines={1}>
                    {fullEnquiry.Name}
                  </Text>
                ) : null}
              </View>
              {isFetchingEnquiry && (
                <ActivityIndicator
                  size="small"
                  color="#fff"
                  style={{ marginRight: 6 }}
                />
              )}
              <TouchableOpacity
                style={s.headerAddBtn}
                onPress={handleAddEntry}
                activeOpacity={0.8}
              >
                <Icon name="add" size={16} color={colors.primary} />
                <Text style={s.headerAddBtnText}>Add New Quotation</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.closeBtn}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <Icon name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={s.scrollBody}
              contentContainerStyle={s.scrollContent}
              showsVerticalScrollIndicator={false}
              refreshControl={pullRefreshControl}
            >
              {isAutoRecalculating && (
                <View style={s.recalcBanner}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={s.recalcBannerText}>Recalculating pricing</Text>
                </View>
              )}

              {pricingEntries.map((entry, idx) => {
                const stoneTypes = [
                  ...new Set(
                    (entry.stones || []).map(s => s.Type).filter(Boolean),
                  ),
                ];
                const typeLabel =
                  stoneTypes.length > 0 ? stoneTypes.join(', ') : 'METAL ONLY';
                const result = entry.result || {};
                const totalPrice = num(result.TotalPrice);
                const stoneCount = (entry.stones || []).length;
                const hasMissing = (entry.missingIndices?.size || 0) > 0;
                const defaultIdx = (() => {
                  const di = pricingEntries.findIndex(
                    e => e.isSentForApproaval,
                  );
                  return di >= 0 ? di : 0;
                })();
                const isApprovalCard = idx === defaultIdx;

                return (
                  <TouchableOpacity
                    key={entry.id}
                    activeOpacity={0.9}
                    onPress={() => handleSetDefault(idx)}
                    style={[s.entryCard, isApprovalCard && s.entryCardActive]}
                  >
                    {isApprovalCard ? (
                      <View style={s.defaultBadge}>
                        <Icon name="check-circle" size={14} color="#059669" />
                        <Text style={s.defaultBadgeText}>
                          Default quote this is the one sent to the client
                        </Text>
                      </View>
                    ) : (
                      <Text style={s.setDefaultHint}>
                        Tap this card to make it the default quote sent to the
                        client
                      </Text>
                    )}
                    <View style={s.entryCardHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={s.entryCardTypeRow}>
                          <Icon
                            name={stoneCount > 0 ? 'diamond' : 'hardware'}
                            size={16}
                            color={colors.primary}
                          />
                          <Text style={s.entryCardType} numberOfLines={1}>
                            {typeLabel}
                          </Text>
                        </View>
                        <Text style={s.entryCardMetal}>
                          {entry.metalQuality || '10K'} {stoneCount} stone
                          {stoneCount !== 1 ? 's' : ''}
                        </Text>
                      </View>
                      {hasMissing && (
                        <View style={s.entryCardMissing}>
                          <Icon name="warning" size={12} color="#DC2626" />
                          <Text style={s.entryCardMissingText}>Missing</Text>
                        </View>
                      )}
                    </View>

                    <View style={s.entryCardPriceRow}>
                      <View style={s.entryCardPriceItem}>
                        <Text style={s.entryCardPriceLabel}>Metal Price</Text>
                        <Text style={s.entryCardPriceVal}>
                          ${num(result.MetalPrice).toFixed(0)}
                        </Text>
                      </View>
                      <View
                        style={[
                          s.entryCardPriceItem,
                          { borderLeftWidth: 1, borderLeftColor: '#E0E0E0' },
                        ]}
                      >
                        <Text style={s.entryCardPriceLabel}>Diamond Price</Text>
                        <Text style={s.entryCardPriceVal}>
                          ${num(result.DiamondsPrice).toFixed(0)}
                        </Text>
                      </View>
                      <View
                        style={[
                          s.entryCardPriceItem,
                          { borderLeftWidth: 1, borderLeftColor: '#E0E0E0' },
                        ]}
                      >
                        <Text style={s.entryCardPriceLabel}>Total Price</Text>
                        <Text
                          style={[
                            s.entryCardPriceVal,
                            { color: colors.primary, fontWeight: '700' },
                          ]}
                        >
                          ${totalPrice.toFixed(0)}
                        </Text>
                      </View>
                    </View>

                    {entry.clientMsg || result.ClientPricingMessage ? (
                      <View style={s.entryCardMsgBox}>
                        <View style={s.entryCardMsgHeader}>
                          <Text style={s.entryCardMsgLabel}>
                            Client Pricing Message
                          </Text>
                          <TouchableOpacity
                            style={s.entryCardCopyBtn}
                            onPress={() =>
                              handleCopyCardMsg(
                                idx,
                                entry.clientMsg || result.ClientPricingMessage,
                              )
                            }
                            activeOpacity={0.8}
                          >
                            <Icon
                              name={
                                copiedCardIdx === idx ? 'check' : 'content-copy'
                              }
                              size={13}
                              color={
                                copiedCardIdx === idx
                                  ? '#059669'
                                  : colors.primary
                              }
                            />
                            <Text
                              style={[
                                s.entryCardCopyText,
                                copiedCardIdx === idx && { color: '#059669' },
                              ]}
                            >
                              {copiedCardIdx === idx ? 'Copied!' : 'Copy'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                        <Text style={s.entryCardMsgText}>
                          {entry.clientMsg || result.ClientPricingMessage}
                        </Text>
                      </View>
                    ) : null}

                    <TouchableOpacity
                      style={s.entryCardViewBtn}
                      onPress={() => handleViewPricing(idx)}
                      activeOpacity={0.8}
                    >
                      <Icon name="visibility" size={16} color="#fff" />
                      <Text style={s.entryCardViewBtnText}>View Pricing</Text>
                      <Icon name="chevron-right" size={18} color="#fff" />
                    </TouchableOpacity>

                    {pricingEntries.length > 1 && (
                      <TouchableOpacity
                        style={s.entryCardDeleteBtn}
                        onPress={() => handleDeleteEntry(idx)}
                        activeOpacity={0.8}
                      >
                        <Icon
                          name="delete-outline"
                          size={16}
                          color={colors.error || '#EF4444'}
                        />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                style={[s.calcBtn, { backgroundColor: '#7C3AED' }]}
                onPress={handleCompareImages}
                activeOpacity={0.85}
              >
                <Icon name="compare" size={18} color="#fff" />
                <Text style={s.calcBtnText}>Compare Images</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>

        <CompareRefrences
          visible={showCompareModal}
          onClose={() => setShowCompareModal(false)}
          fullEnquiry={fullEnquiry}
          isFetchingEnquiry={isFetchingEnquiry}
        />

        <BrandedAlert
          visible={alertCfg.visible}
          title={alertCfg.title}
          message={alertCfg.message}
          type={alertCfg.type}
          buttons={alertCfg.buttons}
          onClose={hideAlert}
        />
        {renderQualityPicker()}
        {renderAddEntryModal()}
      </>
    </Modal>
  );

  const renderUpdateQuotation = () => (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.header}>
              <View style={{ flex: 1 }}>
                <Text style={s.headerTitle} numberOfLines={1}>
                  Update Quotation
                </Text>
                {fullEnquiry?.Name ? (
                  <Text style={s.headerSub} numberOfLines={1}>
                    {fullEnquiry.Name}
                  </Text>
                ) : null}
              </View>
              {isFetchingEnquiry && (
                <ActivityIndicator
                  size="small"
                  color="#fff"
                  style={{ marginRight: 6 }}
                />
              )}
              <TouchableOpacity
                style={s.closeBtn}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <Icon name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={s.recalcBar}>
              <TouchableOpacity
                style={[s.recalcAllBtn, !canRecalculateAll && { opacity: 0.4 }]}
                onPress={() => handleRecalculateAll({ force: true })}
                disabled={
                  !canRecalculateAll || isCalculating || isAutoRecalculating
                }
                activeOpacity={0.85}
              >
                {isCalculating || isAutoRecalculating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Icon name="calculate" size={18} color="#fff" />
                    <Text style={s.recalcAllBtnText}>
                      {canRecalculateAll
                        ? 'Recalculate'
                        : 'Fill all missing details to recalculate'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <ScrollView
              style={s.scrollBody}
              contentContainerStyle={s.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              refreshControl={pullRefreshControl}
            >
              {isAutoRecalculating && (
                <View style={s.recalcBanner}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={s.recalcBannerText}>Recalculating pricing</Text>
                </View>
              )}

              {pricingEntries.map((entry, idx) => {
                const stoneTypes = [
                  ...new Set(
                    (entry.stones || []).map(s => s.Type).filter(Boolean),
                  ),
                ];
                const typeLabel =
                  stoneTypes.length > 0 ? stoneTypes.join(', ') : 'METAL ONLY';
                const stoneCount = (entry.stones || []).length;
                const entryMissingStones = (entry.stones || []).some((d, i) => {
                  if (!entry.missingIndices?.has(i)) return false;
                  const ep =
                    entry.editedPrices?.[i] !== undefined
                      ? num(entry.editedPrices[i])
                      : num(d.Price);
                  return ep <= 0;
                });
                const entryMissingMetal =
                  num(entry.metalWeight) <= 0 || num(entry.metalRate) <= 0;

                return (
                  <View key={entry.id} style={s.entryEditCard}>
                    <View style={s.entryEditHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={s.entryCardTypeRow}>
                          <Icon
                            name={stoneCount > 0 ? 'diamond' : 'hardware'}
                            size={16}
                            color={colors.primary}
                          />
                          <Text style={s.entryCardType} numberOfLines={1}>
                            {typeLabel}
                          </Text>
                        </View>
                        <Text style={s.entryCardMetal}>
                          {entry.metalQuality || '10K'}
                          {stoneCount} stone{stoneCount !== 1 ? 's' : ''}
                        </Text>
                      </View>

                      {pricingEntries.length > 1 && (
                        <TouchableOpacity
                          style={s.entryCardDeleteBtn}
                          onPress={() => handleDeleteEntry(idx)}
                          activeOpacity={0.8}
                        >
                          <Icon
                            name="delete-outline"
                            size={16}
                            color={colors.error || '#EF4444'}
                          />
                        </TouchableOpacity>
                      )}
                    </View>

                    <View
                      style={[
                        s.metalSection,
                        entryMissingStones &&
                          entryMissingMetal &&
                          s.metalSectionMissing,
                      ]}
                    >
                      <Text style={s.sectionTitle}>Metal</Text>
                      <View style={s.metalRow}>
                        <View style={s.metalField}>
                          <Text style={s.chargeLabel}>Weight (g)</Text>
                          <TextInput
                            ref={node => {
                              const key = `${entry.id}:metalWeight`;
                              if (node) inputRefs.current[key] = node;
                              else delete inputRefs.current[key];
                            }}
                            style={[
                              s.chargeInput,
                              num(entry.metalWeight) <= 0 &&
                                s.inputErrorHighlight,
                            ]}
                            value={entry.metalWeight}
                            onChangeText={v =>
                              onEntryMetalChange(idx, 'metalWeight', v)
                            }
                            onSubmitEditing={focusNextMissingField}
                            onFocus={() => {
                              activeIdxRef.current = idx;
                              setActiveEntryIndex(idx);
                            }}
                            keyboardType="decimal-pad"
                            returnKeyType="next"
                            blurOnSubmit={false}
                            placeholder="0"
                            placeholderTextColor={colors.textSecondary}
                          />
                        </View>
                        <View style={s.metalField}>
                          <Text style={s.chargeLabel}>Quality</Text>
                          <TouchableOpacity
                            style={s.qualityBtn}
                            onPress={() => {
                              setQualityPickerIdx(idx);
                              setShowQualityPicker(true);
                            }}
                            activeOpacity={0.8}
                          >
                            <Text style={s.qualityBtnText}>
                              {entry.metalQuality || '10K'}
                            </Text>
                            <Icon
                              name="arrow-drop-down"
                              size={18}
                              color={colors.textSecondary}
                            />
                          </TouchableOpacity>
                        </View>
                        <View style={s.metalField}>
                          <Text style={s.chargeLabel}>24K Rate ($/g)</Text>
                          <TextInput
                            ref={node => {
                              const key = `${entry.id}:metalRate`;
                              if (node) inputRefs.current[key] = node;
                              else delete inputRefs.current[key];
                            }}
                            style={[
                              s.chargeInput,
                              num(entry.metalRate) <= 0 &&
                                s.inputErrorHighlight,
                            ]}
                            value={entry.metalRate}
                            onChangeText={v =>
                              onEntryMetalChange(idx, 'metalRate', v)
                            }
                            onSubmitEditing={focusNextMissingField}
                            onFocus={() => {
                              activeIdxRef.current = idx;
                              setActiveEntryIndex(idx);
                            }}
                            keyboardType="decimal-pad"
                            returnKeyType="next"
                            blurOnSubmit={false}
                            placeholder="0"
                            placeholderTextColor={colors.textSecondary}
                          />
                        </View>
                        <View style={s.metalField}>
                          <Text style={s.chargeLabel}>Per Ounce ($)</Text>
                          <TextInput
                            style={s.chargeInput}
                            value={entry.metalOunce}
                            onChangeText={v =>
                              onEntryMetalChange(idx, 'metalOunce', v)
                            }
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={colors.textSecondary}
                          />
                        </View>
                      </View>
                    </View>

                    {entryMissingStones ? (
                      <View style={s.warningBanner}>
                        <Icon name="warning" size={15} color="#92400E" />
                        <Text style={s.warningText}>
                          Stone prices are missing â€” fill them in below to
                          calculate pricing.
                        </Text>
                      </View>
                    ) : (
                      <View style={s.infoBanner}>
                        <Icon name="info" size={15} color={colors.primary} />
                        <Text style={s.infoText}>
                          All stones filled. Ready to calculate pricing.
                        </Text>
                      </View>
                    )}

                    {renderStonesSectionFor(entry, idx)}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>

        {renderQualityPicker()}

        <CompareRefrences
          visible={showCompareModal}
          onClose={() => setShowCompareModal(false)}
          fullEnquiry={fullEnquiry}
          isFetchingEnquiry={isFetchingEnquiry}
        />

        <BrandedAlert
          visible={alertCfg.visible}
          title={alertCfg.title}
          message={alertCfg.message}
          type={alertCfg.type}
          buttons={alertCfg.buttons}
          onClose={hideAlert}
        />
      </>
    </Modal>
  );

  if (navigatingToPreview) return null;

  const allEntriesComplete =
    pricingEntries.length > 0 && pricingEntries.every(e => isEntryComplete(e));

  return (
    <>
      {isQRPhase || allEntriesComplete
        ? renderQRPhase()
        : renderUpdateQuotation()}
    </>
  );
};

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '93%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.primary,
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: fonts.base || 15,
    color: '#fff',
  },
  headerSub: {
    fontFamily: fonts.regular,
    fontSize: fonts.xs || 11,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 1,
  },
  stepChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  stepChipText: {
    fontFamily: fonts.medium,
    fontSize: fonts.xs || 11,
    color: colors.primary,
  },
  closeBtn: { padding: 4 },
  headerAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  headerAddBtnText: { color: colors.primary, fontSize: 12, fontWeight: '700' },

  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 40,
    gap: 0,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || '#F0F0F0',
    position: 'relative',
  },
  stepLine: {
    position: 'absolute',
    top: '50%',
    left: '30%',
    right: '30%',
    height: 1,
    backgroundColor: colors.borderLight || '#E0E0E0',
    zIndex: 0,
  },
  stepItem: { flex: 1, alignItems: 'center', gap: 4, zIndex: 1 },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.borderLight || '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: colors.primary },
  stepDotDone: { backgroundColor: '#059669' },
  stepDotText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.textSecondary,
  },
  stepDotTextActive: { color: '#fff' },
  stepLabel: {
    fontFamily: fonts.regular,
    fontSize: fonts.xs || 11,
    color: colors.textSecondary,
  },
  stepLabelActive: { fontFamily: fonts.medium, color: colors.primary },

  scrollBody: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  warningText: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: '#92400E',
    lineHeight: 20,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primary + '15',
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  infoText: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: colors.primary,
    lineHeight: 20,
  },

  recalcBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primary + '15',
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  recalcBannerText: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: colors.primary,
    lineHeight: 20,
  },

  recalcBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || '#E8E8E8',
    backgroundColor: colors.background,
  },
  recalcAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 12,
  },
  recalcAllBtnText: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 14,
    color: '#fff',
  },

  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
    marginBottom: 8,
    marginTop: 4,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 4,
  },

  metalRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  metalField: { flex: 1 },

  chargesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  chargeItem: { width: '47%' },
  chargeLabel: {
    fontFamily: fonts.medium,
    fontSize: fonts.xs || 11,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  chargeInput: {
    borderWidth: 1,
    borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontFamily: fonts.regular,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  inputError: { borderColor: colors.error || '#EF4444', borderWidth: 1.5 },
  inputErrorHighlight: { borderColor: '#DC2626', borderWidth: 1.5 },

  metalSection: { marginBottom: 8 },
  metalSectionMissing: {
    borderWidth: 1.5,
    borderColor: '#DC2626',
    borderRadius: 10,
    padding: 8,
  },

  missingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#DC2626',
  },
  missingBadgeText: {
    fontFamily: fonts.bold,
    fontSize: fonts.xs || 12,
    color: '#DC2626',
  },

  recalcBtnDisabled: { opacity: 0.4 },

  stoneTable: {
    borderWidth: 1,
    borderColor: colors.borderLight || '#E8E8E8',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: colors.white,
  },
  stoneTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  stoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight || '#F0F0F0',
  },
  stoneRowAlt: { backgroundColor: colors.backgroundSecondary || '#F8F8F8' },
  stoneRowMissing: {
    borderWidth: 1.5,
    borderColor: '#DC2626',
    backgroundColor: '#FEF2F2',
  },

  stoneCol: { textAlign: 'center' },
  stoneColType: { flex: 2.5, textAlign: 'left' },
  stoneColShape: { flex: 2, textAlign: 'left' },
  stoneColNum: { flex: 1.2 },
  stoneColPrice: { flex: 1.8 },
  stoneColActions: {
    width: 74,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  inlinePriceInput: {
    borderWidth: 1.5,
    borderColor: '#DC2626',
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    textAlign: 'left',
  },
  inlineActionBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  stoneTh: { fontFamily: fonts.bold, fontSize: 11, color: '#fff' },
  stoneTd: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textPrimary,
  },
  stonePriceMissing: { color: colors.error || '#EF4444', fontWeight: 'bold' },

  stoneAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight || '#F0F0F0',
  },
  stoneAddRowText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.primary,
  },

  emptyStones: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 10,
    marginBottom: 16,
  },
  emptyStonesText: {
    fontFamily: fonts.regular,
    fontSize: fonts.sm || 13,
    color: colors.textSecondary,
  },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  addBtnText: {
    fontFamily: fonts.medium,
    fontSize: fonts.xs || 12,
    color: '#fff',
  },

  calcBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 16,
  },
  calcBtnDisabled: { opacity: 0.5 },
  calcBtnText: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 14,
    color: '#fff',
  },

  resultCard: {
    backgroundColor: colors.backgroundSecondary || '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.borderLight || '#E8E8E8',
  },
  resultTitle: {
    fontFamily: fonts.bold,
    fontSize: fonts.base || 15,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || '#F0F0F0',
  },
  resultLbl: {
    fontFamily: fonts.medium,
    fontSize: fonts.sm || 13,
    color: colors.textSecondary,
  },
  resultVal: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
  },
  resultTotalRow: { borderBottomWidth: 0, marginTop: 6 },
  resultTotalLbl: {
    fontFamily: fonts.bold,
    fontSize: fonts.base || 15,
    color: colors.textPrimary,
  },
  sumNote: {
    fontFamily: fonts.regular,
    fontSize: fonts.xs || 11,
    color: colors.textSecondary,
    lineHeight: 15,
    marginTop: 6,
  },
  resultTotalVal: {
    fontFamily: fonts.bold,
    fontSize: fonts.lg || 18,
    color: colors.primary,
  },
  typeResultCard: {
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.borderLight || '#E8E8E8',
  },
  typeResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 8,
    marginBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || '#F0F0F0',
  },
  typeResultTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
  },
  typeResultStats: {
    fontFamily: fonts.regular,
    fontSize: fonts.xs || 11,
    color: colors.textSecondary,
  },
  typeResultTotalLbl: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
  },
  typeResultTotalVal: {
    fontFamily: fonts.bold,
    fontSize: fonts.base || 15,
    color: colors.primary,
  },
  recapCard: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderLight || '#E8E8E8',
    marginBottom: 8,
  },
  recapTitle: {
    fontFamily: fonts.medium,
    fontSize: fonts.xs || 12,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  recapText: {
    fontFamily: fonts.regular,
    fontSize: fonts.xs || 12,
    color: colors.textPrimary,
  },

  qualityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: colors.background,
  },
  qualityBtnText: {
    fontFamily: fonts.regular,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
    flex: 1,
  },

  pickerAbsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    elevation: 1000,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  pickerTitle: {
    fontFamily: fonts.bold,
    fontSize: fonts.base || 15,
    color: colors.textPrimary,
    marginBottom: 12,
    textAlign: 'center',
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  pickerOptionSelected: { backgroundColor: colors.primary + '15' },
  pickerOptionText: {
    fontFamily: fonts.regular,
    fontSize: fonts.base || 15,
    color: colors.textPrimary,
  },
  pickerOptionTextSelected: { fontFamily: fonts.bold, color: colors.primary },

  clientMsgCard: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 12,
    padding: 14,
    backgroundColor: colors.backgroundSecondary || '#F8F9FA',
  },
  clientMsgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  clientMsgLabel: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
    flex: 1,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  copyBtnText: {
    fontFamily: fonts.medium,
    fontSize: fonts.xs || 12,
    color: colors.primary,
  },
  clientMsgInput: {
    minHeight: 100,
    borderWidth: 1,
    borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 8,
    padding: 10,
    fontFamily: fonts.regular,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  clientMsgText: {
    fontFamily: fonts.regular,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
    lineHeight: 20,
    marginTop: 4,
  },
  msgTypeBlock: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight || '#E8E8E8',
  },
  msgTypeLabel: {
    fontFamily: fonts.bold,
    fontSize: fonts.xs || 11,
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  entryCard: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.borderLight || '#E0E0E0',
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 5,
  },
  entryCardActive: {
    borderColor: '#059669',
    borderWidth: 2,
    backgroundColor: '#F0FDF4',
  },
  defaultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#DCFCE7',
    borderBottomWidth: 1,
    borderBottomColor: '#BBF7D0',
  },
  defaultBadgeText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
  },
  setDefaultHint: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#FEF2F2',
    borderBottomWidth: 1,
    borderBottomColor: '#FECACA',
    fontSize: 11,
    fontWeight: '600',
    color: '#DC2626',
  },
  entryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingBottom: 10,
  },
  entryCardMsgBox: {
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.backgroundSecondary || '#F8F9FA',
    borderWidth: 1,
    borderColor: colors.borderLight || '#E0E0E0',
  },
  entryCardMsgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  entryCardMsgLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary || '#6B7280',
  },
  entryCardCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderLight || '#E0E0E0',
  },
  entryCardCopyText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  entryCardMsgText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textPrimary,
  },
  entryCardTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  entryCardType: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
    flex: 1,
  },
  entryCardMetal: {
    fontFamily: fonts.regular,
    fontSize: fonts.xs || 11,
    color: colors.textSecondary,
  },
  entryCardMissing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DC2626',
  },
  entryCardMissingText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: '#DC2626',
  },
  entryCardPriceRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight || '#F0F0F0',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || '#F0F0F0',
  },
  entryCardPriceItem: {
    flex: 1,
    alignItems: 'center',
  },
  entryCardPriceLabel: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  entryCardPriceVal: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
  },
  entryCardViewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 12,
  },
  entryCardViewBtnText: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: '#fff',
    textAlign: 'center',
  },
  entryCardDeleteBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
  },

  entryEditCard: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderLight || '#E0E0E0',
    marginBottom: 14,
    padding: 14,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 5,
  },
  entryEditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },

  entryNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 14,
    backgroundColor: colors.backgroundSecondary || '#F8F8F8',
    borderRadius: 10,
    padding: 6,
  },
  entryNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryNavBtnDisabled: { opacity: 0.4 },
  entryNavTabs: {
    flex: 1,
  },
  entryNavTabsContent: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  entryNavTab: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  entryNavTabActive: {
    backgroundColor: colors.primary,
  },
  entryNavTabText: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.textSecondary,
  },
  entryNavTabTextActive: {
    color: '#fff',
    fontWeight: '700',
  },

  pickerSectionLabel: {
    fontFamily: fonts.semibold,
    fontSize: fonts.sm || 12,
    color: colors.textSecondary,
    marginTop: 14,
    marginBottom: 8,
  },
  addEntryChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  addEntryChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.backgroundSecondary || '#F3F4F6',
    borderWidth: 1,
    borderColor: colors.border || '#E5E7EB',
  },
  addEntryChipSelected: {
    backgroundColor: colors.primary + '18',
    borderColor: colors.primary,
  },
  addEntryChipText: {
    fontFamily: fonts.medium,
    fontSize: fonts.sm || 12,
    color: colors.textPrimary,
  },
  addEntryChipTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  addEntryBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  addEntryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addEntryBtnCancel: {
    backgroundColor: colors.backgroundSecondary || '#F3F4F6',
  },
  addEntryBtnCancelText: {
    fontFamily: fonts.medium,
    fontSize: fonts.base || 15,
    color: colors.textSecondary,
  },
  addEntryBtnConfirm: {
    backgroundColor: colors.primary,
  },
  addEntryBtnConfirmText: {
    fontFamily: fonts.semibold,
    fontSize: fonts.base || 15,
    color: '#fff',
  },
});

export default QuotationModal;
