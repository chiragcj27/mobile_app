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
  TextInput, ActivityIndicator, Platform,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import Icon from '../common/Icon';
import PdfViewer from '../common/PdfViewer';
import BrandedAlert from '../common/BrandedAlert';
import DiamondEditModal from '../../screens/Admin/components/DiamondEditModal';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import {
  useCalculatePricingMutation,
  useGetMetalPricesQuery,
  useSavePricingMutation,
  useGetEnquiryByIdQuery,
} from '../../store/api';
import CompareRefrences from './CompareRefrences';

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

const mapSourceToPricingResult = (source) => {
  if (!source) return null;
  const mp = num(source.MetalPrice);
  const dp = num(source.DiamondsPrice);
  const da = num(source.DutiesAmount);
  const tp = num(source.TotalPrice);
  if (mp === 0 && dp === 0 && da === 0 && tp === 0) return null;
  return { MetalPrice: mp, DiamondsPrice: dp, DutiesAmount: da, TotalPrice: tp };
};

const buildHtml = ({ enquiry, pricingResult, stones, metal, charges, clientName }) => {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const stonesHtml = stones.map((s, i) => `
    <tr style="${i % 2 === 0 ? 'background:#f9f9f9' : ''}">
      <td>${s.Type || '-'}</td><td>${s.Color || '-'}</td><td>${s.Shape || '-'}</td>
      <td>${s.MmSize || '-'}</td><td>${s.SieveSize || '-'}</td>
      <td>${s.Weight ?? 0}</td><td>${s.Pcs ?? 0}</td><td>${s.CtWeight ?? s.Carat ?? 0}</td>
      <td>${s.Markup ?? 0}</td><td>$${num(s.Price).toFixed(2)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:Arial,sans-serif;padding:24px;color:#2B3735;font-size:13px}
    .hdr{text-align:center;border-bottom:3px solid #143F46;padding-bottom:16px;margin-bottom:20px}
    .hdr h1{color:#143F46;margin:0;font-size:24px}
    .hdr p{color:#BFA26C;margin:4px 0;font-size:12px}
    .sec-title{background:#143F46;color:#fff;padding:8px 12px;font-weight:900;margin:18px 0 10px;border-left:4px solid #BFA26C}
    .grid{display:table;width:100%;margin-bottom:8px}
    .row{display:table-row}
    .lbl{display:table-cell;padding:6px 8px;font-weight:800;color:#2B3735;width:42%;border-bottom:1px solid #BFA26C}
    .val{display:table-cell;padding:6px 8px;color:#2B3735;border-bottom:1px solid #BFA26C}
    table{width:100%;border-collapse:collapse;margin:10px 0;font-size:11px}
    th{background:#143F46;color:#fff;padding:8px;text-align:center;border:1px solid #BFA26C;font-weight:900}
    td{padding:7px;border:1px solid #BFA26C;text-align:center}
    .totals{background:#f5f5f5;padding:16px;border-radius:6px;margin-top:16px}
    .tot-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #BFA26C}
    .grand{font-size:18px;color:#143F46;margin-top:12px;padding-top:12px;border-top:2px solid #BFA26C}
    .footer{text-align:center;margin-top:32px;padding-top:16px;border-top:2px solid #BFA26C;color:#BFA26C;font-size:11px}
  </style></head><body>
  <div class="hdr"><h1>Chandra Jewels</h1><p>Quotation</p><p>${date}</p></div>

  <div class="sec-title">Enquiry Details</div>
  <div class="grid">
    <div class="row"><div class="lbl">Name</div><div class="val">${enquiry?.Name || '-'}</div></div>
    <div class="row"><div class="lbl">Client</div><div class="val">${clientName || '-'}</div></div>
    <div class="row"><div class="lbl">Category</div><div class="val">${enquiry?.Category || '-'}</div></div>
    <div class="row"><div class="lbl">Stone Type</div><div class="val">${enquiry?.StoneType || '-'}</div></div>
    <div class="row"><div class="lbl">Priority</div><div class="val">${enquiry?.Priority || '-'}</div></div>
    <div class="row"><div class="lbl">Quantity</div><div class="val">${enquiry?.Quantity ?? 1}</div></div>
  </div>

  <div class="sec-title">Metal</div>
  <div class="grid">
    <div class="row"><div class="lbl">Weight</div><div class="val">${num(metal.Weight).toFixed(3)} g</div></div>
    <div class="row"><div class="lbl">Quality</div><div class="val">${metal.Quality || '-'}</div></div>
    <div class="row"><div class="lbl">Rate</div><div class="val">$${num(metal.Rate).toFixed(2)}/g</div></div>
  </div>

  ${stones.length ? `
  <div class="sec-title">Stones (${stones.length})</div>
  <table><thead><tr>
    <th>Type</th><th>Color</th><th>Shape</th><th>MM</th><th>Sieve</th>
    <th>Avg Wt</th><th>Pcs</th><th>Ct Wt</th><th>Markup</th><th>$/Ct</th>
  </tr></thead><tbody>${stonesHtml}</tbody></table>` : ''}

  <div class="sec-title">Charges</div>
  <div class="grid">
    <div class="row"><div class="lbl">Loss</div><div class="val">${charges.Loss}%</div></div>
    <div class="row"><div class="lbl">Labour</div><div class="val">$${charges.Labour}/g</div></div>
    <div class="row"><div class="lbl">Extra Charges</div><div class="val">${charges.ExtraCharges}%</div></div>
    ${charges.UndercutPrice > 0 ? `<div class="row"><div class="lbl">Undercut Price</div><div class="val">$${charges.UndercutPrice}/ct</div></div>` : ''}
  </div>

  <div class="totals">
    <div class="tot-row"><span>Metal Price</span><span>$${num(pricingResult.MetalPrice).toFixed(2)}</span></div>
    <div class="tot-row"><span>Diamonds Price</span><span>$${num(pricingResult.DiamondsPrice).toFixed(2)}</span></div>
    <div class="tot-row"><span>Duties Amount</span><span>$${num(pricingResult.DutiesAmount).toFixed(2)}</span></div>
    <div class="tot-row grand"><strong>TOTAL PRICE</strong><strong>$${num(pricingResult.TotalPrice).toFixed(2)}</strong></div>
  </div>

  <div class="footer"><p>Generated by Chandra Jewels Management App</p></div>
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

const QuotationModal = ({ visible, enquiryId, onClose }) => {
  const { data: fullEnquiryData, isFetching: isFetchingEnquiry } = useGetEnquiryByIdQuery(enquiryId, {
    skip: !visible || !enquiryId,
    refetchOnMountOrArgChange: true,
  });

  const rawEnquiry  = fullEnquiryData?._originalData || fullEnquiryData;
  const fullEnquiry = rawEnquiry;

  const sourcePricing = useMemo(() => getLatestPricing(fullEnquiry), [fullEnquiry]);

  const [metalWeight,       setMetalWeight]       = useState('0');
  const [metalQuality,      setMetalQuality]      = useState('10K');
  const [metalRate,         setMetalRate]         = useState('0');
  const [showQualityPicker, setShowQualityPicker] = useState(false);

  const [diamonds,            setDiamonds]            = useState([]);
  const [missingIndices,      setMissingIndices]      = useState(new Set());
  const [editModalVisible,    setEditModalVisible]    = useState(false);
  const [selectedIndex,       setSelectedIndex]       = useState(null);
  const [selectedDiamondData, setSelectedDiamondData] = useState({});

  const [pricingResult, setPricingResult] = useState(null);
  const [pdfHtml,       setPdfHtml]       = useState(null);
  const [showPdf,       setShowPdf]       = useState(false);
  const [isSharing,     setIsSharing]     = useState(false);

  const [showCompareModal, setShowCompareModal] = useState(false);

  const [clientMsg,     setClientMsg]     = useState('');
  const [copied,        setCopied]        = useState(false);

  const [calculatePricing, { isLoading: isCalculating }] = useCalculatePricingMutation();
  const [savePricing,      { isLoading: isSaving }]      = useSavePricingMutation();

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
        const base = prices.gold?.price || 0;
        const m = q.match(/(\d+)K/i);
        if (m && base) return String((base * parseInt(m[1], 10) / 24).toFixed(2));
        return '0';
      })();
      setMetalRate(autoRate);

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
            Pcs:       num(st.Pcs),
            Markup:    num(st.Markup),
          }))
        : []);

      const initialMissing = new Set(
        rawStones.reduce((acc, st, i) => { if (num(st.Price) <= 0) acc.push(i); return acc; }, [])
      );
      setMissingIndices(initialMissing);

      setClientMsg(p.ClientPricingMessage || '');
      if (isQRPhase && sourcePricing) {
        const qrResult = mapSourceToPricingResult(sourcePricing);
        setPricingResult(qrResult);
        if (qrResult) {
          const html = buildHtml({
            enquiry: fullEnquiry,
            pricingResult: qrResult,
            stones: rawStones,
            metal: {
              Weight: num(p.Metal?.Weight ?? 0),
              Quality: p.Metal?.Quality || '10K',
              Rate: num(p.Metal?.Rate ?? 0),
            },
            charges: {
              Loss: num(p.Loss ?? 0),
              Labour: num(p.Labour ?? 0),
              ExtraCharges: num(p.ExtraCharges ?? 0),
              UndercutPrice: num(p.UndercutPrice ?? 0),
            },
            clientName: fullEnquiry?.ClientName || fullEnquiry?.clientName || '',
          });
          setPdfHtml(html);
        }
      } else {
        setPricingResult(null);
        setPdfHtml(null);
      }
      setShowPdf(false);
      setShowCompareModal(false);
      setCopied(false);

  }, [visible, isFetchingEnquiry, fullEnquiry, enquiryId, sourcePricing, metalPricesData]);



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

  const openEditModal = useCallback((index, diamond) => {
    setSelectedIndex(index);
    setSelectedDiamondData({
      Type:      diamond.Type      || '',
      Shape:     diamond.Shape     || '',
      Carat:     String(diamond.Carat    ?? ''),
      MmSize:    String(diamond.MmSize   ?? ''),
      SieveSize: diamond.SieveSize || '',
      Price:     String(diamond.Price    ?? ''),
    });
    setEditModalVisible(true);
  }, []);

  const handleDiamondSave = useCallback((updated) => {
    setDiamonds(prev => prev.map((d, i) => i !== selectedIndex ? d : {
      ...d,
      Type:      updated.Type      || '',
      Shape:     updated.Shape     || '',
      Carat:     num(updated.Carat),
      MmSize:    num(updated.MmSize),
      SieveSize: updated.SieveSize || '',
      Price:     num(updated.Price),
    }));
    setEditModalVisible(false);
    setSelectedIndex(null);
  }, [selectedIndex]);


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

    const pricingToSave = {
      Metal: { Weight: num(metalWeight), Quality: metalQuality, Rate: num(metalRate) },
      Stones: diamonds.map(d => ({
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
      ExtraCharges:        num(sourcePricing?.ExtraCharges ?? 0),
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
      await savePricing({
        enquiryId: resolvedEnquiryId,
        designType,
        version,
        pricingData: pricingToSave,
      }).unwrap();
      showAlert('Saved', 'Quotation saved successfully.', 'success', [{ text: 'OK' }]);
    } catch (e) {
      showAlert('Save Failed', e?.data?.message || 'Could not save the quotation. Please try again.', 'error', [{ text: 'OK' }]);
    }
  }, [pricingResult, isFetchingEnquiry, enquiryId, fullEnquiry,
      metalWeight, metalQuality, metalRate, diamonds, sourcePricing,
      clientMsg, savePricing, showAlert]);

  const handleCalculate = useCallback(async () => {
    if (!diamonds.length) {
      showAlert('Validation', 'Please add at least one stone before calculating.', 'warning', [{ text: 'OK' }]);
      return;
    }
    if (num(metalWeight) <= 0) {
      showAlert('Validation', 'Metal weight must be greater than 0.', 'warning', [{ text: 'OK' }]);
      return;
    }
    if (num(metalRate) <= 0) {
      showAlert('Validation', 'Metal rate must be greater than 0.', 'warning', [{ text: 'OK' }]);
      return;
    }
    const missingPrice = diamonds.some(d => num(d.Price) <= 0);
    if (missingPrice) {
      showAlert('Validation', 'All stones must have a price ($/Ct) greater than 0.', 'warning', [{ text: 'OK' }]);
      return;
    }

    const clientId = fullEnquiry?.ClientId || fullEnquiry?.clientId;

    const payload = {
      details: {
        Metal: {
          Weight:  num(metalWeight),
          Quality: metalQuality,
          Rate:    num(metalRate),
        },
        Stones: diamonds.map(d => ({
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
        ExtraCharges:        num(sourcePricing?.ExtraCharges ?? 0),
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
    };

    try {
      const result = await calculatePricing(payload).unwrap();
      setPricingResult(result);

      setDiamonds(prev => {
        setMissingIndices(new Set(
          prev.reduce((acc, st, i) => { if (num(st.Price) <= 0) acc.push(i); return acc; }, [])
        ));
        return prev;
      });

      setClientMsg(prev => {
        if (result.ClientPricingMessage) return result.ClientPricingMessage;
        return prev;
      });

      const html = buildHtml({
        enquiry: fullEnquiry,
        pricingResult: result,
        stones: diamonds,
        metal: { Weight: num(metalWeight), Quality: metalQuality, Rate: num(metalRate) },
        charges: {
          Loss: num(sourcePricing?.Loss ?? 0),
          Labour: num(sourcePricing?.Labour ?? 0),
          ExtraCharges: num(sourcePricing?.ExtraCharges ?? 0),
          UndercutPrice: num(sourcePricing?.UndercutPrice ?? 0),
        },
        clientName: fullEnquiry?.ClientName || fullEnquiry?.clientName || '',
      });
      setPdfHtml(html);
    } catch (e) {
      showAlert('Calculation Failed', e?.data?.message || 'Failed to calculate pricing. Please try again.', 'error', [{ text: 'OK' }]);
    }
  }, [diamonds, metalWeight, metalQuality, metalRate, sourcePricing, fullEnquiry, calculatePricing, showAlert]);

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

  const hasMissingStones = missingIndices.size > 0 || diamonds.length === 0;

  const handleCopyMsg = useCallback(() => {
    if (!clientMsg) return;
    Clipboard.setString(clientMsg);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [clientMsg]);

  return (
    <>
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => { if (showPdf) { setShowPdf(false); } else { onClose(); } }}>
      <View style={s.overlay}>
        <View style={s.sheet}>

          {/* ── header ──────────────────────────────────────────────── */}
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle} numberOfLines={1}>{isCMPhase ? 'Update Quotation' : 'View Quotation'}</Text>
              {fullEnquiry?.Name ? <Text style={s.headerSub} numberOfLines={1}>{fullEnquiry.Name}</Text> : null}
            </View>
            {isFetchingEnquiry && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />}
            <TouchableOpacity style={s.closeBtn} onPress={showPdf ? () => setShowPdf(false) : onClose} activeOpacity={0.7}>
              <Icon name={showPdf ? 'arrow-back' : 'close'} size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* ── PDF full-screen overlay ──────────────────────────────── */}
          {showPdf ? (
            <View style={{ flex: 1 }}>
              <PdfViewer html={pdfHtml} style={{ flex: 1 }} />
              <View style={s.pdfBar}>
                <TouchableOpacity style={s.pdfBarBtn} onPress={() => setShowPdf(false)} activeOpacity={0.8}>
                  <Icon name="arrow-back" size={18} color="#fff" />
                  <Text style={s.pdfBarBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.pdfBarBtn, s.shareBtn]} onPress={handleSharePdf} disabled={isSharing} activeOpacity={0.85}>
                  {isSharing
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <><Icon name="share" size={18} color="#fff" /><Text style={s.pdfBarBtnText}>Share</Text></>}
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
              {/* ── banner ────────────────────────────────────────────── */}
              {hasMissingStones ? (
                <View style={s.warningBanner}>
                  <Icon name="warning" size={15} color="#92400E" />
                  <Text style={s.warningText}>Stone prices are missing — fill them in below to calculate pricing.</Text>
                </View>
              ) : (
                <View style={s.infoBanner}>
                  <Icon name="info" size={15} color={colors.primary} />
                  <Text style={s.infoText}>Stones pre-filled from the latest design version.</Text>
                </View>
              )}

              {/* ── METAL ─────────────────────────────────────────────── */}
              {!isQRPhase && (
                <>
                  <Text style={s.sectionTitle}>Metal</Text>
                  <View style={s.metalRow}>
                    {/* Weight */}
                    <View style={s.metalField}>
                      <Text style={s.chargeLabel}>Weight (g)</Text>
                      <TextInput
                        style={[s.chargeInput, num(metalWeight) <= 0 && s.inputError]}
                        value={metalWeight}
                        onChangeText={setMetalWeight}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                    {/* Quality — dropdown */}
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
                    {/* Rate */}
                    <View style={s.metalField}>
                      <Text style={s.chargeLabel}>Rate ($/g)</Text>
                      <TextInput
                        style={[s.chargeInput, num(metalRate) <= 0 && s.inputError]}
                        value={metalRate}
                        onChangeText={setMetalRate}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                  </View>
                </>
              )}

              {/* ── STONES (missing-price snapshot — refreshes on Calculate) ── */}
              {(() => {
                // Use the frozen snapshot — doesn't change when user edits a price,
                // only refreshes after Calculate so the table stays stable while editing.
                const visibleStones = diamonds
                  .map((d, i) => ({ d, i }))
                  .filter(({ i }) => missingIndices.has(i));

                if (missingIndices.size === 0 && diamonds.length > 0) return null;

                return (
                  <>
                    <View style={s.sectionRow}>
                      <Text style={s.sectionTitle}>
                        {visibleStones.length > 0
                          ? `Stones needing price (${visibleStones.length})`
                          : 'Stones'}
                      </Text>
                      <TouchableOpacity style={s.addBtn} onPress={handleAddDiamond} activeOpacity={0.8}>
                        <Icon name="add" size={16} color="#fff" />
                        <Text style={s.addBtnText}>Add Stone</Text>
                      </TouchableOpacity>
                    </View>

                    {visibleStones.length === 0 ? (
                      <View style={s.emptyStones}>
                        <Icon name="diamond" size={28} color={colors.textSecondary} />
                        <Text style={s.emptyStonesText}>No stones added yet</Text>
                        <TouchableOpacity style={[s.addBtn, { marginTop: 4 }]} onPress={handleAddDiamond} activeOpacity={0.8}>
                          <Icon name="add" size={16} color="#fff" />
                          <Text style={s.addBtnText}>Add First Stone</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={s.stoneTable}>
                        <View style={s.stoneTableHeader}>
                          <Text style={[s.stoneCol, s.stoneColType,  s.stoneTh]}>Type</Text>
                          <Text style={[s.stoneCol, s.stoneColShape, s.stoneTh]}>Shape</Text>
                          <Text style={[s.stoneCol, s.stoneColNum,   s.stoneTh]}>Ct</Text>
                          <Text style={[s.stoneCol, s.stoneColNum,   s.stoneTh]}>Pcs</Text>
                          <Text style={[s.stoneCol, s.stoneColPrice, s.stoneTh]}>$/Ct</Text>
                          <View style={s.stoneColActions} />
                        </View>
                        {visibleStones.map(({ d, i }, rowIdx) => (
                          <View key={d.localId || i} style={[s.stoneRow, rowIdx % 2 === 1 && s.stoneRowAlt]}>
                            <Text style={[s.stoneCol, s.stoneColType,  s.stoneTd]} numberOfLines={1}>{d.Type || '—'}</Text>
                            <Text style={[s.stoneCol, s.stoneColShape, s.stoneTd]} numberOfLines={1}>{d.Shape || '—'}</Text>
                            <Text style={[s.stoneCol, s.stoneColNum,   s.stoneTd]}>{num(d.Carat).toFixed(2)}</Text>
                            <Text style={[s.stoneCol, s.stoneColNum,   s.stoneTd]}>{num(d.Pcs)}</Text>
                            <Text style={[s.stoneCol, s.stoneColPrice, s.stoneTd, num(d.Price) <= 0 ? s.stonePriceMissing : null]}>
                              {num(d.Price) > 0 ? `$${num(d.Price).toFixed(2)}` : '—'}
                            </Text>
                            <View style={s.stoneColActions}>
                              <TouchableOpacity onPress={() => openEditModal(i, d)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 4 }}>
                                <Icon name="edit" size={15} color={colors.primary} />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => handleDeleteDiamond(i)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 6 }}>
                                <Icon name="delete-outline" size={15} color={colors.error || '#EF4444'} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                        <TouchableOpacity style={s.stoneAddRow} onPress={handleAddDiamond} activeOpacity={0.8}>
                          <Icon name="add" size={14} color={colors.primary} />
                          <Text style={s.stoneAddRowText}>Add another stone</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </>
                );
              })()}

              {/* ── COMPARE IMAGES ────────────────────────────────────── */}
              {!isQRPhase && (
                <TouchableOpacity
                  style={[s.calcBtn, { backgroundColor: '#7C3AED', marginBottom: 10 }]}
                  onPress={handleCompareImages}
                  activeOpacity={0.85}
                >
                  <Icon name="compare" size={18} color="#fff" />
                  <Text style={s.calcBtnText}>Compare Images</Text>
                </TouchableOpacity>
              )}

              {/* ── CALCULATE ─────────────────────────────────────────── */}
              {!isQRPhase && (
                <TouchableOpacity
                  style={[s.calcBtn, isCalculating && s.calcBtnDisabled]}
                  onPress={handleCalculate}
                  disabled={isCalculating}
                  activeOpacity={0.85}
                >
                  {isCalculating
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <>
                        <Icon name="calculate" size={18} color="#fff" />
                        <Text style={s.calcBtnText}>{pricingResult ? 'Recalculate' : 'Calculate Pricing'}</Text>
                      </>}
                </TouchableOpacity>
              )}

              {/* ── AFTER CALCULATION: View PDF + Save / Compare Images ── */}
              {pricingResult && (
                <>
                  <Text style={s.sectionTitle}>Pricing</Text>
                  <View style={s.resultCard}>
                    <View style={s.resultRow}>
                      <Text style={s.resultLbl}>Metal Price</Text>
                      <Text style={s.resultVal}>${num(pricingResult.MetalPrice).toFixed(2)}</Text>
                    </View>
                    <View style={s.resultRow}>
                      <Text style={s.resultLbl}>Diamonds Price</Text>
                      <Text style={s.resultVal}>${num(pricingResult.DiamondsPrice).toFixed(2)}</Text>
                    </View>
                    <View style={s.resultRow}>
                      <Text style={s.resultLbl}>Duties Amount</Text>
                      <Text style={s.resultVal}>${num(pricingResult.DutiesAmount).toFixed(2)}</Text>
                    </View>
                    <View style={[s.resultRow, s.resultTotalRow]}>
                      <Text style={s.resultTotalLbl}>TOTAL PRICE</Text>
                      <Text style={s.resultTotalVal}>${num(pricingResult.TotalPrice).toFixed(2)}</Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[s.calcBtn, { backgroundColor: '#DC2626' }]}
                    onPress={() => setShowPdf(true)}
                    activeOpacity={0.85}
                  >
                    <Icon name="picture-as-pdf" size={18} color="#fff" />
                    <Text style={s.calcBtnText}>View PDF</Text>
                  </TouchableOpacity>

                  {isQRPhase ? (
                    <TouchableOpacity
                      style={[s.calcBtn, { backgroundColor: '#7C3AED' }]}
                      onPress={handleCompareImages}
                      activeOpacity={0.85}
                    >
                      <Icon name="compare" size={18} color="#fff" />
                      <Text style={s.calcBtnText}>Compare Images</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[s.calcBtn, { backgroundColor: '#059669', marginTop: 10 }, (isSaving || isFetchingEnquiry) && s.calcBtnDisabled]}
                      onPress={handleSaveQuotation}
                      disabled={isSaving || isFetchingEnquiry}
                      activeOpacity={0.85}
                    >
                      {(isSaving || isFetchingEnquiry)
                        ? <><ActivityIndicator size="small" color="#fff" /><Text style={s.calcBtnText}>{isFetchingEnquiry ? 'Loading...' : 'Saving...'}</Text></>
                        : <><Icon name="save" size={18} color="#fff" /><Text style={s.calcBtnText}>Save Quotation</Text></>}
                    </TouchableOpacity>
                  )}
                </>
              )}
              {(clientMsg !== null && clientMsg !== undefined && diamonds.length > 0) ? (
                <View style={s.clientMsgCard}>
                  <View style={s.clientMsgHeader}>
                    <Text style={s.clientMsgLabel}>Copy pricing format for your client</Text>
                    <TouchableOpacity style={s.copyBtn} onPress={handleCopyMsg} activeOpacity={0.8}>
                      <Icon name={copied ? 'check' : 'content-copy'} size={15} color={copied ? '#059669' : colors.primary} />
                      <Text style={[s.copyBtnText, copied && { color: '#059669' }]}>{copied ? 'Copied!' : 'Copy'}</Text>
                    </TouchableOpacity>
                  </View>
                  {diamonds.length > 0 && <TextInput
                    style={s.clientMsgInput}
                    value={clientMsg}
                    onChangeText={setClientMsg}
                    multiline
                    placeholder="No pricing message saved yet..."
                    placeholderTextColor={colors.textSecondary}
                    textAlignVertical="top"
                  />}
                </View>
              ) : null}

            </ScrollView>
          )}
        </View>
      </View>

      {/* ── Quality picker modal ──────────────────────────────────────── */}
      <Modal visible={showQualityPicker} transparent animationType="fade" onRequestClose={() => setShowQualityPicker(false)}>
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
      </Modal>

    </Modal>

    <CompareRefrences
      visible={showCompareModal}
      onClose={() => setShowCompareModal(false)}
      fullEnquiry={fullEnquiry}
      isFetchingEnquiry={isFetchingEnquiry}
    />

    {/* ── DiamondEditModal — outside parent Modal so iOS events work ── */}
    <DiamondEditModal
      visible={editModalVisible}
      diamond={selectedDiamondData}
      onClose={() => { setEditModalVisible(false); setSelectedIndex(null); }}
      onSave={handleDiamondSave}
    />

    <BrandedAlert
      visible={alertCfg.visible} title={alertCfg.title} message={alertCfg.message}
      type={alertCfg.type} buttons={alertCfg.buttons} onClose={hideAlert}
    />
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
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#FEF3C7', borderRadius: 8, padding: 12, marginBottom: 14,
  },
  warningText: { flex: 1, fontFamily: fonts.regular, fontSize: fonts.xs || 12, color: '#92400E', lineHeight: 18 },
  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: colors.primary + '15', borderRadius: 8, padding: 12, marginBottom: 14,
  },
  infoText: { flex: 1, fontFamily: fonts.regular, fontSize: fonts.xs || 12, color: colors.primary, lineHeight: 18 },

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

  stoneTable: {
    borderWidth: 1, borderColor: colors.borderLight || '#E8E8E8',
    borderRadius: 10, overflow: 'hidden', marginBottom: 16,
    backgroundColor: colors.white,
  },
  stoneTableHeader: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 8, paddingHorizontal: 10,
  },
  stoneRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 9, paddingHorizontal: 10,
    borderTopWidth: 1, borderTopColor: colors.borderLight || '#F0F0F0',
  },
  stoneRowAlt: { backgroundColor: colors.backgroundSecondary || '#F8F8F8' },

  stoneCol:        { textAlign: 'center' },
  stoneColType:    { flex: 2.5, textAlign: 'left' },
  stoneColShape:   { flex: 2, textAlign: 'left' },
  stoneColNum:     { flex: 1.2 },
  stoneColPrice:   { flex: 1.8 },
  stoneColActions: { width: 44, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },

  stoneTh: { fontFamily: fonts.bold,    fontSize: 10, color: '#fff' },
  stoneTd: { fontFamily: fonts.regular, fontSize: 11, color: colors.textPrimary },
  stonePriceMissing: { color: colors.error || '#EF4444' },

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

  pdfBar: { flexDirection: 'row', gap: 10, padding: 10, backgroundColor: 'rgba(0,0,0,0.75)' },
  pdfBarBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 10, borderRadius: 8,
  },
  pdfBarBtnText: { fontFamily: fonts.medium, fontSize: fonts.xs || 12, color: '#fff' },
  shareBtn: { backgroundColor: colors.primary },

  qualityBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: colors.background,
  },
  qualityBtnText: { fontFamily: fonts.regular, fontSize: fonts.sm || 13, color: colors.textPrimary, flex: 1 },

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
});

export default QuotationModal;
