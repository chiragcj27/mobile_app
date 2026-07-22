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
import { useImageProcessor } from '../../utils/imageProcessor';
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

let generatePDFModule = null;
try {
  const mod = require('react-native-html-to-pdf');
  generatePDFModule =
    mod.generatePDF || mod.default?.generatePDF || mod.default;
} catch (e) {}


export default function PricingCalci({ route, navigation }) {
  const [clientId, setClientId] = useState(route?.params?.clientId || '');
  const [selectedStoneTypes, setSelectedStoneTypes] = useState([]);
  const [metalKt, setMetalKt] = useState('18K');
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
  const [expandedCommonSections, setExpandedCommonSections] = useState({ metal: true });
  const [pdfHtml, setPdfHtml] = useState(null);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingContext, setEditingContext] = useState({
    type: null,
    index: null,
  });
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [commonMetal, setCommonMetal] = useState({ Weight: '', Rate: '' });
  const [stoneRecalcStatus, setStoneRecalcStatus] = useState({});
  const [showSingleStoneModal, setShowSingleStoneModal] = useState(false);
  const [singleStoneCatData, setSingleStoneCatData] = useState(null);
  const [singleStoneModalKey, setSingleStoneModalKey] = useState(0);
  const [extractPhase, setExtractPhase] = useState('');
  const { processImage, processor } = useImageProcessor();

  const isAutoRecalculatingRef = useRef(false);
  const dataChangedRef = useRef(false);
  const prevMissingCountRef = useRef(0);
  const metalWeightRef = useRef(null);
  const singleStoneCatDataRef = useRef(singleStoneCatData);
  const groupedDataRef = useRef(groupedData);
  const handleRecalculateAllRef = useRef(null);
  const needsAutoRecalcRef = useRef(false);
  useEffect(() => { singleStoneCatDataRef.current = singleStoneCatData; }, [singleStoneCatData]);
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
    setCommonMetal({ Weight: '', Rate: '' });
    setMetalKt('18K');
    setImageFile(null);
    setEditModalVisible(false);
    setEditingContext({ type: null, index: 0 });
    setIsRecalculating(false);
    setPdfHtml(null);
    setShowPdfModal(false);
    setSingleStoneCatData(null);
    setShowSingleStoneModal(false);
  }, [clientId, selectedClient]);

  // Count missing stones — optionally filter by a specific type
  const countMissingStones = useCallback((filterType) => {
    let count = 0;
    Object.values(groupedData).forEach((catData) => {
      catData.types.forEach((type) => {
        if (filterType && type !== filterType) return;
        const d = catData.byType[type];
        if (!d || !Array.isArray(d.editableStones)) return;
        d.editableStones.forEach((s, idx) => {
          if (parseFloat(s.Price) <= 0) {
            count++;
          }
        });
      });
    });
    return count;
  }, [groupedData]);

  // Auto-recalculate: when stone types change, trigger recalc after extraction settles
  useEffect(() => {
    if (dataChangedRef.current && clientId && Object.keys(groupedData).length > 0) {
      dataChangedRef.current = false;
      const timer = setTimeout(() => {
        if (!isAutoRecalculatingRef.current) {
          isAutoRecalculatingRef.current = true;
          handleRecalculateAll().finally(() => {
            isAutoRecalculatingRef.current = false;
          });
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [selectedStoneTypes]);

  // Auto-recalculate: listen for keyboard hide, debounce, then recalc
  // skip if missing stones remain so user can finish editing all first
  useEffect(() => {
    let debounceTimer = null;
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      if (dataChangedRef.current && clientId && Object.keys(groupedData).length > 0) {
        const currentMissing = countMissingStones();
        if (currentMissing > 0) return;
        dataChangedRef.current = false;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (!isAutoRecalculatingRef.current) {
            isAutoRecalculatingRef.current = true;
            handleRecalculateAll().finally(() => {
              isAutoRecalculatingRef.current = false;
            });
          }
        }, 500);
      }
    });
    return () => {
      subscription?.remove();
      clearTimeout(debounceTimer);
    };
  }, [clientId, groupedData]);

  // Auto-recalculate: when edit modal closes after editing, trigger recalc
  // only if all missing stones of the EDITED TYPE are now filled
  useEffect(() => {
    if (editModalVisible) {
      const editedType = editingContext.type;
      const snapCount = editedType ? countMissingStones(editedType) : countMissingStones();
      prevMissingCountRef.current = snapCount;
      return;
    }
    const editedType = editingContext.type;
    if (clientId && Object.keys(groupedData).length > 0) {
      const currentMissing = editedType ? countMissingStones(editedType) : countMissingStones();
      if (currentMissing > 0) {
        return;
      }
      dataChangedRef.current = false;
      const timer = setTimeout(() => {
        if (!isAutoRecalculatingRef.current) {
          isAutoRecalculatingRef.current = true;
          handleRecalculateAll().finally(() => {
            isAutoRecalculatingRef.current = false;
          });
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [editModalVisible]);

  // Auto-focus metal weight input when grouped data appears and weight is missing
  useEffect(() => {
    if (
      Object.keys(groupedData).length > 0 &&
      (!commonMetal.Weight || parseFloat(commonMetal.Weight) <= 0)
    ) {
      setTimeout(() => metalWeightRef.current?.focus(), 400);
    }
  }, [groupedData]);

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

  const updateStone = (type, index, field, value) => {
    dataChangedRef.current = true;
    setGroupedData((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((cat) => {
        if (next[cat].byType[type]) {
          const typeData = next[cat].byType[type];
          if (!Array.isArray(typeData.editableStones)) return;
          const nextStones = [...typeData.editableStones];
          nextStones[index] = { ...nextStones[index], [field]: value };
          next[cat] = {
            ...next[cat],
            byType: {
              ...next[cat].byType,
              [type]: { ...typeData, editableStones: nextStones },
            },
          };
        }
      });
      return next;
    });
  };

  const deleteStone = (type, index) => {
    dataChangedRef.current = true;
    setGroupedData((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((cat) => {
        if (next[cat].byType[type]) {
          const typeData = next[cat].byType[type];
          if (!Array.isArray(typeData.editableStones)) return;
          next[cat] = {
            ...next[cat],
            byType: {
              ...next[cat].byType,
              [type]: {
                ...typeData,
                editableStones: typeData.editableStones.filter((_, i) => i !== index),
              },
            },
          };
        }
      });
      return next;
    });
  };

  const hasStoneTypeBeenRecalculated = type => Boolean(stoneRecalcStatus[type]);

  const extractStoneTypeFromImage = async type => {
    if (!type || !clientId || !imageFile) return null;

    try {
      const data = await GetimagepriceData({
        image: imageFile,
        clientId,
        stoneType: type,
        metalQuality: metalKt,
      }).unwrap();

      return { type, data };
    } catch (error) {
      return null;
    }
  };

  const buildStoneDataFromExtraction = (type, responseData) => {
    if (!type || !responseData) return null;
    const p = responseData.pricing || responseData.extractedData || responseData;
    return {
      imageData: responseData,
      editableStones: (p.Stones || []).map(s => ({ ...s, Type: type })),
      editableMetal: {
        Weight: p.Metal?.Weight || 0,
        Quality: p.Metal?.Quality || metalKt,
        Rate: p.Metal?.Rate || '',
      },
      editableCharges: {
        Loss: p.Client?.Loss ?? 10,
        Labour: p.Client?.Labour ?? 7,
        ExtraCharges: extraChargesValue(p.Client?.ExtraCharges),
        ExtraChargesType: extraChargesType(p.Client?.ExtraCharges),
        GoldDuties: p.Client?.GoldDuties ?? 0,
        SilverAndLabsDuties: p.Client?.SilverAndLabsDuties ?? 0,
        LossAndLabourDuties: p.Client?.LossAndLabourDuties ?? 0,
      },
      dutyRates: {
        UndercutPrice: p.Client?.UndercutPrice ?? undefined,
        UndercutPriceTouched: false,
        NaturalDuties: p.Client?.NaturalDuties ?? 0,
        LabDuties: p.Client?.LabDuties ?? 0,
      },
      pricingResult: p,
    };
  };

  const handleMetalKtChange = (newKt) => {
    setMetalKt(newKt);
    setCommonMetal({ ...commonMetal, Rate: '' });
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

  const updateCommonMetal = (field, value) => {
    dataChangedRef.current = true;
    const updated = { ...commonMetal, [field]: value };
    setCommonMetal(updated);
    setGroupedData((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((cat) => {
        const newByType = { ...next[cat].byType };
        Object.keys(newByType).forEach((type) => {
          newByType[type] = { ...newByType[type], editableMetal: { ...updated } };
        });
        next[cat] = { ...next[cat], byType: newByType };
      });
      return next;
    });
  };

  const toggleCommonSection = (section) => {
    setExpandedCommonSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleRecalculateAll = async () => {
    dataChangedRef.current = false;
    const selectedTypes = [...(selectedStoneTypes.length > 0 ? selectedStoneTypes : [])];
    Object.values(groupedData).forEach((catData) => {
      catData.types.forEach((type) => {
        if (!selectedTypes.includes(type)) selectedTypes.push(type);
      });
    });
    if (selectedTypes.length === 0 || !clientId) return;

    console.log('[Recalc] START — selectedTypes:', selectedTypes, '| clientId:', clientId);
    setIsRecalculating(true);

    const newTypes = selectedTypes.filter(
      type => !hasStoneTypeBeenRecalculated(type),
    );
    console.log('[Recalc] newTypes (not yet extracted):', newTypes, '| alreadyDone:', selectedTypes.filter(t => hasStoneTypeBeenRecalculated(t)));

    const rawMultiData = {};
    Object.values(groupedData).forEach((catData) => {
      catData.types.forEach((type) => {
        if (catData.byType[type]) {
          rawMultiData[type] = catData.byType[type];
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
        console.log('[Recalc] Template found from type:', templateType, '— cloning for newTypes:', newTypes);
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
        console.log('[Recalc] No template — firing single Gemini extraction for:', firstNewType);
        let singleExtraction = null;
        try {
          singleExtraction = await extractStoneTypeFromImage(firstNewType);
        } catch (_) {}
        console.log('[Recalc] Extraction result for', firstNewType, ':', singleExtraction?.data ? 'OK' : 'FAILED', singleExtraction?.data);

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
        console.log('[Recalc] Cloning extraction from', firstNewType, 'to remaining types:', newTypes.slice(1));
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
        type,
        data,
        metalKt,
        selectedClient,
        // New types go through their first calculation so the backend prices
        // the stones for the selected type; existing types recalculate.
        isRecalculate: !newTypes.includes(type),
      }),
    }));

    console.log('[Recalc] Firing calculatePricing for types:', payloads.map(p => p.type));
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

    console.log('[Recalc] Results — succeeded:', succeededTypes.map(s => s.type), '| failed:', failedTypes, '| rateLimit:', hasRateLimit);
    succeededTypes.forEach(({ type, result }) => {
      console.log(`[Recalc] ${type} → TotalPrice: ${result?.TotalPrice}, Metal: ${result?.Metal?.Weight}g @ ${result?.Metal?.Rate}/g`);
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

      const first = succeededTypes[0];
      if (first) {
        setCommonMetal({
          Weight: first.result.Metal?.Weight ? first.result.Metal.Weight.toString() : commonMetal.Weight,
          Rate: first.result.Metal?.Rate ? first.result.Metal.Rate.toString() : commonMetal.Rate,
        });
      }
    }

    setIsRecalculating(false);

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
      // Step 1: Pick original image (pre-crop) and save to AsyncStorage
      let originalUri;
      try {
        const picked = await ImageCropPicker.openPicker({
          mediaType: 'photo',
        });
        if (!picked?.path) {
          showAlert('Error', 'Failed to pick image.', 'error');
          return;
        }
        originalUri = picked.path;
      } catch (pickErr) {
        if (pickErr?.code === 'E_PICKER_CANCELLED') return;
        throw pickErr;
      }

      // Save pre-crop image to AsyncStorage
      try {
        const filePath = originalUri.replace(/^file:\/\//, '');
        const base64 = await RNFS.readFile(filePath, 'base64');
        await AsyncStorage.setItem('@pre_crop_image', base64);
      } catch (e) {
        // Non-critical - continue even if saving fails
      }

      // Step 2: Open cropper on the original image
      let cropped;
      try {
        cropped = await ImageCropPicker.openCropper({
          path: originalUri,
          freeStyleCropEnabled: true,
          compressImageQuality: 0.8,
          forceJpg: true,
          cropperToolbarTitle: 'Crop the stones excel for accuracy',
          cropperStatusBarColor: colors.primary,
          cropperToolbarColor: colors.primary,
          cropperActiveWidgetColor: colors.primary,
          cropperToolbarWidgetColor: '#ffffff',
        });
      } catch (cropErr) {
        if (cropErr?.code === 'E_PICKER_CANCELLED') return;
        throw cropErr;
      }

      if (cropped) {
        if (cropped.size && cropped.size > 20 * 1024 * 1024) {
          showAlert(
            'File too large',
            'Maximum allowed image size is 20MB.',
            'warning',
          );
          return;
        }

        // Process cropped image with B&W + sharpen for better API accuracy
        // iOS: skip WebView B&W processing (unreliable off-screen canvas),
        // send the original cropped image instead.
        let apiImageFile;
        if (Platform.OS === 'ios') {
          console.log('[ImagePick] iOS — skipping B&W, using original cropped image');
          apiImageFile = {
            uri: cropped.path.startsWith('file://') ? cropped.path : `file://${cropped.path}`,
            name: cropped.filename || `image_${Date.now()}.jpg`,
            type: cropped.mime || 'image/jpeg',
          };
        } else {
          try {
            const croppedBase64 = await RNFS.readFile(cropped.path.replace(/^file:\/\//, ''), 'base64');
            const processedBase64 = await processImage(croppedBase64);
            if (!processedBase64 || processedBase64.length < 100) {
              throw new Error('Processed image is too small or empty');
            }
            const processedPath = `${RNFS.CachesDirectoryPath}/bw_${Date.now()}.jpg`;
            await RNFS.writeFile(processedPath, processedBase64, 'base64');
            apiImageFile = {
              uri: processedPath.startsWith('file://') ? processedPath : `file://${processedPath}`,
              name: `bw_${Date.now()}.jpg`,
              type: 'image/jpeg',
            };
            console.log('[ImagePick] B&W processing succeeded');
          } catch (processErr) {
            console.log('[ImagePick] B&W processing failed, using original:', processErr?.message || processErr);
            apiImageFile = {
              uri: cropped.path.startsWith('file://') ? cropped.path : `file://${cropped.path}`,
              name: cropped.filename || `image_${Date.now()}.jpg`,
              type: cropped.mime || 'image/jpeg',
            };
          }
        }

        const newImageFile = apiImageFile;
        // A new image means a fresh design — clear all previous pricing state so nothing
        // from the last image lingers (avoids the "stuck" data when re-picking an image).
        setImageFile(newImageFile);
        setGroupedData({});
        setStoneRecalcStatus({});
        setCommonMetal({ Weight: '', Rate: '' });
        setPdfHtml(null);
        setShowPdfModal(false);
        setSingleStoneCatData(null);
        setShowSingleStoneModal(false);
        setIsExtracting(true);
        setExtractPhase('extracting');

        try {
          const firstType = selectedStoneTypes[0];
          console.log('[ImagePick] Firing single Gemini extraction for firstType:', firstType, '| totalTypes:', selectedStoneTypes.length);
          const extractionResponse = await GetimagepriceData({
            image: newImageFile,
            clientId: clientId,
            stoneType: firstType,
            metalQuality: metalKt,
          }).unwrap();

          const rawMultiData = {};
          const p = extractionResponse.pricing || extractionResponse.extractedData || extractionResponse;

          console.log('[ImagePick] Extraction response:', { stones: p.Stones?.length, metalWeight: p.Metal?.Weight, totalPieces: p.TotalPieces });
          const hasData =
            (p.Stones && p.Stones.length > 0) ||
            (p.Metal && parseFloat(p.Metal.Weight) > 0) ||
            p.TotalPieces > 0;

          if (hasData) {
            const buildTypeData = (type) => ({
              imageData: extractionResponse,
              editableStones: (p.Stones || []).map(s => ({
                ...s,
                Type: type,
              })),
              editableMetal: {
                Weight: p.Metal?.Weight || 0,
                Quality: p.Metal?.Quality || metalKt,
                Rate: p.Metal?.Rate || '',
              },
              editableCharges: {
                Loss: p.Client?.Loss ?? 10,
                Labour: p.Client?.Labour ?? 7,
                ExtraCharges: extraChargesValue(p.Client?.ExtraCharges),
                ExtraChargesType: extraChargesType(p.Client?.ExtraCharges),
                GoldDuties: p.Client?.GoldDuties ?? 0,
                SilverAndLabsDuties: p.Client?.SilverAndLabsDuties ?? 0,
                LossAndLabourDuties: p.Client?.LossAndLabourDuties ?? 0,
              },
              dutyRates: {
                UndercutPrice: p.Client?.UndercutPrice ?? undefined,
                UndercutPriceTouched: false,
                NaturalDuties: p.Client?.NaturalDuties ?? 0,
                LabDuties: p.Client?.LabDuties ?? 0,
              },
              pricingResult: p,
            });

            rawMultiData[firstType] = buildTypeData(firstType);
            selectedStoneTypes.slice(1).forEach(type => {
              rawMultiData[type] = buildTypeData(type);
            });
          }

          console.log('[ImagePick] rawMultiData types built:', Object.keys(rawMultiData));
          if (Object.keys(rawMultiData).length === 0) {
            showAlert(
              'No Data Found',
              'No pricing data was extracted from the image.',
              'warning',
            );
            setImageFile(null);
            setGroupedData({});
            setStoneRecalcStatus({});
            // Clear the extracting state here too — otherwise the upload button stays
            // disabled (disabled={isExtracting}) and a re-upload does nothing until the
            // screen is reopened.
            setIsExtracting(false);
            setExtractPhase('');
          } else {
            const grouped = groupStoneDataByCategory(rawMultiData, stoneCategoryMap);
            setGroupedData(grouped);
            const allTypes = [];
            Object.values(grouped).forEach((catData) => {
              catData.types.forEach((type) => allTypes.push(type));
            });
            const firstType = allTypes[0];
            if (firstType) {
              let firstData = null;
              Object.values(grouped).forEach((catData) => {
                if (catData.byType[firstType]) firstData = catData.byType[firstType];
              });
              if (firstData) {
                const m = firstData.editableMetal;
                setCommonMetal({
                  Weight: m.Weight ? String(m.Weight) : commonMetal.Weight,
                  Rate: m.Rate ? String(m.Rate) : commonMetal.Rate,
                });
              }
            }
            setExtractPhase('calculating');
            needsAutoRecalcRef.current = true;
          }
      } catch (apiError) {
        if (apiError?.status === 429 || apiError?.data?.statusCode === 429) {
          showAlert('Rate Limit', 'Too many requests. Please try again later.', 'error', [
            { text: 'Try Again', onPress: () => handleImagePick() },
          ]);
        } else {
          showAlert(
            'Extraction Error',
            'Failed to extract pricing data. Check configuration.',
            'error',
          );
        }
        setImageFile(null);
        setIsExtracting(false);
        setExtractPhase('');
        }
      }
    } catch (error) {
      showAlert('Error', 'Failed to pick image.', 'error');
      setIsExtracting(false);
      setExtractPhase('');
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

  const findTypeData = (type) => {
    let found = null;
    Object.values(groupedData).forEach((catData) => {
      if (catData.byType[type]) found = catData.byType[type];
    });
    return found;
  };

  const openSingleStoneModal = (catData) => {
    if (catData) {
      setSingleStoneCatData(catData);
      setSingleStoneModalKey(k => k + 1);
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
      {processor}
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
                    onPress={() => {
                      setImageFile(null);
                      setGroupedData({});
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

        {Object.keys(groupedData).length > 0 && (
          <Card style={[styles.card, { marginTop: 16, borderBottomWidth: 0 }]}>

            {(!commonMetal.Rate || parseFloat(commonMetal.Rate) <= 0) && (
              <View style={styles.validationWarning}>
                <Icon name="warning" size={16} color={colors.warning} />
                <Text style={styles.validationWarningText}>
                  Fill metal rate before recalculating
                </Text>
              </View>
            )}

            {/* Metal Section */}
            <TouchableOpacity
              style={styles.commonSectionHeader}
              onPress={() => toggleCommonSection('metal')}
            >
              <Text style={styles.commonSectionTitle}>Metal Weight & Rate</Text>
        
            </TouchableOpacity>
           
              <View style={styles.chargesRow}>
                <View style={styles.chargeField}>
                  <Text style={[
                    styles.fieldLabel,
                    (!commonMetal.Weight || parseFloat(commonMetal.Weight) <= 0) && styles.fieldLabelError,
                  ]}>Weight (g) *</Text>
                  <TextInput
                    ref={metalWeightRef}
                    style={[
                      styles.fieldInput,
                      (!commonMetal.Weight || parseFloat(commonMetal.Weight) <= 0) && styles.fieldInputError,
                    ]}
                    keyboardType="decimal-pad"
                    value={String(commonMetal.Weight || '')}
                    onChangeText={v => updateCommonMetal('Weight', v)}
                    onSubmitEditing={() => { dataChangedRef.current = false; handleRecalculateAll(); }}
                  />
                </View>
                <View style={styles.chargeField}>
                  <Text
                    style={[
                      styles.fieldLabel,
                      (!commonMetal.Rate || parseFloat(commonMetal.Rate) <= 0) && styles.fieldLabelError,
                    ]}
                  >
                    24K Rate ($/g) *
                  </Text>
                  <TextInput
                    style={[
                      styles.fieldInput,
                      (!commonMetal.Rate || parseFloat(commonMetal.Rate) <= 0) && styles.fieldInputError,
                    ]}
                    keyboardType="decimal-pad"
                    value={String(commonMetal.Rate || '')}
                    onChangeText={v => updateCommonMetal('Rate', v)}
                    onSubmitEditing={() => { dataChangedRef.current = false; handleRecalculateAll(); }}
                  />
                </View>
              </View>
   

          </Card>
        )}

        {/* ACCORDION SECTIONS */}
        {Object.entries(groupedData).map(([category, catData]) => {
          if (!catData || !catData.types || catData.types.length === 0) return null;

          const categoryTotal = catData.types.reduce((sum, type) => {
            const typeData = catData.byType[type];
            return sum + (typeData?.pricingResult?.TotalPrice || 0);
          }, 0);

          const hasMissing = catData.types.some(type => {
            const d = catData.byType[type];
            return d?.editableStones?.some(s => parseFloat(s.Price) <= 0);
          });

          return (
            <Card
              key={category}
              style={[
                styles.card,
                styles.accordionCard,
              ]}
            >
              {hasMissing && (
                <View style={styles.validationWarning}>
                  <Icon name="warning" size={16} color={colors.warning} />
                  <Text style={styles.validationWarningText}>
                    Fill all stone prices before recalculating
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.accordionHeader}
                onPress={() => openSingleStoneModal(catData)}
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
                    const entries = catData.types
                      .map(type => catData.byType[type]?.pricingResult)
                      .filter(Boolean);
                    navigation.navigate('PricingPreview', {
                      pricingEntries: entries,
                      clientName: resolvedClientName,
                      metalKt,
                      preCropImageKey: '@pre_crop_image',
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
                    const entries = catData.types
                      .map(type => catData.byType[type]?.pricingResult)
                      .filter(Boolean);
                    navigation.navigate('PricingPreview', {
                      pricingEntries: entries,
                      clientName: resolvedClientName,
                      metalKt,
                      preCropImageKey: '@pre_crop_image',
                      isClientPreview: true,
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
                findTypeData(editingContext.type) &&
                Array.isArray(findTypeData(editingContext.type).editableStones) &&
                (() => {
                  const typeData = findTypeData(editingContext.type);
                  const stone =
                    typeData.editableStones[
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
      <BrandedAlert {...alertConfig} onClose={hideAlert} />
      </Modal>

      <SingleStonePricing
        key={singleStoneModalKey}
        visible={showSingleStoneModal}
        onClose={() => {
          setShowSingleStoneModal(false);
          setSingleStoneCatData(null);
        }}
        onDone={() => {
          setShowSingleStoneModal(false);
          const catKey = Object.keys(groupedDataRef.current).find(
            k => groupedDataRef.current[k]?.label === singleStoneCatDataRef.current?.label
          );
          setTimeout(async () => {
            if (handleRecalculateAllRef.current) {
              await handleRecalculateAllRef.current();
            }
            await new Promise(r => setTimeout(r, 150));
            const cat = catKey && groupedDataRef.current[catKey];
            if (cat) {
              setSingleStoneCatData(cat);
              setSingleStoneModalKey(k => k + 1);
              setShowSingleStoneModal(true);
            }
          }, 400);
        }}
        catData={singleStoneCatData}
        clientId={clientId}
        metalKt={metalKt}
        selectedClient={selectedClient}
        onRecalculated={handleSingleStoneRecalculated}
        onModifyPricing={() => {
          setShowSingleStoneModal(false);
          navigation.navigate('ModifyPricingScreen', {
            stonesData: groupedData,
            clientId,
            selectedClient,
            metalKt,
          });
        }}
        onPreviewSummary={() => {
          setShowSingleStoneModal(false);
          const cat = singleStoneCatDataRef.current;
          const entries = cat?.types
            ?.map(type => cat.byType[type]?.pricingResult)
            ?.filter(Boolean) || [];
          navigation.navigate('PricingPreview', {
            pricingEntries: entries,
            clientName: resolvedClientName,
            metalKt,
            preCropImageKey: '@pre_crop_image',
          });
        }}
        onClientPreview={() => {
          setShowSingleStoneModal(false);
          const cat = singleStoneCatDataRef.current;
          const entries = cat?.types
            ?.map(type => cat.byType[type]?.pricingResult)
            ?.filter(Boolean) || [];
          navigation.navigate('PricingPreview', {
            pricingEntries: entries,
            clientName: resolvedClientName,
            metalKt,
            preCropImageKey: '@pre_crop_image',
            isClientPreview: true,
          });
        }}
        onRequestRecalculate={() => {
          setShowSingleStoneModal(false);
          const catKey = Object.keys(groupedDataRef.current).find(
            k => groupedDataRef.current[k]?.label === singleStoneCatDataRef.current?.label
          );
          setTimeout(async () => {
            if (handleRecalculateAllRef.current) {
              await handleRecalculateAllRef.current();
            }
            await new Promise(r => setTimeout(r, 150));
            const cat = catKey && groupedDataRef.current[catKey];
            if (cat) {
              setSingleStoneCatData(cat);
              setSingleStoneModalKey(k => k + 1);
              setShowSingleStoneModal(true);
            }
          }, 400);
        }}
      />

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
});
