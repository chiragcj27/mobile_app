/**
 * QuotationModal
 *
 * Full quotation flow in a single bottom-sheet modal:
 *   1. Pre-fills metal + charges + stones from the enquiry's latest Coral/CAD pricing
 *   2. If stones are missing / all have Price=0 → user fills them (same DiamondRow UI as ClientPricingScreen)
 *   3. Calculate button → calls calculatePricing API
 *   4. Result summary + inline HTML PDF viewer + Share PDF
 *
 * Usage:
 *   <QuotationModal
 *     visible={show}
 *     enquiry={enquiryObject}   // full enquiry from getEnquiryById
 *     onClose={() => setShow(false)}
 *   />
 */

import React, {
  useState, useEffect, useCallback, useMemo, useRef,
} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView,
  TextInput, ActivityIndicator, Platform, Animated, Keyboard,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import Icon from '../common/Icon';
import PdfViewer from '../common/PdfViewer';
import BrandedAlert from '../common/BrandedAlert';
// import DiamondEditModal from '../../screens/Admin/components/DiamondEditModal';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import {
  useCalculatePricingMutation,
  useGetMetalPricesQuery,
  useSavePricingMutation,
  useGetEnquiryByIdQuery,
  useGetClientByIdQuery,
} from '../../store/api';
import { LOGO_BASE64, buildCombinedHtml } from '../../screens/Pricing/previewScreen';
import { normalizeExtraCharges, extraChargesValue, extraChargesType } from '../../utils/extraCharges';
import CompareRefrences from './CompareRefrences';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

const hapticOptions = { enableVibrateFallback: true, ignoreAndroidSystemSettings: true };
const triggerHaptic = (type = 'impactMedium') =>
  ReactNativeHapticFeedback.trigger(type, hapticOptions);

const METAL_QUALITY_OPTIONS = ['10K', '14K', '18K', '22K', 'Silver 925', 'Platinum'];

let generatePDFModule = null;
try {
  const mod = require('react-native-html-to-pdf');
  generatePDFModule = mod.generatePDF || mod.default?.generatePDF || mod.default;
} catch (_) {}

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
let _idSeed = 0;
const makeId = () => `d-${Date.now()}-${_idSeed++}`;

const getLatestPricing = (enquiry) => {
  const pool = [
    ...(Array.isArray(enquiry?.Cad)   ? enquiry.Cad   : []),
    ...(Array.isArray(enquiry?.Coral) ? enquiry.Coral : []),
  ];
  if (!pool.length) return null;
  pool.sort((a, b) => new Date(b.CreatedDate || 0) - new Date(a.CreatedDate || 0));
  const pricing = pool[0]?.Pricing || pool[0]?.pricing;
  if (!pricing) return null;
  if (Array.isArray(pricing)) return pricing[0] || null;
  if (typeof pricing === 'object' && Object.keys(pricing).length > 0) return pricing;
  return null;
};

const stonesAreMissing = (stones) =>
  !Array.isArray(stones) || stones.length === 0 ||
  stones.every(s => num(s.Price) === 0);

const buildHtml = ({ pricingResult, stones, metal, charges, clientName, sourcePricing }) => {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const stoneTypes = [...new Set(stones.map(s => s.Type).filter(Boolean))];
  const diamondTypeLabel = stoneTypes.length > 0 ? stoneTypes.join(', ') : 'NATURAL';

  const stonesHtml = stones.map(s => `
    <tr style="border-bottom:1px solid #E6F0F1;">
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${s.Type || 'NATURAL'}</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${s.Shape || 'RD'}</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${s.MmSize || '-'}</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${num(s.Weight).toFixed(3)}</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${num(s.Markup || 0).toFixed(0)}</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">$${num(s.Price).toFixed(0)}</td>
      <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${s.Pcs || 0}</td>
    </tr>`).join('');

  const PR = pricingResult || {};
  const metalQuality = metal.Quality || PR.MetalKT || '';

  const hasRichData = PR.Duties && typeof PR.Duties === 'object' && Object.keys(PR.Duties).length > 0;

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
    const dutiesEntries = Object.entries(PR.Duties).filter(([, d]) => d && typeof d === 'object');
    const undercutPrice = num(PR.Client?.UndercutPrice || 0);
    const hasNaturalDuty = dutiesEntries.some(([k]) => k === 'Natural');
    const totalDutiesWithUndercut = num(PR.TotalDutiesWithUndercut);

    const dutiesHtml = dutiesEntries.length > 0 ? `
    <table style="width:100%;border-collapse:collapse;margin-top:12px;border:1px solid #E6F0F1;">
      <thead>
        <tr style="background-color:#143F45;color:#ffffff;text-align:center;font-size:10px;font-weight:700;">
          <th colspan="3" style="padding:6px;border:1px solid #0F3236;background-color:#D4AF37;color:#1A1A1A;">DUTIES BREAKDOWN</th>
        </tr>
        <tr style="background-color:#235A63;color:#ffffff;text-align:center;font-size:9px;font-weight:700;">
          <th style="padding:4px;border:1px solid #0F3236;">Duty Type</th>
          <th style="padding:4px;border:1px solid #0F3236;">Rate × Base Amount</th>
          <th style="padding:4px;border:1px solid #0F3236;">Amount</th>
        </tr>
      </thead>
      <tbody>${dutiesEntries.map(([key, duty]) => {
        const label = dutyLabels[key] || key.replace(/([A-Z])/g, ' $1').trim();
        return `
        <tr style="text-align:center;font-size:11px;">
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">${label}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">${num(duty.Rate).toFixed(0)}% × $${num(duty.BaseAmount).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">$${num(duty.Amount).toFixed(2)}</td>
        </tr>`;
      }).join('')}
        ${hasNaturalDuty && undercutPrice > 0 ? `
        <tr style="text-align:center;font-size:11px;background-color:#FFF8E1;">
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#1A1A1A;" colspan="2">Total Duties</td>
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#143F45;">$${totalDutiesWithUndercut.toFixed(2)}</td>
        </tr>` : `
        <tr style="text-align:center;font-size:11px;background-color:#FFF8E1;">
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#1A1A1A;" colspan="2">Duties Amount</td>
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#143F45;">$${num(PR.DutiesAmount).toFixed(2)}</td>
        </tr>`}
      </tbody>
    </table>` : '';

    const extraChargesHtml = num(PR.ExtraChargesPercent) > 0 || num(PR.ExtraChargesAmount) > 0 ? `
    <div style="margin-top:12px;padding:8px;background:#FFF8E1;border:1px solid #D4AF37;border-radius:4px;display:flex;justify-content:space-between;font-size:11px;font-weight:600;">
      <span>Extra Charges ${PR.ExtraChargesType === 'fixed' ? '(Fixed)' : `(${num(PR.ExtraChargesPercent).toFixed(0)}%)`}</span>
      <span>$${num(PR.ExtraChargesAmount).toFixed(2)}</span>
    </div>` : '';

   

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
          <td style="padding:10px;border:1px solid #E6F0F1;background-color:#FFF8E1;">${PR.MetalKT || metalQuality} & ${diamondTypeLabel}</td>
          <td style="padding:10px;border:1px solid #E6F0F1;">${clientName || '-'}</td>
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
          <td style="padding:6px;border:1px solid #E6F0F1;">${PR.MetalKT || metalQuality}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">$${num(PR.GoldRate24K).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">$${num(PR.GoldRateKT).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;color:#EF4444;">${num(PR.LossPercent)}%</td>
          <td style="padding:6px;border:1px solid #E6F0F1;color:#EF4444;">$${num(PR.LabourPercent).toFixed(2)}/g</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">$${num(PR.GoldAmount).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">$${num(PR.LossAmount).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">$${num(PR.LabourAmount).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;">${num(PR.GoldWeight).toFixed(1)}</td>
        </tr>
      </tbody>
    </table>

    ${stones.length ? `
    <table style="border:1px solid #E6F0F1;">
      <thead><tr><th>Type</th><th>Shape</th><th>MM</th><th>AVG CT</th><th>Markup</th><th>Rate</th><th>Qty</th></tr></thead>
      <tbody>${stonesHtml}</tbody>
    </table>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin:6px 0;flex-wrap:wrap;">
      <div style="background:#143F45;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
        <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Total Pieces</div>
        <div style="font-size:13px;font-weight:700;color:#fff;">${num(PR.TotalPieces).toFixed(0)}</div>
      </div>
      <div style="background:#143F45;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
        <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Dia Wt</div>
        <div style="font-size:13px;font-weight:700;color:#fff;">${num(PR.DiamondWeight).toFixed(3)}</div>
      </div>
      <div style="background:#D4AF37;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
        <div style="font-size:7px;color:#1A1A1A;text-transform:uppercase;letter-spacing:.05em;">Dia Price</div>
        <div style="font-size:13px;font-weight:700;color:#1A1A1A;">$${num(PR.DiamondsPrice).toFixed(0)}</div>
      </div>
    </div>` : ''}

    ${dutiesHtml}

    ${extraChargesHtml}

    <div style="display:flex;justify-content:flex-end;align-items:center;margin-top:10px;gap:8px;padding:6px 10px;background:#143F45;border-radius:6px;">
      <div style="text-align:center;flex:1;">
        <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Metal</div>
        <div style="font-size:11px;font-weight:700;color:#fff;">$${num(PR.MetalPrice).toFixed(0)}</div>
      </div>
      <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);">
        <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Dia Price</div>
        <div style="font-size:11px;font-weight:700;color:#fff;">$${num(PR.DiamondsPrice).toFixed(0)}</div>
      </div>
      <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);">
        <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Duties</div>
        <div style="font-size:11px;font-weight:700;color:#fff;">$${num(PR.DutiesAmount).toFixed(0)}</div>
      </div>
      <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);background:#D4AF37;border-radius:4px;padding:4px 6px;">
        <div style="font-size:7px;color:#1A1A1A;text-transform:uppercase;letter-spacing:.05em;">Total</div>
        <div style="font-size:13px;font-weight:800;color:#1A1A1A;">$${num(PR.TotalPrice).toFixed(0)}</div>
      </div>
    </div>
    </body></html>`;
  }

  const dutyMap = [
    { key: 'Natural',       value: num(SP.NaturalDuties) },
    { key: 'Lab',           value: num(SP.LabDuties) },
    { key: 'Gold',          value: num(SP.GoldDuties) },
    { key: 'LossAndLabour', value: num(SP.LossAndLabourDuties) },
    { key: 'SilverAndLabs', value: num(SP.SilverAndLabsDuties) },
  ].filter(({ value }) => value > 0);

  const dutiesHtml = dutyMap.length > 0 ? `
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
    <tbody>${dutyMap.map(({ key, value }) => `
      <tr style="text-align:center;font-size:11px;">
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">${dutyLabels[key] || key}</td>
        <td style="padding:6px;border:1px solid #E6F0F1;">${value}%</td>
      </tr>`).join('')}
      <tr style="text-align:center;font-size:11px;background-color:#FFF8E1;">
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#1A1A1A;">Duties Amount</td>
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#143F45;">$${num(PR.DutiesAmount).toFixed(2)}</td>
      </tr>
    </tbody>
  </table>` : '';

  const extraChargesHtml = num(PR.ExtraChargesPercent) > 0 || num(PR.ExtraChargesAmount) > 0 ? `
  <div style="margin-top:12px;padding:8px;background:#FFF8E1;border:1px solid #D4AF37;border-radius:4px;display:flex;justify-content:space-between;font-size:11px;font-weight:600;">
    <span>Extra Charges ${PR.ExtraChargesType === 'fixed' ? '(Fixed)' : `(${num(PR.ExtraChargesPercent).toFixed(0)}%)`}</span>
    <span>$${num(PR.ExtraChargesAmount).toFixed(2)}</span>
  </div>` : '';

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
        <td style="padding:10px;border:1px solid #E6F0F1;">${clientName || '-'}</td>
      </tr>
    </tbody>
  </table>

  <table>
    <thead><tr><th>KT</th><th>Metal Rate/g</th><th>Loss</th><th>Labour</th><th>Metal Weight</th></tr></thead>
    <tbody>
      <tr style="text-align:center;font-weight:600;font-size:11px;">
        <td style="padding:6px;border:1px solid #E6F0F1;">${metalQuality}</td>
        <td style="padding:6px;border:1px solid #E6F0F1;">$${num(metal.Rate).toFixed(2)}/g</td>
        <td style="padding:6px;border:1px solid #E6F0F1;color:#EF4444;">${num(charges.Loss)}%</td>
        <td style="padding:6px;border:1px solid #E6F0F1;color:#EF4444;">$${num(charges.Labour).toFixed(2)}/g</td>
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;">${num(metal.Weight).toFixed(1)}</td>
      </tr>
    </tbody>
  </table>

  ${stones.length ? `
  <table style="border:1px solid #E6F0F1;">
    <thead><tr><th>Type</th><th>Shape</th><th>MM</th><th>AVG CT</th><th>Markup</th><th>Rate</th><th>Qty</th></tr></thead>
    <tbody>${stonesHtml}</tbody>
  </table>
  <div style="display:flex;justify-content:flex-end;gap:8px;margin:6px 0;flex-wrap:wrap;">
    <div style="background:#143F45;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
      <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Total Pieces</div>
      <div style="font-size:13px;font-weight:700;color:#fff;">${num(PR.TotalPieces).toFixed(0)}</div>
    </div>
    <div style="background:#143F45;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
      <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Dia Wt</div>
      <div style="font-size:13px;font-weight:700;color:#fff;">${num(PR.DiamondWeight).toFixed(3)}</div>
    </div>
    <div style="background:#D4AF37;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
      <div style="font-size:7px;color:#1A1A1A;text-transform:uppercase;letter-spacing:.05em;">Dia Price</div>
      <div style="font-size:13px;font-weight:700;color:#1A1A1A;">$${num(PR.DiamondsPrice).toFixed(0)}</div>
    </div>
  </div>` : ''}

  ${dutiesHtml}

  ${extraChargesHtml}

  ${num(charges.UndercutPrice) > 0 ? `
  <div style="margin-top:8px;padding:8px;background:#FFF8E1;border:1px solid #D4AF37;border-radius:4px;display:flex;justify-content:space-between;font-size:11px;font-weight:600;">
    <span>Undercut Price</span><span>$${num(charges.UndercutPrice).toFixed(2)}/ct</span>
  </div>` : ''}

  <div style="display:flex;justify-content:flex-end;align-items:center;margin-top:10px;gap:8px;padding:6px 10px;background:#143F45;border-radius:6px;">
    <div style="text-align:center;flex:1;">
      <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Metal</div>
      <div style="font-size:11px;font-weight:700;color:#fff;">$${num(PR.MetalPrice).toFixed(0)}</div>
    </div>
    <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);">
      <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Dia Price</div>
      <div style="font-size:11px;font-weight:700;color:#fff;">$${num(PR.DiamondsPrice).toFixed(0)}</div>
    </div>
    <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);">
      <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.05em;">Duties</div>
      <div style="font-size:11px;font-weight:700;color:#fff;">$${num(PR.DutiesAmount).toFixed(0)}</div>
    </div>
    <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);background:#D4AF37;border-radius:4px;padding:4px 6px;">
      <div style="font-size:7px;color:#1A1A1A;text-transform:uppercase;letter-spacing:.05em;">Total</div>
      <div style="font-size:13px;font-weight:800;color:#1A1A1A;">$${num(PR.TotalPrice).toFixed(0)}</div>
    </div>
  </div>
  </body></html>`;
};

