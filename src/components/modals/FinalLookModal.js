import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ActivityIndicator, Platform,
} from 'react-native';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import Icon from '../common/Icon';
import PdfViewer from '../common/PdfViewer';
import BrandedAlert from '../common/BrandedAlert';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useGetEnquiryByIdQuery } from '../../store/api';
import { generateFinalLookHTML } from '../../utils/pdfGenerator';

let generatePDFModule = null;
try {
  const mod = require('react-native-html-to-pdf');
  generatePDFModule = mod.generatePDF || mod.default?.generatePDF || mod.default;
} catch (_) {}

const FinalLookModal = ({ visible, enquiryId, onClose, clientName, onApprove }) => {
  const { data: fullEnquiryData, isFetching } = useGetEnquiryByIdQuery(enquiryId, {
    skip: !visible || !enquiryId,
    refetchOnMountOrArgChange: true,
  });

  const fullEnquiry = fullEnquiryData?._originalData || fullEnquiryData;

  const [pdfHtml, setPdfHtml] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const [isSaving,    setIsSaving]    = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const [alertCfg, setAlertCfg] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  const showAlert = useCallback((title, message, type = 'info', buttons = []) =>
    setAlertCfg({ visible: true, title, message, type, buttons }), []);
  const hideAlert = useCallback(() => setAlertCfg(p => ({ ...p, visible: false })), []);

  useEffect(() => {
    if (!visible || !fullEnquiry || isFetching) return;
    let cancelled = false;
    const build = async () => {
      setIsLoading(true);
      try {
        const html = await generateFinalLookHTML(fullEnquiry, { clientName });
        if (!cancelled) setPdfHtml(html);
      } catch (e) {
        if (!cancelled) showAlert('Error', 'Failed to generate report.', 'error', [{ text: 'OK' }]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    build();
    return () => { cancelled = true; };
  }, [visible, fullEnquiry, isFetching, showAlert]);

  const handleSavePdf = useCallback(async () => {
    if (!pdfHtml) return;
    if (typeof generatePDFModule !== 'function') {
      showAlert('Not Available', 'PDF generation library is not installed.', 'warning', [{ text: 'OK' }]);
      return;
    }
    setIsSaving(true);
    try {
      const fileName = `FinalLook_${(fullEnquiry?.Name || 'Enquiry').replace(/\s+/g, '_')}_${Date.now()}`;
      const pdf = await generatePDFModule({ html: pdfHtml, fileName, directory: 'Documents', base64: false });
      if (!pdf?.filePath) throw new Error('PDF generation failed');
      showAlert('Saved', 'PDF saved to Documents folder.', 'success', [{ text: 'OK' }]);
    } catch (e) {
      showAlert('Save Failed', e?.message || 'Could not save PDF.', 'error', [{ text: 'OK' }]);
    } finally {
      setIsSaving(false);
    }
  }, [pdfHtml, fullEnquiry, showAlert]);

  const handleSharePdf = useCallback(async () => {
    if (!pdfHtml) return;
    if (typeof generatePDFModule !== 'function') {
      showAlert('Not Available', 'PDF generation library is not installed.', 'warning', [{ text: 'OK' }]);
      return;
    }
    setIsSharing(true);
    try {
      const fileName = `FinalLook_${(fullEnquiry?.Name || 'Enquiry').replace(/\s+/g, '_')}_${Date.now()}`;
      const pdf = await generatePDFModule({ html: pdfHtml, fileName, directory: 'Documents', base64: false });
      if (!pdf?.filePath) throw new Error('PDF generation failed');
      const cachePath = `${RNFS.CachesDirectoryPath}/${fileName}.pdf`;
      await RNFS.copyFile(pdf.filePath, cachePath);
      await Share.open({
        title: 'Share Final Look Report',
        message: `Final Look - ${fullEnquiry?.Name || ''}`,
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

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.header}>
              <View style={{ flex: 1 }}>
                <Text style={s.headerTitle} numberOfLines={1}>Final Look</Text>
                {fullEnquiry?.Name ? <Text style={s.headerSub} numberOfLines={1}>{fullEnquiry.Name}</Text> : null}
              </View>
              {isFetching && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />}
              <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.7}>
                <Icon name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            {isLoading || isFetching ? (
              <View style={s.loaderWrap}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={s.loaderText}>Generating report...</Text>
              </View>
            ) : pdfHtml ? (
              <View style={{ flex: 1 }}>
                <PdfViewer html={pdfHtml} style={{ flex: 1 }} />
                <View style={s.pdfBar}>
                  <TouchableOpacity style={s.pdfBarBtn} onPress={handleSharePdf} disabled={isSharing} activeOpacity={0.85}>
                    {isSharing
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <><Icon name="share" size={18} color="#fff" /><Text style={s.pdfBarBtnText}>Share PDF</Text></>}
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.pdfBarBtn, s.saveBtn]} onPress={handleSavePdf} disabled={isSaving} activeOpacity={0.85}>
                    {isSaving
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <><Icon name="save" size={18} color="#fff" /><Text style={s.pdfBarBtnText}>Save PDF</Text></>}
                  </TouchableOpacity>

                </View>
              </View>
            ) : (
              <View style={s.loaderWrap}>
                <Text style={s.loaderText}>No data available</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

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
  closeBtn: { padding: 4 },
  loaderWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loaderText: { fontFamily: fonts.medium, fontSize: fonts.sm || 13, color: colors.textSecondary },
  pdfBar: { flexDirection: 'row', gap: 10, padding: 10, backgroundColor: 'rgba(0,0,0,0.75)' },
  pdfBarBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 10, borderRadius: 8,
  },
  saveBtn: { backgroundColor: colors.primary },
  approveBtn: { backgroundColor: colors.success || '#10B981' },
  pdfBarBtnText: { fontFamily: fonts.medium, fontSize: fonts.xs || 12, color: '#fff' },
});

export default FinalLookModal;
