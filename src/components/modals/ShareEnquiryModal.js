import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Share from 'react-native-share';
import Icon from '../common/Icon';
import PdfViewer from '../common/PdfViewer';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { FILE_BASE_URL } from '../../config/apiConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import { LOGO_BASE64 } from '../../constants/logo';

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateString;
  }
};

// Reference images only — drop any image whose Key also lives in a Coral/CAD design
// version (uploaded design images that leaked into ReferenceImages).
const getReferenceOnlyImages = (enquiry) => {
  const src = enquiry?._originalData || enquiry || {};
  const designKeys = new Set();
  [
    ...(src.Coral || enquiry?.Coral || []),
    ...(src.Cad || enquiry?.Cad || []),
  ].forEach(version => {
    (version?.Images || version?.images || []).forEach(img => {
      const k = img?.Key || img?.key;
      if (k) designKeys.add(k);
    });
  });
  const list = enquiry?.ReferenceImages || src?.ReferenceImages || [];
  return list.filter(img => {
    const k = img?.Key || img?.key;
    return !(k && designKeys.has(k));
  });
};

let generatePDFModule = null;
try {
  const mod = require('react-native-html-to-pdf');
  generatePDFModule = mod.generatePDF || mod.default?.generatePDF || mod.default;
} catch (e) {}