const ChargeInput = ({ label, value, onChangeText, placeholder = '0', keyboardType = 'decimal-pad' }) => (
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

export { num, getLatestPricing, buildHtml };

const QuotationModal = ({ visible, enquiryId, onClose }) => {
  const { data: fullEnquiryData, isFetching: isFetchingEnquiry } = useGetEnquiryByIdQuery(enquiryId, {
    skip: !visible || !enquiryId,
    refetchOnMountOrArgChange: true,
  });

  const rawEnquiry  = fullEnquiryData?._originalData || fullEnquiryData;
  const fullEnquiry = rawEnquiry;

  const sourcePricing = useMemo(() => getLatestPricing(fullEnquiry), [fullEnquiry]);

  const clientIdResolved = fullEnquiry?.ClientId || fullEnquiry?.clientId;
  const { data: clientData } = useGetClientByIdQuery(clientIdResolved, {
    skip: !visible || !clientIdResolved || isFetchingEnquiry,
  });
  const resolvedClientName = useMemo(() => {
    return clientData?.name || clientData?.Name || fullEnquiry?.ClientName || fullEnquiry?.clientName || '';
  }, [clientData, fullEnquiry?.ClientName, fullEnquiry?.clientName]);

  const [metalWeight,       setMetalWeight]       = useState('0');
  const [metalQuality,      setMetalQuality]      = useState('10K');
  const [metalRate,         setMetalRate]         = useState('0');
  const [metalOunce,        setMetalOunce]        = useState('0');
  const [showQualityPicker, setShowQualityPicker] = useState(false);

  const [diamonds,            setDiamonds]            = useState([]);
  const [missingIndices,      setMissingIndices]      = useState(new Set());
  // const [editModalVisible,    setEditModalVisible]    = useState(false);
  // const [selectedIndex,       setSelectedIndex]       = useState(null);
  // const [selectedDiamondData, setSelectedDiamondData] = useState({});
  const [inlineEditIndex, setInlineEditIndex] = useState(null);
  const [inlineEditPrice, setInlineEditPrice] = useState('');
  const [editedPrices, setEditedPrices] = useState({});
  const inlinePriceRef = useRef(null);

  const [pricingResult, setPricingResult] = useState(null);
  const [pdfHtml,       setPdfHtml]       = useState(null);
  const [showPdf,       setShowPdf]       = useState(false);
  const [isSharing,     setIsSharing]     = useState(false);
  const [pdfPreviewMode, setPdfPreviewMode] = useState('admin');
  // Keep the latest toggle value readable inside async recalc callbacks so a background
  // recalc rebuilds the HTML for the mode the user is actually viewing (no flip to admin).
  const pdfPreviewModeRef = useRef('admin');
  useEffect(() => { pdfPreviewModeRef.current = pdfPreviewMode; }, [pdfPreviewMode]);

  const [showCompareModal, setShowCompareModal] = useState(false);

  const [clientMsg,     setClientMsg]     = useState('');
  const [copied,        setCopied]        = useState(false);

  const initialPricing = useMemo(() => {
    if (!sourcePricing) return null;
    const mp = num(sourcePricing.MetalPrice);
    const dp = num(sourcePricing.DiamondsPrice);
    const da = num(sourcePricing.DutiesAmount);
    const tp = num(sourcePricing.TotalPrice);
    if (mp === 0 && dp === 0 && da === 0 && tp === 0) return null;
    return { MetalPrice: mp, DiamondsPrice: dp, DutiesAmount: da, TotalPrice: tp };
  }, [sourcePricing]);

  const [calculatePricing, { isLoading: isCalculating }] = useCalculatePricingMutation();
  const [savePricing,      { isLoading: isSaving }]      = useSavePricingMutation();
  const navigation = useNavigation();

  const lastHistory = useMemo(() => {
    const hist = fullEnquiry?.StatusHistory;
    if (!Array.isArray(hist) || hist.length === 0) return null;
    return hist[hist.length - 1];
  }, [fullEnquiry]);
  const currentSubStatus = fullEnquiry?.CurrentSubStatus ?? lastHistory?.SubStatus ?? null;
  const isCMPhase = currentSubStatus === 'Cost Missing';
  const isQRPhase = currentSubStatus === 'Quotation Review';

  const { data: metalPricesData } = useGetMetalPricesQuery(false);

  const [alertCfg, setAlertCfg] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  const showAlert  = useCallback((title, message, type = 'info', buttons = []) =>
    setAlertCfg({ visible: true, title, message, type, buttons }), []);
  const hideAlert  = useCallback(() => setAlertCfg(p => ({ ...p, visible: false })), []);

  const seededForRef = useRef(null);

  useEffect(() => {
    if (!visible || isFetchingEnquiry || !fullEnquiry) return;
    if (seededForRef.current === enquiryId) return;
    seededForRef.current = enquiryId;

    const p   = sourcePricing || {};
    const enq = fullEnquiry   || {};
    const mpd = metalPricesData;

    setMetalWeight(String(p.Metal?.Weight ?? 0));
    setMetalQuality(p.Metal?.Quality || enq?.Metal?.Quality || '10K');
    const autoRate = (() => {
      if (p.Metal?.Rate) return String(p.Metal.Rate);
      const prices = mpd?.prices || {};
      const q = p.Metal?.Quality || enq?.Metal?.Quality || '10K';
      if (/silver\s*925/i.test(q)) return String(prices.silver?.price ?? 0);
      if (/platinum/i.test(q))     return String(prices.platinum?.price ?? 0);
      // Send the 24K full gold rate — the backend derives the KT rate itself
      // (metalRate = goldRate * KT / 24). Sending the KT rate reduces it a second time.
      const base = prices.gold?.price || 0;
      if (base) return String(base);
      return '0';
    })();
    setMetalRate(autoRate);
    setMetalOunce(p.Metal?.Ounce != null ? String(p.Metal.Ounce) : (p.GoldRatePerOunce ? String(p.GoldRatePerOunce) : '0'));

    const rawStones = Array.isArray(p.Stones) ? p.Stones : [];
    setDiamonds(rawStones.length > 0
      ? rawStones.map(st => ({
          localId:   makeId(),
          Type:      st.Type      || '',
          Shape:     st.Shape     || '',
          Carat:     num(st.CtWeight ?? st.Carat),
          MmSize:    num(st.MmSize),
          SieveSize: st.SieveSize || '',
          Price:     num(st.Price),
          Color:     st.Color     || '',
          Weight:    num(st.Weight),
          Pcs:       Math.round(num(st.Pcs)),
          Markup:    num(st.Markup),
        }))
      : []);

    const initialMissing = new Set(
      rawStones.reduce((acc, st, i) => { if (num(st.Price) <= 0) acc.push(i); return acc; }, [])
    );
    setMissingIndices(initialMissing);

    setClientMsg(p.ClientPricingMessage || '');
    setShowPdf(false);
    setShowCompareModal(false);
    setCopied(false);
    setPdfPreviewMode('admin');

  }, [visible, isFetchingEnquiry, fullEnquiry, enquiryId, sourcePricing, metalPricesData]);

  useEffect(() => {
    if (!visible || isFetchingEnquiry || !fullEnquiry) return;
    if (!isQRPhase) {
      setPricingResult(null);
      setPdfHtml(null);
    }
  }, [visible, isFetchingEnquiry, fullEnquiry, isQRPhase]);



  const handleAddDiamond = useCallback(() => {
    setDiamonds(prev => {
      const newIdx = prev.length;
      setMissingIndices(s => new Set([...s, newIdx]));
      return [...prev, {
        localId: makeId(), Type: '', Shape: '', Carat: 0,
        MmSize: 0, SieveSize: '', Price: 0, Color: '', Weight: 0, Pcs: 0, Markup: 0,
      }];
    });
  }, []);

  const handleDeleteDiamond = useCallback((index) => {
    showAlert('Delete Stone', 'Remove this stone entry?', 'info', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => setDiamonds(prev => prev.filter((_, i) => i !== index)),
      },
    ]);
  }, [showAlert]);

  const startInlineEdit = useCallback((index, diamond) => {
    setInlineEditIndex(index);
    const local = editedPrices[index];
    setInlineEditPrice(local !== undefined ? local : (num(diamond.Price) > 0 ? String(diamond.Price) : ''));
  }, [editedPrices]);

  useEffect(() => {
    if (inlineEditIndex !== null && inlinePriceRef.current) {
      Keyboard.dismiss();
      requestAnimationFrame(() => {
        setTimeout(() => {
          inlinePriceRef.current?.focus();
        }, 150);
      });
    }
  }, [inlineEditIndex]);

  const saveInlineEdit = useCallback(() => {
    if (inlineEditIndex === null) return;
    setEditedPrices(prev => {
      const next = { ...prev, [inlineEditIndex]: inlineEditPrice };
      const stillMissing = [...missingIndices].filter(idx => {
        const ep = next[idx] !== undefined ? num(next[idx]) : num(diamonds[idx]?.Price);
        return ep <= 0;
      });
      if (stillMissing.length > 0) {
        const nextIdx = stillMissing[0];
        setTimeout(() => {
          setInlineEditIndex(nextIdx);
          const nd = diamonds[nextIdx];
          setInlineEditPrice(next[nextIdx] !== undefined ? next[nextIdx] : (num(nd?.Price) > 0 ? String(nd.Price) : ''));
        }, 100);
      } else {
        setInlineEditIndex(null);
        setInlineEditPrice('');
      }
      return next;
    });
  }, [inlineEditIndex, inlineEditPrice, missingIndices, diamonds]);

  const cancelInlineEdit = useCallback(() => {
    setInlineEditIndex(null);
    setInlineEditPrice('');
  }, []);

  useEffect(() => {
    if (missingIndices.size > 0 && inlineEditIndex === null) {
      const first = [...missingIndices][0];
      startInlineEdit(first, diamonds[first]);
    }
  }, [missingIndices]);

  const handleSaveQuotation = useCallback(async () => {
    if (!pricingResult) return;

    if (isFetchingEnquiry) {
      showAlert('Please Wait', 'Loading enquiry data, please try again in a moment.', 'info', [{ text: 'OK' }]);
      return;
    }

    const resolvedEnquiryId = fullEnquiry?._id || fullEnquiry?.id || fullEnquiry?.Id;
    if (!resolvedEnquiryId) {
      showAlert('Error', 'Could not identify the enquiry to save.', 'error', [{ text: 'OK' }]);
      return;
    }

    const mergedForSave = diamonds.map((d, i) =>
      editedPrices[i] !== undefined ? { ...d, Price: num(editedPrices[i]) } : d
    );

    const isOnlyMetalDesign = diamonds.length === 0;

    const pricingToSave = {
      isOnlyMetalDesign,
      Metal: { Weight: num(metalWeight), Quality: metalQuality, Rate: num(metalRate) },
      Stones: mergedForSave.map(d => ({
        Type:      d.Type      || '',
        Color:     d.Color     || '',
        Shape:     d.Shape     || '',
        MmSize:    String(d.MmSize   ?? '0'),
        SieveSize: String(d.SieveSize || '0'),
        CtWeight:  num(d.Carat),
        Weight:    num(d.Weight),
        Pcs:       Math.round(num(d.Pcs)),
        Price:     num(d.Price),
        Markup:    num(d.Markup),
      })).filter(st => st.Type),
      Loss:                num(sourcePricing?.Loss ?? 0),
      Labour:              num(sourcePricing?.Labour ?? 0),
      ExtraCharges:        normalizeExtraCharges(sourcePricing?.ExtraCharges),
      UndercutPrice:       num(sourcePricing?.UndercutPrice ?? 0),
      NaturalDuties:       num(sourcePricing?.NaturalDuties ?? 0),
      LabDuties:           num(sourcePricing?.LabDuties ?? 0),
      GoldDuties:          num(sourcePricing?.GoldDuties ?? 0),
      SilverAndLabsDuties: num(sourcePricing?.SilverAndLabsDuties ?? 0),
      LossAndLabourDuties: num(sourcePricing?.LossAndLabourDuties ?? 0),
      MetalPrice:          pricingResult.MetalPrice,
      DiamondsPrice:       pricingResult.DiamondsPrice,
      DutiesAmount:        pricingResult.DutiesAmount,
      TotalPrice:          pricingResult.TotalPrice,
      ClientPricingMessage: clientMsg,
    };

    const pool = [
      ...(Array.isArray(fullEnquiry?.Cad)   ? fullEnquiry.Cad.map(e => ({ ...e, _type: 'cad' }))   : []),
      ...(Array.isArray(fullEnquiry?.Coral)  ? fullEnquiry.Coral.map(e => ({ ...e, _type: 'coral' })) : []),
    ];
    if (!pool.length) {
      showAlert('Error', 'No design version found to save quotation to.', 'error', [{ text: 'OK' }]);
      return;
    }
    pool.sort((a, b) => new Date(b.CreatedDate || 0) - new Date(a.CreatedDate || 0));
    const latestDesign = pool[0];
    const designType   = latestDesign._type;                        // 'cad' or 'coral'
    const version      = latestDesign.Version;

    if (!version) {
      showAlert('Error', 'Design version number is missing. Cannot save.', 'error', [{ text: 'OK' }]);
      return;
    }

    try {
      const saveArgs = {
        enquiryId: resolvedEnquiryId,
        designType,
        version,
        pricingData: pricingToSave,
        isOnlyMetalDesign,
      };
      await savePricing(saveArgs).unwrap();
      // Metal-only designs: the backend applies IsOnlyMetalDesign only AFTER deriving the
      // cost sub-status, so the first save persists the flag but leaves the status at
      // "Cost Missing". Saving once more now sees the persisted flag and advances it to
      // "Quotation Review".
      if (isOnlyMetalDesign) {
        await savePricing(saveArgs).unwrap();
      }
      showAlert('Saved', 'Quotation saved successfully.', 'success', [{ text: 'OK' }]);
    } catch (e) {
      showAlert('Save Failed', e?.data?.message || 'Could not save the quotation. Please try again.', 'error', [{ text: 'OK' }]);
    }
  }, [pricingResult, isFetchingEnquiry, enquiryId, fullEnquiry,
      metalWeight, metalQuality, metalRate, diamonds, editedPrices, sourcePricing,
      clientMsg, savePricing, showAlert]);

  // Open the full Modify Pricing screen for this enquiry. It runs in "enquiry mode"
  // (isEnquiry) so each recalculate there saves the quotation — same as saving here.
  const handleOpenModify = useCallback(() => {
    const resolvedEnquiryId = fullEnquiry?._id || fullEnquiry?.id || fullEnquiry?.Id;
    const modClientId = fullEnquiry?.ClientId || fullEnquiry?.clientId;

    const pool = [
      ...(Array.isArray(fullEnquiry?.Cad)   ? fullEnquiry.Cad.map(e => ({ ...e, _type: 'cad' }))   : []),
      ...(Array.isArray(fullEnquiry?.Coral) ? fullEnquiry.Coral.map(e => ({ ...e, _type: 'coral' })) : []),
    ];
    pool.sort((a, b) => new Date(b.CreatedDate || 0) - new Date(a.CreatedDate || 0));
    const latestDesign = pool[0];
    if (!resolvedEnquiryId || !latestDesign?.Version) {
      showAlert('Error', 'No design version found to modify.', 'error', [{ text: 'OK' }]);
      return;
    }

    const merged = diamonds.map((d, i) =>
      editedPrices[i] !== undefined ? { ...d, Price: num(editedPrices[i]) } : d
    );
    const editableStones = merged.map(d => ({
      Type: d.Type || '',
      Color: d.Color || '',
      Shape: d.Shape || '',
      MmSize: String(d.MmSize ?? ''),
      SieveSize: String(d.SieveSize ?? ''),
      Weight: num(d.Weight),
      Pcs: Math.round(num(d.Pcs)),
      CtWeight: num(d.Carat),
      Price: num(d.Price),
      Markup: num(d.Markup),
    }));
    const primaryType = editableStones[0]?.Type || 'Diamond';
    const typeData = {
      editableStones,
      editableMetal: { Weight: num(metalWeight), Quality: metalQuality, Rate: num(metalRate) },
      editableCharges: {
        Loss: num(sourcePricing?.Loss ?? 0),
        Labour: num(sourcePricing?.Labour ?? 0),
        ExtraCharges: extraChargesValue(sourcePricing?.ExtraCharges),
        ExtraChargesType: extraChargesType(sourcePricing?.ExtraCharges),
        GoldDuties: num(sourcePricing?.GoldDuties ?? 0),
        SilverAndLabsDuties: num(sourcePricing?.SilverAndLabsDuties ?? 0),
        LossAndLabourDuties: num(sourcePricing?.LossAndLabourDuties ?? 0),
      },
      dutyRates: {
        UndercutPrice: num(sourcePricing?.UndercutPrice ?? 0),
        NaturalDuties: num(sourcePricing?.NaturalDuties ?? 0),
        LabDuties: num(sourcePricing?.LabDuties ?? 0),
      },
      pricingResult: pricingResult || null,
      imageData: null,
    };
    const stonesData = { All: { types: [primaryType], byType: { [primaryType]: typeData } } };

    onClose?.();
    navigation.navigate('ModifyPricingScreen', {
      stonesData,
      clientId: modClientId,
      selectedClient: { name: resolvedClientName, ApplicableStoneTypes: [primaryType] },
      metalKt: metalQuality,
      isEnquiry: true,
      enquiryId: resolvedEnquiryId,
      designType: latestDesign._type,
      version: latestDesign.Version,
    });
  }, [fullEnquiry, diamonds, editedPrices, metalWeight, metalQuality, metalRate,
      sourcePricing, pricingResult, resolvedClientName, navigation, onClose, showAlert]);

  const handleCalculate = useCallback(async () => {
    
    const mergedDiamonds = diamonds.map((d, i) =>
      editedPrices[i] !== undefined ? { ...d, Price: num(editedPrices[i]) } : d
    );

    const missingItems = [];
    if (num(metalWeight) <= 0) missingItems.push('Metal Weight');
    if (num(metalRate) <= 0) missingItems.push('Metal Rate');
    mergedDiamonds.forEach((d, i) => {
      if (num(d.Price) <= 0) missingItems.push(`${d.Type || 'Stone'} ${d.Shape || ''} #${i + 1} Price`);
    });

    if (missingItems.length > 0) {
      showAlert('Data Missing', missingItems.join(', ') + ' — please fill all missing fields before calculating.', 'warning', [{ text: 'OK' }]);
      return;
    }

    const clientId = fullEnquiry?.ClientId || fullEnquiry?.clientId;

    const isOnlyMetalDesign = diamonds.length === 0;

    const payload = {
      details: {
        isOnlyMetalDesign,
        Metal: {
          Weight:  num(metalWeight),
          Quality: metalQuality,
          // Only send Rate when > 0 — the backend uses `metalRateOverride ?? todaysRate`,
          // and 0 is not nullish, so sending 0 would force the metal price (and total) to 0.
          ...(num(metalRate) > 0 ? { Rate: num(metalRate) } : {}),
        },
        Stones: mergedDiamonds.map(d => ({
          Type:      d.Type      || '',
          Color:     d.Color     || '',
          Shape:     d.Shape     || '',
          MmSize:    String(d.MmSize   ?? '0'),
          SieveSize: String(d.SieveSize || '0'),
          CtWeight:  num(d.Carat),
          Weight:    num(d.Weight),
          Pcs:       Math.round(num(d.Pcs)),
          Price:     num(d.Price),
          Markup:    num(d.Markup),
        })).filter(st => st.Type),
        Loss:                num(sourcePricing?.Loss ?? 0),
        Labour:              num(sourcePricing?.Labour ?? 0),
        ExtraCharges:        normalizeExtraCharges(sourcePricing?.ExtraCharges),
        UndercutPrice:       num(sourcePricing?.UndercutPrice ?? 0),
        NaturalDuties:       num(sourcePricing?.NaturalDuties ?? 0),
        LabDuties:           num(sourcePricing?.LabDuties ?? 0),
        GoldDuties:          num(sourcePricing?.GoldDuties ?? 0),
        SilverAndLabsDuties: num(sourcePricing?.SilverAndLabsDuties ?? 0),
        LossAndLabourDuties: num(sourcePricing?.LossAndLabourDuties ?? 0),
        Quantity: fullEnquiry?.Quantity || 1,
      },
      clientId,
      isRecalculate: true,
      isOnlyMetalDesign,
    };

    try {
      const result = await calculatePricing(payload).unwrap();
      console.log('=== calculatePricing raw response ===', JSON.stringify(result, null, 2));
      setPricingResult(result);
      // Reflect the rate the backend actually used when we didn't send one (was 0/empty).
      if (num(metalRate) <= 0 && result.Metal?.Rate) setMetalRate(String(result.Metal.Rate));
      if (result.GoldRatePerOunce) setMetalOunce(String(result.GoldRatePerOunce));

      setClientMsg(prev => {
        if (result.ClientPricingMessage) return result.ClientPricingMessage;
        return prev;
      });

      const html = buildHtml({
        pricingResult: result,
        stones: mergedDiamonds,
        metal: { Weight: num(metalWeight), Quality: metalQuality, Rate: num(metalRate), Ounce: num(metalOunce) },
        charges: {
          Loss: num(sourcePricing?.Loss ?? 0),
          Labour: num(sourcePricing?.Labour ?? 0),
          ExtraCharges: num(sourcePricing?.ExtraCharges ?? 0),
          UndercutPrice: num(sourcePricing?.UndercutPrice ?? 0),
        },
        clientName: resolvedClientName,
        sourcePricing: sourcePricing || {},
      });
      setPdfHtml(html);
      setPdfPreviewMode('admin');
      setShowPdf(true);
    } catch (e) {
      showAlert('Calculation Failed', e?.data?.message || 'Failed to calculate pricing. Please try again.', 'error', [{ text: 'OK' }]);
    }
  }, [diamonds, editedPrices, metalWeight, metalQuality, metalRate, sourcePricing, fullEnquiry, calculatePricing, showAlert, resolvedClientName]);

  const autoCalcTimerRef = useRef(null);
  const autoSaveInProgress = useRef(false);
  const fullEnquiryRef = useRef(fullEnquiry);
  fullEnquiryRef.current = fullEnquiry;
  useEffect(() => {
    // Runs in Quotation Review AND Cost Missing so that adding/deleting/pricing stones
    // (e.g. deleting an unpriced stone in Cost Missing) auto-recalculates and saves.
    if (!visible || !(isQRPhase || isCMPhase)) return;
    if (num(metalWeight) <= 0 || num(metalRate) <= 0) return;
    if (autoCalcTimerRef.current) clearTimeout(autoCalcTimerRef.current);
    autoCalcTimerRef.current = setTimeout(() => {
      if (autoSaveInProgress.current) return;
      const merged = diamonds.map((d, i) => editedPrices[i] !== undefined ? { ...d, Price: num(editedPrices[i]) } : d);
      const anyMissingPrice = merged.some(d => num(d.Price) <= 0);
      if (anyMissingPrice) return;
      const enq = fullEnquiryRef.current;
      const isOnlyMetalDesign = diamonds.length === 0;

      const payload = {
        details: {
          isOnlyMetalDesign,
          // Omit Rate when 0 so the backend falls back to today's rate (0 is not nullish).
          Metal: { Weight: num(metalWeight), Quality: metalQuality, ...(num(metalRate) > 0 ? { Rate: num(metalRate) } : {}) },
          Stones: merged.map(d => ({
            Type: d.Type || '', Color: d.Color || '', Shape: d.Shape || '',
            MmSize: String(d.MmSize ?? '0'), SieveSize: String(d.SieveSize || '0'),
            CtWeight: num(d.Carat), Weight: num(d.Weight), Pcs: Math.round(num(d.Pcs)), Price: num(d.Price), Markup: num(d.Markup),
          })).filter(st => st.Type),
          Loss: num(sourcePricing?.Loss ?? 0), Labour: num(sourcePricing?.Labour ?? 0),
          ExtraCharges: normalizeExtraCharges(sourcePricing?.ExtraCharges), UndercutPrice: num(sourcePricing?.UndercutPrice ?? 0),
          NaturalDuties: num(sourcePricing?.NaturalDuties ?? 0), LabDuties: num(sourcePricing?.LabDuties ?? 0),
          GoldDuties: num(sourcePricing?.GoldDuties ?? 0), SilverAndLabsDuties: num(sourcePricing?.SilverAndLabsDuties ?? 0),
          LossAndLabourDuties: num(sourcePricing?.LossAndLabourDuties ?? 0), Quantity: enq?.Quantity || 1,
        },
        clientId: enq?.ClientId || enq?.clientId,
        isRecalculate: true,
      };
      calculatePricing(payload).unwrap().then(result => {
        setPricingResult(result);
        if (num(metalRate) <= 0 && result.Metal?.Rate) setMetalRate(String(result.Metal.Rate));
        if (result.GoldRatePerOunce) setMetalOunce(String(result.GoldRatePerOunce));
        setClientMsg(prev => result.ClientPricingMessage || prev);
        // Rebuild the HTML for whichever preview the user is currently viewing so a
        // background recalc doesn't flip a Client preview back to Admin.
        let html;
        if (pdfPreviewModeRef.current === 'client') {
          const clientEntry = {
            ...result,
            Stones: merged.map(d => ({
              Type: d.Type || '', Color: d.Color || '', Shape: d.Shape || '',
              MmSize: String(d.MmSize ?? '0'), SieveSize: String(d.SieveSize || '0'),
              CtWeight: num(d.Carat), Weight: num(d.Weight), Pcs: Math.round(num(d.Pcs)),
              Price: num(d.Price), Markup: num(d.Markup),
            })).filter(st => st.Type),
          };
          html = buildCombinedHtml([clientEntry], resolvedClientName, metalQuality, null, true);
        } else {
          html = buildHtml({
            pricingResult: result, stones: merged,
            metal: { Weight: num(metalWeight), Quality: metalQuality, Rate: num(metalRate) },
            charges: { Loss: num(sourcePricing?.Loss ?? 0), Labour: num(sourcePricing?.Labour ?? 0), ExtraCharges: num(sourcePricing?.ExtraCharges ?? 0), UndercutPrice: num(sourcePricing?.UndercutPrice ?? 0) },
            clientName: resolvedClientName, sourcePricing: sourcePricing || {},
          });
        }
        setPdfHtml(html);

        if ((isQRPhase || isCMPhase) && !autoSaveInProgress.current) {
          const resolvedId = enq?._id || enq?.id || enq?.Id;
          if (resolvedId) {
            const pool = [
              ...(Array.isArray(enq?.Cad)  ? enq.Cad.map(e  => ({ ...e, _type: 'cad' }))  : []),
              ...(Array.isArray(enq?.Coral) ? enq.Coral.map(e => ({ ...e, _type: 'coral' })) : []),
            ];
            pool.sort((a, b) => new Date(b.CreatedDate || 0) - new Date(a.CreatedDate || 0));
            const latestDesign = pool[0];
            if (latestDesign?.Version) {
              autoSaveInProgress.current = true;
              const onlyMetal = diamonds.length === 0;
              const autoSaveArgs = {
                enquiryId: resolvedId,
                designType: latestDesign._type,
                version: latestDesign.Version,
                pricingData: {
                  isOnlyMetalDesign: onlyMetal,
                  Metal: { Weight: num(metalWeight), Quality: metalQuality, Rate: num(metalRate) },
                  Stones: merged.map(d => ({
                    Type: d.Type || '', Color: d.Color || '', Shape: d.Shape || '',
                    MmSize: String(d.MmSize ?? '0'), SieveSize: String(d.SieveSize || '0'),
                    CtWeight: num(d.Carat), Weight: num(d.Weight), Pcs: Math.round(num(d.Pcs)),
                    Price: num(d.Price), Markup: num(d.Markup),
                  })).filter(st => st.Type),
                  Loss: num(sourcePricing?.Loss ?? 0), Labour: num(sourcePricing?.Labour ?? 0),
                  ExtraCharges: normalizeExtraCharges(sourcePricing?.ExtraCharges), UndercutPrice: num(sourcePricing?.UndercutPrice ?? 0),
                  NaturalDuties: num(sourcePricing?.NaturalDuties ?? 0), LabDuties: num(sourcePricing?.LabDuties ?? 0),
                  GoldDuties: num(sourcePricing?.GoldDuties ?? 0), SilverAndLabsDuties: num(sourcePricing?.SilverAndLabsDuties ?? 0),
                  LossAndLabourDuties: num(sourcePricing?.LossAndLabourDuties ?? 0),
                  MetalPrice: result.MetalPrice, DiamondsPrice: result.DiamondsPrice,
                  DutiesAmount: result.DutiesAmount, TotalPrice: result.TotalPrice,
                  ClientPricingMessage: result.ClientPricingMessage || '',
                },
                isOnlyMetalDesign: onlyMetal,
              };
              // Metal-only (all stones deleted): save twice so the persisted flag advances
              // the status past "Cost Missing" (backend applies it after deriving the status).
              savePricing(autoSaveArgs).unwrap()
                .then(() => (onlyMetal ? savePricing(autoSaveArgs).unwrap() : null))
                .then(() => {
                  setTimeout(() => { autoSaveInProgress.current = false; }, 2000);
                })
                .catch(() => { autoSaveInProgress.current = false; });
            }
          }
        }
      }).catch(() => {});
    }, 800);
    return () => { if (autoCalcTimerRef.current) clearTimeout(autoCalcTimerRef.current); };
  }, [visible, isQRPhase, isCMPhase, metalWeight, metalQuality, metalRate, diamonds, editedPrices, sourcePricing, calculatePricing, savePricing, resolvedClientName]);

  const handleSharePdf = useCallback(async () => {
    if (!pdfHtml) return;
    if (typeof generatePDFModule !== 'function') {
      showAlert('Not Available', 'PDF generation library is not installed.', 'warning', [{ text: 'OK' }]);
      return;
    }
    setIsSharing(true);
    try {
      const fileName = `Quotation_${(fullEnquiry?.Name || 'Enquiry').replace(/\s+/g, '_')}_${Date.now()}`;
      const pdf = await generatePDFModule({ html: pdfHtml, fileName, directory: 'Documents', base64: false });
      if (!pdf?.filePath) throw new Error('PDF generation failed');
      const cachePath = `${RNFS.CachesDirectoryPath}/${fileName}.pdf`;
      await RNFS.copyFile(pdf.filePath, cachePath);
      await Share.open({
        title: 'Share Quotation',
        message: `Quotation - ${fullEnquiry?.Name || ''}`,
        url: Platform.OS === 'android' ? `file://${cachePath}` : cachePath,
        type: 'application/pdf',
        failOnCancel: false,
      });
      setTimeout(() => RNFS.unlink(cachePath).catch(() => {}), 6000);
    } catch (e) {
      if (!String(e?.message || '').toLowerCase().includes('cancel')) {
        showAlert('Share Failed', e?.message || 'Could not share PDF.', 'error', [{ text: 'OK' }]);
      }
    } finally {
      setIsSharing(false);
    }
  }, [pdfHtml, fullEnquiry, showAlert]);

  const handleCompareImages = useCallback(() => {
    setShowCompareModal(true);
  }, []);

  const hasMissingStones = missingIndices.size > 0 && diamonds.some((d, i) => {
    if (!missingIndices.has(i)) return false;
    const effectivePrice = editedPrices[i] !== undefined ? num(editedPrices[i]) : num(d.Price);
    return effectivePrice <= 0;
  }) || diamonds.length === 0;
  const hasMissingMetal = num(metalWeight) <= 0 || num(metalRate) <= 0;

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (hasMissingStones) {
      const loop = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(shakeAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: -1, duration: 80, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: 0, duration: 80, useNativeDriver: true }),
            Animated.delay(1000),
          ]),
          Animated.sequence([
            Animated.timing(scaleAnim, { toValue: 1.08, duration: 150, useNativeDriver: true }),
            Animated.timing(scaleAnim, { toValue: 0.92, duration: 150, useNativeDriver: true }),
            Animated.timing(scaleAnim, { toValue: 1.08, duration: 150, useNativeDriver: true }),
            Animated.timing(scaleAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
            Animated.delay(1000),
          ]),
        ])
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
    const t2 = hasMissingMetal ? setTimeout(() => triggerHaptic('notificationWarning'), 900) : null;
    const t3 = hasMissingStones ? setTimeout(() => triggerHaptic('notificationWarning'), 1300) : null;
    return () => { clearTimeout(t1); if (t2) clearTimeout(t2); if (t3) clearTimeout(t3); };
  }, [visible, isQRPhase, enquiryId, hasMissingMetal, hasMissingStones]);

  const buildClientPreviewHtml = useCallback(() => {
    if (!pricingResult) return '';
    const merged = diamonds.map((d, i) =>
      editedPrices[i] !== undefined ? { ...d, Price: num(editedPrices[i]) } : d
    );
    const entry = {
      ...pricingResult,
      Stones: merged.map(d => ({
        Type: d.Type || '', Color: d.Color || '', Shape: d.Shape || '',
        MmSize: String(d.MmSize ?? '0'), SieveSize: String(d.SieveSize || '0'),
        CtWeight: num(d.Carat), Weight: num(d.Weight), Pcs: Math.round(num(d.Pcs)),
        Price: num(d.Price), Markup: num(d.Markup),
      })).filter(st => st.Type),
    };
    return buildCombinedHtml([entry], resolvedClientName, metalQuality, null, true);
  }, [pricingResult, diamonds, editedPrices, resolvedClientName, metalQuality]);

  const handleCopyMsg = useCallback(() => {
    if (!clientMsg) return;
    Clipboard.setString(clientMsg);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [clientMsg]);

  // ── Stones IIFE (shared by both renders) ──────────────────────────
  const renderStonesSection = () => {
    if (diamonds.length === 0) {
      return (
        <>
        <View style={s.emptyStones}>
          <Icon name="diamond" size={28} color={colors.textSecondary} />
          <Text style={s.emptyStonesText}>No stones added yet</Text>
          <TouchableOpacity style={[s.addBtn, { marginTop: 4 }]} onPress={handleAddDiamond} activeOpacity={0.8}>
            <Icon name="add" size={16} color="#fff" />
            <Text style={s.addBtnText}>Add First Stone</Text>
          </TouchableOpacity>
        </View>
         <TouchableOpacity
          style={[s.calcBtn, { paddingVertical: 18, marginTop: 20 }]}
          onPress={handleCalculate}
          disabled={isCalculating}
          activeOpacity={0.85}
        >
          {isCalculating
            ? <ActivityIndicator size="small" color="#fff" />
            : <>
                <Icon name="calculate" size={20} color="#fff" />
                <Text style={[s.calcBtnText, { fontSize: (fonts.base || 16) }]}>Recalculate</Text>
              </>}
        </TouchableOpacity></>
      );
    }

    const missingStones = diamonds
      .map((d, i) => ({ d, i }))
      .filter(({ i }) => missingIndices.has(i));

    return (
      <>
        <View style={s.sectionRow}>
          <Text style={s.sectionTitle}>
            {missingStones.length > 0
              ? `Stones needing price (${missingStones.length})`
              : 'Stones'}
          </Text>
        </View>

        {missingStones.length === 0 ? null : (
        <View style={s.stoneTable}>
            <View style={s.stoneTableHeader}>
              <Text style={[s.stoneCol, s.stoneColType,  s.stoneTh]}>Type</Text>
              <Text style={[s.stoneCol, s.stoneColShape, s.stoneTh]}>Shape</Text>
              <Text style={[s.stoneCol, s.stoneColNum,   s.stoneTh]}>Ct</Text>
              <Text style={[s.stoneCol, s.stoneColNum,   s.stoneTh]}>Pcs</Text>
              <Text style={[s.stoneCol, s.stoneColPrice, s.stoneTh]}>$/Ct</Text>
              <View style={s.stoneColActions} />
            </View>
            {missingStones.map(({ d, i }, rowIdx) => {
              const effectivePrice = editedPrices[i] !== undefined ? num(editedPrices[i]) : num(d.Price);
              const isEdited = editedPrices[i] !== undefined && effectivePrice > 0;
              const isEditing = inlineEditIndex === i;
              return (
                <Animated.View
                  key={d.localId || i}
                  style={[
                    s.stoneRow,
                    rowIdx % 2 === 1 && s.stoneRowAlt,
                    !isEdited && s.stoneRowMissing,
                    !isEdited && { transform: [{ translateX: shakeAnim }, { scale: scaleAnim }] },
                  ]}
                >
                  <Text style={[s.stoneCol, s.stoneColType,  s.stoneTd]} numberOfLines={1}>{d.Type || '—'}</Text>
                  <Text style={[s.stoneCol, s.stoneColShape, s.stoneTd]} numberOfLines={1}>{d.Shape || '—'}</Text>
                  <Text style={[s.stoneCol, s.stoneColNum,   s.stoneTd]}>{num(d.Carat).toFixed(2)}</Text>
                  <Text style={[s.stoneCol, s.stoneColNum,   s.stoneTd]}>{num(d.Pcs)}</Text>

                  {isEditing ? (
                    <TextInput
                      ref={inlinePriceRef}
                      style={[s.stoneCol, s.stoneColPrice, s.inlinePriceInput]}
                      value={inlineEditPrice}
                      onChangeText={setInlineEditPrice}
                      keyboardType="decimal-pad"
                      placeholder="$/Ct"
                      placeholderTextColor="#A0A0A0"
                      onSubmitEditing={saveInlineEdit}
                      returnKeyType="done"
                    />
                  ) : (
                    <Text style={[s.stoneCol, s.stoneColPrice, s.stoneTd, !isEdited && s.stonePriceMissing]}>
                      {effectivePrice > 0 ? `$${effectivePrice.toFixed(2)}` : '—'}
                    </Text>
                  )}

                  <View style={s.stoneColActions}>
                    {!isEdited && (
                      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
                        <Icon name="warning" size={16} color="#DC2626" />
                      </Animated.View>
                    )}
                    {!isEditing && (
                      <TouchableOpacity onPress={() => startInlineEdit(i, d)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 4 }} style={[s.inlineActionBtn, { borderColor: colors.primary }]}>
                        <Icon name="edit" size={14} color={colors.primary} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => handleDeleteDiamond(i)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 6 }} style={[s.inlineActionBtn, { borderColor: colors.error || '#EF4444' }]}>
                      <Icon name="delete-outline" size={14} color={colors.error || '#EF4444'} />
                    </TouchableOpacity>
                  </View>
                </Animated.View>
              );
            })}
            <TouchableOpacity style={s.stoneAddRow} onPress={handleAddDiamond} activeOpacity={0.8}>
              <Icon name="add" size={14} color={colors.primary} />
              <Text style={s.stoneAddRowText}>Add another stone</Text>
            </TouchableOpacity>
          </View>
        )}

       
      </>
    );
  };

  // Metal quality picker rendered as an in-modal absolute overlay (NOT a nested <Modal>,
  // which is unreliable on iOS/Android when the parent is already a Modal). Used by both
  // the QR-phase and Update-Quotation renders.
  const renderQualityPicker = () => {
    if (!showQualityPicker) return null;
    return (
      <View style={s.pickerAbsOverlay}>
        <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => setShowQualityPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerSheet}>
            <Text style={s.pickerTitle}>Select Metal Quality</Text>
            {METAL_QUALITY_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt}
                style={[s.pickerOption, metalQuality === opt && s.pickerOptionSelected]}
                onPress={() => { setMetalQuality(opt); setShowQualityPicker(false); }}
                activeOpacity={0.8}
              >
                <Text style={[s.pickerOptionText, metalQuality === opt && s.pickerOptionTextSelected]}>{opt}</Text>
                {metalQuality === opt && <Icon name="check" size={16} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </View>
    );
  };

  // ── QR Phase render ────────────────────────────────────────────────
  const renderQRPhase = () => (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => { if (showPdf) { setShowPdf(false); } else { onClose(); } }}>
      <>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle} numberOfLines={1}>View Quotation</Text>
              {fullEnquiry?.Name ? <Text style={s.headerSub} numberOfLines={1}>{fullEnquiry.Name}</Text> : null}
            </View>
            {isFetchingEnquiry && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />}
            <TouchableOpacity style={s.closeBtn} onPress={showPdf ? () => setShowPdf(false) : onClose} activeOpacity={0.7}>
              <Icon name={showPdf ? 'arrow-back' : 'close'} size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {showPdf ? (
            <View style={{ flex: 1 }}>
              <PdfViewer html={pdfHtml} style={{ flex: 1 }} />
              <View style={s.pdfBar}>
                <TouchableOpacity style={s.pdfBarBtn} onPress={() => setShowPdf(false)} activeOpacity={0.8}>
                  <Icon name="arrow-back" size={18} color="#fff" />
                  <Text style={s.pdfBarBtnText}>Back</Text>
                </TouchableOpacity>
                <View style={s.pdfPreviewToggle}>
                  <TouchableOpacity
                    style={[s.pdfPreviewBtn, pdfPreviewMode === 'admin' && s.pdfPreviewBtnActive]}
                    onPress={() => {
                      if (pdfPreviewMode !== 'admin') {
                        setPdfPreviewMode('admin');
                        const merged = diamonds.map((d, i) =>
                          editedPrices[i] !== undefined ? { ...d, Price: num(editedPrices[i]) } : d
                        );
                        const html = buildHtml({
                          pricingResult, stones: merged,
                          metal: { Weight: num(metalWeight), Quality: metalQuality, Rate: num(metalRate) },
                          charges: { Loss: num(sourcePricing?.Loss ?? 0), Labour: num(sourcePricing?.Labour ?? 0), ExtraCharges: num(sourcePricing?.ExtraCharges ?? 0), UndercutPrice: num(sourcePricing?.UndercutPrice ?? 0) },
                          clientName: resolvedClientName, sourcePricing: sourcePricing || {},
                        });
                        if (html) setPdfHtml(html);
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.pdfPreviewBtnText, pdfPreviewMode === 'admin' && s.pdfPreviewBtnTextActive]}>Admin</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.pdfPreviewBtn, pdfPreviewMode === 'client' && s.pdfPreviewBtnActive]}
                    onPress={() => {
                      if (pdfPreviewMode !== 'client') {
                        setPdfPreviewMode('client');
                        const html = buildClientPreviewHtml();
                        if (html) setPdfHtml(html);
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.pdfPreviewBtnText, pdfPreviewMode === 'client' && s.pdfPreviewBtnTextActive]}>Client</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[s.pdfBarBtn, s.shareBtn]}
                  onPress={async () => { await handleSaveQuotation(); handleSharePdf(); }}
                  disabled={isSaving || isSharing}
                  activeOpacity={0.85}
                >
                  {(isSaving || isSharing)
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <><Icon name="share" size={18} color="#fff" /><Text style={s.pdfBarBtnText}>Save & Share</Text></>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <ScrollView
              style={s.scrollBody}
              contentContainerStyle={s.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={s.infoBanner}>
                <Icon name="info" size={15} color={colors.primary} />
                <Text style={s.infoText}>Review details below, then tap View PDF to recalculate and generate quotation.</Text>
              </View>

              <View style={s.metalSection}>
                <Text style={s.sectionTitle}>Metal</Text>
                <View style={s.metalRow}>
                  <View style={s.metalField}>
                    <Text style={s.chargeLabel}>Weight (g)</Text>
                    <TextInput style={s.chargeInput} value={metalWeight} onChangeText={setMetalWeight} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textSecondary} />
                  </View>
                  <View style={s.metalField}>
                    <Text style={s.chargeLabel}>Quality</Text>
                    <TouchableOpacity style={s.qualityBtn} onPress={() => setShowQualityPicker(true)} activeOpacity={0.8}>
                      <Text style={s.qualityBtnText}>{metalQuality || '10K'}</Text>
                      <Icon name="arrow-drop-down" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  <View style={s.metalField}>
                    <Text style={s.chargeLabel}>24K Rate ($/g)</Text>
                    <TextInput style={s.chargeInput} value={metalRate} onChangeText={setMetalRate} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textSecondary} />
                  </View>
                  <View style={s.metalField}>
                    <Text style={s.chargeLabel}>Per Ounce ($)</Text>
                    <TextInput style={s.chargeInput} value={metalOunce} onChangeText={setMetalOunce} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textSecondary} />
                  </View>
                </View>
              </View>



              <TouchableOpacity
                style={[s.calcBtn, { backgroundColor: '#DC2626' }]}
                onPress={handleCalculate}
                disabled={isCalculating}
                activeOpacity={0.85}
              >
                {isCalculating
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon name="picture-as-pdf" size={18} color="#fff" />
                      <Text style={s.calcBtnText}>View PDF</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 4, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.4)' }}>
                        <Icon name="refresh" size={14} color="#FFD700" />
                        <Text style={{ color: '#FFD700', fontSize: 10, fontWeight: '600' }}> Auto</Text>
                      </View>
                    </View>}
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.calcBtn, { backgroundColor: '#7C3AED' }]}
                onPress={handleCompareImages}
                activeOpacity={0.85}
              >
                <Icon name="compare" size={18} color="#fff" />
                <Text style={s.calcBtnText}>Compare Images</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.calcBtn, { backgroundColor: colors.primary }]}
                onPress={handleOpenModify}
                activeOpacity={0.85}
              >
                <Icon name="tune" size={18} color="#fff" />
                <Text style={s.calcBtnText}>Modify Pricing</Text>
              </TouchableOpacity>

              {(() => {
                const PR = pricingResult || initialPricing;
                if (!PR) return null;
                return <>
                  <Text style={s.sectionTitle}>Pricing</Text>
                  <View style={s.resultCard}>
                    <View style={s.resultRow}>
                      <Text style={s.resultLbl}>Metal Price</Text>
                      <Text style={s.resultVal}>${num(PR.MetalPrice).toFixed(2)}</Text>
                    </View>
                    <View style={s.resultRow}>
                      <Text style={s.resultLbl}>Diamonds Price</Text>
                      <Text style={s.resultVal}>${num(PR.DiamondsPrice).toFixed(2)}</Text>
                    </View>
                    <View style={s.resultRow}>
                      <Text style={s.resultLbl}>Duties Amount</Text>
                      <Text style={s.resultVal}>${num(PR.DutiesAmount).toFixed(2)}</Text>
                    </View>
                    <View style={[s.resultRow, s.resultTotalRow]}>
                      <Text style={s.resultTotalLbl}>TOTAL PRICE</Text>
                      <Text style={s.resultTotalVal}>${num(PR.TotalPrice).toFixed(2)}</Text>
                    </View>
                  </View>
                </>;
              })()}
              {(clientMsg !== null && clientMsg !== undefined && clientMsg !== '' && diamonds.length > 0) ? (
                <View style={s.clientMsgCard}>
                  <View style={s.clientMsgHeader}>
                    <Text style={s.clientMsgLabel}>Client Pricing Message</Text>
                    <TouchableOpacity style={s.copyBtn} onPress={handleCopyMsg} activeOpacity={0.8}>
                      <Icon name={copied ? 'check' : 'content-copy'} size={15} color={copied ? '#059669' : colors.primary} />
                      <Text style={[s.copyBtnText, copied && { color: '#059669' }]}>{copied ? 'Copied!' : 'Copy'}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={s.clientMsgText}>{clientMsg}</Text>
                </View>
              ) : null}
            </ScrollView>
          )}
        </View>
      </View>

        <CompareRefrences
          visible={showCompareModal}
          onClose={() => setShowCompareModal(false)}
          fullEnquiry={fullEnquiry}
          isFetchingEnquiry={isFetchingEnquiry}
        />

        <BrandedAlert
          visible={alertCfg.visible} title={alertCfg.title} message={alertCfg.message}
          type={alertCfg.type} buttons={alertCfg.buttons} onClose={hideAlert}
        />
        {renderQualityPicker()}
      </>
    </Modal>
  );

  // ── Update Quotation render ────────────────────────────────────────
  const renderUpdateQuotation = () => (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => { if (showPdf) { setShowPdf(false); } else { onClose(); } }}>
      <>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle} numberOfLines={1}>Update Quotation</Text>
              {fullEnquiry?.Name ? <Text style={s.headerSub} numberOfLines={1}>{fullEnquiry.Name}</Text> : null}
            </View>
            {isFetchingEnquiry && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />}
            <TouchableOpacity style={s.closeBtn} onPress={showPdf ? () => {
              showAlert(
                'Save & Go Back',
                'Do you want to save the updated quotation before going back?',
                'warning',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'No Update Price',
                    onPress: () => setShowPdf(false),
                  },
                  {
                    text: 'Save & Go Back',
                    onPress: async () => {
                      await handleSaveQuotation();
                      setShowPdf(false);
                    },
                  },
                ]
              );
            } : onClose} activeOpacity={0.7}>
              <Icon name={showPdf ? 'arrow-back' : 'close'} size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {showPdf ? (
            <View style={{ flex: 1 }}>
              <PdfViewer html={pdfHtml} style={{ flex: 1 }} />
              <View style={s.pdfBar}>
                <TouchableOpacity style={s.pdfBarBtn} onPress={() => {
                  showAlert(
                    'Save & Go Back',
                    'Do you want to save the updated quotation before going back?',
                    'warning',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'No Update Price',
                        onPress: () => setShowPdf(false),
                      },
                      {
                        text: 'Save & Go Back',
                        onPress: async () => {
                          await handleSaveQuotation();
                          setShowPdf(false);
                        },
                      },
                    ]
                  );
                }} activeOpacity={0.8}>
                  <Icon name="arrow-back" size={18} color="#fff" />
                  <Text style={s.pdfBarBtnText}>Go Back</Text>
                </TouchableOpacity>
                <View style={s.pdfPreviewToggle}>
                  <TouchableOpacity
                    style={[s.pdfPreviewBtn, pdfPreviewMode === 'admin' && s.pdfPreviewBtnActive]}
                    onPress={() => {
                      if (pdfPreviewMode !== 'admin') {
                        setPdfPreviewMode('admin');
                        const merged = diamonds.map((d, i) =>
                          editedPrices[i] !== undefined ? { ...d, Price: num(editedPrices[i]) } : d
                        );
                        const html = buildHtml({
                          pricingResult, stones: merged,
                          metal: { Weight: num(metalWeight), Quality: metalQuality, Rate: num(metalRate) },
                          charges: { Loss: num(sourcePricing?.Loss ?? 0), Labour: num(sourcePricing?.Labour ?? 0), ExtraCharges: num(sourcePricing?.ExtraCharges ?? 0), UndercutPrice: num(sourcePricing?.UndercutPrice ?? 0) },
                          clientName: resolvedClientName, sourcePricing: sourcePricing || {},
                        });
                        if (html) setPdfHtml(html);
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.pdfPreviewBtnText, pdfPreviewMode === 'admin' && s.pdfPreviewBtnTextActive]}>Admin</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.pdfPreviewBtn, pdfPreviewMode === 'client' && s.pdfPreviewBtnActive]}
                    onPress={() => {
                      if (pdfPreviewMode !== 'client') {
                        setPdfPreviewMode('client');
                        const html = buildClientPreviewHtml();
                        if (html) setPdfHtml(html);
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.pdfPreviewBtnText, pdfPreviewMode === 'client' && s.pdfPreviewBtnTextActive]}>Client</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[s.pdfBarBtn, s.shareBtn]}
                  onPress={async () => { await handleSaveQuotation(); handleSharePdf(); }}
                  disabled={isSaving || isSharing}
                  activeOpacity={0.85}
                >
                  {(isSaving || isSharing)
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <><Icon name="share" size={18} color="#fff" /><Text style={s.pdfBarBtnText}>Save & Share</Text></>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <ScrollView
              style={s.scrollBody}
              contentContainerStyle={s.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {hasMissingStones && hasMissingMetal && (
                <View style={s.missingBadge}>
                  <Icon name="warning" size={14} color="#DC2626" />
                  <Text style={s.missingBadgeText}>Missing Metal Details</Text>
                </View>
              )}

              <View style={[s.metalSection, hasMissingStones && hasMissingMetal && s.metalSectionMissing]}>
                <Text style={s.sectionTitle}>Metal</Text>
                <View style={s.metalRow}>
                  <View style={s.metalField}>
                    <Text style={s.chargeLabel}>Weight (g)</Text>
                    <TextInput
                      style={[s.chargeInput, num(metalWeight) <= 0 && s.inputErrorHighlight]}
                      value={metalWeight}
                      onChangeText={setMetalWeight}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textSecondary}
                    />
                  </View>
                  <View style={s.metalField}>
                    <Text style={s.chargeLabel}>Quality</Text>
                    <TouchableOpacity
                      style={s.qualityBtn}
                      onPress={() => setShowQualityPicker(true)}
                      activeOpacity={0.8}
                    >
                      <Text style={s.qualityBtnText}>{metalQuality || '10K'}</Text>
                      <Icon name="arrow-drop-down" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  <View style={s.metalField}>
                    <Text style={s.chargeLabel}>24K Rate ($/g)</Text>
                    <TextInput
                      style={[s.chargeInput, num(metalRate) <= 0 && s.inputErrorHighlight]}
                      value={metalRate}
                      onChangeText={setMetalRate}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textSecondary}
                    />
                  </View>
                  <View style={s.metalField}>
                    <Text style={s.chargeLabel}>Per Ounce ($)</Text>
                    <TextInput
                      style={s.chargeInput}
                      value={metalOunce}
                      onChangeText={setMetalOunce}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textSecondary}
                    />
                  </View>
                </View>
              </View>

              {hasMissingStones ? (
                <View style={s.warningBanner}>
                  <Icon name="warning" size={15} color="#92400E" />
                  <Text style={s.warningText}>Stone prices are missing — fill them in below to calculate pricing.</Text>
                </View>
              ) : (
                <View style={s.infoBanner}>
                  <Icon name="info" size={15} color={colors.primary} />
                  <Text style={s.infoText}>All stones filled. Ready to calculate pricing.</Text>
                </View>
              )}


              {renderStonesSection()}

            </ScrollView>
          )}
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
          visible={alertCfg.visible} title={alertCfg.title} message={alertCfg.message}
          type={alertCfg.type} buttons={alertCfg.buttons} onClose={hideAlert}
        />
      </>
    </Modal>
  );

  return (
    <>
      {isQRPhase ? renderQRPhase() : renderUpdateQuotation()}
    </>
  );
};

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    height: '93%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    overflow: 'hidden',
  },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: colors.primary,
  },
  headerTitle: { fontFamily: fonts.bold, fontSize: fonts.base || 15, color: '#fff' },
  headerSub:   { fontFamily: fonts.regular, fontSize: fonts.xs || 11, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  stepChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
  },
  stepChipText: { fontFamily: fonts.medium, fontSize: fonts.xs || 11, color: colors.primary },
  closeBtn: { padding: 4 },

  stepRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, paddingHorizontal: 40, gap: 0,
    backgroundColor: colors.background,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight || '#F0F0F0',
    position: 'relative',
  },
  stepLine: {
    position: 'absolute', top: '50%', left: '30%', right: '30%',
    height: 1, backgroundColor: colors.borderLight || '#E0E0E0', zIndex: 0,
  },
  stepItem: { flex: 1, alignItems: 'center', gap: 4, zIndex: 1 },
  stepDot: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.borderLight || '#E0E0E0',
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: colors.primary },
  stepDotDone:   { backgroundColor: '#059669' },
  stepDotText:     { fontFamily: fonts.bold, fontSize: 12, color: colors.textSecondary },
  stepDotTextActive:{ color: '#fff' },
  stepLabel:     { fontFamily: fonts.regular, fontSize: fonts.xs || 11, color: colors.textSecondary },
  stepLabelActive:{ fontFamily: fonts.medium, color: colors.primary },

  scrollBody:    { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  warningBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FEF3C7', borderRadius: 10, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: '#F59E0B',
  },
  warningText: { flex: 1, fontFamily: fonts.bold, fontSize: fonts.sm || 13, color: '#92400E', lineHeight: 20 },
  infoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.primary + '15', borderRadius: 10, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: colors.primary + '40',
  },
  infoText: { flex: 1, fontFamily: fonts.bold, fontSize: fonts.sm || 13, color: colors.primary, lineHeight: 20 },

  sectionTitle: {
    fontFamily: fonts.bold, fontSize: fonts.sm || 13,
    color: colors.textPrimary, marginBottom: 8, marginTop: 4,
  },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8, marginTop: 4,
  },

  metalRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  metalField: { flex: 1 },

  chargesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chargeItem:  { width: '47%' },
  chargeLabel: { fontFamily: fonts.medium, fontSize: fonts.xs || 11, color: colors.textSecondary, marginBottom: 4 },
  chargeInput: {
    borderWidth: 1, borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
    fontFamily: fonts.regular, fontSize: fonts.sm || 13,
    color: colors.textPrimary, backgroundColor: colors.background,
  },
  inputError: { borderColor: colors.error || '#EF4444', borderWidth: 1.5 },
  inputErrorHighlight: { borderColor: '#DC2626', borderWidth: 1.5 },

  metalSection: { marginBottom: 8 },
  metalSectionMissing: { borderWidth: 1.5, borderColor: '#DC2626', borderRadius: 10, padding: 8 },

  missingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF2F2', borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 12,
    marginBottom: 10, borderWidth: 1, borderColor: '#DC2626',
  },
  missingBadgeText: {
    fontFamily: fonts.bold, fontSize: fonts.xs || 12, color: '#DC2626',
  },

  recalcBtnDisabled: { opacity: 0.4 },

  stoneTable: {
    borderWidth: 1, borderColor: colors.borderLight || '#E8E8E8',
    borderRadius: 10, overflow: 'hidden', marginBottom: 16,
    backgroundColor: colors.white,
  },
  stoneTableHeader: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  stoneRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 12,
    borderTopWidth: 1, borderTopColor: colors.borderLight || '#F0F0F0',
  },
  stoneRowAlt: { backgroundColor: colors.backgroundSecondary || '#F8F8F8' },
  stoneRowMissing: { borderWidth: 1.5, borderColor: '#DC2626', backgroundColor: '#FEF2F2' },

  stoneCol:        { textAlign: 'center' },
  stoneColType:    { flex: 2.5, textAlign: 'left' },
  stoneColShape:   { flex: 2, textAlign: 'left' },
  stoneColNum:     { flex: 1.2 },
  stoneColPrice:   { flex: 1.8 },
  stoneColActions: { width: 74, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
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

  stoneTh: { fontFamily: fonts.bold,    fontSize: 11, color: '#fff' },
  stoneTd: { fontFamily: fonts.regular, fontSize: 12, color: colors.textPrimary },
  stonePriceMissing: { color: colors.error || '#EF4444', fontWeight: 'bold' },

  stoneAddRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.borderLight || '#F0F0F0',
  },
  stoneAddRowText: { fontFamily: fonts.medium, fontSize: 12, color: colors.primary },

  emptyStones: {
    alignItems: 'center', gap: 10, paddingVertical: 24,
    borderWidth: 1, borderStyle: 'dashed',
    borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 10, marginBottom: 16,
  },
  emptyStonesText: { fontFamily: fonts.regular, fontSize: fonts.sm || 13, color: colors.textSecondary },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20,
  },
  addBtnText: { fontFamily: fonts.medium, fontSize: fonts.xs || 12, color: '#fff' },

  calcBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: colors.primary,
    paddingVertical: 13, borderRadius: 12, marginTop: 16,
  },
  calcBtnDisabled: { opacity: 0.5 },
  calcBtnText: { fontFamily: fonts.bold, fontSize: fonts.sm || 14, color: '#fff' },

  resultCard: {
    backgroundColor: colors.backgroundSecondary || '#F8F9FA',
    borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: colors.borderLight || '#E8E8E8',
  },
  resultTitle: { fontFamily: fonts.bold, fontSize: fonts.base || 15, color: colors.textPrimary, marginBottom: 12 },
  resultRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderLight || '#F0F0F0' },
  resultLbl:   { fontFamily: fonts.medium, fontSize: fonts.sm || 13, color: colors.textSecondary },
  resultVal:   { fontFamily: fonts.bold, fontSize: fonts.sm || 13, color: colors.textPrimary },
  resultTotalRow: { borderBottomWidth: 0, marginTop: 6 },
  resultTotalLbl: { fontFamily: fonts.bold, fontSize: fonts.base || 15, color: colors.textPrimary },
  resultTotalVal: { fontFamily: fonts.bold, fontSize: fonts.lg || 18, color: colors.primary },
  recapCard: {
    backgroundColor: colors.background, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: colors.borderLight || '#E8E8E8', marginBottom: 8,
  },
  recapTitle: { fontFamily: fonts.medium, fontSize: fonts.xs || 12, color: colors.textSecondary, marginBottom: 2 },
  recapText:  { fontFamily: fonts.regular, fontSize: fonts.xs || 12, color: colors.textPrimary },
  viewPdfBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#DC2626',
    paddingVertical: 13, borderRadius: 12, marginTop: 16,
  },
  backEditBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, marginTop: 6,
  },
  backEditText: { fontFamily: fonts.medium, fontSize: fonts.sm || 13, color: colors.primary },

  pdfBar: { flexDirection: 'row', gap: 8, padding: 10, backgroundColor: 'rgba(0,0,0,0.75)' },
  pdfBarBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 10, borderRadius: 8,
  },
  pdfBarBtnText: { fontFamily: fonts.medium, fontSize: fonts.xs || 12, color: '#fff' },
  shareBtn: { backgroundColor: colors.primary },
  pdfPreviewToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  pdfPreviewBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pdfPreviewBtnActive: {
    backgroundColor: colors.primary,
  },
  pdfPreviewBtnText: {
    fontFamily: fonts.medium,
    fontSize: fonts.xs || 12,
    color: 'rgba(255,255,255,0.6)',
  },
  pdfPreviewBtnTextActive: {
    color: '#fff',
  },

  qualityBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: colors.background,
  },
  qualityBtnText: { fontFamily: fonts.regular, fontSize: fonts.sm || 13, color: colors.textPrimary, flex: 1 },

  pickerAbsOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 1000,
    elevation: 1000,
  },
  pickerOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 16, paddingBottom: 32, paddingHorizontal: 16,
  },
  pickerTitle: {
    fontFamily: fonts.bold, fontSize: fonts.base || 15,
    color: colors.textPrimary, marginBottom: 12, textAlign: 'center',
  },
  pickerOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 12,
    borderRadius: 10, marginBottom: 4,
  },
  pickerOptionSelected: { backgroundColor: colors.primary + '15' },
  pickerOptionText: { fontFamily: fonts.regular, fontSize: fonts.base || 15, color: colors.textPrimary },
  pickerOptionTextSelected: { fontFamily: fonts.bold, color: colors.primary },

  pdfBtnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  pdfRowBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 10,
  },
  pdfRowBtnText: { fontFamily: fonts.bold, fontSize: fonts.sm || 13, color: '#fff' },

  clientMsgCard: {
    marginTop: 20, borderWidth: 1, borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 12, padding: 14, backgroundColor: colors.backgroundSecondary || '#F8F9FA',
  },
  clientMsgHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
  },
  clientMsgLabel: {
    fontFamily: fonts.bold, fontSize: fonts.sm || 13, color: colors.textPrimary, flex: 1,
  },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 20, borderWidth: 1, borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  copyBtnText: { fontFamily: fonts.medium, fontSize: fonts.xs || 12, color: colors.primary },
  clientMsgInput: {
    minHeight: 100, borderWidth: 1, borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 8, padding: 10, fontFamily: fonts.regular,
    fontSize: fonts.sm || 13, color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  clientMsgText: {
    fontFamily: fonts.regular,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
    lineHeight: 20,
    marginTop: 4,
  },
});

export default QuotationModal;
