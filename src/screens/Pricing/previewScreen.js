import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Clipboard,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import PdfViewer from '../../components/common/PdfViewer';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, getStoneBg } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import Icon from '../../components/common/Icon';
import {
  useCalculatePricingMutation,
  useGetStoneShapesQuery,
  useGetStoneTypesQuery,
  useGetClientByIdQuery,
  useSavePricingMutation,
} from '../../store/api';
import { buildRecalculatePayload } from '../../utils/pricingRecalc';
import { LOGO_BASE64 } from '../../constants/logo';
import { normalizeExtraCharges } from '../../utils/extraCharges';

let generatePDFModule = null;
try {
  const mod = require('react-native-html-to-pdf');
  generatePDFModule = mod.generatePDF || mod.default?.generatePDF || mod.default;
} catch (e) {}

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const METAL_QUALITY_CHOICES = ['3K', '9K', '10K', '14K', '18K', '22K', '24K', 'Silver 925', 'Platinum'];


const buildEntryHtml = (entry, index, metalKt, clientName, simpleMetal = false, isEditable=false) => {
  const p = entry;
  const stones = p.Stones || [];
  
  const stoneTypes = [...new Set(stones.map(s => s.Type).filter(Boolean))];
  const diamondTypeLabel = stoneTypes.length > 0 ? stoneTypes.join(', ') : 'NATURAL';

  const ec = (entryIdx, stoneIdx, field, value, isDropdown = false, isMissing = false) => {
    if (!isEditable) return value;
    const cls = isMissing ? 'ed-cell ed-missing-cell' : 'ed-cell';
    const attrs = `contenteditable="true" data-ei="${entryIdx}" data-si="${stoneIdx}" data-field="${field}" class="${cls}"`;
    if (isDropdown) {
      return `<span data-ei="${entryIdx}" data-si="${stoneIdx}" data-field="${field}" class="ed-dropdown">${value}</span>`;
    }
    return `<span ${attrs}>${value}</span>`;
  };

  const stonesHtml = stones
    .map((s, idx) => {
      const rowBg = getStoneBg(s.Color);
      const isMissing = num(s.Price) <= 0;
      const bgStyle = isMissing
        ? 'background-color:#FEF2F2;'
        : (rowBg ? `background-color:${rowBg};` : '');
      return `
      <tr style="border-bottom:1px solid #E6F0F1;${bgStyle}">
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${ec(index, idx, 'Type', s.Type || 'NATURAL', true)}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${ec(index, idx, 'Shape', s.Shape || 'RD', true)}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${ec(index, idx, 'Color', s.Color || 'WH')}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${ec(index, idx, 'MmSize', s.MmSize || '-')}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${ec(index, idx, 'Weight', num(s.Weight).toFixed(3))}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${ec(index, idx, 'Markup', num(s.Markup || 0).toFixed(0))}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">$${ec(index, idx, 'Price', num(s.Price).toFixed(0), false, isMissing)}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${ec(index, idx, 'Pcs', s.Pcs || 0)}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${ec(index, idx, 'CtWeight', num(s.CtWeight).toFixed(3))}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;font-weight:700;">$${num(s.DiamondPrice != null ? s.DiamondPrice : num(s.Price) * num(s.CtWeight)).toFixed(2)}</td>
      </tr>`;
    })
    .join('');

  const hasLabStone = stones.some(s => /lab/i.test(s.Type));
  const displayMetalKt = p.MetalKT || metalKt;
  const isSilverOrPlat = displayMetalKt?.includes('Silver') || displayMetalKt?.includes('Platinum');

  const m = p.Metal || {};
  const mBase = m.MetalBase || {};
  const mLoss = m.Loss || {};
  const mLabour = m.Labour || {};
  const metalRate24K = num(m.Rate24K) || num(p.GoldRate24K);
  const metalRateKT = num(m.RateKT) || num(p.GoldRateKT);
  const metalWeight = num(m.Weight) || num(p.GoldWeight);
  const metalLossRate = num(mLoss.Rate) || num(p.LossPercent);
  const metalLabourRate = num(mLabour.Rate) || num(p.LabourPercent);
  const metalBaseAmt = num(mBase.Amount) || num(p.GoldAmount);
  const metalLossAmt = num(mLoss.Amount) || num(p.LossAmount);
  const metalLabourAmt = num(mLabour.Amount) || num(p.LabourAmount);
  const metalTotal = num(m.MetalPrice) || num(p.MetalPrice);
  const metalBaseRate = num(mBase.Rate);
  const metalBaseWeight = num(mBase.BaseAmount);
  const metalLossBase = num(mLoss.BaseAmount);
  const metalLabourWeight = num(mLabour.BaseAmount);

  const metalHtml = `
  <table style="width:100%;border-collapse:collapse;margin-top:12px;border:1px solid #E6F0F1;">
    <thead>
      <tr style="background-color:#143F45;color:#ffffff;text-align:center;font-size:10px;font-weight:700;">
        <th colspan="3" style="padding:6px;border:1px solid #0F3236;background-color:#D4AF37;color:#1A1A1A;">METAL BREAKDOWN</th>
      </tr>
      <tr style="background-color:#235A63;color:#ffffff;text-align:center;font-size:9px;font-weight:700;">
        <th style="padding:4px;border:1px solid #0F3236;">Component</th>
        <th style="padding:4px;border:1px solid #0F3236;">Rate × Base</th>
        <th style="padding:4px;border:1px solid #0F3236;">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr style="text-align:center;font-size:11px;">
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">Metal Base (${displayMetalKt})</td>
        <td style="padding:6px;border:1px solid #E6F0F1;">$${metalBaseRate.toFixed(3)}/g × ${metalBaseWeight.toFixed(1)}g</td>
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">$${metalBaseAmt.toFixed(3)}</td>
      </tr>
      <tr style="text-align:center;font-size:11px;">
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">Loss</td>
        <td style="padding:6px;border:1px solid #E6F0F1;">${metalLossRate}% × $${metalLossBase.toFixed(3)}</td>
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">$${metalLossAmt.toFixed(3)}</td>
      </tr>
      <tr style="text-align:center;font-size:11px;">
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">Labour</td>
        <td style="padding:6px;border:1px solid #E6F0F1;">$${metalLabourRate.toFixed(3)}/g × ${metalLabourWeight.toFixed(1)}g</td>
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">$${metalLabourAmt.toFixed(3)}</td>
      </tr>
      <tr style="text-align:center;font-size:11px;background-color:#FFF8E1;">
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#1A1A1A;" colspan="2">Total Metal Price</td>
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#143F45;">$${metalTotal.toFixed(3)}</td>
      </tr>
    </tbody>
  </table>`;

  const dutyLabels = {
    Natural: 'Natural',
    Lab: 'Lab',
    Gold: 'Gold',
    LossAndLabour: 'Loss + Labour',
    SilverAndLabs: hasLabStone ? 'Silver & Labs' : 'Silver',
  };
  const dutiesEntries = p.Duties ? Object.entries(p.Duties) : [];
  const undercutPrice = num(p.Client?.UndercutPrice || 0);
  const hasNaturalDuty = dutiesEntries.some(([k]) => k === 'Natural');
  const totalDutiesWithUndercut = num(p.TotalDutiesWithUndercut);
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
    <tbody>
      ${dutiesEntries.map(([key, duty]) => {
        const label = dutyLabels[key] || key.replace(/([A-Z])/g, ' $1').trim();
        return `
        <tr style="text-align:center;font-size:11px;">
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">${label}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">${ec(index, null, 'DutyRate.' + key, num(p.DutyRate?.[key] ?? duty.Rate).toFixed(0))}% × $${num(duty.BaseAmount).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">$${num(duty.Amount).toFixed(2)}</td>
        </tr>`;
      }).join('')}
      ${hasNaturalDuty && undercutPrice > 0 ? `
      <tr style="text-align:center;font-size:11px;background-color:#FFF8E1;">
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#1A1A1A;" colspan="2">Total Duties</td>
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#143F45;">$${totalDutiesWithUndercut.toFixed(2)}</td>
      </tr>` : dutiesEntries.length > 0 ? `
      <tr style="text-align:center;font-size:11px;background-color:#FFF8E1;">
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#1A1A1A;" colspan="2">Duties Amount</td>
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#143F45;">$${num(p.DutiesAmount).toFixed(2)}</td>
      </tr>` : ''}
    </tbody>
  </table>` : '';

  const extraChargesAmt = num(p.ExtraChargesAmount);
  const hasExtraCharges = num(p.ExtraChargesPercent) > 0 || extraChargesAmt > 0;
  const extraChargesHtml = hasExtraCharges ? `
  <div style="margin-top:12px;padding:8px;background:#FFF8E1;border:1px solid #D4AF37;border-radius:4px;display:flex;justify-content:space-between;font-size:11px;font-weight:600;">
    <span>Extra Charges ${p.ExtraChargesType === 'fixed' ? '(Fixed)' : `(${num(p.ExtraChargesPercent).toFixed(0)}%)`}</span>
    <span>$${extraChargesAmt.toFixed(2)}</span>
  </div>` : '';

  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return `
    <div class="section" style="page-break-inside:avoid;margin-bottom:24px;border:2px solid #143F45;border-radius:8px;padding:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:-12px -12px 14px -12px;padding:9px 14px;background:#143F45;border-radius:6px 6px 0 0;">
        <div style="font-size:13px;font-weight:800;color:#D4AF37;letter-spacing:0.06em;text-transform:uppercase;">${diamondTypeLabel}</div>
        <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.85);">Section ${index + 1}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr style="background-color:#143F45;color:#ffffff;text-align:center;font-size:10px;font-weight:700;">
            <th style="padding:8px;border:1px solid #0F3236;">Date</th>
            <th style="padding:8px;border:1px solid #0F3236;">KT & Diamond Type</th>
            <th style="padding:8px;border:1px solid #0F3236;">Client</th>
          </tr>
        </thead>
        <tbody>
          <tr style="text-align:center;font-size:12px;font-weight:700;color:#1A1A1A;">
            <td style="padding:10px;border:1px solid #E6F0F1;">${currentDate}</td>
            <td style="padding:10px;border:1px solid #E6F0F1;background-color:#FFF8E1;">${p.MetalKT || metalKt} & ${diamondTypeLabel}</td>
            <td style="padding:10px;border:1px solid #E6F0F1;">${clientName || p.Client || '-'}</td>
          </tr>
        </tbody>
      </table>

      <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;">
        
        <div>
          ${simpleMetal ? `
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead>
              <tr style="background-color:#235A63;color:#ffffff;text-align:center;font-weight:700;">
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">KT</th>
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">METAL WEIGHT</th>
              </tr>
            </thead>
            <tbody>
              <tr style="text-align:center;font-weight:600;font-size:11px;">
                <td style="padding:6px;border:1px solid #E6F0F1;">${ec(index, null, 'MetalKT', p.MetalKT || metalKt, true)}</td>
                <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;">${ec(index, null, 'Metal.Weight', metalWeight.toFixed(1), false, metalWeight <= 0)}</td>
              </tr>
            </tbody>
          </table>` : `
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead>
              <tr style="background-color:#235A63;color:#ffffff;text-align:center;font-weight:700;">
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">KT</th>
                ${!isSilverOrPlat ? `<th style="padding:4px;border:1px solid #0F3236;font-size:9px;">METAL RATE PER GRAM (24k)</th>` : ''}
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">METAL RATE PER GRAM</th>
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;background-color:#143F45;">LOSS</th>
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;background-color:#143F45;">LABOUR ($/g)</th>
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">METAL AMT</th>
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">LOSS AMT</th>
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">LABOUR AMT</th>
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">METAL WEIGHT</th>
              </tr>
            </thead>
            <tbody>
              <tr style="text-align:center;font-weight:600;font-size:11px;">
                <td style="padding:6px;border:1px solid #E6F0F1;">${ec(index, null, 'MetalKT', p.MetalKT || metalKt, true)}</td>
                ${!isSilverOrPlat ? `<td style="padding:6px;border:1px solid #E6F0F1;">$${ec(index, null, 'Metal.Rate24K', metalRate24K)}</td>` : ''}
                <td style="padding:6px;border:1px solid #E6F0F1;">$${ec(index, null, 'Metal.RateKT', metalRateKT)}</td>
                <td style="padding:6px;border:1px solid #E6F0F1;color:#EF4444;">${ec(index, null, 'LossPercent', metalLossRate)}%</td>
                <td style="padding:6px;border:1px solid #E6F0F1;color:#EF4444;">$${ec(index, null, 'LabourPercent', metalLabourRate.toFixed(2))}/g</td>
                <td style="padding:6px;border:1px solid #E6F0F1;">$${metalBaseAmt.toFixed(2)}</td>
                <td style="padding:6px;border:1px solid #E6F0F1;">$${metalLossAmt.toFixed(2)}</td>
                <td style="padding:6px;border:1px solid #E6F0F1;">$${metalLabourAmt.toFixed(2)}</td>
                <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;">${ec(index, null, 'Metal.Weight', metalWeight.toFixed(1), false, metalWeight <= 0)}</td>
              </tr>
            </tbody>
          </table>`}
        </div>

        <div>
          <table style="width:100%;border-collapse:collapse;font-size:10px;border:1px solid #E6F0F1;">
            <thead>
              <tr style="background-color:#143F45;color:#ffffff;text-align:center;font-weight:700;">
                <th style="padding:4px;border:1px solid #0F3236;">Diamond Type</th>
                <th style="padding:4px;border:1px solid #0F3236;">ST. Shape</th>
                <th style="padding:4px;border:1px solid #0F3236;">COLOR</th>
                <th style="padding:4px;border:1px solid #0F3236;">MM SIZE</th>
                <th style="padding:4px;border:1px solid #0F3236;">AVG CT</th>
                <th style="padding:4px;border:1px solid #0F3236;">MARK UP</th>
                <th style="padding:4px;border:1px solid #0F3236;">RATE /g</th>
                <th style="padding:4px;border:1px solid #0F3236;">QTY</th>
                <th style="padding:4px;border:1px solid #0F3236;">CT WT</th>
                <th style="padding:4px;border:1px solid #0F3236;">DIA PRICE</th>
              </tr>
            </thead>
            <tbody>
              ${stonesHtml}
            </tbody>
          </table>

          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;flex-wrap:wrap;">
            <div style="background:#143F45;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
              <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.05em;">Total Stones</div>
              <div style="font-size:13px;font-weight:700;color:#fff;">${num(p.TotalPieces).toFixed(0)}</div>
            </div>
            <div style="background:#143F45;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
              <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.05em;">Dia Wt</div>
              <div style="font-size:13px;font-weight:700;color:#fff;">${num(p.DiamondWeight).toFixed(3)}</div>
            </div>
            <div style="background:#D4AF37;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
              <div style="font-size:7px;color:#1A1A1A;text-transform:uppercase;letter-spacing:0.05em;">Dia Price</div>
              <div style="font-size:13px;font-weight:700;color:#1A1A1A;">$${num(p.DiamondsPrice).toFixed(0)}</div>
            </div>
          </div>
        </div>
      </div>

      ${metalHtml}

      ${dutiesHtml}

      ${extraChargesHtml}

      <div style="display:flex;justify-content:flex-end;align-items:center;margin-top:10px;gap:8px;padding:6px 10px;background:#143F45;border-radius:6px;">
        <div style="text-align:center;flex:1;">
          <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.05em;">Metal</div>
          <div style="font-size:11px;font-weight:700;color:#fff;">$${num(p.MetalPrice).toFixed(0)}</div>
        </div>
        <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);">
          <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.05em;">Dia Price</div>
          <div style="font-size:11px;font-weight:700;color:#fff;">$${num(p.DiamondsPrice).toFixed(0)}</div>
        </div>
        <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);">
          <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.05em;">Duties</div>
          <div style="font-size:11px;font-weight:700;color:#fff;">$${num(p.DutiesAmount).toFixed(0)}</div>
        </div>
        <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);background:#D4AF37;border-radius:4px;padding:4px 6px;">
          <div style="font-size:7px;color:#1A1A1A;text-transform:uppercase;letter-spacing:0.05em;">Total</div>
          <div style="font-size:13px;font-weight:800;color:#1A1A1A;">$${num(p.TotalPrice).toFixed(0)}</div>
        </div>
      </div>
    </div>
  `;
};

const buildClientEntryHtml = (entry, index, metalKt, clientName, simpleMetal = false) => {
  const p = entry;
  const stones = p.Stones || [];
  const ec = (_e, _s, _f, value) => value;

  const stoneTypes = [...new Set(stones.map(s => s.Type).filter(Boolean))];
  const diamondTypeLabel = stoneTypes.length > 0 ? stoneTypes.join(', ') : 'NATURAL';

  const stonesHtml = stones
    .map((s) => {
      const rowBg = getStoneBg(s.Color);
      const bgStyle = rowBg ? `background-color:${rowBg};` : '';
      return `
      <tr style="border-bottom:1px solid #E6F0F1;${bgStyle}">
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${s.Type || 'NATURAL'}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${s.Shape || 'RD'}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${s.Color || 'WH'}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:center;">${s.MmSize || '-'}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${num(s.Weight).toFixed(3)}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${num(s.Markup || 0).toFixed(0)}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">$${num(s.Price).toFixed(0)}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${s.Pcs || 0}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;">${num(s.CtWeight).toFixed(3)}</td>
        <td style="padding:6px 4px;font-family:monospace;font-size:11px;text-align:right;font-weight:700;">$${num(s.DiamondPrice != null ? s.DiamondPrice : num(s.Price) * num(s.CtWeight)).toFixed(2)}</td>
      </tr>`;
    })
    .join('');

  const hasLabStone = stones.some(s => /lab/i.test(s.Type));
  const displayMetalKt = p.MetalKT || metalKt;
  const isSilverOrPlat = displayMetalKt?.includes('Silver') || displayMetalKt?.includes('Platinum');
  const dutyLabels = {
    Natural: 'Natural',
    Lab: 'Lab',
    Gold: 'Gold',
    LossAndLabour: 'Loss + Labour',
    SilverAndLabs: hasLabStone ? 'Silver & Labs' : 'Silver',
  };
  const dutiesEntries = p.Duties ? Object.entries(p.Duties) : [];
  const undercutPrice = num(p.Client?.UndercutPrice || 0);
  const hasNaturalDuty = dutiesEntries.some(([k]) => k === 'Natural');
  const totalDutiesWithUndercut = num(p.TotalDutiesWithUndercut);
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
    <tbody>
      ${dutiesEntries.map(([key, duty]) => {
        const label = dutyLabels[key] || key.replace(/([A-Z])/g, ' $1').trim();
        return `
        <tr style="text-align:center;font-size:11px;">
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">${label}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;">${ec(index, null, 'DutyRate.' + key, num(p.DutyRate?.[key] ?? duty.Rate).toFixed(0))}% × $${num(duty.BaseAmount).toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #E6F0F1;font-weight:600;">$${num(duty.Amount).toFixed(2)}</td>
        </tr>`;
      }).join('')}
      ${hasNaturalDuty && undercutPrice > 0 ? `
      <tr style="text-align:center;font-size:11px;background-color:#FFF8E1;">
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#1A1A1A;" colspan="2">Total Duties</td>
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#143F45;">$${totalDutiesWithUndercut.toFixed(2)}</td>
      </tr>` : dutiesEntries.length > 0 ? `
      <tr style="text-align:center;font-size:11px;background-color:#FFF8E1;">
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#1A1A1A;" colspan="2">Duties Amount</td>
        <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;color:#143F45;">$${num(p.DutiesAmount).toFixed(2)}</td>
      </tr>` : ''}
    </tbody>
  </table>` : '';

  const extraChargesAmt = num(p.ExtraChargesAmount);
  const hasExtraCharges = num(p.ExtraChargesPercent) > 0 || extraChargesAmt > 0;
  const extraChargesHtml = hasExtraCharges ? `
  <div style="margin-top:12px;padding:8px;background:#FFF8E1;border:1px solid #D4AF37;border-radius:4px;display:flex;justify-content:space-between;font-size:11px;font-weight:600;">
    <span>Special Charges ${p.ExtraChargesType === 'fixed' ? '(Fixed)' : `(${num(p.ExtraChargesPercent).toFixed(0)}%)`}</span>
    <span>$${extraChargesAmt.toFixed(2)}</span>
  </div>` : '';

  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const goldRatePerOunce = num(p.GoldRatePerOunce).toFixed(3);

  return `
    <div class="section" style="page-break-inside:avoid;margin-bottom:12px;border:2px solid #143F45;border-radius:8px;padding:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:-12px -12px 12px -12px;padding:9px 14px;background:#143F45;border-radius:6px 6px 0 0;">
        <div style="font-size:13px;font-weight:800;color:#D4AF37;letter-spacing:0.06em;text-transform:uppercase;">${diamondTypeLabel}</div>
        <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.85);">Section ${index + 1}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
        <thead>
          <tr style="background-color:#143F45;color:#ffffff;text-align:center;font-size:10px;font-weight:700;">
            <th style="padding:8px;border:1px solid #0F3236;">Date</th>
            <th style="padding:8px;border:1px solid #0F3236;">KT & Diamond Type</th>
            <th style="padding:8px;border:1px solid #0F3236;">Client</th>
          </tr>
        </thead>
        <tbody>
          <tr style="text-align:center;font-size:12px;font-weight:700;color:#1A1A1A;">
            <td style="padding:10px;border:1px solid #E6F0F1;">${currentDate}</td>
            <td style="padding:10px;border:1px solid #E6F0F1;background-color:#FFF8E1;">${p.MetalKT || metalKt} & ${diamondTypeLabel}</td>
            <td style="padding:10px;border:1px solid #E6F0F1;">${clientName || p.Client || '-'}</td>
          </tr>
        </tbody>
      </table>

      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;">

        <div>
          ${simpleMetal ? `
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead>
              <tr style="background-color:#235A63;color:#ffffff;text-align:center;font-weight:700;">
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">KT</th>
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">METAL WEIGHT</th>
              </tr>
            </thead>
            <tbody>
              <tr style="text-align:center;font-weight:600;font-size:11px;">
                <td style="padding:6px;border:1px solid #E6F0F1;">${ec(index, null, 'MetalKT', p.MetalKT || metalKt, true)}</td>
                <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;">${num(p.GoldWeight).toFixed(1)}</td>
              </tr>
            </tbody>
          </table>` : `
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead>
              <tr style="background-color:#235A63;color:#ffffff;text-align:center;font-weight:700;">
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">KT</th>
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">${isSilverOrPlat ? 'METAL RATE PER OUNCE' : 'METAL RATE PER OUNCE (24k)'}</th>
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">METAL WEIGHT</th>
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">METAL RATE PER GRAM</th>
                <th style="padding:4px;border:1px solid #0F3236;font-size:9px;">METAL Price</th>

              </tr>
            </thead>
            <tbody>
              <tr style="text-align:center;font-weight:600;font-size:11px;">
                <td style="padding:6px;border:1px solid #E6F0F1;">${ec(index, null, 'MetalKT', p.MetalKT || metalKt, true)}</td>
                <td style="padding:6px;border:1px solid #E6F0F1;">$${goldRatePerOunce}</td>
                <td style="padding:6px;border:1px solid #E6F0F1;font-weight:700;">${num(p.GoldWeight).toFixed(1)} grm</td>                
                <td style="padding:6px;border:1px solid #E6F0F1;">$${num(p.GoldRateKT)}</td>
                <td style="padding:6px;border:1px solid #E6F0F1;">$${num(p.MetalPrice).toFixed(2)}</td>

              </tr>
            </tbody>
          </table>`}
        </div>

        <div>
          <table style="width:100%;border-collapse:collapse;font-size:10px;border:1px solid #E6F0F1;">
            <thead>
              <tr style="background-color:#143F45;color:#ffffff;text-align:center;font-weight:700;">
                <th style="padding:4px;border:1px solid #0F3236;">Diamond Type</th>
                <th style="padding:4px;border:1px solid #0F3236;">ST. Shape</th>
                <th style="padding:4px;border:1px solid #0F3236;">COLOR</th>
                <th style="padding:4px;border:1px solid #0F3236;">MM SIZE</th>
                <th style="padding:4px;border:1px solid #0F3236;">AVG CT</th>
                <th style="padding:4px;border:1px solid #0F3236;">MARK UP</th>
                <th style="padding:4px;border:1px solid #0F3236;">RATE /g</th>
                <th style="padding:4px;border:1px solid #0F3236;">QTY</th>
                <th style="padding:4px;border:1px solid #0F3236;">CT WT</th>
                <th style="padding:4px;border:1px solid #0F3236;">DIA PRICE (CT WT * RATE/g)</th>
              </tr>
            </thead>
            <tbody>
              ${stonesHtml}
            </tbody>
          </table>
          ${extraChargesHtml}

          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;flex-wrap:wrap;">
            <div style="background:#143F45;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
              <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.05em;">Total Stones</div>
              <div style="font-size:13px;font-weight:700;color:#fff;">${num(p.TotalPieces).toFixed(0)}</div>
            </div>
            <div style="background:#143F45;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
              <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.05em;">Dia Wt</div>
              <div style="font-size:13px;font-weight:700;color:#fff;">${num(p.DiamondWeight).toFixed(3)}</div>
            </div>
            <div style="background:#D4AF37;padding:4px 10px;border-radius:4px;text-align:center;min-width:80px;">
              <div style="font-size:7px;color:#1A1A1A;text-transform:uppercase;letter-spacing:0.05em;">Dia Price</div>
              <div style="font-size:13px;font-weight:700;color:#1A1A1A;">$${num(p.DiamondsPrice).toFixed(0)}</div>
            </div>
          </div>
        </div>
      </div>

      ${dutiesHtml}

      <div style="display:flex;justify-content:flex-end;align-items:center;margin-top:10px;gap:8px;padding:6px 10px;background:#143F45;border-radius:6px;">
        <div style="text-align:center;flex:1;">
          <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.05em;">Metal</div>
          <div style="font-size:11px;font-weight:700;color:#fff;">$${num(p.MetalPrice).toFixed(0)}</div>
        </div>
        <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);">
          <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.05em;">Dia Price</div>
          <div style="font-size:11px;font-weight:700;color:#fff;">$${num(p.DiamondsPrice).toFixed(0)}</div>
        </div>
        <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);">
          <div style="font-size:7px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.05em;">Duties</div>
          <div style="font-size:11px;font-weight:700;color:#fff;">$${num(p.DutiesAmount).toFixed(0)}</div>
        </div>
        <div style="text-align:center;flex:1;border-left:1px solid rgba(255,255,255,0.2);background:#D4AF37;border-radius:4px;padding:4px 6px;">
          <div style="font-size:7px;color:#1A1A1A;text-transform:uppercase;letter-spacing:0.05em;">Total</div>
          <div style="font-size:13px;font-weight:800;color:#1A1A1A;">$${num(p.TotalPrice).toFixed(0)}</div>
        </div>
      </div>

      ${p.ClientPricingMessage ? `
      <div style="margin-top:10px;padding:8px 10px;background:#F4F2EC;border-left:3px solid #D4AF37;border-radius:4px;">
        <div style="font-size:8px;font-weight:700;color:#143F45;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">${diamondTypeLabel} — Pricing Message</div>
        <div style="font-size:10px;color:#2B3735;line-height:1.45;white-space:pre-wrap;">${p.ClientPricingMessage}</div>
      </div>` : ''}
    </div>
  `;
};

