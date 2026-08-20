import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Keyboard,
} from 'react-native';
import BrandedAlert from '../../components/common/BrandedAlert';
import PdfViewer from '../../components/common/PdfViewer';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ImageCropPicker from 'react-native-image-crop-picker';

import { Card } from '../../components/cards/Cards';
import Icon from '../../components/common/Icon';
import SingleStonePricing from './SingleStonePricing';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useClients } from '../../features/clients/clientsHooks';
import { buildRecalculatePayload } from '../../utils/pricingRecalc';
import { selectQuality, getSelectedQuality, commitQuality } from '../../utils/metalQualitySelector';
import {
  groupStoneDataByCategory,
  splitGroupedDataForRecalc,
  regroupApiResults,
} from '../../utils/stoneDataGrouper';
import { getClientStoneOptions, buildStoneCategoryMap } from '../../utils/stoneTypeMapping';
import { extraChargesValue, extraChargesType } from '../../utils/extraCharges';
import {
  useGetStoneTypesQuery,
  useGetMetalPricesQuery,
  useCalculatePricingMutation,
  useImagepriceDataMutation,
  useGetClientByIdQuery,
} from '../../store/api';
import { buildCombinedHtml } from './previewScreen';
import CropBoxSelector from './CropBoxSelector';

const buildTypeEntry = ({ type, src, imageData, metalKt, clientPricing = {}, forceType = false }) => ({
  imageData,
  editableStones: (src.Stones || []).map(st => ({ ...st, Type: forceType ? type : (st.Type || type) })),
  editableMetal: {
    Weight: src.Metal?.Weight || 0,
    Quality: src.Metal?.Quality || metalKt,
    Rate: src.Metal?.Rate || '',
    Ounce: src.GoldRatePerOunce ? String(src.GoldRatePerOunce) : '',
  },
  editableCharges: {
    Loss: src.Client?.Loss ?? clientPricing.Loss ?? 0,
    Labour: src.Client?.Labour ?? clientPricing.Labour ?? 0,
    ExtraCharges: extraChargesValue(src.Client?.ExtraCharges ?? clientPricing.ExtraCharges),
    ExtraChargesType: extraChargesType(src.Client?.ExtraCharges ?? clientPricing.ExtraCharges),
    GoldDuties: src.Client?.GoldDuties ?? clientPricing.GoldDuties ?? 0,
    SilverAndLabsDuties: src.Client?.SilverAndLabsDuties ?? clientPricing.SilverAndLabsDuties ?? 0,
    LossAndLabourDuties: src.Client?.LossAndLabourDuties ?? clientPricing.LossAndLabourDuties ?? 0,
  },
  dutyRates: {
    UndercutPrice: src.Client?.UndercutPrice ?? clientPricing.UndercutPrice,
    UndercutPriceTouched: false,
    NaturalDuties: src.Client?.NaturalDuties ?? clientPricing.NaturalDuties ?? 0,
    LabDuties: src.Client?.LabDuties ?? clientPricing.LabDuties ?? 0,
  },
  pricingResult: src,
});

let generatePDFModule = null;
try {
  const mod = require('react-native-html-to-pdf');
  generatePDFModule =
    mod.generatePDF || mod.default?.generatePDF || mod.default;
} catch (e) {}


