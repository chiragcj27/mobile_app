import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Image,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import BrandedAlert from '../../components/common/BrandedAlert';
import PdfViewer from '../../components/common/PdfViewer';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import Clipboard from '@react-native-clipboard/clipboard';
import { launchImageLibrary } from 'react-native-image-picker';

let DocumentPicker;
try {
  DocumentPicker = require('react-native-document-picker').default;
} catch (e) {
  DocumentPicker = null;
}

import { Card } from '../../components/cards/Cards';
import Icon from '../../components/common/Icon';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useClients } from '../../features/clients/clientsHooks';
import {
  useGetStoneTypesQuery,
  useGetMetalPricesQuery,
  useCalculatePricingMutation,
  useImagepriceDataMutation,
  useGetClientByIdQuery,
} from '../../store/api';

let generatePDFModule = null;
try {
  const mod = require('react-native-html-to-pdf');
  generatePDFModule =
    mod.generatePDF || mod.default?.generatePDF || mod.default;
} catch (e) {}

export default function PricingCalci({ route }) {
  const [clientId, setClientId] = useState(route?.params?.clientId || '');
  const [selectedStoneTypes, setSelectedStoneTypes] = useState([]);
  const [metalKt, setMetalKt] = useState('18K');
  const [imageFile, setImageFile] = useState(null);
  const [excelFile, setExcelFile] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);

  // Unified State for Multiple Results
  const [multiData, setMultiData] = useState({});
  const [expandedStones, setExpandedStones] = useState({});

  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: '',
    message: '',
    type: 'info',
    buttons: [],
  });
  const showAlert = (title, message, type = 'info', buttons = []) =>
    setAlertConfig({ visible: true, title, message, type, buttons });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));

  const [showClientModal, setShowClientModal] = useState(false);
  const [showStoneModal, setShowStoneModal] = useState(false);
  const [showMetalModal, setShowMetalModal] = useState(false);
  const [showAllPricesModal, setShowAllPricesModal] = useState(false);
  const [pdfHtml, setPdfHtml] = useState(null);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingContext, setEditingContext] = useState({
    type: null,
    index: null,
  });
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCompactTypeModal, setShowCompactTypeModal] = useState(false);
  const [showCompactQualityModal, setShowCompactQualityModal] = useState(false);
  const [compactContext, setCompactContext] = useState({ type: null });

  const handleCopyMsg = (text) => {
    if (text) {
      Clipboard.setString(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const { clients = [] } = useClients();
  const { data: stoneTypesData = [] } = useGetStoneTypesQuery();
  const { data: metalPricesData } = useGetMetalPricesQuery(false);
  const { data: selectedClient } = useGetClientByIdQuery(clientId, {
    skip: !clientId,
  });
  const [calculatePricing, { isLoading: isCalculating }] =
    useCalculatePricingMutation();
  const [GetimagepriceData, { isLoading: isImageLoading }] =
    useImagepriceDataMutation();

  // Auto-fill stone types when client is selected
  useEffect(() => {
    if (clientId && selectedClient?.ApplicableStoneTypes) {
      setSelectedStoneTypes(selectedClient.ApplicableStoneTypes);
    } else {
      setSelectedStoneTypes([]);
    }
  }, [clientId, selectedClient]);

  const validatePricingData = useCallback(
    type => {
      const data = multiData[type];
      if (!data) return false;
      const hasMetalRate =
        data.editableMetal && parseFloat(data.editableMetal.Rate) > 0;
      const allStonesHavePrices =
        data.editableStones.length > 0 &&
        data.editableStones.every(stone => parseFloat(stone.Price || 0) > 0);
      return hasMetalRate && allStonesHavePrices;
    },
    [multiData],
  );

  const hasAnyMissingStoneData = useCallback(() => {
    const activeTypes = Object.keys(multiData);
    if (activeTypes.length === 0) return true;

    return activeTypes.some(type => {
      const data = multiData[type];
      return data.editableStones.some(
        stone =>
          !stone.MmSize?.toString().trim() ||
          !stone.Color?.toString().trim() ||
          !stone.Shape?.toString().trim() ||
          !stone.SieveSize?.toString().trim() ||
          parseFloat(stone.Weight) <= 0 ||
          parseInt(stone.Pcs) <= 0 ||
          parseFloat(stone.CtWeight) <= 0 ||
          parseFloat(stone.Price) <= 0,
      );
    });
  }, [multiData]);

  const validateStoneType = clientId => {
    if (clientId === '6871535a0798b31bfa7fe5e4') {
      setSelectedStoneTypes();
    }
  };

  const toggleAccordion = type => {
    setExpandedStones(prev => ({ ...prev, [type]: !prev[type] }));
  };

  const updateMultiData = (type, key, val) => {
    setMultiData(prev => ({
      ...prev,
      [type]: { ...prev[type], [key]: val },
    }));
  };

  const updateStone = (type, index, field, value) => {
    setMultiData(prev => {
      const nextStones = [...prev[type].editableStones];
      nextStones[index] = { ...nextStones[index], [field]: value };
      return { ...prev, [type]: { ...prev[type], editableStones: nextStones } };
    });
  };

  const deleteStone = (type, index) => {
    setMultiData(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        editableStones: prev[type].editableStones.filter((_, i) => i !== index),
      },
    }));
  };

  const addStone = type => {
    setMultiData(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        editableStones: [
          ...prev[type].editableStones,
          {
            Type: type,
            Color: 'WH',
            Shape: 'RD',
            MmSize: '',
            SieveSize: '',
            Weight: 0,
            Pcs: 0,
            CtWeight: 0,
            Price: 0,
            Markup: 0,
          },
        ],
      },
    }));
  };

  const handleImagePick = async () => {
    if (!clientId) {
      showAlert('Validation Error', 'Please select a client first', 'warning');
      return;
    }
    if (selectedStoneTypes.length === 0) {
      showAlert(
        'Validation Error',
        'Please select at least one stone type',
        'warning',
      );
      return;
    }

    try {
      const pickerResult = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
      });
      if (pickerResult.didCancel) return;

      if (pickerResult.assets && pickerResult.assets.length > 0) {
        const asset = pickerResult.assets[0];
        if (asset.fileSize && asset.fileSize > 20 * 1024 * 1024) {
          showAlert(
            'File too large',
            'Maximum allowed image size is 20MB.',
            'warning',
          );
          return;
        }

        const newImageFile = {
          uri: asset.uri,
          name: asset.fileName || `image_${Date.now()}.jpg`,
          type: asset.type || 'image/jpeg',
        };
        setImageFile(newImageFile);
        setIsExtracting(true);

        try {
          const requests = selectedStoneTypes.map(type =>
            GetimagepriceData({
              image: newImageFile,
              clientId: clientId,
              stoneType: type,
              metalQuality: metalKt,
            })
              .unwrap()
              .then(res => ({ type, data: res })),
          );

          const resultsArray = await Promise.all(requests);
          const newMultiData = {};
          const newExpanded = {};

          resultsArray.forEach(({ type, data }) => {
            const p = data.pricing || data.extractedData || data;
            const extractedData = data.extractedData || {};

            const hasData =
              (p.Stones && p.Stones.length > 0) ||
              (extractedData.Stones && extractedData.Stones.length > 0) ||
              (p.Metal && parseFloat(p.Metal.Weight) > 0) ||
              (extractedData.Metal &&
                parseFloat(extractedData.Metal.Weight) > 0) ||
              p.TotalPieces > 0 ||
              extractedData.TotalPieces > 0;

            if (hasData) {
              newMultiData[type] = {
                imageData: data,
                // Ensure Type is set if missing
                editableStones: (p.Stones || []).map(s => ({
                  Type: type,
                  ...s,
                })),
                editableMetal: {
                  Weight: p.Metal?.Weight || 0,
                  Quality: p.Metal?.Quality || metalKt,
                  Rate: p.Metal?.Rate || 0,
                },
                editableCharges: {
                  Loss: p.Client?.Loss ?? 10,
                  Labour: p.Client?.Labour ?? 7,
                  ExtraCharges: p.Client?.ExtraCharges ?? 0,
                  UndercutPrice: p.Client?.UndercutPrice ?? 0,
                },
                pricingResult: p,
              };
              newExpanded[type] = true;
            }
          });

          if (Object.keys(newMultiData).length === 0) {
            showAlert(
              'No Data Found',
              'No pricing data was extracted from the image.',
              'warning',
            );
            setImageFile(null);
            setMultiData({});
          } else {
            setMultiData(newMultiData);
            setExpandedStones(newExpanded);
          }
        } catch (apiError) {
          console.error('❌ API Error:', apiError);
          showAlert(
            'Extraction Error',
            'Failed to extract pricing data. Check configuration.',
            'error',
          );
          setImageFile(null);
        } finally {
          setIsExtracting(false);
        }
      }
    } catch (error) {
      console.error('❌ Image Picker Error:', error);
      showAlert('Error', 'Failed to pick image.', 'error');
      setIsExtracting(false);
    }
  };

  const handleRecalculate = async type => {
    const data = multiData[type];
    if (!clientId || !data) return;

    setIsRecalculating(true);
    try {
      const formattedStones = data.editableStones
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
        }))
        .filter(s => s.Type);

      const result = await calculatePricing({
        details: {
          Metal: {
            Weight: parseFloat(data.editableMetal.Weight || 0) || 0,
            Quality: data.editableMetal.Quality || metalKt,
            Rate: parseFloat(data.editableMetal.Rate || 0) || 0,
          },
          Stones: formattedStones,
          Quantity: 1,
          Loss: parseFloat(data.editableCharges.Loss || 0) || 0,
          Labour: parseFloat(data.editableCharges.Labour || 0) || 0,
          ExtraCharges: parseFloat(data.editableCharges.ExtraCharges || 0) || 0,
          UndercutPrice:
            parseFloat(data.editableCharges.UndercutPrice || 0) || 0,
        },
        clientId,
        isRecalculate: true,
      }).unwrap();

      setMultiData(prev => ({
        ...prev,
        [type]: {
          ...prev[type],
          editableStones:
            result.Stones && Array.isArray(result.Stones)
              ? result.Stones.map(s => ({ ...s }))
              : prev[type].editableStones,
          pricingResult: result,
        },
      }));

      showAlert(
        'Recalculated',
        `${type} Total Price: $${result.TotalPrice ?? result.totalPrice ?? 0}`,
        'success',
      );
    } catch (error) {
      showAlert(
        'Error',
        error?.data?.message || 'Recalculation failed',
        'error',
      );
    } finally {
      setIsRecalculating(false);
    }
  };

  const buildPricingHtml = useCallback(() => {
    const activeTypes = Object.keys(multiData);
    if (activeTypes.length === 0) return '';

    const clientName =
      clients.find(c => c.id === clientId || c._id === clientId)?.name || 'N/A';
    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    let sectionsHtml = activeTypes
      .map(type => {
        const data = multiData[type];
        const result = data.pricingResult;

        const stonesHtml = data.editableStones
          .map(
            (s, idx) => `
        <tr style="${idx % 2 === 0 ? 'background:#f9f9f9' : ''}">
          <td style="padding:8px;border:1px solid #ddd;text-align:center">${
            s.Type || type
          }</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:center">${
            s.MmSize || '-'
          }</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:center">${
            s.Color || '-'
          }</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:center">${
            s.Shape || '-'
          }</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:center">${
            s.SieveSize || '-'
          }</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:right">${
            s.Weight || 0
          }</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:center">${
            s.Pcs || 0
          }</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:right">${
            s.CtWeight || 0
          }</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:right">${
            s.Markup || 0
          }</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:right">$${
            s.Price || 0
          }</td>
        </tr>`,
          )
          .join('');

        const applicableDuties = result.Applicable
          ? Object.entries(result.Applicable)
              .filter(([_, value]) => value)
              .map(([key]) => key.replace(/([A-Z])/g, ' $1').trim())
              .join(', ')
          : 'None';

        return `
        <div class="section">
          <h2>${type} Report</h2>
          <div class="info-grid">
            <div class="info-row"><div class="info-label">Diamond Weight:</div><div class="info-value">${
              result.DiamondWeight || 0
            } ct</div></div>
            <div class="info-row"><div class="info-label">Metal Details:</div><div class="info-value">${
              data.editableMetal.Weight || 0
            }g, ${data.editableMetal.Quality}, $${
          data.editableMetal.Rate
        }/g</div></div>
          </div>

          ${
            data.editableStones.length > 0
              ? `
          <h3>Stones Breakdown</h3>
          <table>
            <thead><tr><th>Type</th><th>MM</th><th>Color</th><th>Shape</th><th>Sieve</th><th>Avg Wt</th><th>Pcs</th><th>Ct Wt</th><th>Markup</th><th>$/Ct</th></tr></thead>
            <tbody>${stonesHtml}</tbody>
          </table>`
              : ''
          }

          <div style="display: flex; justify-content: space-between; margin-top: 20px;">
            <div style="width: 48%;">
              <h3>Client Charges Applied</h3>
              <div class="info-grid">
                <div class="info-row"><div class="info-label" style="font-size:12px;">Loss:</div><div class="info-value" style="font-size:12px;">${
                  result.Client?.Loss || data.editableCharges.Loss || 0
                }%</div></div>
                <div class="info-row"><div class="info-label" style="font-size:12px;">Labour:</div><div class="info-value" style="font-size:12px;">$${
                  result.Client?.Labour || data.editableCharges.Labour || 0
                }/g</div></div>
                <div class="info-row"><div class="info-label" style="font-size:12px;">Extra Charges:</div><div class="info-value" style="font-size:12px;">${
                  result.Client?.ExtraCharges ||
                  data.editableCharges.ExtraCharges ||
                  0
                }%</div></div>
                ${
                  (result.Client?.UndercutPrice ||
                    data.editableCharges.UndercutPrice) > 0
                    ? `
                <div class="info-row"><div class="info-label" style="font-size:12px;">Undercut Price:</div><div class="info-value" style="font-size:12px;">$${
                  result.Client?.UndercutPrice ||
                  data.editableCharges.UndercutPrice ||
                  0
                }/ct</div></div>`
                    : ''
                }
              </div>
            </div>
            
            <div style="width: 48%;">
              <h3>Applicable Duties</h3>
              <p style="font-size: 12px; margin: 0; padding: 8px;">${applicableDuties}</p>
            </div>
          </div>

          <div class="total-section">
            <div class="total-row"><span class="total-label">Metal Price:</span><span class="total-value">$${(
              result.MetalPrice || 0
            ).toFixed(2)}</span></div>
            <div class="total-row"><span class="total-label">Diamonds Price:</span><span class="total-value">$${(
              result.DiamondsPrice || 0
            ).toFixed(2)}</span></div>
            <div class="total-row"><span class="total-label">Duties Amount:</span><span class="total-value">$${(
              result.DutiesAmount || 0
            ).toFixed(2)}</span></div>
            <div class="total-row grand-total" style="border-top: 2px solid #143F45; margin-top: 10px; padding-top: 10px;">
              <span class="total-label" style="color: #D4AF37;">TOTAL PRICE:</span>
              <span class="total-value" style="color: #D4AF37;">$${(
                result.TotalPrice || 0
              ).toFixed(2)}</span>
            </div>
          </div>
        </div>
      `;
      })
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>@page{margin:0;padding:0}*{margin:0;padding:0;box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Arial,sans-serif;padding:10px;color:#1A1A1A}.header{text-align:center;margin-bottom:12px;border-bottom:2px solid #143F45;padding-bottom:8px}.header h1{color:#143F45;margin:0 0 4px 0;font-size:22px}.header p{margin:2px 0;font-size:12px}.info-grid{display:table;width:100%;margin-bottom:10px}.info-row{display:table-row}.info-label{display:table-cell;padding:5px;font-weight:bold;width:40%;border-bottom:1px solid #F3F4F6;font-size:11px}.info-value{display:table-cell;padding:5px;border-bottom:1px solid #F3F4F6;font-size:11px}table{width:100%;border-collapse:collapse;margin:10px 0}th{background:#8B4513;color:white;padding:6px 3px;font-size:10px;border:1px solid #E5E7EB}td{padding:5px 3px;border:1px solid #E5E7EB;font-size:10px}.total-section{background:#F8F9FB;padding:12px;border-radius:4px;margin-top:12px}.total-row{display:flex;justify-content:space-between;padding:4px 0;font-size:11px}.grand-total{font-size:14px;font-weight:bold}.footer{text-align:center;margin-top:15px;padding-top:8px;border-top:1px solid #F3F4F6;color:#9CA3AF;font-size:9px}.section{page-break-inside:avoid;border:1px solid #eee;padding:12px;border-radius:4px;margin-bottom:12px}.section h2{color:#143F45;border-bottom:1px solid #143F45;padding-bottom:6px;margin:0 0 10px 0;font-size:16px}.section h3{background:#143F45;color:white;padding:5px 6px;font-size:12px;margin:10px 0 6px 0}</style></head><body><div class="header"><h1>Chandra Jewels</h1><p>Multi-Stone Pricing Report - ${clientName}</p><p>${currentDate}</p></div>${sectionsHtml}<div class="footer"><p>Generated by Chandra Jewels Management App</p><p>This is a computer-generated document and does not require a signature</p></div></body></html>`;
  }, [multiData, clients, clientId]);

  const generatePdfFile = useCallback(async () => {
    if (typeof generatePDFModule !== 'function')
      throw new Error('PDF library not available');
    const html = buildPricingHtml();
    const clientName =
      clients.find(c => c.id === clientId || c._id === clientId)?.name ||
      'Client';
    return await generatePDFModule({
      html,
      fileName: `Pricing_${clientName.replace(/\s+/g, '_')}_${Date.now()}`,
      directory: 'Documents',
      base64: false,
      padding: 0,
    });
  }, [buildPricingHtml, clients, clientId]);

  const handleSharePDF = async () => {
    try {
      const pdf = await generatePdfFile();
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
      if (e?.message && !e.message.includes('cancel'))
        showAlert('Share Failed', 'Failed to share PDF.', 'error');
    }
  };

  const clientOptions = clients.map(c => ({
    label: c.name || 'Unknown',
    value: c.id || c._id,
  }));
  const clientApplicableStones = selectedClient?.ApplicableStoneTypes || [];
  const stoneOptions = stoneTypesData
    .filter(
      st =>
        clientApplicableStones.length === 0 ||
        clientApplicableStones.includes(st.value),
    )
    .map(st => ({ label: st.label, value: st.value }));
  const metalQualityOptions = [
    { label: '10K', value: '10K' },
    { label: '14K', value: '14K' },
    { label: '18K', value: '18K' },
    { label: '22K', value: '22K' },
    { label: 'Silver 925', value: 'Silver 925' },
    { label: 'Platinum', value: 'Platinum' },
  ];

  const getTodayPrice = () => {
    const prices = metalPricesData?.prices || {};
    if (metalKt.includes('Silver'))
      return prices.silver?.price
        ? `$${prices.silver.price.toFixed(2)}/g`
        : 'N/A';
    if (metalKt.includes('Platinum'))
      return prices.platinum?.price
        ? `$${prices.platinum.price.toFixed(2)}/g`
        : 'N/A';
    const baseGoldPrice = prices.gold?.price || 0;
    if (!baseGoldPrice) return 'N/A';
    const match = metalKt.match(/(\d+)K/i);
    if (match)
      return `$${(baseGoldPrice * (parseInt(match[1], 10) / 24)).toFixed(2)}/g`;
    return 'N/A';
  };

  const renderDropdown = (
    label,
    placeholder,
    value,
    options,
    isVisible,
    setVisible,
    onSelect,
    extraElement = null,
  ) => {
    const selectedLabel =
      options.find(o => o.value === value)?.label || placeholder;
    return (
      <View style={styles.inputContainer}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {extraElement}
        </View>
        <TouchableOpacity
          style={styles.dropdown}
          onPress={() => setVisible(true)}
          activeOpacity={0.8}
        >
          <Text style={[styles.dropdownText, !value && styles.placeholderText]}>
            {selectedLabel}
          </Text>
          <Icon name="arrow-drop-down" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <Modal
          visible={isVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setVisible(false)}
          >
            <View style={styles.modalContent}>
              <ScrollView showsVerticalScrollIndicator={true}>
                {options.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.dropdownOption,
                      value === opt.value && styles.dropdownOptionSelected,
                    ]}
                    onPress={() => {
                      onSelect(opt.value);
                      setVisible(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownOptionText,
                        value === opt.value &&
                          styles.dropdownOptionTextSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {value === opt.value && (
                      <Icon name="check" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  };

  const renderMultiSelectModal = () => (
    <Modal
      visible={showStoneModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowStoneModal(false)}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={() => setShowStoneModal(false)}
      >
        <View style={styles.modalContent}>
          <Text style={styles.multiSelectHeader}>Select Stone Types</Text>
          <ScrollView showsVerticalScrollIndicator={true}>
            {stoneOptions.map(opt => {
              const isSelected = selectedStoneTypes.includes(opt.value);
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.dropdownOption,
                    isSelected && styles.dropdownOptionSelected,
                  ]}
                  onPress={() => {
                    setSelectedStoneTypes(prev =>
                      isSelected
                        ? prev.filter(v => v !== opt.value)
                        : [...prev, opt.value],
                    );
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownOptionText,
                      isSelected && styles.dropdownOptionTextSelected,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {isSelected && (
                    <Icon name="check-box" size={20} color={colors.primary} />
                  )}
                  {!isSelected && (
                    <Icon
                      name="check-box-outline-blank"
                      size={20}
                      color={colors.textSecondary}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => setShowStoneModal(false)}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <Card style={styles.card}>
          <Text style={styles.title}>Multi-Stone Pricing</Text>

          {renderDropdown(
            'Client*',
            'Select a client...',
            clientId,
            clientOptions,
            showClientModal,
            setShowClientModal,
            setClientId,
          )}

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Stone Types*</Text>
            <TouchableOpacity
              style={styles.dropdown}
              onPress={() => setShowStoneModal(true)}
            >
              <Text
                style={[
                  styles.dropdownText,
                  selectedStoneTypes.length === 0 && styles.placeholderText,
                ]}
                numberOfLines={1}
              >
                {selectedStoneTypes.length > 0
                  ? selectedStoneTypes.join(', ')
                  : 'Select multiple stones...'}
              </Text>
              <Icon
                name="arrow-drop-down"
                size={24}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
            {renderMultiSelectModal()}
          </View>

          {renderDropdown(
            'Metal Kt*',
            'Select Metal Kt...',
            metalKt,
            metalQualityOptions,
            showMetalModal,
            setShowMetalModal,
            setMetalKt,
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.extraText}>Today: {getTodayPrice()}</Text>
              <TouchableOpacity
                onPress={() => setShowAllPricesModal(true)}
                style={{ marginLeft: 8 }}
              >
                <Icon name="monetization-on" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>,
          )}

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Image*</Text>
            <TouchableOpacity
              style={styles.uploadArea}
              onPress={handleImagePick}
              disabled={isExtracting || isImageLoading}
            >
              {isExtracting || isImageLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={styles.uploadText}>
                    Extracting {selectedStoneTypes.length} profiles...
                  </Text>
                </View>
              ) : imageFile ? (
                <View style={styles.filePreview}>
                  <Image
                    source={{ uri: imageFile.uri }}
                    style={styles.previewImage}
                  />
                  <Text style={styles.fileName} numberOfLines={1}>
                    {imageFile.name}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setImageFile(null);
                      setMultiData({});
                    }}
                  >
                    <Icon name="close" size={20} color={colors.error} />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Icon name="cloud-upload" size={40} color={colors.primary} />
                  <Text style={styles.uploadText}>Upload Image</Text>
                  <Text style={styles.uploadSubText}>
                    Select client & stones first
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </Card>

        {/* ACCORDION SECTIONS */}
        {Object.keys(multiData).map(type => {
          const data = multiData[type];
          const isExpanded = expandedStones[type];
          const canCalc = validatePricingData(type);
          const pricingResult = data.pricingResult;

          // Identify stones with missing data exactly as your original code did
          const missingStones = data.editableStones.filter(
            stone =>
              !stone.MmSize?.toString().trim() ||
              !stone.Color?.toString().trim() ||
              !stone.Shape?.toString().trim() ||
              !stone.SieveSize?.toString().trim() ||
              parseFloat(stone.Weight) <= 0 ||
              parseInt(stone.Pcs) <= 0 ||
              parseFloat(stone.CtWeight) <= 0 ||
              parseFloat(stone.Price) <= 0,
          );

          return (
            <Card
              key={type}
              style={[
                styles.card,
                { marginTop: 16, padding: 0, overflow: 'hidden' },
              ]}
            >
              <TouchableOpacity
                style={styles.accordionHeader}
                onPress={() => toggleAccordion(type)}
              >
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                >
                  <Icon name="diamond" size={20} color={colors.primary} />
                  <Text style={styles.accordionTitle}>{type} Pricing</Text>
                </View>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                >
                  <Text style={styles.accordionTotal}>
                    ${(pricingResult?.TotalPrice || 0).toFixed(2)}
                  </Text>
                  <Icon
                    name={isExpanded ? 'expand-less' : 'expand-more'}
                    size={24}
                    color={colors.textSecondary}
                  />
                </View>
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.accordionBody}>
                  {/* Compact Type & Quality Selectors */}
                  <View style={styles.compactSelectorsRow}>
                    <View style={styles.compactSelectorField}>
                      <Text style={styles.compactSelectorLabel}>Type</Text>
                      <TouchableOpacity
                        style={styles.compactSelector}
                        onPress={() => {
                          setCompactContext({ type });
                          setShowCompactTypeModal(true);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.compactSelectorText} numberOfLines={1}>
                          {data.editableStones[0]?.Type || type}
                        </Text>
                        <Icon name="arrow-drop-down" size={18} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.compactSelectorField}>
                      <Text style={styles.compactSelectorLabel}>Quality</Text>
                      <TouchableOpacity
                        style={styles.compactSelector}
                        onPress={() => {
                          setCompactContext({ type });
                          setShowCompactQualityModal(true);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.compactSelectorText} numberOfLines={1}>
                          {data.editableMetal.Quality || 'Select'}
                        </Text>
                        <Icon name="arrow-drop-down" size={18} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  {/* Restored EXACT Table widths and rendering missing stones ONLY */}
                  <Text style={styles.subSectionTitle}>
                    Missing Stones Data
                  </Text>
                  <View style={styles.compactTableWrapper}>
                    <View style={styles.compactTableHeader}>
                      <Text
                        style={[styles.compactTableHeaderText, { width: 44 }]}
                      >
                        Type
                      </Text>
                      <Text
                        style={[styles.compactTableHeaderText, { width: 42 }]}
                      >
                        MM
                      </Text>
                      <Text
                        style={[styles.compactTableHeaderText, { width: 30 }]}
                      >
                        Col
                      </Text>
                      <Text
                        style={[styles.compactTableHeaderText, { width: 30 }]}
                      >
                        Shp
                      </Text>
                      <Text
                        style={[styles.compactTableHeaderText, { width: 36 }]}
                      >
                        Sieve
                      </Text>
                      <Text
                        style={[styles.compactTableHeaderText, { width: 36 }]}
                      >
                        Wt
                      </Text>
                      <Text
                        style={[styles.compactTableHeaderText, { width: 30 }]}
                      >
                        Pcs
                      </Text>
                      <Text
                        style={[styles.compactTableHeaderText, { width: 36 }]}
                      >
                        CtWt
                      </Text>
                      <Text
                        style={[styles.compactTableHeaderText, { width: 42 }]}
                      >
                        $/Ct
                      </Text>
                    </View>

                    <ScrollView
                      style={styles.compactTableBody}
                      nestedScrollEnabled
                    >
                      {missingStones.map((stone, i) => {
                        const originalIndex =
                          data.editableStones.indexOf(stone);
                        return (
                          <TouchableOpacity
                            key={originalIndex}
                            style={styles.compactTableRow}
                            onPress={() => {
                              setEditingContext({ type, index: originalIndex });
                              setEditModalVisible(true);
                            }}
                          >
                            <Text
                              style={[
                                styles.compactTableCell,
                                {
                                  width: 44,
                                  fontFamily: !stone.Type
                                    ? fonts.bold
                                    : fonts.regular,
                                },
                              ]}
                            >
                              {stone.Type || type}
                            </Text>
                            <Text
                              style={[
                                styles.compactTableCell,
                                {
                                  width: 42,
                                  color: !stone.MmSize
                                    ? colors.error
                                    : colors.textPrimary,
                                  fontFamily: !stone.MmSize
                                    ? fonts.bold
                                    : fonts.regular,
                                },
                              ]}
                            >
                              {stone.MmSize || '-'}
                            </Text>
                            <Text
                              style={[
                                styles.compactTableCell,
                                {
                                  width: 30,
                                  color: !stone.Color
                                    ? colors.error
                                    : colors.textPrimary,
                                  fontFamily: !stone.Color
                                    ? fonts.bold
                                    : fonts.regular,
                                },
                              ]}
                            >
                              {stone.Color || '-'}
                            </Text>
                            <Text
                              style={[
                                styles.compactTableCell,
                                {
                                  width: 30,
                                  color: !stone.Shape
                                    ? colors.error
                                    : colors.textPrimary,
                                  fontFamily: !stone.Shape
                                    ? fonts.bold
                                    : fonts.regular,
                                },
                              ]}
                            >
                              {stone.Shape || '-'}
                            </Text>
                            <Text
                              style={[
                                styles.compactTableCell,
                                {
                                  width: 36,
                                  color: !stone.SieveSize
                                    ? colors.error
                                    : colors.textPrimary,
                                  fontFamily: !stone.SieveSize
                                    ? fonts.bold
                                    : fonts.regular,
                                },
                              ]}
                            >
                              {stone.SieveSize || '-'}
                            </Text>
                            <Text
                              style={[
                                styles.compactTableCell,
                                {
                                  width: 36,
                                  color: !stone.Weight
                                    ? colors.error
                                    : colors.textPrimary,
                                  fontFamily: !stone.Weight
                                    ? fonts.bold
                                    : fonts.regular,
                                },
                              ]}
                            >
                              {stone.Weight ?? 0}
                            </Text>
                            <Text
                              style={[
                                styles.compactTableCell,
                                {
                                  width: 30,
                                  color: !stone.Pcs
                                    ? colors.error
                                    : colors.textPrimary,
                                  fontFamily: !stone.Pcs
                                    ? fonts.bold
                                    : fonts.regular,
                                },
                              ]}
                            >
                              {stone.Pcs ?? 0}
                            </Text>
                            <Text
                              style={[
                                styles.compactTableCell,
                                {
                                  width: 36,
                                  color: !stone.CtWeight
                                    ? colors.error
                                    : colors.textPrimary,
                                  fontFamily: !stone.CtWeight
                                    ? fonts.bold
                                    : fonts.regular,
                                },
                              ]}
                            >
                              {stone.CtWeight ?? 0}
                            </Text>
                            <Text
                              style={[
                                styles.compactTableCell,
                                {
                                  width: 42,
                                  color:
                                    !stone.Price || parseFloat(stone.Price) <= 0
                                      ? colors.error
                                      : colors.textPrimary,
                                  fontFamily:
                                    !stone.Price || parseFloat(stone.Price) <= 0
                                      ? fonts.bold
                                      : fonts.regular,
                                },
                              ]}
                            >
                              {stone.Price ?? 0}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      {missingStones.length === 0 && (
                        <View style={{ padding: 12, alignItems: 'center' }}>
                          <Text
                            style={{
                              color: colors.textSecondary,
                              fontSize: fonts.xs,
                            }}
                          >
                            All stones data is complete
                          </Text>
                        </View>
                      )}
                    </ScrollView>
                  </View>
                  <TouchableOpacity
                    style={styles.addStoneButton}
                    onPress={() => addStone(type)}
                  >
                    <Icon name="add" size={16} color={colors.textWhite} />
                    <Text style={styles.addStoneButtonText}>Add Stone</Text>
                  </TouchableOpacity>

                  {/* Metal Inputs */}
                  <Text style={styles.subSectionTitle}>Metal</Text>
                  <View style={styles.chargesRow}>
                    <View style={styles.chargeField}>
                      <Text style={styles.fieldLabel}>Weight (g)</Text>
                      <TextInput
                        style={styles.fieldInput}
                        keyboardType="decimal-pad"
                        value={String(data.editableMetal.Weight || '')}
                        onChangeText={v =>
                          updateMultiData(type, 'editableMetal', {
                            ...data.editableMetal,
                            Weight: v,
                          })
                        }
                      />
                    </View>
                    <View style={styles.chargeField}>
                      <Text style={styles.fieldLabel}>Quality</Text>
                      <TouchableOpacity
                        style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                        onPress={() => {
                          setCompactContext({ type });
                          setShowCompactQualityModal(true);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: fonts.sm, fontFamily: fonts.regular, color: data.editableMetal.Quality ? colors.textPrimary : colors.textLight, flex: 1 }}>
                          {data.editableMetal.Quality || 'Select Quality'}
                        </Text>
                        <Icon name="arrow-drop-down" size={18} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.chargeField}>
                      <Text
                        style={[
                          styles.fieldLabel,
                          (!data.editableMetal.Rate ||
                            parseFloat(data.editableMetal.Rate) <= 0) &&
                            styles.fieldLabelError,
                        ]}
                      >
                        Rate ($/g) *
                      </Text>
                      <TextInput
                        style={[
                          styles.fieldInput,
                          (!data.editableMetal.Rate ||
                            parseFloat(data.editableMetal.Rate) <= 0) &&
                            styles.fieldInputError,
                        ]}
                        keyboardType="decimal-pad"
                        value={String(data.editableMetal.Rate || '')}
                        onChangeText={v =>
                          updateMultiData(type, 'editableMetal', {
                            ...data.editableMetal,
                            Rate: v,
                          })
                        }
                      />
                    </View>
                  </View>

                  {/* Charges Inputs */}
                  <Text style={styles.subSectionTitle}>Charges & Duties</Text>
                  <View style={styles.chargesRow}>
                    <View style={styles.chargeField}>
                      <Text style={styles.fieldLabel}>Loss (%)</Text>
                      <TextInput
                        style={styles.fieldInput}
                        keyboardType="decimal-pad"
                        value={String(data.editableCharges.Loss || '')}
                        onChangeText={v =>
                          updateMultiData(type, 'editableCharges', {
                            ...data.editableCharges,
                            Loss: v,
                          })
                        }
                      />
                    </View>
                    <View style={styles.chargeField}>
                      <Text style={styles.fieldLabel}>Labour ($/g)</Text>
                      <TextInput
                        style={styles.fieldInput}
                        keyboardType="decimal-pad"
                        value={String(data.editableCharges.Labour || '')}
                        onChangeText={v =>
                          updateMultiData(type, 'editableCharges', {
                            ...data.editableCharges,
                            Labour: v,
                          })
                        }
                      />
                    </View>
                    <View style={styles.chargeField}>
                      <Text style={styles.fieldLabel}>Extra (%)</Text>
                      <TextInput
                        style={styles.fieldInput}
                        keyboardType="decimal-pad"
                        value={String(data.editableCharges.ExtraCharges || '')}
                        onChangeText={v =>
                          updateMultiData(type, 'editableCharges', {
                            ...data.editableCharges,
                            ExtraCharges: v,
                          })
                        }
                      />
                    </View>
                    <View style={styles.chargeField}>
                      <Text style={styles.fieldLabel}>Undercut ($/ct)</Text>
                      <TextInput
                        style={styles.fieldInput}
                        keyboardType="decimal-pad"
                        value={String(data.editableCharges.UndercutPrice || '')}
                        onChangeText={v =>
                          updateMultiData(type, 'editableCharges', {
                            ...data.editableCharges,
                            UndercutPrice: v,
                          })
                        }
                      />
                    </View>
                  </View>

                  {/* Pricing Summary Block */}
                  {pricingResult && (
                    <>
                      <Text style={styles.subSectionTitle}>
                        Pricing Summary
                      </Text>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Metal Price</Text>
                        <Text style={styles.summaryValue}>
                          ${(pricingResult.MetalPrice || 0).toFixed(2)}
                        </Text>
                      </View>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Diamonds Price</Text>
                        <Text style={styles.summaryValue}>
                          ${(pricingResult.DiamondsPrice || 0).toFixed(2)}
                        </Text>
                      </View>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Duties Amount</Text>
                        <Text style={styles.summaryValue}>
                          ${(pricingResult.DutiesAmount || 0).toFixed(2)}
                        </Text>
                      </View>

                      {pricingResult.Applicable && (
                        <View style={styles.dutiesContainer}>
                          <Text style={styles.dutiesTitle}>
                            Applicable Duties:
                          </Text>
                          {Object.entries(pricingResult.Applicable).map(
                            ([key, value]) =>
                              value && (
                                <View key={key} style={styles.dutyRow}>
                                  <Icon
                                    name="check-circle"
                                    size={14}
                                    color={colors.success}
                                  />
                                  <Text style={styles.dutyText}>
                                    {key.replace(/([A-Z])/g, ' $1').trim()}
                                  </Text>
                                </View>
                              ),
                          )}
                        </View>
                      )}

                      <View style={[styles.summaryRow, styles.totalRow]}>
                        <Text style={styles.totalLabel}>Total Price</Text>
                        <Text style={styles.totalValue}>
                          ${(pricingResult.TotalPrice || 0).toFixed(2)}
                        </Text>
                      </View>

                      {pricingResult.Client && (
                        <View style={styles.clientChargesContainer}>
                          <Text style={styles.clientChargesTitle}>
                            Client Charges Applied:
                          </Text>
                          <View style={styles.chargeDetailRow}>
                            <Text style={styles.chargeDetailLabel}>Loss:</Text>
                            <Text style={styles.chargeDetailValue}>
                              {pricingResult.Client.Loss || 0}%
                            </Text>
                          </View>
                          <View style={styles.chargeDetailRow}>
                            <Text style={styles.chargeDetailLabel}>
                              Labour:
                            </Text>
                            <Text style={styles.chargeDetailValue}>
                              ${pricingResult.Client.Labour || 0}/g
                            </Text>
                          </View>
                          <View style={styles.chargeDetailRow}>
                            <Text style={styles.chargeDetailLabel}>
                              Extra Charges:
                            </Text>
                            <Text style={styles.chargeDetailValue}>
                              {pricingResult.Client.ExtraCharges || 0}%
                            </Text>
                          </View>
                          {pricingResult.Client.UndercutPrice > 0 && (
                            <View style={styles.chargeDetailRow}>
                              <Text style={styles.chargeDetailLabel}>
                                Undercut Price:
                              </Text>
                              <Text style={styles.chargeDetailValue}>
                                ${pricingResult.Client.UndercutPrice || 0}/ct
                              </Text>
                            </View>
                          )}
                        </View>
                      )}

                      {!canCalc && (
                        <View style={styles.validationWarning}>
                          <Icon
                            name="warning"
                            size={16}
                            color={colors.warning}
                          />
                          <Text style={styles.validationWarningText}>
                            Fill metal rate & all stone prices before
                            recalculating
                          </Text>
                        </View>
                      )}
                    </>
                  )}

                  {pricingResult?.ClientPricingMessage &&
                  data.editableStones.length > 0 ? (
                    <View style={styles.clientMsgCard}>
                      <View style={styles.clientMsgHeader}>
                        <Text style={styles.clientMsgLabel}>
                          Copy pricing format for your client
                        </Text>
                        <TouchableOpacity
                          style={styles.copyBtn}
                          onPress={() => handleCopyMsg(pricingResult.ClientPricingMessage)}
                          activeOpacity={0.8}
                        >
                          <Icon
                            name={copied ? 'check' : 'content-copy'}
                            size={15}
                            color={copied ? '#059669' : colors.primary}
                          />
                          <Text
                            style={[
                              styles.copyBtnText,
                              copied && { color: '#059669' },
                            ]}
                          >
                            {copied ? 'Copied!' : 'Copy'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {data.editableStones.length > 0 && (
                        <TextInput
                          style={styles.clientMsgInput}
                          value={pricingResult.ClientPricingMessage}
                          onChangeText={() => {}}
                          multiline
                          placeholder="No pricing message saved yet..."
                          placeholderTextColor={colors.textSecondary}
                          textAlignVertical="top"
                          editable={false}
                        />
                      )}
                    </View>
                  ) : null}

                  <TouchableOpacity
                    style={[
                      styles.recalcButton,
                      !canCalc && styles.recalcButtonDisabled,
                      { marginTop: 10 },
                    ]}
                    onPress={() => handleRecalculate(type)}
                    disabled={isRecalculating || !canCalc}
                  >
                    <Icon name="refresh" size={20} color={colors.textWhite} />
                    <Text style={styles.calculateButtonText}>
                      Recalculate {type}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>

      {/* Footer Actions */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.calculateButton,
            (Object.keys(multiData).length === 0 || hasAnyMissingStoneData()) &&
              styles.calculateButtonDisabled,
          ]}
          onPress={() => {
            setPdfHtml(buildPricingHtml());
            setShowPdfModal(true);
          }}
          disabled={
            Object.keys(multiData).length === 0 || hasAnyMissingStoneData()
          }
        >
          <Icon name="picture-as-pdf" size={20} color={colors.textWhite} />
          <Text style={styles.calculateButtonText}>Preview Full PDF</Text>
        </TouchableOpacity>
      </View>

      {/* PRICES INFO MODAL */}
      <Modal
        visible={showAllPricesModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAllPricesModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAllPricesModal(false)}
        >
          <View style={styles.pricesModalContent}>
            <Text style={styles.pricesModalTitle}>Current Metal Prices</Text>
            <ScrollView style={styles.pricesList}>
              {metalPricesData?.prices ? (
                Object.entries(metalPricesData.prices).map(([metal, data]) => (
                  <View key={metal} style={styles.priceRow}>
                    <Text style={styles.priceMetal}>
                      {metal.charAt(0).toUpperCase() + metal.slice(1)}
                    </Text>
                    <Text style={styles.priceValue}>
                      ${data?.price?.toFixed(2)} / {data?.unit || 'g'}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.noPricesText}>No prices available</Text>
              )}
            </ScrollView>
            <TouchableOpacity
              style={styles.closePricesButton}
              onPress={() => setShowAllPricesModal(false)}
            >
              <Text style={styles.closePricesButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* UNIFIED EDIT STONE MODAL */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalContent}>
            <View style={styles.editModalHeader}>
              <Text style={styles.editModalTitle}>Edit Stone</Text>
              <View style={styles.editModalHeaderActions}>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => {
                    if (editingContext.type && editingContext.index !== null) {
                      deleteStone(editingContext.type, editingContext.index);
                      setEditModalVisible(false);
                      setEditingContext({ type: null, index: null });
                    }
                  }}
                >
                  <Icon name="delete" size={20} color={colors.error} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                  <Icon name="close" size={22} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView>
              {editingContext.type !== null &&
                editingContext.index !== null &&
                (() => {
                  const stone =
                    multiData[editingContext.type].editableStones[
                      editingContext.index
                    ];
                  if (!stone) return null;
                  return (
                    <View style={styles.editModalFields}>
                      <View style={styles.editFieldRow}>
                        <View style={styles.editFieldHalf}>
                          <Text style={styles.editFieldLabel}>Type</Text>
                          <TextInput
                            style={styles.editFieldInput}
                            value={stone.Type || editingContext.type}
                            onChangeText={v =>
                              updateStone(
                                editingContext.type,
                                editingContext.index,
                                'Type',
                                v,
                              )
                            }
                          />
                        </View>
                        <View style={styles.editFieldHalf}>
                          <Text style={styles.editFieldLabel}>MM</Text>
                          <TextInput
                            style={styles.editFieldInput}
                            value={stone.MmSize}
                            onChangeText={v =>
                              updateStone(
                                editingContext.type,
                                editingContext.index,
                                'MmSize',
                                v,
                              )
                            }
                          />
                        </View>
                      </View>
                      <View style={styles.editFieldRow}>
                        <View style={styles.editFieldHalf}>
                          <Text style={styles.editFieldLabel}>Color</Text>
                          <TextInput
                            style={styles.editFieldInput}
                            value={stone.Color}
                            onChangeText={v =>
                              updateStone(
                                editingContext.type,
                                editingContext.index,
                                'Color',
                                v,
                              )
                            }
                          />
                        </View>
                        <View style={styles.editFieldHalf}>
                          <Text style={styles.editFieldLabel}>Shape</Text>
                          <TextInput
                            style={styles.editFieldInput}
                            value={stone.Shape}
                            onChangeText={v =>
                              updateStone(
                                editingContext.type,
                                editingContext.index,
                                'Shape',
                                v,
                              )
                            }
                          />
                        </View>
                      </View>
                      <View style={styles.editFieldRow}>
                        <View style={styles.editFieldHalf}>
                          <Text style={styles.editFieldLabel}>Sieve</Text>
                          <TextInput
                            style={styles.editFieldInput}
                            value={stone.SieveSize}
                            onChangeText={v =>
                              updateStone(
                                editingContext.type,
                                editingContext.index,
                                'SieveSize',
                                v,
                              )
                            }
                          />
                        </View>
                        <View style={styles.editFieldHalf}>
                          <Text style={styles.editFieldLabel}>Pcs</Text>
                          <TextInput
                            style={styles.editFieldInput}
                            keyboardType="number-pad"
                            value={String(stone.Pcs ?? 0)}
                            onChangeText={v =>
                              updateStone(
                                editingContext.type,
                                editingContext.index,
                                'Pcs',
                                v,
                              )
                            }
                          />
                        </View>
                      </View>
                      <View style={styles.editFieldRow}>
                        <View style={styles.editFieldHalf}>
                          <Text style={styles.editFieldLabel}>Avg Wt</Text>
                          <TextInput
                            style={styles.editFieldInput}
                            keyboardType="decimal-pad"
                            value={String(stone.Weight ?? 0)}
                            onChangeText={v =>
                              updateStone(
                                editingContext.type,
                                editingContext.index,
                                'Weight',
                                v,
                              )
                            }
                          />
                        </View>
                        <View style={styles.editFieldHalf}>
                          <Text style={styles.editFieldLabel}>Ct Wt</Text>
                          <TextInput
                            style={styles.editFieldInput}
                            keyboardType="decimal-pad"
                            value={String(stone.CtWeight ?? 0)}
                            onChangeText={v =>
                              updateStone(
                                editingContext.type,
                                editingContext.index,
                                'CtWeight',
                                v,
                              )
                            }
                          />
                        </View>
                      </View>
                      <View style={styles.editFieldRow}>
                        <View style={styles.editFieldHalf}>
                          <Text style={styles.editFieldLabel}>Markup</Text>
                          <TextInput
                            style={styles.editFieldInput}
                            keyboardType="decimal-pad"
                            value={String(stone.Markup ?? 0)}
                            onChangeText={v =>
                              updateStone(
                                editingContext.type,
                                editingContext.index,
                                'Markup',
                                v,
                              )
                            }
                          />
                        </View>
                        <View style={styles.editFieldHalf}>
                          <Text
                            style={[
                              styles.editFieldLabel,
                              (!stone.Price || parseFloat(stone.Price) <= 0) &&
                                styles.fieldLabelError,
                            ]}
                          >
                            $/Ct *
                          </Text>
                          <TextInput
                            style={[
                              styles.editFieldInput,
                              (!stone.Price || parseFloat(stone.Price) <= 0) &&
                                styles.fieldInputError,
                            ]}
                            keyboardType="decimal-pad"
                            value={String(stone.Price ?? 0)}
                            onChangeText={v =>
                              updateStone(
                                editingContext.type,
                                editingContext.index,
                                'Price',
                                v,
                              )
                            }
                          />
                        </View>
                      </View>
                    </View>
                  );
                })()}
            </ScrollView>
            <TouchableOpacity
              style={styles.editModalSaveButton}
              onPress={() => setEditModalVisible(false)}
            >
              <Text style={styles.editModalSaveText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* PDF VIEWER MODAL */}
      <Modal visible={showPdfModal} animationType="slide" transparent>
        <View style={styles.pdfModalOverlay}>
          <View style={styles.pdfModalContent}>
            <PdfViewer html={pdfHtml} style={styles.pdfViewer} />
            <View style={styles.pdfModalToolbar}>
              <TouchableOpacity
                style={styles.pdfToolbarBtn}
                onPress={handleSharePDF}
              >
                <Icon name="share" size={20} color="#fff" />
                <Text style={styles.pdfToolbarBtnText}>Share PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.pdfToolbarBtn,
                  { backgroundColor: 'rgba(0,0,0,0.5)' },
                ]}
                onPress={() => setShowPdfModal(false)}
              >
                <Icon name="close" size={20} color="#fff" />
                <Text style={styles.pdfToolbarBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* COMPACT TYPE SELECTOR MODAL */}
      <Modal
        visible={showCompactTypeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCompactTypeModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowCompactTypeModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.multiSelectHeader}>Select Stone Type</Text>
            <ScrollView showsVerticalScrollIndicator={true}>
              {stoneTypesData.map(st => {
                const opt = { label: st.label, value: st.value };
                const isSelected = compactContext.type && multiData[compactContext.type]?.editableStones?.every(s => s.Type === opt.value);
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.dropdownOption,
                      isSelected && styles.dropdownOptionSelected,
                    ]}
                    onPress={() => {
                      if (compactContext.type && compactContext.type !== opt.value) {
                        const oldKey = compactContext.type;
                        const newKey = opt.value;
                        setMultiData(prev => {
                          const { [oldKey]: data, ...rest } = prev;
                          if (!data) return prev;
                          return {
                            ...rest,
                            [newKey]: {
                              ...data,
                              editableStones: data.editableStones.map(s => ({
                                ...s,
                                Type: newKey,
                              })),
                            },
                          };
                        });
                        setExpandedStones(prev => {
                          const { [oldKey]: val, ...rest } = prev;
                          return { ...rest, [newKey]: val ?? false };
                        });
                      }
                      setShowCompactTypeModal(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownOptionText,
                        isSelected && styles.dropdownOptionTextSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {isSelected && (
                      <Icon name="check" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={styles.doneButton}
              onPress={() => setShowCompactTypeModal(false)}
            >
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* COMPACT QUALITY SELECTOR MODAL */}
      <Modal
        visible={showCompactQualityModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCompactQualityModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowCompactQualityModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.multiSelectHeader}>Select Metal Quality</Text>
            <ScrollView showsVerticalScrollIndicator={true}>
              {metalQualityOptions.map(opt => {
                const isSelected = compactContext.type && multiData[compactContext.type]?.editableMetal?.Quality === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.dropdownOption,
                      isSelected && styles.dropdownOptionSelected,
                    ]}
                    onPress={() => {
                      if (compactContext.type) {
                        setMultiData(prev => ({
                          ...prev,
                          [compactContext.type]: {
                            ...prev[compactContext.type],
                            editableMetal: {
                              ...prev[compactContext.type].editableMetal,
                              Quality: opt.value,
                            },
                          },
                        }));
                      }
                      setShowCompactQualityModal(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownOptionText,
                        isSelected && styles.dropdownOptionTextSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {isSelected && (
                      <Icon name="check" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={styles.doneButton}
              onPress={() => setShowCompactQualityModal(false)}
            >
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <BrandedAlert {...alertConfig} onClose={hideAlert} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 100 },
  card: { padding: 20, borderRadius: 12, backgroundColor: '#fff' },
  title: {
    fontSize: fonts.xl,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 24,
  },
  inputContainer: { marginBottom: 20 },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    alignItems: 'flex-end',
  },
  label: {
    fontSize: fonts.md,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  extraText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: colors.background,
  },
  dropdownText: {
    fontSize: fonts.md,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    flex: 1,
  },
  placeholderText: { color: colors.textLight },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    minWidth: 280,
    maxHeight: '60%',
    overflow: 'hidden',
    elevation: 5,
  },
  dropdownOption: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#eee',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownOptionSelected: { backgroundColor: colors.backgroundSecondary },
  dropdownOptionText: {
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  dropdownOptionTextSelected: { fontFamily: fonts.bold, color: colors.primary },
  multiSelectHeader: {
    padding: 16,
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    borderBottomWidth: 1,
    borderColor: '#eee',
    textAlign: 'center',
    color: colors.textPrimary,
  },
  doneButton: {
    padding: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  doneButtonText: { color: '#fff', fontFamily: fonts.bold, fontSize: fonts.md },
  uploadArea: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 8,
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface || colors.backgroundSecondary,
    minHeight: 120,
  },
  uploadText: {
    fontSize: fonts.md,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    marginTop: 8,
  },
  uploadSubText: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  loadingContainer: { alignItems: 'center', justifyContent: 'center' },
  filePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  previewImage: { width: 50, height: 50, borderRadius: 6 },
  fileName: {
    flex: 1,
    marginHorizontal: 10,
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },

  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fafafa',
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  accordionTitle: {
    fontSize: fonts.md,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  accordionTotal: {
    fontSize: fonts.md,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  accordionBody: { padding: 16 },
  subSectionTitle: {
    fontSize: fonts.md,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginTop: 16,
    marginBottom: 10,
  },

  compactTableWrapper: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.background,
    marginVertical: 8,
  },
  compactTableHeader: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    paddingVertical: 6,
  },
  compactTableHeaderText: {
    fontSize: 9,
    fontFamily: fonts.bold,
    color: colors.textWhite,
    textAlign: 'center',
  },
  compactTableBody: { maxHeight: 180 },
  compactTableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || colors.border,
    backgroundColor: colors.background,
  },
  compactTableCell: {
    fontSize: 9,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    textAlign: 'center',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addStoneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    marginTop: 4,
  },
  addStoneButtonText: {
    color: colors.textWhite,
    fontFamily: fonts.medium,
    fontSize: fonts.sm,
  },

  chargesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chargeField: { width: '46%', marginBottom: 10 },
  fieldLabel: {
    fontSize: fonts.xs,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },

  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || colors.border,
  },
  summaryLabel: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontSize: fonts.sm,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  totalRow: {
    borderBottomWidth: 0,
    marginTop: 4,
    paddingVertical: 10,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 6,
    paddingHorizontal: 8,
  },
  totalLabel: {
    fontSize: fonts.md,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  totalValue: {
    fontSize: fonts.md,
    fontFamily: fonts.bold,
    color: colors.primary,
  },

  dutiesContainer: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
  },
  dutiesTitle: {
    fontSize: fonts.sm,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  dutyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
  dutyText: {
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },

  clientChargesContainer: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
  },
  clientChargesTitle: {
    fontSize: fonts.sm,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  chargeDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  chargeDetailLabel: {
    fontSize: fonts.xs,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
  chargeDetailValue: {
    fontSize: fonts.xs,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },

  recalcButton: {
    flex: 1,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  recalcButtonDisabled: { backgroundColor: colors.textSecondary, opacity: 0.5 },
  validationWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  validationWarningText: {
    flex: 1,
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    color: '#E65100',
  },

  footer: {
    padding: 16,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  calculateButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    gap: 8,
    height: 50,
  },
  calculateButtonDisabled: {
    backgroundColor: colors.textSecondary,
    opacity: 0.5,
  },
  calculateButtonText: {
    color: colors.textWhite,
    fontFamily: fonts.bold,
    fontSize: fonts.md,
  },

  pricesModalContent: {
    backgroundColor: colors.background,
    borderRadius: 12,
    width: '80%',
    maxHeight: '60%',
    padding: 20,
    elevation: 5,
  },
  pricesModalTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 16,
    textAlign: 'center',
  },
  pricesList: { marginBottom: 16 },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || colors.border,
  },
  priceMetal: {
    fontSize: fonts.md,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  priceValue: {
    fontSize: fonts.md,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  noPricesText: {
    fontSize: fonts.md,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    padding: 20,
  },
  closePricesButton: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  closePricesButtonText: {
    color: colors.textWhite,
    fontFamily: fonts.bold,
    fontSize: fonts.md,
  },

  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  editModalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    paddingBottom: 24,
    elevation: 10,
  },
  editModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  editModalTitle: {
    fontSize: fonts.md,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  editModalHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  deleteButton: { padding: 4 },
  editModalFields: { padding: 16 },
  editFieldRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  editFieldHalf: { flex: 1 },
  editFieldFull: { flex: 1 },
  editFieldLabel: {
    fontSize: fonts.xs,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  editFieldInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    backgroundColor: colors.backgroundSecondary,
  },
  editModalSaveButton: {
    marginHorizontal: 16,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  editModalSaveText: {
    color: colors.textWhite,
    fontFamily: fonts.bold,
    fontSize: fonts.md,
  },
  fieldLabelError: { color: colors.error },
  fieldInputError: { borderColor: colors.error, borderWidth: 2 },

  pdfModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  pdfModalContent: {
    width: '100%',
    height: '80%',
    backgroundColor: colors.background,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  pdfViewer: { flex: 1 },
  pdfModalToolbar: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  pdfToolbarBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  pdfToolbarBtnText: {
    color: '#fff',
    fontFamily: fonts.medium,
    fontSize: fonts.sm,
  },
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
  compactSelectorsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  compactSelectorField: {
    flex: 1,
  },
  compactSelectorLabel: {
    fontSize: fonts.xs,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  compactSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.background,
  },
  compactSelectorText: {
    fontSize: fonts.sm,
    fontFamily: fonts.bold,
    color: colors.primary,
    flex: 1,
  },
});