const buildCombinedHtml = (pricingEntries, clientName, metalKt, preCropImageUrl, isClientPreview = false, isEditable = false) => {
  if (!pricingEntries || pricingEntries.length === 0) return '';

  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const sectionsHtml = pricingEntries
    .map((entry, index) => isClientPreview
      ? buildClientEntryHtml(entry, index, metalKt, clientName, false)
      : buildEntryHtml(entry, index, metalKt, clientName, false, isEditable))
    .join('');

  const logoSrc = `data:image/png;base64,${LOGO_BASE64}`;

  const preCropMaxHeight = isClientPreview ? 170 : 300;
  const preCropMarginBottom = isClientPreview ? 10 : 20;
  const preCropImageHtml = preCropImageUrl ? `
  <div style="text-align:center;margin-bottom:${preCropMarginBottom}px;">
    <img src="${preCropImageUrl}" style="max-width:100%;max-height:${preCropMaxHeight}px;border:1px solid #E6F0F1;border-radius:4px;" />
  </div>` : '';

  const editStyles = isEditable ? `
    <style>
      .ed-cell { outline:none; cursor:text; border-bottom:1px dashed #D4AF37; min-width:20px; display:inline-block; padding:1px 3px; border-radius:2px; transition: background 0.15s; }
      .ed-cell:hover { background:rgba(212,175,55,0.12); }
      .ed-cell:focus { background:rgba(212,175,55,0.2); border-bottom:2px solid #D4AF37; }
      .ed-missing-cell { color:#EF4444; border-bottom:2px solid #EF4444; font-weight:700; }
      .ed-missing-cell:focus { background:#FEE2E2; border-bottom:2px solid #EF4444; }
      .ed-dropdown { cursor:pointer; border-bottom:1px dashed #143F45; display:inline-block; padding:1px 3px; border-radius:2px; color:#143F45; font-weight:600; }
      .ed-dropdown:hover { background:rgba(20,63,69,0.1); }
      .ed-dropdown::after { content:' ▾'; font-size:8px; color:#143F45; }
      .ed-recalc-indicator { position:fixed; top:8px; right:8px; background:#D4AF37; color:#fff; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:600; z-index:9999; animation: pulse 1s infinite; }
      @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
    </style>` : '';

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=0.6, maximum-scale=3.0, user-scalable=yes">
    <title>Chandra Jewels - Official Pricing Document</title>
    <style>
      @page { margin: 0; padding: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: Arial, sans-serif; background-color: #ffffff; color: #1A1A1A; padding: 24px; }
      .header-container { display:flex; align-items:center; justify-content:center; gap:14px; margin-bottom: 20px; }
      .header-logo { height: 44px; width: auto; }
      .header-title { font-size: 24px; color: #D4AF37; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 2px; }
      .header-subtitle { font-size: 10px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.2em; }
      .divider { height: 1px; width: 100%; background-color: #E6F0F1; margin: 6px 0; }
    </style>
    ${editStyles}
  </head>
  <body>
    <div class="header-container">
      ${logoSrc ? `<img src="${logoSrc}" class="header-logo" />` : ''}
      <div>
        <h2 class="header-title">CHANDRA JEWELS</h2>
        <div class="divider"></div>
        <p class="header-subtitle">Official Pricing Sheet Matrix (Date Ref: ${currentDate})</p>
      </div>
    </div>
    
    ${preCropImageHtml}
    
    ${sectionsHtml}
    
    ${isEditable ? `
    <script>
    (function() {
      function sendEdit(el, value) {
        var ei = parseInt(el.getAttribute('data-ei'));
        var si = parseInt(el.getAttribute('data-si'));
        var field = el.getAttribute('data-field');
        if (isNaN(si)) si = null;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'edit', entryIdx: ei, stoneIdx: si, field: field, value: value
        }));
      }

      document.querySelectorAll('.ed-cell').forEach(function(el) {
        el.addEventListener('blur', function() {
          sendEdit(this, this.textContent.trim());
        });
        el.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
        });
      });

      document.querySelectorAll('.ed-dropdown').forEach(function(el) {
        el.addEventListener('click', function() {
          var ei = parseInt(this.getAttribute('data-ei'));
          var si = parseInt(this.getAttribute('data-si'));
          var field = this.getAttribute('data-field');
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'dropdown', entryIdx: ei, stoneIdx: si, field: field,
            currentValue: this.textContent.trim()
          }));
        });
      });

      var firstMissing = document.querySelector('.ed-missing-cell');
      if (firstMissing) {
        setTimeout(function() { firstMissing.focus(); }, 600);
      }
    })();
    </script>` : ''}
    
  </body>
  </html>`;
};

export default function PreviewScreen({ route, navigation }) {
  const {
    pricingEntries = [],
    clientName = 'Client',
    metalKt = '18K',
    modify = false,
    preCropImageKey = null,
    preCropImageUrl: preCropImageUrlParam = null,
    isClientPreview = false,
    clientId = null,
    selectedClient = null,
    isEnquiry = false,
    enquiryId: enquiryIdParam = null,
    designType: designTypeParam = null,
    version: versionParam = null,
    clientMessage: clientMessageParam = null,
    preservedPricing = null,
    activePricingIndex = 0,
  } = route.params || {};

  const showMessageFormat = !modify;
  const webViewRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [isSharingPdf, setIsSharingPdf] = useState(false);
  const [preCropImageUrl, setPreCropImageUrl] = useState(null);

  const [isEditing, setIsEditing] = useState(!isClientPreview);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [entries, setEntries] = useState(pricingEntries);
  const [calculatePricing] = useCalculatePricingMutation();
  const [savePricing] = useSavePricingMutation();

  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [dropdownConfig, setDropdownConfig] = useState({ type: '', entryIdx: 0, stoneIdx: 0, currentValue: '' });
  const [stoneTypeOptions, setStoneTypeOptions] = useState([]);
  const [shapeOptions, setShapeOptions] = useState([]);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const dirtyRef = useRef(false);
  const lookupChangedRef = useRef(false);
  const isAutoRecalculatingRef = useRef(false);

  const onEntriesUpdatedRef = useRef(null);
  onEntriesUpdatedRef.current = route.params?.onEntriesUpdated;

  useEffect(() => () => {
    onEntriesUpdatedRef.current?.(entriesRef.current);
  }, []);

  useEffect(() => {
    setEntries(pricingEntries);
  }, [pricingEntries]);

  const { data: stoneShapesData } = useGetStoneShapesQuery();
  useEffect(() => {
    if (Array.isArray(stoneShapesData)) {
      setShapeOptions(stoneShapesData.map(s => s.code || s.Code || s).filter(Boolean));
    }
  }, [stoneShapesData]);

  const { data: clientData } = useGetClientByIdQuery(clientId, { skip: !clientId });
  const { data: allStoneTypes } = useGetStoneTypesQuery();
  useEffect(() => {
    const applicable =
      selectedClient?.ApplicableStoneTypes ||
      selectedClient?.applicableStoneTypes ||
      clientData?.ApplicableStoneTypes ||
      clientData?.applicableStoneTypes ||
      [];
    const asCodes = (list) =>
      (list || []).map(t => (typeof t === 'string' ? t : (t?.value || t?.Value || t?.name || t?.Name))).filter(Boolean);

    const applicableCodes = asCodes(applicable);
    if (applicableCodes.length > 0) {
      setStoneTypeOptions(applicableCodes);
      return;
    }
    setStoneTypeOptions(asCodes(allStoneTypes));
  }, [selectedClient, clientData, allStoneTypes]);

  const combinedMessage = useMemo(() => {
    const messages = entries
      .map(entry => entry.ClientPricingMessage || '')
      .filter(Boolean);
    return messages.join('\n\n---\n\n');
  }, [entries]);

  const combinedHtml = useMemo(
    () => buildCombinedHtml(entries, clientName, metalKt, preCropImageUrl, false, isEditing),
    [entries, clientName, metalKt, preCropImageUrl, isEditing],
  );
  const combinedHtmlClient = useMemo(
    () => (isClientPreview ? buildCombinedHtml(entries, clientName, metalKt, preCropImageUrl, true, false) : ''),
    [entries, clientName, metalKt, preCropImageUrl, isClientPreview],
  );

  const handleWebViewMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'edit') {
        const { entryIdx, stoneIdx, field, value } = data;
        setEntries(prev => {
          const next = [...prev];
          if (!next[entryIdx]) return prev;
          const entry = { ...next[entryIdx] };
          if (stoneIdx !== null && stoneIdx !== undefined && entry.Stones) {
            const stones = [...entry.Stones];
            const numVal = parseFloat(value);
            stones[stoneIdx] = {
              ...stones[stoneIdx],
              [field]: isNaN(numVal) ? value : numVal,
            };
            entry.Stones = stones;
          } else {
            const numVal = parseFloat(value);
            const val = isNaN(numVal) ? value : numVal;
            if (field.includes('.')) {
              const [parent, child] = field.split('.');
              entry[parent] = { ...(entry[parent] || {}), [child]: val };
              if (field === 'Metal.RateKT' && num(val) > 0) {
                const kt = parseInt(String(entry.MetalKT || metalKt).match(/(\d+)\s*K/i)?.[1] || '', 10);
                entry.Metal.Rate24K = kt > 0 ? +((num(val) * 24) / kt).toFixed(3) : num(val);
              }
            } else {
              entry[field] = val;
            }
          }
          next[entryIdx] = entry;
          return next;
        });
        dirtyRef.current = true;
        if (field === 'Color' || field === 'Shape') {
          lookupChangedRef.current = true;
        }
      }
      if (data.type === 'dropdown') {
        const { entryIdx, stoneIdx, field, currentValue } = data;
        if (field === 'Type') {
          setDropdownConfig({ type: 'Type', entryIdx, stoneIdx, currentValue });
          setDropdownVisible(true);
        } else if (field === 'Shape') {
          setDropdownConfig({ type: 'Shape', entryIdx, stoneIdx, currentValue });
          setDropdownVisible(true);
        } else if (field === 'MetalKT') {
          setDropdownConfig({ type: 'MetalKT', entryIdx, stoneIdx: null, currentValue });
          setDropdownVisible(true);
        }
      }
    } catch (e) {}
  }, [metalKt]);

  const persistEntries = useCallback((currentEntries) => {
    if (!isEnquiry || !enquiryIdParam || !designTypeParam || !versionParam) return;
    if (!currentEntries || currentEntries.length === 0) return;
    const pricingArray = currentEntries.map(entry => {
      const savedStones = (entry.Stones || []).map(st => ({
        Type: st.Type || '', Color: st.Color || '', Shape: st.Shape || '',
        MmSize: String(st.MmSize ?? '0'), SieveSize: String(st.SieveSize ?? '0'),
        CtWeight: num(st.CtWeight), Weight: num(st.Weight),
        Pcs: Math.round(num(st.Pcs)), Price: num(st.Price), Markup: num(st.Markup || 0),
      }));
      return {
        isOnlyMetalDesign: savedStones.length === 0,
        Metal: {
          Weight: num(entry.Metal?.Weight) || num(entry.GoldWeight),
          Color: entry.Metal?.Color || '',
          Quality: entry.Metal?.Quality || entry.MetalKT || metalKt,
          Rate: num(entry.Metal?.Rate) || num(entry.Metal?.Rate24K) || num(entry.Metal?.RateKT),
        },
        Stones: savedStones,
        Loss: num(entry.Client?.Loss ?? entry.LossPercent ?? entry.Loss ?? 0),
        Labour: num(entry.Client?.Labour ?? entry.LabourPercent ?? entry.Labour ?? 0),
        ExtraCharges: normalizeExtraCharges(entry.Client?.ExtraCharges ?? entry.ExtraCharges),
        ExtraChargesType: entry.Client?.ExtraChargesType ?? entry.ExtraChargesType ?? 'percentage',
        UndercutPrice: num(entry.Client?.UndercutPrice ?? entry.UndercutPrice ?? 0),
        NaturalDuties: num(entry.Client?.NaturalDuties ?? entry.NaturalDuties ?? 0),
        LabDuties: num(entry.Client?.LabDuties ?? entry.LabDuties ?? 0),
        GoldDuties: num(entry.Client?.GoldDuties ?? entry.GoldDuties ?? 0),
        SilverAndLabsDuties: num(entry.Client?.SilverAndLabsDuties ?? entry.SilverAndLabsDuties ?? 0),
        LossAndLabourDuties: num(entry.Client?.LossAndLabourDuties ?? entry.LossAndLabourDuties ?? 0),
        MetalPrice: num(entry.MetalPrice), DiamondsPrice: num(entry.DiamondsPrice),
        DutiesAmount: num(entry.DutiesAmount), TotalPrice: num(entry.TotalPrice),
        DiamondWeight: num(entry.DiamondWeight), TotalPieces: num(entry.TotalPieces),
        ClientPricingMessage: entry.ClientPricingMessage || '',
      };
    });
    let finalArray = pricingArray;
    if (Array.isArray(preservedPricing) && preservedPricing.length > 0) {
      const merged = preservedPricing.map(p2 => {
        const { _id, ...rest } = p2 || {};
        return rest;
      });
      const editedWithFlags = pricingArray.map((pa, k) => ({
        ...pa,
        IsSentForApproaval: !!merged[activePricingIndex + k]?.IsSentForApproaval,
      }));
      merged.splice(activePricingIndex, editedWithFlags.length, ...editedWithFlags);
      finalArray = merged;
    }
    const allOnlyMetal = finalArray.every(p2 => (p2.Stones || []).length === 0);
    savePricing({
      enquiryId: enquiryIdParam, designType: designTypeParam, version: versionParam,
      pricingData: finalArray, isOnlyMetalDesign: allOnlyMetal,
    }).unwrap()
      .catch(err => console.warn('[preview][enquiry-save] FAILED', err?.status, err?.data?.message));
  }, [isEnquiry, enquiryIdParam, designTypeParam, versionParam, metalKt, savePricing, preservedPricing, activePricingIndex]);

  const triggerRecalculation = useCallback(async (isRecalc) => {
    const currentEntries = entriesRef.current;
    if (!currentEntries || currentEntries.length === 0 || !clientId) return;
    setIsRecalculating(true);
    try {
      const payloads = currentEntries.map(entry => {
        const editableStones = (entry.Stones || []).map(s => ({
          Type: s.Type || '',
          Color: s.Color || '',
          Shape: s.Shape || '',
          MmSize: (s.MmSize || '0').toString(),
          SieveSize: (s.SieveSize || '0').toString(),
          CtWeight: num(s.CtWeight),
          Weight: num(s.Weight),
          Pcs: num(s.Pcs),
          Price: isRecalc ? num(s.Price) : 0,
          Markup: num(s.Markup),
        }));
        return buildRecalculatePayload({
          clientId,
          data: {
            editableStones,
            editableMetal: {
              Weight: num(entry.Metal?.Weight),
              Quality: entry.MetalKT || metalKt,
              Rate: num(entry.Metal?.Rate24K) || num(entry.Metal?.RateKT),
            },
            editableCharges: (() => {
              const ex = normalizeExtraCharges(
                entry.Client?.ExtraCharges ?? entry.ExtraCharges ?? {
                  Type: entry.ExtraChargesType || 'percentage',
                  Value: num(entry.ExtraChargesPercent),
                },
              );
              return {
                Loss: num(entry.LossPercent ?? entry.Client?.Loss),
                Labour: num(entry.LabourPercent ?? entry.Client?.Labour),
                ExtraCharges: num(ex.Value),
                ExtraChargesType: ex.Type || 'percentage',
              };
            })(),
            dutyRates: (() => {
              const edits = entry.DutyRate || {};
              const mapped = {};
              Object.entries(edits).forEach(([k, v]) => {
                if (v === undefined || v === null || v === '') return;
                mapped[k.endsWith('Duties') ? k : `${k}Duties`] = num(v);
              });
              return mapped;
            })(),
            pricingResult: entry,
          },
          metalKt,
          selectedClient,
          isRecalculate: isRecalc,
        });
      });

      const results = await Promise.all(
        payloads.map(p => calculatePricing(p).unwrap().catch(() => null)),
      );

      const next = [...currentEntries];
      results.forEach((result, i) => {
        if (!result) return;
        const prevEntry = currentEntries[i] || {};
        next[i] = {
          ...result,
          MetalKT: prevEntry.MetalKT || result.MetalKT,
          Metal: { ...(prevEntry.Metal || {}), ...(result.Metal || {}) },
          DutyRate: prevEntry.DutyRate,
          Stones: (result.Stones || []).map(st => ({
            ...st,
            DiamondPrice: +(num(st.Price) * num(st.CtWeight)).toFixed(3),
          })),
        };
      });
      entriesRef.current = next;
      setEntries(next);
      persistEntries(next);
    } catch (e) {
      console.warn('[preview][recalc] ERROR', e?.status, e?.data?.message || e?.message, e);
    } finally {
      setIsRecalculating(false);
    }
  }, [clientId, metalKt, selectedClient, calculatePricing, persistEntries]);

  const didInitialRecalcRef = useRef(false);
  useEffect(() => {
    if (isClientPreview || didInitialRecalcRef.current) return;
    if (!clientId || !entriesRef.current || entriesRef.current.length === 0) return;
    didInitialRecalcRef.current = true;
    triggerRecalculation(true);
  }, [isClientPreview, clientId, triggerRecalculation]);

  useEffect(() => {
    if (isClientPreview) return;
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      if (!dirtyRef.current || !clientId) return;
      const refetchPrices = lookupChangedRef.current;
      dirtyRef.current = false;
      lookupChangedRef.current = false;
      if (!isAutoRecalculatingRef.current) {
        isAutoRecalculatingRef.current = true;
        const fn = refetchPrices
          ? () => triggerRecalculation(false)
          : () => triggerRecalculation(true);
        Promise.resolve(fn()).finally(() => {
          isAutoRecalculatingRef.current = false;
        });
      }
    });
    return () => sub.remove();
  }, [isClientPreview, clientId, triggerRecalculation]);

  // The new value has to be in entriesRef before recalculating: triggerRecalculation reads the
  // ref synchronously, and a setEntries updater would not have run yet.
  const handleDropdownSelect = useCallback((value) => {
    const { entryIdx, stoneIdx, type } = dropdownConfig;
    setDropdownVisible(false);

    const current = entriesRef.current;
    const target = current[entryIdx];
    if (!target) return;

    const entry = { ...target };
    if (type === 'MetalKT') {
      entry.MetalKT = value;
      entry.Metal = { ...(entry.Metal || {}), Quality: value };
    } else {
      const stones = entry.Stones ? [...entry.Stones] : [];
      if (!stones[stoneIdx]) return;
      stones[stoneIdx] = { ...stones[stoneIdx], [type]: value };
      entry.Stones = stones;
    }

    const next = [...current];
    next[entryIdx] = entry;
    entriesRef.current = next;
    setEntries(next);

    dirtyRef.current = false;
    lookupChangedRef.current = false;
    triggerRecalculation(false);
  }, [dropdownConfig, triggerRecalculation]);

  useEffect(() => {
    if (preCropImageUrlParam) {
      setPreCropImageUrl(preCropImageUrlParam);
      return;
    }
    if (!preCropImageKey) return;
    AsyncStorage.getItem(preCropImageKey).then(base64 => {
      if (base64) {
        setPreCropImageUrl(`data:image/jpeg;base64,${base64}`);
      }
    }).catch(() => {});
  }, [preCropImageKey, preCropImageUrlParam]);

  const handleCopy = useCallback(() => {
    if (combinedMessage) {
      Clipboard.setString(combinedMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [combinedMessage]);

  const handleSharePdf = useCallback(async () => {
    const htmlToShare = isClientPreview ? combinedHtmlClient : combinedHtml;
    if (!htmlToShare || isSharingPdf) return;
    try {
      setIsSharingPdf(true);
      if (typeof generatePDFModule !== 'function') {
        throw new Error('PDF library not available');
      }
      const pdf = await generatePDFModule({
        html: htmlToShare,
        fileName: `Pricing_${clientName.replace(/\s+/g, '_')}_${Date.now()}`,
        directory: 'Documents',
        base64: false,
        padding: 0,
      });
      const cachePath = `${
        RNFS.CachesDirectoryPath
      }/PricingReport_${Date.now()}.pdf`;
      await RNFS.copyFile(pdf.filePath, cachePath);
      await Share.open({
        title: 'Share Pricing Report',
        url: Platform.OS === 'android' ? `file://${cachePath}` : cachePath,
        type: 'application/pdf',
      });
      setTimeout(() => RNFS.unlink(cachePath).catch(() => {}), 5000);
    } catch (e) {
      if (e?.message && !e.message.includes('cancel')) {
        Alert.alert('Share PDF failed', e.message);
      }
    } finally {
      setIsSharingPdf(false);
    }
  }, [combinedHtml, combinedHtmlClient, clientName, isSharingPdf, isClientPreview]);

  const renderAdminpreview = () => {
    return(
<SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.8}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="close" size={24} color="#151515" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Pricing Preview</Text>
          <Text style={styles.headerSub}>
            {entries.length} section
            {entries.length !== 1 ? 's' : ''} - {clientName}
          </Text>
        </View>
        {isRecalculating && (
          <View style={styles.recalcBadge}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.recalcText}>Recalculating...</Text>
          </View>
        )}
        {!isClientPreview && (
          <TouchableOpacity
            style={[styles.editToggle, isEditing && styles.editToggleActive]}
            activeOpacity={0.8}
            onPress={() => setIsEditing(!isEditing)}
          >
            <MaterialIcons name={isEditing ? 'edit' : 'visibility'} size={16} color={isEditing ? '#fff' : colors.primary || '#143F45'} />
            <Text style={[styles.editToggleText, isEditing && styles.editToggleTextActive]}>
              {isEditing ? 'Editing' : 'View'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

        {showMessageFormat && combinedMessage && combinedMessage.trim() ? (
          <View style={styles.clientMsgCard}>
            <View style={styles.clientMsgHeader}>
              <Text style={styles.clientMsgLabel}>
                Copy pricing format for your client
              </Text>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={handleCopy}
                activeOpacity={0.8}
              >
                <Icon
                  name={copied ? 'check' : 'content-copy'}
                  size={15}
                  color={copied ? '#059669' : colors.primary}
                />
                <Text
                  style={[styles.copyBtnText, copied && { color: '#059669' }]}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.clientMsgInput}
              value={combinedMessage}
              multiline
              editable={false}
              placeholder="No pricing message saved yet..."
              placeholderTextColor={colors.textSecondary}
              textAlignVertical="top"
              scrollEnabled
              nestedScrollEnabled
            />
          </View>
        ) : null}

      <View style={styles.pdfContainer}>
        <PdfViewer
          ref={webViewRef}
          html={combinedHtml}
          style={styles.pdfViewer}
          onMessage={handleWebViewMessage}
        />
      </View>
      
      

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[
              styles.sharePdfBtn,
              isSharingPdf && styles.sharePdfBtnDisabled,
            ]}
            activeOpacity={0.8}
            onPress={handleSharePdf}
            disabled={isSharingPdf}
          >
            {isSharingPdf ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name="share" size={16} color="#fff" />
            )}
            <Text style={styles.sharePdfBtnText}>
              {isSharingPdf ? 'Sharing...' : 'Share PDF'}
            </Text>
          </TouchableOpacity>
        </View>

    </SafeAreaView>
    )
  }