export default function PricingCalci({ route, navigation }) {
  const [clientId, setClientId] = useState(route?.params?.clientId || '');
  const [selectedStoneTypes, setSelectedStoneTypes] = useState([]);
  const [metalKt, setMetalKt] = useState('');
  const [metalWeight, setMetalWeight] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);

  // Grouped State for Multiple Results
  const [groupedData, setGroupedData] = useState({});

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
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [stoneRecalcStatus, setStoneRecalcStatus] = useState({});
  const [showSingleStoneModal, setShowSingleStoneModal] = useState(false);
  const [singleStoneCatKey, setSingleStoneCatKey] = useState(null);
  const [extractPhase, setExtractPhase] = useState('');
  // Crop-box selection: the picked original waits here while the user marks the chart region.
  const [cropSelectorVisible, setCropSelectorVisible] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [extractionTimeoutVisible, setExtractionTimeoutVisible] = useState(false);
  const [extractionTimeoutImage, setExtractionTimeoutImage] = useState(null);
  const [extractionTimeoutCrop, setExtractionTimeoutCrop] = useState(null);

  const metalWeightRef = useRef(null);
  const pendingWeightRef = useRef(null);
  const isAutoRecalculatingRef = useRef(false);
  const dataChangedRef = useRef(false);
  const singleStoneCatKeyRef = useRef(singleStoneCatKey);
  const groupedDataRef = useRef(groupedData);
  const handleRecalculateAllRef = useRef(null);
  const needsAutoRecalcRef = useRef(false);
  // Fire exactly one automatic follow-up recalculation after a successful calc/recalc.
  // The follow-up run sets this false so it never triggers a third pass (no loop).
  const isFollowUpRecalcRef = useRef(false);
  useEffect(() => { singleStoneCatKeyRef.current = singleStoneCatKey; }, [singleStoneCatKey]);
  useEffect(() => { groupedDataRef.current = groupedData; }, [groupedData]);

  const { clients = [] } = useClients();
  const { data: stoneTypesData = [] } = useGetStoneTypesQuery();
  const { data: metalPricesData } = useGetMetalPricesQuery(false);
  const { data: selectedClient } = useGetClientByIdQuery(clientId, {
    skip: !clientId,
  });
  const [calculatePricing] =
    useCalculatePricingMutation();
  const [GetimagepriceData, { isLoading: isImageLoading }] =
    useImagepriceDataMutation();

  // Client objects come from two sources with different name casing: the list from
  // useClients() uses `.name`, the fetched client (getClientById) uses `.Name`.
  const resolvedClientName =
    selectedClient?.Name ||
    selectedClient?.name ||
    clients.find(c => c.id === clientId || c._id === clientId)?.name ||
    clients.find(c => c.id === clientId || c._id === clientId)?.Name ||
    'Client';

  // Auto-fill stone types when client is selected
  useEffect(() => {
    if (clientId && selectedClient?.ApplicableStoneTypes) {
      setSelectedStoneTypes(selectedClient.ApplicableStoneTypes);
    } else {
      setSelectedStoneTypes([]);
    }
    setGroupedData({});
    setStoneRecalcStatus({});
    setMetalKt('');
    setMetalWeight('');
    setImageFile(null);
    setIsRecalculating(false);
    setPdfHtml(null);
    setShowPdfModal(false);
    setSingleStoneCatKey(null);
    setShowSingleStoneModal(false);
  }, [clientId, selectedClient]);

  // Wipe all extraction/pricing state back to a clean slate (keeps the selected client,
  // stone types and metal KT). Used whenever the image changes/removes or an extraction
  // error occurs, so nothing stale from a previous image survives.
  const resetToFresh = useCallback(() => {
    setImageFile(null);
    setGroupedData({});
    setStoneRecalcStatus({});
    setPdfHtml(null);
    setShowPdfModal(false);
    setSingleStoneCatKey(null);
    setShowSingleStoneModal(false);
    setIsRecalculating(false);
    setIsExtracting(false);
    setExtractPhase('');
  }, []);

  const typeHasWeight = (data) => parseFloat(data?.editableMetal?.Weight) > 0;

  const isMetalWeightMissing =
    Object.keys(groupedData).length > 0 &&
    Object.values(groupedData).some(cat =>
      (cat.types || []).some(type => !typeHasWeight(cat.byType?.[type])),
    );

  useEffect(() => {
    if (!isMetalWeightMissing) return;
    const id = setTimeout(() => metalWeightRef.current?.focus(), 400);
    return () => clearTimeout(id);
  }, [isMetalWeightMissing]);

  const hasMissingStones = useCallback(() =>
    Object.values(groupedDataRef.current).some((catData) =>
      catData.types.some((type) => {
        const d = catData.byType[type];
        return Array.isArray(d?.editableStones)
          && d.editableStones.some((s) => parseFloat(s.Price) <= 0);
      }),
    ), []);

  // Auto-recalculate: when stone types change, trigger recalc after extraction settles
  useEffect(() => {
    if (dataChangedRef.current && clientId && Object.keys(groupedData).length > 0) {
      dataChangedRef.current = false;
      const timer = setTimeout(() => {
        if (!isAutoRecalculatingRef.current) {
          isAutoRecalculatingRef.current = true;
          handleRecalculateAllRef.current?.().finally(() => {
            isAutoRecalculatingRef.current = false;
          });
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [selectedStoneTypes]);

  // Auto-recalculate on keyboard hide.
  // Skip while stone prices are missing so the user can finish filling them.
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      if (!dataChangedRef.current || !clientId || Object.keys(groupedData).length === 0) return;
      if (hasMissingStones() || isAutoRecalculatingRef.current) return;
      dataChangedRef.current = false;
      applyPendingWeight();
      isAutoRecalculatingRef.current = true;
      handleRecalculateAllRef.current?.().finally(() => {
        isAutoRecalculatingRef.current = false;
      });
    });
    return () => subscription?.remove();
  }, [clientId, groupedData]);

  // Auto-recalc after image extraction: trigger calculatePricing for all types
  useEffect(() => {
    if (
      needsAutoRecalcRef.current &&
      Object.keys(groupedData).length > 0 &&
      clientId
    ) {
      needsAutoRecalcRef.current = false;
      const timer = setTimeout(async () => {
        if (handleRecalculateAllRef.current) {
          await handleRecalculateAllRef.current();
        }
        setIsExtracting(false);
        setExtractPhase('');
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [groupedData, clientId]);

  const hasAnyMissingStoneData = useCallback(() => {
    const allTypes = [];
    Object.values(groupedData).forEach((catData) => {
      catData.types.forEach((type) => allTypes.push(type));
    });
    if (allTypes.length === 0) return true;

    return allTypes.some((type) => {
      let data = null;
      Object.values(groupedData).forEach((catData) => {
        if (catData.byType[type]) data = catData.byType[type];
      });
      if (!data || !Array.isArray(data.editableStones)) return true;
      return data.editableStones.some(
        stone => parseFloat(stone.Price) <= 0,
      );
    });
  }, [groupedData]);

  const hasAnyZeroTotal = useCallback(() => {
    const allTypes = [];
    Object.values(groupedData).forEach((catData) => {
      catData.types.forEach((type) => allTypes.push(type));
    });
    if (allTypes.length === 0) return true;
    return allTypes.some((type) => {
      let data = null;
      Object.values(groupedData).forEach((catData) => {
        if (catData.byType[type]) data = catData.byType[type];
      });
      if (!data || !data.pricingResult) return true;
      return !data.pricingResult.TotalPrice || parseFloat(data.pricingResult.TotalPrice) <= 0;
    });
  }, [groupedData]);

  const hasStoneTypeBeenRecalculated = type => Boolean(stoneRecalcStatus[type]);

  const extractStoneTypeFromImage = async type => {
    if (!type || !clientId || !imageFile) return null;

    try {
      const data = await GetimagepriceData({
        image: imageFile,
        clientId,
        stoneType: type,
      }).unwrap();

      return { type, data };
    } catch (error) {
      return null;
    }
  };

  const buildStoneDataFromExtraction = (type, responseData) => {
    if (!type || !responseData) return null;
    // `pricing` may be an array (one entry per stone type) — pick this type's entry.
    const rawPricing = responseData.pricing;
    const p = Array.isArray(rawPricing)
      ? (rawPricing.find(e => (e?.Stones || []).some(s => s?.Type === type)) || rawPricing[0] || responseData.extractedData || responseData)
      : (rawPricing || responseData.extractedData || responseData);
    return buildTypeEntry({
      type,
      src: p,
      imageData: responseData,
      metalKt,
      clientPricing: selectedClient?.Pricing,
      forceType: true,
    });
  };

  const updateMetalWeight = (value) => {
    dataChangedRef.current = true;
    pendingWeightRef.current = value;
    setMetalWeight(value);
  };

  // Writes the typed weight into every stone type. Called on keyboard hide, not
  // while typing, so groupedData is not rebuilt on each keystroke.
  const applyPendingWeight = () => {
    const value = pendingWeightRef.current;
    if (value == null) return;
    setGroupedData((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((cat) => {
        const newByType = { ...next[cat].byType };
        Object.keys(newByType).forEach((type) => {
          newByType[type] = {
            ...newByType[type],
            editableMetal: { ...newByType[type].editableMetal, Weight: value },
          };
        });
        next[cat] = { ...next[cat], byType: newByType };
      });
      return next;
    });
  };

  const handleMetalKtChange = (newKt) => {
    selectQuality(clientId || 'pricing', newKt, metalKt);
    setMetalKt(newKt);
    setGroupedData((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((cat) => {
        const newByType = { ...next[cat].byType };
        Object.keys(newByType).forEach((type) => {
          newByType[type] = {
            ...newByType[type],
            editableMetal: { ...newByType[type].editableMetal, Quality: newKt, Rate: '' },
          };
        });
        next[cat] = { ...next[cat], byType: newByType };
      });
      return next;
    });
    if (clientId && Object.keys(groupedData).length > 0) {
      setTimeout(() => {
        if (!isAutoRecalculatingRef.current) {
          isAutoRecalculatingRef.current = true;
          handleRecalculateAllRef.current?.().finally(() => {
            isAutoRecalculatingRef.current = false;
          });
        }
      }, 100);
    }
  };


  const handleRecalculateAll = async () => {
    dataChangedRef.current = false;
    // Consume the follow-up flag: if this run IS the auto follow-up, it must not queue another.
    const isFollowUp = isFollowUpRecalcRef.current;
    isFollowUpRecalcRef.current = false;
    const selectedTypes = [...(selectedStoneTypes.length > 0 ? selectedStoneTypes : [])];
    Object.values(groupedData).forEach((catData) => {
      catData.types.forEach((type) => {
        if (!selectedTypes.includes(type)) selectedTypes.push(type);
      });
    });
    if (selectedTypes.length === 0 || !clientId) return;

    setIsRecalculating(true);

    const newTypes = selectedTypes.filter(
      type => !hasStoneTypeBeenRecalculated(type),
    );

    const rawMultiData = {};
    Object.values(groupedData).forEach((catData) => {
      catData.types.forEach((type) => {
        if (catData.byType[type]) {
          const entry = catData.byType[type];
          rawMultiData[type] = pendingWeightRef.current != null
            ? { ...entry, editableMetal: { ...entry.editableMetal, Weight: pendingWeightRef.current } }
            : entry;
        }
      });
    });

    if (newTypes.length > 0) {
      // Extraction output is identical for every stone type except the Type
      // label, so reuse an already-extracted type as the template and send the
      // new types straight to their first price calculation.
      const templateType = Object.keys(rawMultiData).find(
        t =>
          Array.isArray(rawMultiData[t]?.editableStones) &&
          rawMultiData[t].editableStones.length > 0,
      );
      const template = templateType ? rawMultiData[templateType] : null;

      if (template) {
        newTypes.forEach((type) => {
          rawMultiData[type] = {
            ...template,
            editableStones: template.editableStones.map(s => ({
              ...s,
              Type: type,
            })),
            editableMetal: { ...template.editableMetal },
            editableCharges: { ...template.editableCharges },
            dutyRates: { ...template.dutyRates },
          };
        });
      } else {
        if (!imageFile) {
          showAlert(
            'Image Required',
            'Please use the already uploaded image to extract new stone types.',
            'warning',
          );
          setIsRecalculating(false);
          return;
        }

        // Call the API once for the first new type, then clone for the rest
        const firstNewType = newTypes[0];
        let singleExtraction = null;
        try {
          singleExtraction = await extractStoneTypeFromImage(firstNewType);
        } catch (_) {}

        if (!singleExtraction?.data) {
          showAlert(
            'Extraction Failed',
            `Failed to extract data from the uploaded image.`,
            'warning',
          );
          setIsRecalculating(false);
          return;
        }

        const baseExtracted = buildStoneDataFromExtraction(firstNewType, singleExtraction.data);
        if (!baseExtracted) {
          showAlert('Extraction Failed', 'Could not parse extracted data.', 'warning');
          setIsRecalculating(false);
          return;
        }

        rawMultiData[firstNewType] = baseExtracted;
        newTypes.slice(1).forEach((type) => {
          rawMultiData[type] = {
            ...baseExtracted,
            editableStones: baseExtracted.editableStones.map(s => ({ ...s, Type: type })),
            editableMetal: { ...baseExtracted.editableMetal },
            editableCharges: { ...baseExtracted.editableCharges },
            dutyRates: { ...baseExtracted.dutyRates },
          };
        });
      }
    }

    const allTypeEntries = splitGroupedDataForRecalc(
      groupStoneDataByCategory(rawMultiData, stoneCategoryMap),
    );

    const payloads = allTypeEntries.map(({ type, data }) => ({
      type,
      payload: buildRecalculatePayload({
        clientId,
        data,
        metalKt,
        previousMetalQuality:
          getSelectedQuality(type)?.current ?? getSelectedQuality(clientId || 'pricing')?.current,
        updatedMetalQuality:
          getSelectedQuality(type)?.updated ?? getSelectedQuality(clientId || 'pricing')?.updated,
        selectedClient,
        // New types go through their first calculation so the backend prices
        // the stones for the selected type; existing types recalculate.
        isRecalculate: !newTypes.includes(type),
      }),
    }));

    const results = await Promise.allSettled(
      payloads.map(({ type, payload }) =>
        calculatePricing(payload).unwrap().then(result => ({ type, result }))
      ),
    );

    const failedTypes = [];
    const succeededTypes = [];
    let hasRateLimit = false;

    results.forEach((settled, i) => {
      const type = payloads[i].type;
      if (settled.status === 'fulfilled') {
        succeededTypes.push({ type, result: settled.value.result });
      } else {
        if (settled.reason?.status === 429 || settled.reason?.data?.statusCode === 429) {
          hasRateLimit = true;
        }
        failedTypes.push(type);
      }
    });

    if (succeededTypes.length > 0) {
      const updatedGrouped = regroupApiResults(succeededTypes, groupedData, stoneCategoryMap);
      setGroupedData((prev) => {
        const next = { ...prev };
        Object.keys(updatedGrouped).forEach((cat) => {
          if (next[cat]) {
            next[cat] = {
              ...next[cat],
              byType: {
                ...next[cat].byType,
                ...updatedGrouped[cat].byType,
              },
            };
          } else {
            next[cat] = updatedGrouped[cat];
          }
        });
        return next;
      });

      setStoneRecalcStatus((prev) => {
        const next = { ...prev };
        succeededTypes.forEach(({ type }) => {
          next[type] = true;
        });
        return next;
      });

      commitQuality(clientId || 'pricing');
      pendingWeightRef.current = null;
    }

    setIsRecalculating(false);

    // When a complete result has arrived, automatically run the recalculation once more
    // (single guarded follow-up) so the final totals settle. The follow-up won't re-trigger.
    if (!isFollowUp && succeededTypes.length > 0) {
      isFollowUpRecalcRef.current = true;
      setTimeout(() => { handleRecalculateAllRef.current?.(); }, 0);
    }

    if (failedTypes.length > 0) {
      if (hasRateLimit) {
        showAlert('Rate Limit', 'Too many requests. Please try again later.', 'error', [
          { text: 'Try Again', onPress: () => handleRecalculateAll() },
        ]);
      } else {
        showAlert('Partial Recalculation', `Failed: ${failedTypes.join(', ')}`, 'warning');
      }
    }
  };

  handleRecalculateAllRef.current = handleRecalculateAll;

  // Runs the extraction on the ORIGINAL image plus the selected crop region (fractions 0..1).
  // The backend crops full-resolution from those fractions — the device never crops, so iOS
  // and Android behave identically.
  const runExtraction = async (file, crop) => {
    resetToFresh();
    setImageFile(file);
    setIsExtracting(true);
    setExtractPhase('extracting');

    let timeoutId = null;
    try {
      const firstType = selectedStoneTypes[0];

      const extractionPromise = GetimagepriceData({
        image: file,
        clientId: clientId,
        stoneType: firstType,
        cropX: crop?.x,
        cropY: crop?.y,
        cropW: crop?.w,
        cropH: crop?.h,
      }).unwrap();

      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject({ status: 'TIMEOUT', message: 'Extraction is taking longer than expected.' });
        }, 120000);
      });

      let extractionResponse;
      try {
        extractionResponse = await Promise.race([extractionPromise, timeoutPromise]);
      } catch (timeoutErr) {
        if (timeoutErr?.status === 'TIMEOUT') {
          clearTimeout(timeoutId);
          setIsExtracting(false);
          setExtractPhase('');
          setExtractionTimeoutImage(file);
          setExtractionTimeoutCrop(crop);
          setExtractionTimeoutVisible(true);
          return;
        }
        throw timeoutErr;
      }

      clearTimeout(timeoutId);

      const rawMultiData = {};
      // The backend now returns `pricing` as an ARRAY — one calculated entry per stone
      // type. Fall back to a single object / the raw extraction for older responses.
      const pricingList = Array.isArray(extractionResponse.pricing)
        ? extractionResponse.pricing.filter(Boolean)
        : (extractionResponse.pricing ? [extractionResponse.pricing] : []);
      const extracted = extractionResponse.extractedData || extractionResponse;

      const hasDataIn = (src) =>
        !!src && (
          (src.Stones && src.Stones.length > 0) ||
          (src.Metal && parseFloat(src.Metal.Weight) > 0) ||
          src.TotalPieces > 0
        );

      // `src` is that type's own pricing entry (or the raw extraction when unpriced).
      const buildTypeData = (type, src) =>
        buildTypeEntry({
          type,
          src,
          imageData: extractionResponse,
          metalKt,
          clientPricing: selectedClient?.Pricing,
        });

      if (pricingList.length > 0) {
        // One entry per stone type — key it by the type the backend priced it as.
        pricingList.forEach((entry, i) => {
          const type =
            (entry.Stones || []).find(s => s?.Type)?.Type ||
            selectedStoneTypes[i] ||
            firstType;
          rawMultiData[type] = buildTypeData(type, entry);
        });
      } else if (hasDataIn(extracted)) {
        // Geometry extracted but not priced — seed every selected type from it.
        rawMultiData[firstType] = buildTypeData(firstType, extracted);
        selectedStoneTypes.slice(1).forEach(type => {
          rawMultiData[type] = buildTypeData(type, extracted);
        });
      }

      if (Object.keys(rawMultiData).length === 0) {
        showAlert('No Data Found', 'No pricing data was extracted from the image.', 'warning');
        resetToFresh();
      } else {
        const grouped = groupStoneDataByCategory(rawMultiData, stoneCategoryMap);
        setGroupedData(grouped);
        const allTypes = [];
        Object.values(grouped).forEach((catData) => {
          catData.types.forEach((type) => allTypes.push(type));
        });
        const firstGroupType = allTypes[0];
        if (firstGroupType) {
          let firstData = null;
          Object.values(grouped).forEach((catData) => {
            if (catData.byType[firstGroupType]) firstData = catData.byType[firstGroupType];
          });
        }
        setExtractPhase('calculating');
        needsAutoRecalcRef.current = true;
      }
    } catch (apiError) {
      if (apiError?.status === 429 || apiError?.data?.statusCode === 429) {
        showAlert('Rate Limit', 'Too many requests. Please try again later.', 'error', [
          { text: 'Try Again', onPress: () => runExtraction(file, crop) },
        ]);
      } else {
        showAlert('Extraction Error', 'Failed to extract pricing data. Check configuration.', 'error');
      }
      resetToFresh();
    }
  };

  const handleCropConfirm = (crop) => {
    setCropSelectorVisible(false);
    const img = pendingImage;
    setPendingImage(null);
    if (!img) return;
    runExtraction({ uri: img.uri, name: img.name, type: img.type }, crop);
  };

  const handleCropCancel = () => {
    setCropSelectorVisible(false);
    setPendingImage(null);
  };

  const handleExtractionTimeoutRetry = () => {
    const img = extractionTimeoutImage;
    const crop = extractionTimeoutCrop;
    setExtractionTimeoutVisible(false);
    setExtractionTimeoutImage(null);
    setExtractionTimeoutCrop(null);
    if (img) {
      runExtraction(img, crop);
    }
  };

  const handleExtractionTimeoutDismiss = () => {
    setExtractionTimeoutVisible(false);
    setExtractionTimeoutImage(null);
    setExtractionTimeoutCrop(null);
    resetToFresh();
  };

  const handleImagePick = async () => {
    if (!clientId) {
      showAlert('Validation Error', 'Please select a client first', 'warning');
      return;
    }
    if (selectedStoneTypes.length === 0) {
      showAlert('Validation Error', 'Please select at least one stone type', 'warning');
      return;
    }
    if (!metalKt) {
      showAlert('Validation Error', 'Please select the metal Kt first', 'warning');
      return;
    }

    try {
      // Pick the ORIGINAL image with NO on-device cropping (that was the iOS-degrading step).
      // forceJpg converts HEIC → JPEG and bakes in EXIF orientation so the box the user draws
      // matches what the backend will decode. The user then marks the chart region and the
      // backend crops full-resolution from those fractions.
      let picked;
      try {
        picked = await ImageCropPicker.openPicker({
          mediaType: 'photo',
          cropping: false,
          forceJpg: true,
          compressImageQuality: 1,
        });
      } catch (pickErr) {
        if (pickErr?.code === 'E_PICKER_CANCELLED') return;
        throw pickErr;
      }
      if (!picked?.path) {
        showAlert('Error', 'Failed to pick image.', 'error');
        return;
      }
      if (picked.size && picked.size > 20 * 1024 * 1024) {
        showAlert('File too large', 'Maximum allowed image size is 20MB.', 'warning');
        return;
      }

      const uri = picked.path.startsWith('file://') ? picked.path : `file://${picked.path}`;

      // Save the original for the in-app preview.
      try {
        const base64 = await RNFS.readFile(picked.path.replace(/^file:\/\//, ''), 'base64');
        await AsyncStorage.setItem('@pre_crop_image', base64);
      } catch (e) {
        // Non-critical
      }

      // Hold the original and let the user mark the chart region.
      setPendingImage({
        uri,
        name: picked.filename || `image_${Date.now()}.jpg`,
        type: picked.mime || 'image/jpeg',
        width: picked.width,
        height: picked.height,
      });
      // Delay presenting our Modal so iOS has finished dismissing the image picker first —
      // presenting a Modal while another is still dismissing is silently dropped on iOS.
      setTimeout(() => setCropSelectorVisible(true), Platform.OS === 'ios' ? 400 : 0);
    } catch (error) {
      showAlert('Error', 'Failed to pick image.', 'error');
      resetToFresh();
    }
  };

  const buildPricingHtml = useCallback(() => {
    const entries = [];
    Object.values(groupedData).forEach((catData) => {
      catData.types.forEach((type) => {
        const typeData = catData.byType[type];
        if (typeData?.pricingResult) {
          entries.push(typeData.pricingResult);
        }
      });
    });
    if (entries.length === 0) return '';
    const clientName =
      clients.find(c => c.id === clientId || c._id === clientId)?.name || 'N/A';
    return buildCombinedHtml(entries, clientName, metalKt);
  }, [groupedData, clients, clientId, metalKt]);

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

  const openSingleStoneModal = (category) => {
    if (category) {
      setSingleStoneCatKey(category);
      setShowSingleStoneModal(true);
    }
  };

  const handleSingleStoneRecalculated = (type, updatedData) => {
    setGroupedData(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(cat => {
        if (next[cat].byType[type]) {
          next[cat] = {
            ...next[cat],
            byType: {
              ...next[cat].byType,
              [type]: updatedData,
            },
          };
        }
      });
      return next;
    });
    setStoneRecalcStatus(prev => ({ ...prev, [type]: true }));
  };

  const clientOptions = clients.map(c => ({
    label: c.name || 'Unknown',
    value: c.id || c._id,
  }));
  const stoneOptions = getClientStoneOptions(stoneTypesData, selectedClient);
  const stoneCategoryMap = buildStoneCategoryMap(selectedClient?.ApplicableStoneTypes || []);
  const metalQualityOptions = [
    {label:'3K', value:'3K'},
    {label:'9K', value:'9K'},
    { label: '10K', value: '10K' },
    { label: '14K', value: '14K' },
    { label: '18K', value: '18K' },
    { label: '22K', value: '22K' },
    { label: 'Silver 925', value: 'Silver 925' },
    { label: 'Platinum', value: 'Platinum' },
  ];

  const buildPreviewPairs = (cat) =>
    (cat?.types || [])
      .map(type => ({ type, result: cat.byType[type]?.pricingResult }))
      .filter(p => p.result);

  const applyPreviewEntries = (types, updatedEntries) => {
    if (!updatedEntries || updatedEntries.length === 0) return;
    const apiResults = types
      .map((type, i) => ({ type, result: updatedEntries[i] }))
      .filter(r => r.result);
    if (apiResults.length === 0) return;
    setGroupedData(prev => {
      const updated = regroupApiResults(apiResults, prev, stoneCategoryMap);
      const next = { ...prev };
      Object.keys(updated).forEach(cat => {
        next[cat] = next[cat]
          ? { ...next[cat], byType: { ...next[cat].byType, ...updated[cat].byType } }
          : updated[cat];
      });
      return next;
    });
  };

  const recalculateInPlace = () => {
    setTimeout(() => { handleRecalculateAllRef.current?.(); }, 300);
  };

  const openPreviewFromModal = (isClientPreview) => {
    setShowSingleStoneModal(false);
    const catKey = singleStoneCatKeyRef.current;
    setTimeout(async () => {
      if (handleRecalculateAllRef.current) {
        await handleRecalculateAllRef.current();
      }
      await new Promise(r => setTimeout(r, 150));
      const pairs = buildPreviewPairs(groupedDataRef.current[catKey]);
      navigation.navigate('PricingPreview', {
        pricingEntries: pairs.map(p => p.result),
        clientName: resolvedClientName,
        metalKt,
        preCropImageKey: '@pre_crop_image',
        isClientPreview,
        clientId,
        selectedClient,
        onEntriesUpdated: updated =>
          applyPreviewEntries(pairs.map(p => p.type), updated),
      });
    }, 400);
  };

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
                    dataChangedRef.current = true;
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
      <CropBoxSelector
        visible={cropSelectorVisible}
        imageUri={pendingImage?.uri}
        imageWidth={pendingImage?.width}
        imageHeight={pendingImage?.height}
        onConfirm={handleCropConfirm}
        onCancel={handleCropCancel}
      />
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
            handleMetalKtChange,
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
                    {extractPhase === 'calculating'
                      ? `Calculating prices for ${selectedStoneTypes.length} type${selectedStoneTypes.length > 1 ? 's' : ''}...`
                      : `Extracting ${selectedStoneTypes.length} profile${selectedStoneTypes.length > 1 ? 's' : ''}...`
                    }
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
                    onPress={resetToFresh}
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

        {isMetalWeightMissing && (
          <Card style={[styles.card, { marginTop: 16 }]}>
            <View style={styles.validationWarning}>
              <Icon name="warning" size={16} color={colors.warning} />
              <Text style={styles.validationWarningText}>
                Metal weight is missing — fill it first to price this design
              </Text>
            </View>
            <View style={styles.commonSectionHeader}>
              <Text style={styles.commonSectionTitle}>Metal Weight</Text>
            </View>
            <View style={styles.chargesRow}>
              <View style={styles.chargeField}>
                <Text style={[styles.fieldLabel, styles.fieldLabelError]}>Weight (g) *</Text>
                <TextInput
                  ref={metalWeightRef}
                  style={[styles.fieldInput, styles.fieldInputError]}
                  keyboardType="decimal-pad"
                  value={String(metalWeight || '')}
                  onChangeText={updateMetalWeight}
                  placeholder="0"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>
          </Card>
        )}

        {/* ACCORDION SECTIONS */}
        {Object.entries(groupedData).map(([category, catData]) => {
          if (!catData || !catData.types || catData.types.length === 0) return null;

          const hasMissing = catData.types.some(type => {
            const d = catData.byType[type];
            return d?.editableStones?.some(s => parseFloat(s.Price) <= 0);
          });
          const missingMetalWeight = catData.types.some(
            type => !typeHasWeight(catData.byType[type]),
          );

          return (
            <Card
              key={category}
              style={[
                styles.card,
                styles.accordionCard,
              ]}
            >
              {missingMetalWeight && (
                <Text style={styles.missingWarningText}>
                  Metal weight missing
                </Text>
              )}
              {hasMissing && (
                <Text style={styles.missingWarningText}>
                  Please fill all stone prices before recalculating
                </Text>
              )}
              {!hasMissing && (
                <Text style={styles.missingWarningText}>
                  please click on the title below for more details of pricing
                </Text>
              )}
              <TouchableOpacity
                style={styles.accordionHeader}
                onPress={() => openSingleStoneModal(category)}
                activeOpacity={0.7}
              >
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}
                >
                  <Icon name="diamond" size={20} color={colors.primary} />
                  <Text style={styles.accordionTitle}>{catData.label} Pricing</Text>
                  </View>
                  {!hasMissing ? <>
                  <TouchableOpacity
                    style={styles.previewSummaryBtnAdmin}
                  onPress={() => {
                    const pairs = buildPreviewPairs(catData);
                    navigation.navigate('PricingPreview', {
                      pricingEntries: pairs.map(p => p.result),
                      clientName: resolvedClientName,
                      metalKt,
                      preCropImageKey: '@pre_crop_image',
                      clientId,
                      selectedClient,
                      onEntriesUpdated: updated =>
                        applyPreviewEntries(pairs.map(p => p.type), updated),
                    });
                  }}
                  activeOpacity={0.8}
                >
                  <Icon name="visibility" size={16} color={colors.textWhite} />
                  <Text style={styles.previewSummaryBtnText}>Admin Preview</Text>
                </TouchableOpacity> 

                
                </>: <Text style={{color: colors.error}}>$0.00</Text>}
                <Icon name="chevron-right" size={22} color={colors.textSecondary} style={{marginLeft: 8}}/>
              </TouchableOpacity>
                  {!hasMissing && (
                    <>
                     <TouchableOpacity
                  style={styles.previewSummaryBtn}
                  onPress={() => {
                    const pairs = buildPreviewPairs(catData);
                    navigation.navigate('PricingPreview', {
                      pricingEntries: pairs.map(p => p.result),
                      clientName: resolvedClientName,
                      metalKt,
                      preCropImageKey: '@pre_crop_image',
                      isClientPreview: true,
                      clientId,
                      selectedClient,
                      onEntriesUpdated: updated =>
                        applyPreviewEntries(pairs.map(p => p.type), updated),
                    });
                  }}
                  activeOpacity={0.8}
                >
                  <Icon name="visibility" size={16} color={colors.textWhite} />
                  <Text style={styles.previewSummaryBtnText}>Client Preview</Text>
                </TouchableOpacity> 
                    </>
                  )}
            </Card>
          );
        })}
      </ScrollView>

      {/* Footer Actions */}
      <View style={styles.footer}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            style={[
              styles.calculateButton,
              { flex: 1 },
              (Object.keys(groupedData).length === 0 || isRecalculating) &&
                styles.calculateButtonDisabled,
            ]}
            onPress={handleRecalculateAll}
            disabled={Object.keys(groupedData).length === 0 || isRecalculating}
          >
            {isRecalculating ? (
              <ActivityIndicator size="small" color={colors.textWhite} />
            ) : (
              <Icon name="refresh" size={20} color={colors.textWhite} />
            )}
            <Text style={styles.calculateButtonText}>
              {isRecalculating ? 'Recalculating...' : 'Recalculate All'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.calculateButton,
              { flex: 1 },
              (Object.keys(groupedData).length === 0 || hasAnyMissingStoneData() || hasAnyZeroTotal()) &&
                styles.calculateButtonDisabled,
            ]}
            onPress={() => {
              setPdfHtml(buildPricingHtml());
              setShowPdfModal(true);
            }}
            disabled={
              Object.keys(groupedData).length === 0 || hasAnyMissingStoneData() || hasAnyZeroTotal()
            }
          >
            <Icon name="picture-as-pdf" size={20} color={colors.textWhite} />
            <Text style={styles.calculateButtonText}>Preview Full PDF</Text>
          </TouchableOpacity>
        </View>
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
      <BrandedAlert {...alertConfig} onClose={hideAlert} />
      </Modal>

      <SingleStonePricing
        visible={showSingleStoneModal}
        onClose={() => {
          setShowSingleStoneModal(false);
          setSingleStoneCatKey(null);
        }}
        onDone={recalculateInPlace}
        catData={singleStoneCatKey ? groupedData[singleStoneCatKey] : null}
        isRecalculating={isRecalculating}
        metalKt={metalKt}
        onRecalculated={handleSingleStoneRecalculated}
        onPreviewSummary={() => openPreviewFromModal(false)}
        onClientPreview={() => openPreviewFromModal(true)}
        onRequestRecalculate={recalculateInPlace}
      />

      {/* EXTRACTION TIMEOUT WARNING MODAL */}
      <Modal
        visible={extractionTimeoutVisible}
        transparent
        animationType="fade"
        onRequestClose={handleExtractionTimeoutDismiss}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={handleExtractionTimeoutDismiss}
        >
          <View style={styles.timeoutModalContent}>
            <View style={styles.timeoutIconContainer}>
              <Icon name="timer" size={40} color={colors.error || '#EF4444'} />
            </View>
            <Text style={styles.timeoutTitle}>Extraction Taking Longer Than Expected</Text>
            <Text style={styles.timeoutMessage}>
              The image extraction has exceeded 1 min. The server may be busy or experiencing high load.
            </Text>
            <View style={styles.timeoutButtonRow}>
              <TouchableOpacity
                style={styles.timeoutRetryButton}
                onPress={handleExtractionTimeoutRetry}
                activeOpacity={0.8}
              >
                <Icon name="refresh" size={18} color="#fff" />
                <Text style={styles.timeoutRetryText}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.timeoutDismissButton}
                onPress={handleExtractionTimeoutDismiss}
                activeOpacity={0.8}
              >
                <Text style={styles.timeoutDismissText}>Cancel</Text>
              </TouchableOpacity>
            </View>
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
  accordionCard: {
    marginTop: 16,
    padding: 0,
    overflow: Platform.OS === 'ios' ? 'visible' : 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
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
    overflow: Platform.OS === 'ios' ? 'visible' : 'hidden',
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
  previewSummaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  previewSummaryBtnAdmin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  
  previewSummaryBtnText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#fff',
  },
  commonSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  commonSectionTitle: {
    fontSize: fonts.sm,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
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

  validationWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    padding: 12,
    borderRadius: 8,
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
  missingWarningText: {
    fontSize: 10,
    fontFamily: fonts.regular,
    color: colors.error,
    textAlign: 'center',
    paddingVertical: 4,
  },
  timeoutModalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '85%',
    alignItems: 'center',
    padding: 24,
    elevation: 10,
  },
  timeoutIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  timeoutTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  timeoutMessage: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  timeoutButtonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  timeoutRetryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
  },
  timeoutRetryText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: fonts.md,
  },
  timeoutDismissButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  timeoutDismissText: {
    color: colors.textSecondary,
    fontFamily: fonts.bold,
    fontSize: fonts.md,
  },
});