const buildEnquiryHtml = (enquiry, imageUris, isDesigner) => {
  const src = enquiry?._originalData || enquiry;
  const metal = src?.Metal || enquiry?.Metal || {};
  const metalWeight = src?.MetalWeight || enquiry?.MetalWeight || {};
  const diamondWeight = src?.DiamondWeight || enquiry?.DiamondWeight || {};

  const priorityValue = src?.Priority || enquiry?.Priority || 'N/A';
  const priorityLower = (priorityValue || '').toLowerCase().trim();
  const priorityColorMap = {
    'high': { bg: '#FEE2E2', text: '#DC2626', border: '#FCA5A5' },
    'super high': { bg: '#FEE2E2', text: '#DC2626', border: '#FCA5A5' },
    'urgent': { bg: '#FEE2E2', text: '#DC2626', border: '#FCA5A5' },
    'super urgent': { bg: '#FEE2E2', text: '#DC2626', border: '#FCA5A5' },
    'medium': { bg: '#FEF3C7', text: '#D97706', border: '#FCD34D' },
    'normal': { bg: '#D1FAE5', text: '#059669', border: '#6EE7B7' },
    'low': { bg: '#D1FAE5', text: '#059669', border: '#6EE7B7' },
  };
  const pColor = priorityColorMap[priorityLower] || { bg: '#e8f0ef', text: '#1a3c3c', border: '#b0ccc8' };

  const title = src?.Name || enquiry?.Name || 'Enquiry';
  const code = src?.StyleNumber || enquiry?.StyleNumber || '';
  const description = src?.Remarks || enquiry?.Remarks || '';
  const createdDate = src?.CreatedDate || enquiry?.CreatedDate || enquiry?.createdAt || '';
  const updatedDate = src?.UpdatedDate || enquiry?.UpdatedDate || enquiry?.updatedAt || '';

  const metalWeightText = metalWeight.Exact
    ? `${metalWeight.Exact} gms`
    : metalWeight.From
    ? `${metalWeight.From}${metalWeight.To ? `–${metalWeight.To}` : ''} gms`
    : 'N/A';

  const diamondWeightText = diamondWeight.Exact
    ? `${diamondWeight.Exact} ct`
    : diamondWeight.From
    ? `${diamondWeight.From}${diamondWeight.To ? `–${diamondWeight.To}` : ''} ct`
    : 'N/A';

  const specs = [
    { label: 'Category', value: src?.Category || enquiry?.Category || 'N/A' },
    { label: 'Metal Quality', value: metal?.Quality || 'N/A' },
    { label: 'Metal Color', value: metal?.Color || 'N/A' },
    { label: 'Stone Type', value: src?.StoneType || enquiry?.StoneType || 'N/A' },
    { label: 'Quantity', value: String(src?.Quantity || enquiry?.Quantity || 'N/A') },
  ];

  if (!isDesigner) {
    specs.push({ label: 'Budget', value: src?.Budget ? `₹${src.Budget}` : 'N/A' });
  }

  specs.push(
    { label: 'Gold Weight', value: metalWeightText },
    { label: 'Diamonds', value: diamondWeightText },
  );

  const specsHtml = specs.map(s => `
    <div class="spec-row">
      <span class="spec-label">${s.label}</span>
      <span class="spec-value">${s.value}</span>
    </div>
  `).join('');

  const assignmentHtml = [
      { label: 'Assigned To', value: enquiry?.assignedToName || 'N/A' },
      { label: 'Client', value: enquiry?.clientName || 'N/A' },
      { label: 'Created', value: formatDate(createdDate) },
      { label: 'Updated', value: formatDate(updatedDate) },
    ].map(s => `
    <div class="spec-row">
      <span class="spec-label">${s.label}</span>
      <span class="spec-value">${s.value}</span>
    </div>
  `).join('');

  const imagesHtml = imageUris.length > 0 ? `
    <div class="images-grid">
      ${imageUris.map(img => `
        <div class="image-item">
          <img src="${img.uri}" style="width:100%;height:auto;display:block;max-width:400px;" />
          ${img.comment ? `<p class="image-caption">${img.comment}</p>` : ''}
        </div>
      `).join('')}
    </div>` : '';

  const logoSrc = `data:image/png;base64,${LOGO_BASE64}`;
  const currentDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=0.6, maximum-scale=5.0, user-scalable=yes">
    <title>Enquiry Report</title>
    <style>
      @page { margin: 0; padding: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: Arial, sans-serif; background-color: #f4f6f4; color: #1A1A1A; padding: 20px; }
      .header-container { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 20px; }
      .header-logo { height: 44px; width: auto; }
      .header-title { font-size: 24px; color: #D4AF37; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 2px; }
      .header-subtitle { font-size: 10px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.2em; }
      .divider { height: 1px; width: 100%; background-color: #D4AF37; opacity: 0.4; margin: 6px 0; }
      .report-card { border-radius: 14px; border: 1px solid #d0ddd0; overflow: hidden; background: #fff; }
      .card-top-bar { height: 4px; background: linear-gradient(90deg, #1a3c3c, #D4AF37); }
      .report-body { padding: 16px; }
      .report-title { font-size: 17px; font-weight: bold; color: #1a3c3c; margin-bottom: 2px; }
      .report-date { font-size: 10px; color: #9CA3AF; margin-bottom: 10px; }
      .badge-row { display: flex; gap: 6px; margin-bottom: 12px; }
      .badge-green { background: #e8f0e8; padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; color: #1a5c1a; border: 1px solid #b8d8b8; }
      .badge-primary { background: #e8f0ef; padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; color: #1a3c3c; border: 1px solid #b0ccc8; }
      .section-title { font-size: 9px; font-weight: bold; color: #fff; background: #1a3c3c; letter-spacing: 1px; margin: 14px -16px 8px; padding: 5px 16px; text-transform: uppercase; }
      .spec-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; font-size: 12px; border-bottom: 1px solid #f0f4f0; }
      .spec-label { color: #6B7280; }
      .spec-value { font-weight: 600; color: #1a3c3c; text-align: right; max-width: 55%; }
      .desc-text { font-size: 12px; color: #4B5563; line-height: 1.6; margin-top: 4px; padding: 8px; background: #f8faf8; border-left: 3px solid #D4AF37; border-radius: 0 4px 4px 0; }
      .images-grid { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
      .image-item { border-radius: 8px; overflow: hidden; border: 1px solid #d0ddd0; }
      .image-item img { width: 100%; height: auto; display: block; }
      .image-caption { font-size: 11px; color: #555; padding: 6px 10px; background: #f8faf8; text-align: center; border-top: 1px solid #e8ede8; }
      .report-footer { background: #1a3c3c; padding: 10px 16px; text-align: center; font-size: 9px; color: rgba(255,255,255,0.6); letter-spacing: 0.5px; }
      .footer-gold { color: #D4AF37; font-weight: bold; }
    </style>
  </head>
  <body>
    <div class="header-container">
      <img src="${logoSrc}" class="header-logo" />
      <div>
        <h2 class="header-title">CHANDRA JEWELS</h2>
        <div class="divider"></div>
        <p class="header-subtitle">Enquiry Report &mdash; ${currentDate}</p>
      </div>
    </div>

    <div class="report-card">
      <div class="card-top-bar"></div>
      <div class="report-body">
        <div class="report-title">${title}</div>
        <div class="report-date">${code ? `<span style="background:#D4AF37;color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:0.5px;">${code}</span>&nbsp;&nbsp;` : ''}${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
        <div class="badge-row">
          <span class="badge-green">${enquiry?.CurrentStatus || 'N/A'}</span>
          <span style="background:${pColor.bg};padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;color:${pColor.text};border:1px solid ${pColor.border};">${priorityValue}</span>
        </div>

        <div class="section-title">Specifications</div>
        ${specsHtml}

        <div class="section-title">Assignment &amp; Dates</div>
        ${assignmentHtml}

        ${description ? `<div class="section-title">Description</div><p class="desc-text">${description}</p>` : ''}

        ${imagesHtml ? `<div class="section-title">Reference Images</div>${imagesHtml}` : ''}
      </div>
      <div class="report-footer"><span class="footer-gold">CHANDRA JEWELS</span> &nbsp;&mdash;&nbsp; Fine Jewellery &nbsp;|&nbsp; ${code} &nbsp;|&nbsp; Confidential</div>
    </div>
  </body>
  </html>`;
};

const ShareEnquiryModal = ({ visible, enquiry, onClose, isDesigner = false }) => {
  const [sharingPdf, setSharingPdf] = useState(false);
  const [imageUris, setImageUris] = useState([]);
  const [fetchingImages, setFetchingImages] = useState(false);

  const src = enquiry?._originalData || enquiry;
  const title = src?.Name || enquiry?.Name || 'Enquiry';
  const code = src?.StyleNumber || enquiry?.StyleNumber || '';

  useEffect(() => {
    if (!visible) { setImageUris([]); return; }
    const imgs = getReferenceOnlyImages(enquiry);
    if (imgs.length === 0) { setImageUris([]); return; }

    let cancelled = false;
    const fetchImages = async () => {
      setFetchingImages(true);
      try {
        const token = await AsyncStorage.getItem('token');
        if (!token || cancelled) { setFetchingImages(false); return; }

        const uris = await Promise.all(imgs.map(async (img) => {
          const imageKey = img?.Key;
          const comment = img?.Description || img?.description || '';
          if (!imageKey) return null;

          try {
            const res = await fetch(`${FILE_BASE_URL}/api/enquiries/files/${encodeURIComponent(imageKey)}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return null;
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              const j = await res.json();
              const uri = j.url || j.imageUrl || null;
              return uri ? { uri, comment } : null;
            }
            const buf = await res.arrayBuffer();
            const b64 = btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ''));
            return { uri: `data:${ct};base64,${b64}`, comment };
          } catch {
            return null;
          }
        }));

        if (!cancelled) {
          setImageUris(uris.filter(Boolean));
          setFetchingImages(false);
        }
      } catch {
        setFetchingImages(false);
      }
    };
    fetchImages();
    return () => { cancelled = true; };
  }, [visible, enquiry]);

  const previewHtml = useMemo(
    () => buildEnquiryHtml(enquiry, imageUris, isDesigner),
    [enquiry, imageUris, isDesigner],
  );

  const handleSharePdf = async () => {
    if (sharingPdf) return;
    setSharingPdf(true);
    try {
      if (typeof generatePDFModule !== 'function') {
        throw new Error('PDF library not available');
      }
      const html = buildEnquiryHtml(enquiry, imageUris, isDesigner);
      const pdf = await generatePDFModule({
        html: html,
        fileName: `Enquiry_${code || 'report'}_${Date.now()}`,
        directory: 'Documents',
      });
      const cachePath = `${RNFS.CachesDirectoryPath}/Enquiry_${Date.now()}.pdf`;
      await RNFS.copyFile(pdf.filePath, cachePath);
      await Share.open({
        title: `Share Enquiry Report - ${title}`,
        url: Platform.OS === 'android' ? `file://${cachePath}` : cachePath,
        type: 'application/pdf',
        failOnCancel: false,
      });
      setTimeout(() => RNFS.unlink(cachePath).catch(() => {}), 5000);
    } catch (e) {
      // console.error('PDF Share Error:', e);
    } finally {
      setSharingPdf(false);
    }
  };

  if (!enquiry) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Share Enquiry</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
                {code ? (
                  <View style={styles.codeBadge}>
                    <Text style={styles.codeBadgeText}>{code}</Text>
                  </View>
                ) : null}
                <Text style={[styles.headerSub, { marginLeft: code ? 6 : 0 }]} numberOfLines={1}>
                  {title}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* PDF Preview — zoomable WebView, same HTML used for sharing */}
          <View style={styles.pdfPreviewContainer}>
            {fetchingImages ? (
              <View style={styles.pdfLoadingOverlay}>
                <ActivityIndicator size="large" color="#1a3c3c" />
                <Text style={styles.pdfLoadingText}>Loading images…</Text>
              </View>
            ) : (
              <PdfViewer html={previewHtml} style={styles.pdfViewer} />
            )}
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Action buttons */}
            <View style={styles.actionsGrid}>
              <TouchableOpacity style={styles.actionBtnPrimary} onPress={handleSharePdf} activeOpacity={0.85} disabled={sharingPdf || fetchingImages}>
                <Icon name="picture-as-pdf" size={22} color="#fff" />
                <Text style={styles.actionBtnLabel}>{sharingPdf ? 'Generating...' : 'Share PDF'}</Text>
                <Text style={styles.actionBtnSub}>Share Enquiry</Text>
              </TouchableOpacity>

            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: 28,
  },
  handleWrap: { alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary },
  headerSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 1 },
  codeBadge: {
    backgroundColor: '#D4AF37',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  codeBadgeText: {
    fontSize: 10,
    fontFamily: fonts.bold,
    color: '#fff',
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center', alignItems: 'center',
  },

  // PDF preview
  pdfPreviewContainer: {
    height: 420,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#fff',
  },
  pdfViewer: { flex: 1 },
  pdfLoadingOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    gap: 10,
  },
  pdfLoadingText: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: '#6B7280',
  },

  // Actions
  actionsGrid: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  actionBtnPrimary: {
    flex: 1, backgroundColor: '#1a3c3c',
    borderRadius: 12, paddingVertical: 10, alignItems: 'center', gap: 4,
  },
  actionBtnLabel: { fontSize: 13, fontFamily: fonts.bold, color: '#fff' },
  actionBtnSub: { fontSize: 10, color: 'rgba(255,255,255,0.6)', fontFamily: fonts.regular },
});

export default ShareEnquiryModal;