const renderClientPreview = () => {
    return(
<SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.8}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="close" size={24} color="#151515" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Pricing Preview</Text>
          <Text style={styles.headerSub}>
            {entries.length} section
            {entries.length !== 1 ? 's' : ''} - {clientName}
          </Text>
        </View>
      </View>

      <View style={styles.pdfContainer}>
        <PdfViewer html={combinedHtmlClient} style={styles.pdfViewer} />
      </View>
      
      

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[
              styles.sharePdfBtn,
              isSharingPdf && styles.sharePdfBtnDisabled,
            ]}
            activeOpacity={0.8}
            onPress={handleSharePdf}
            disabled={isSharingPdf}
          >
            {isSharingPdf ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name="share" size={16} color="#fff" />
            )}
            <Text style={styles.sharePdfBtnText}>
              {isSharingPdf ? 'Sharing...' : 'Share PDF'}
            </Text>
          </TouchableOpacity>
        </View>

    </SafeAreaView>
    )
  }

  const renderEnquiryPricing = () => {
    const enquiryMsg = combinedMessage || clientMessageParam;
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.8}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="close" size={24} color="#151515" />
        </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>View Pricing</Text>
            <Text style={styles.headerSub}>
              {entries.length} section{entries.length !== 1 ? 's' : ''} - {clientName}
            </Text>
          </View>
          {isRecalculating && (
            <View style={styles.recalcBadge}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.recalcText}>Recalculating...</Text>
            </View>
          )}
        </View>

        {enquiryMsg ? (
          <View style={styles.clientMsgCard}>
            <View style={styles.clientMsgHeader}>
              <Text style={styles.clientMsgLabel}>Client Pricing Message</Text>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={() => {
                  Clipboard.setString(enquiryMsg);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                activeOpacity={0.8}
              >
                <Icon
                  name={copied ? 'check' : 'content-copy'}
                  size={15}
                  color={copied ? '#059669' : colors.primary}
                />
                <Text style={[styles.copyBtnText, copied && { color: '#059669' }]}>
                  {copied ? 'Copied!' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.clientMsgInput}
              value={enquiryMsg}
              multiline
              editable={false}
              placeholder="No pricing message saved yet..."
              placeholderTextColor={colors.textSecondary}
              textAlignVertical="top"
              scrollEnabled
              nestedScrollEnabled
            />
          </View>
        ) : null}

        <View style={styles.pdfContainer}>
          <PdfViewer
            ref={webViewRef}
            html={combinedHtml}
            style={styles.pdfViewer}
            onMessage={handleWebViewMessage}
          />
        </View>

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[
              styles.sharePdfBtn,
              isSharingPdf && styles.sharePdfBtnDisabled,
            ]}
            activeOpacity={0.8}
            onPress={handleSharePdf}
            disabled={isSharingPdf}
          >
            {isSharingPdf ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name="share" size={16} color="#fff" />
            )}
            <Text style={styles.sharePdfBtnText}>
              {isSharingPdf ? 'Sharing...' : 'Share PDF'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  };

  return (
    <>
    {isEnquiry ? renderEnquiryPricing() : (isClientPreview ? renderClientPreview() : renderAdminpreview())}

    <Modal
      visible={dropdownVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setDropdownVisible(false)}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={() => setDropdownVisible(false)}
      >
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              Select {dropdownConfig.type === 'MetalKT' ? 'Metal Quality' : dropdownConfig.type}
            </Text>
            <TouchableOpacity onPress={() => setDropdownVisible(false)}>
              <MaterialIcons name="close" size={22} color="#666" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={
              dropdownConfig.type === 'Type' ? stoneTypeOptions
                : dropdownConfig.type === 'MetalKT' ? METAL_QUALITY_CHOICES
                  : shapeOptions
            }
            keyExtractor={(item) => item}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.modalItem,
                  item === dropdownConfig.currentValue && styles.modalItemActive,
                ]}
                onPress={() => handleDropdownSelect(item)}
              >
                <Text style={[
                  styles.modalItemText,
                  item === dropdownConfig.currentValue && styles.modalItemTextActive,
                ]}>
                  {item}
                </Text>
                {item === dropdownConfig.currentValue && (
                  <MaterialIcons name="check" size={18} color={colors.primary || '#143F45'} />
                )}
              </TouchableOpacity>
            )}
          />
        </View>
      </TouchableOpacity>
    </Modal>
    </>
  );
}

export { num, buildCombinedHtml };

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary || '#F5F5F5',
  },
  headerRow: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 10,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E1E3E6',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F3F5',
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    color: '#171717',
    fontSize: 17,
    fontWeight: '600',
  },
  headerSub: {
    color: '#8A8D93',
    fontSize: 12,
    marginTop: 2,
  },
  pdfContainer: {
    flex: 3,
    backgroundColor: '#fff',
  },
  pdfViewer: {
    flex: 1,
  },
  bottomBar: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E1E3E6',
    alignItems: 'center',
    gap: 10,
  },
  sharePdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.primary || '#143F45',
  },
  sharePdfBtnDisabled: {
    opacity: 0.6,
  },
  sharePdfBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },

  clientMsgCard: {
    marginTop: 0,
    borderTopWidth: 1,
    borderWidth: 1,
    borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 12,
    padding: 14,
    backgroundColor: colors.backgroundSecondary || '#F8F9FA',
    maxHeight: 200,
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
    minHeight: 90,
    maxHeight: 150,
    borderWidth: 1,
    borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 8,
    padding: 10,
    fontFamily: fonts.regular,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  editToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.primary || '#143F45',
    backgroundColor: '#fff',
  },
  editToggleActive: {
    backgroundColor: colors.primary || '#143F45',
    borderColor: colors.primary || '#143F45',
  },
  editToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary || '#143F45',
  },
  editToggleTextActive: {
    color: '#fff',
  },
  recalcBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
  },
  recalcText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '60%',
    paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E1E3E6',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#171717',
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  modalItemActive: {
    backgroundColor: '#F0F7F8',
  },
  modalItemText: {
    fontSize: 15,
    color: '#333',
  },
  modalItemTextActive: {
    color: colors.primary || '#143F45',
    fontWeight: '600',
  },
});
