import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../../components/common/Icon';
import { colors, getStoneBg } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { buildRecalculatePayload } from '../../utils/pricingRecalc';
import { normalizeExtraCharges } from '../../utils/extraCharges';
import {
  useCalculatePricingMutation,
  useSavePricingMutation,
  useGetStoneShapesQuery,
} from '../../store/api';

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const isLabType = (t) => t === 'LabGrown' || t === 'CVDLabGrown';
const DUTY_CONFIG = {
  UndercutPrice: { label: 'Undercut ($/ct)' },
  NaturalDuties: { label: 'Natural Duty (%)' },
  LabDuties: { label: 'Lab Duty (%)' },
  SilverAndLabsDuties: { label: 'Silver + Lab Duty (%)' },
};

export default function ModifyPricingScreen({ route, navigation }) {
  const {
    stonesData = {},
    clientId,
    selectedClient,
    metalKt = '18K',
    // Enquiry mode: launched from the quotation modal. When set, each recalculation also
    // saves the pricing to the enquiry's design version (same as the quotation modal does).
    isEnquiry = false,
    enquiryId: enquiryIdParam,
    designType: designTypeParam,
    version: versionParam,
  } = route.params || {};

  const [calculatePricing] = useCalculatePricingMutation();
  const [savePricing] = useSavePricingMutation();

  const allTypes = useMemo(() => {
    return selectedClient?.ApplicableStoneTypes || [];
  }, [selectedClient]);

  const stonesDataRef = useRef(stonesData);

  const findTypeData = useCallback((type) => {
    for (const catData of Object.values(stonesDataRef.current)) {
      if (catData?.byType?.[type]) return catData.byType[type];
    }
    return null;
  }, []);

  const [selectedType, setSelectedType] = useState(allTypes[0] || '');
  const [flatStones, setFlatStones] = useState([]);
  const [stoneEdits, setStoneEdits] = useState({});
  const [dutyEdits, setDutyEdits] = useState({});
  const [metalData, setMetalData] = useState({ Weight: '', Rate: '', Quality: metalKt });
  const [chargesData, setChargesData] = useState({ Loss: '', Labour: '', ExtraCharges: '', ExtraChargesType: 'percentage', GoldDuties: '', SilverAndLabsDuties: '', LossAndLabourDuties: '' });
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  // True when the edit modal was opened for a freshly-added stone — shows Type/Shape inputs.
  const [isNewStoneEdit, setIsNewStoneEdit] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [topTypeModalVisible, setTopTypeModalVisible] = useState(false);
  const [perStoneTypeModalIndex, setPerStoneTypeModalIndex] = useState(null);
  const [perStoneShapeModalIndex, setPerStoneShapeModalIndex] = useState(null);
  const { data: stoneShapesData } = useGetStoneShapesQuery();
  const [shapeOptions, setShapeOptions] = useState([]);
  useEffect(() => {
    if (stoneShapesData && stoneShapesData.length > 0) {
      const codes = stoneShapesData.map(s => s.code).filter(Boolean);
      if (codes.length > 0) setShapeOptions(codes);
    }
  }, [stoneShapesData]);
  const [newShapeText, setNewShapeText] = useState('');
  const [stoneTypeOverrides, setStoneTypeOverrides] = useState({});
  const [shapeVersion, setShapeVersion] = useState(0);

  const flatStonesRef = useRef(flatStones);
  useEffect(() => { flatStonesRef.current = flatStones; }, [flatStones]);
  const metalDataRef = useRef(metalData);
  useEffect(() => { metalDataRef.current = metalData; }, [metalData]);
  const chargesDataRef = useRef(chargesData);
  useEffect(() => { chargesDataRef.current = chargesData; }, [chargesData]);

  const originalTypeRef = useRef({});
  const dataChangedRef = useRef(false);
  // true when a rate-lookup field (Color / Shape / Stone Type) changed → refetch price (first calc).
  // Any other edit keeps the entered prices and just recalculates.
  const lookupChangedRef = useRef(false);
  const isAutoRecalculatingRef = useRef(false);
  const [pricingResults, setPricingResults] = useState({});

  useEffect(() => {
    const typeData = findTypeData(selectedType);
    if (!typeData) {
      setFlatStones([]);
      return;
    }
    const stones = Array.isArray(typeData.editableStones) ? typeData.editableStones : [];
    setFlatStones(stones.map((s, i) => ({ stoneIndex: i, stone: { ...s } })));
    setStoneEdits({});
    setStoneTypeOverrides({});
    setPricingResults({});
    setDutyEdits({
      UndercutPrice: typeData.dutyRates?.UndercutPrice?.toString() ?? '',
      NaturalDuties: typeData.dutyRates?.NaturalDuties?.toString() ?? '',
      LabDuties: typeData.dutyRates?.LabDuties?.toString() ?? '',
    });
    setMetalData({
      Weight: typeData.editableMetal?.Weight?.toString() ?? '',
      Rate: typeData.editableMetal?.Rate?.toString() ?? '',
      Quality: typeData.editableMetal?.Quality || metalKt,
    });
    setChargesData({
      Loss: typeData.editableCharges?.Loss?.toString() ?? '',
      Labour: typeData.editableCharges?.Labour?.toString() ?? '',
      ExtraCharges: typeData.editableCharges?.ExtraCharges?.toString() ?? '',
      ExtraChargesType: typeData.editableCharges?.ExtraChargesType ?? 'percentage',
      GoldDuties: typeData.editableCharges?.GoldDuties?.toString() ?? '',
      SilverAndLabsDuties: typeData.editableCharges?.SilverAndLabsDuties?.toString() ?? typeData.dutyRates?.SilverAndLabsDuties?.toString() ?? '',
      LossAndLabourDuties: typeData.editableCharges?.LossAndLabourDuties?.toString() ?? typeData.dutyRates?.LossAndLabourDuties?.toString() ?? '',
    });
    const originals = {};
    stones.forEach((s, i) => { originals[i] = s.Type || selectedType; });
    originalTypeRef.current = originals;
  }, [selectedType, metalKt]);

  useEffect(() => {
    if (!dataChangedRef.current || !clientId || flatStonesRef.current.length === 0) return;
    dataChangedRef.current = false;
    lookupChangedRef.current = false;
    const timer = setTimeout(() => {
      if (!isAutoRecalculatingRef.current) {
        isAutoRecalculatingRef.current = true;
        runCalculation(false).finally(() => {
          isAutoRecalculatingRef.current = false;
        });
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [stoneTypeOverrides, shapeVersion]);

  const getEffectiveStone = useCallback((idx) => {
    const base = flatStones[idx]?.stone || {};
    const edits = stoneEdits[idx] || {};
    return { ...base, ...edits };
  }, [flatStones, stoneEdits]);

  const updateStoneField = useCallback((idx, field, value) => {
    dataChangedRef.current = true;
    // Only Color / Shape change the rate lookup → refetch price (first calc).
    // Every other field (Price, Pcs, Weight, CtWeight, MmSize, SieveSize, Markup) keeps the
    // entered prices and just recalculates.
    if (field === 'Color' || field === 'Shape') lookupChangedRef.current = true;
    setStoneEdits(prev => ({ ...prev, [idx]: { ...(prev[idx] || {}), [field]: value } }));
  }, []);

  const updateDuty = useCallback((field, v) => {
    dataChangedRef.current = true;
    // Duty rate is not a rate-lookup field → recalculate keeping the entered stone prices.
    setDutyEdits(prev => ({ ...prev, [field]: v }));
  }, []);

  const getEffectiveType = useCallback((idx) => {
    return stoneTypeOverrides[idx] || selectedType;
  }, [stoneTypeOverrides, selectedType]);

  const runCalculationRef = useRef(null);

  const runCalculation = useCallback(async (isRecalculate) => {
    const currentFlatStones = flatStonesRef.current;
    const currentMetal = metalDataRef.current;
    const currentCharges = chargesDataRef.current;

    if (!selectedType || currentFlatStones.length === 0) return;
    setIsCalculating(true);

    const editableStones = currentFlatStones.map((item, idx) => {
      const eff = getEffectiveStone(idx);
      return {
        Type: getEffectiveType(idx),
        Color: eff.Color || '',
        Shape: eff.Shape || '',
        MmSize: (eff.MmSize || '0').toString(),
        SieveSize: (eff.SieveSize || '0').toString(),
        CtWeight: num(eff.CtWeight),
        Weight: num(eff.Weight),
        Pcs: num(eff.Pcs),
        // First calculation: let the backend fill prices (0). Recalculation:
        // keep the price already entered on the row/modal.
        Price: isRecalculate ? num(eff.Price) : 0,
        Markup: num(eff.Markup),
      };
    });

    console.log('[ModifyPricing] ▶ SENDING stones for recalc:', JSON.stringify(editableStones, null, 2));

    const typeData = findTypeData(selectedType) || {};
    const latestResult = pricingResults[selectedType] || typeData.pricingResult;
    const payload = buildRecalculatePayload({
      clientId,
      type: '',
      data: {
        editableStones,
        editableMetal: {
          Weight: num(currentMetal.Weight),
          Quality: currentMetal.Quality || metalKt,
          Rate: num(currentMetal.Rate),
        },
        editableCharges: {
          Loss: num(currentCharges.Loss),
          Labour: num(currentCharges.Labour),
          ExtraCharges: num(currentCharges.ExtraCharges),
          ExtraChargesType: currentCharges.ExtraChargesType || 'percentage',
          GoldDuties: num(currentCharges.GoldDuties),
          SilverAndLabsDuties: num(currentCharges.SilverAndLabsDuties),
          LossAndLabourDuties: num(currentCharges.LossAndLabourDuties),
        },
        dutyRates: {
          UndercutPrice: dutyEdits.UndercutPrice !== '' ? num(dutyEdits.UndercutPrice) : undefined,
          UndercutPriceTouched: dutyEdits.UndercutPrice !== '',
          NaturalDuties: num(dutyEdits.NaturalDuties),
          LabDuties: dutyEdits.LabDuties !== '' ? num(dutyEdits.LabDuties) : (typeData.dutyRates?.LabDuties ?? 0),
        },
        pricingResult: latestResult,
        imageData: typeData.imageData,
      },
      metalKt,
      selectedClient,
      isRecalculate,
    });

    console.log('[ModifyPricing] ▶ FULL PAYLOAD:', JSON.stringify({ details: payload.details, clientId: payload.clientId, isRecalculate: payload.isRecalculate }, null, 2));

    try {
      if (calculatePricing) {
        const result = await calculatePricing(payload).unwrap();
        console.log('[ModifyPricing] ◀ API RESULT:', JSON.stringify(result, null, 2));
        const updatedStones = result?.Stones;
        console.log('[ModifyPricing] ◀ RESULT Stones:', JSON.stringify(updatedStones, null, 2));
        setPricingResults(prev => ({ ...prev, [selectedType]: result }));
        if (updatedStones && updatedStones.length > 0) {
          setStoneEdits({});
          const newOriginals = {};
          updatedStones.forEach((s, i) => { newOriginals[i] = s.Type || selectedType; });
          originalTypeRef.current = newOriginals;
          setFlatStones(updatedStones.map((s, idx) => ({
            stoneIndex: idx,
            stone: {
              ...s,
              Type: s.Type || selectedType,
            },
          })));
        }
        setMetalData(prev => ({
          ...prev,
          // Round-trip the 24K full rate (Metal.Rate), NOT GoldRateKT. The backend re-derives
          // the KT rate from this each time; sending GoldRateKT would reduce it again on every
          // recalc (matches how PricingCalculator stores editableMetal.Rate).
          Rate: result.Metal?.Rate?.toString() ?? prev.Rate,
          Quality: result.MetalKT || prev.Quality,
        }));
        setChargesData({
          Loss: result.LossPercent?.toString() ?? '',
          Labour: result.LabourPercent?.toString() ?? '',
          ExtraCharges: normalizeExtraCharges(result.Client?.ExtraCharges).Value.toString(),
          ExtraChargesType: normalizeExtraCharges(result.Client?.ExtraCharges).Type,
          GoldDuties: result.Duties?.Gold?.Rate?.toString() ?? '',
          SilverAndLabsDuties: result.Duties?.SilverAndLabs?.Rate?.toString() ?? '',
          LossAndLabourDuties: result.Duties?.LossAndLabour?.Rate?.toString() ?? '',
        });

        // Enquiry mode: persist the recalculated pricing to the design version, exactly
        // like the quotation modal — so modifying here saves the quotation too.
        if (isEnquiry && enquiryIdParam && versionParam && designTypeParam) {
          const savedStones = (result.Stones || []).map(st => ({
            Type: st.Type || selectedType,
            Color: st.Color || '',
            Shape: st.Shape || '',
            MmSize: String(st.MmSize ?? '0'),
            SieveSize: String(st.SieveSize ?? '0'),
            CtWeight: num(st.CtWeight),
            Weight: num(st.Weight),
            Pcs: Math.round(num(st.Pcs)),
            Price: num(st.Price),
            Markup: num(st.Markup || 0),
          }));
          const onlyMetal = savedStones.length === 0;
          const pricingToSave = {
            isOnlyMetalDesign: onlyMetal,
            Metal: {
              Weight: num(result.Metal?.Weight ?? currentMetal.Weight),
              Quality: result.Metal?.Quality || currentMetal.Quality || metalKt,
              Rate: num(result.Metal?.Rate ?? currentMetal.Rate),
            },
            Stones: savedStones,
            Loss: num(result.Client?.Loss ?? currentCharges.Loss ?? 0),
            Labour: num(result.Client?.Labour ?? currentCharges.Labour ?? 0),
            ExtraCharges: normalizeExtraCharges(result.Client?.ExtraCharges ?? currentCharges.ExtraCharges),
            ExtraChargesType: result.Client?.ExtraChargesType ?? currentCharges.ExtraChargesType ?? 'percentage',
            UndercutPrice: num(result.Client?.UndercutPrice ?? 0),
            NaturalDuties: num(result.Client?.NaturalDuties ?? 0),
            LabDuties: num(result.Client?.LabDuties ?? 0),
            GoldDuties: num(result.Client?.GoldDuties ?? 0),
            SilverAndLabsDuties: num(result.Client?.SilverAndLabsDuties ?? 0),
            LossAndLabourDuties: num(result.Client?.LossAndLabourDuties ?? 0),
            MetalPrice: num(result.MetalPrice),
            DiamondsPrice: num(result.DiamondsPrice),
            DutiesAmount: num(result.DutiesAmount),
            TotalPrice: num(result.TotalPrice),
            ClientPricingMessage: result.ClientPricingMessage || '',
          };
          try {
            await savePricing({
              enquiryId: enquiryIdParam,
              designType: designTypeParam,
              version: versionParam,
              pricingData: pricingToSave,
              isOnlyMetalDesign: onlyMetal,
            }).unwrap();
          } catch (saveErr) {
            // Non-fatal: keep the recalculated values on screen even if the save fails.
          }
        }
      }
    } catch (err) {
      // silent
    } finally {
      setIsCalculating(false);
    }
  }, [selectedType, flatStones, metalData, chargesData, dutyEdits, clientId, metalKt, selectedClient, calculatePricing, findTypeData, getEffectiveStone, stoneTypeOverrides, getEffectiveType, isEnquiry, enquiryIdParam, versionParam, designTypeParam, savePricing]);

  useEffect(() => { runCalculationRef.current = runCalculation; }, [runCalculation]);

  // First calculation — prices fetched from the client rate chart. Bound to the RECALCULATE button.
  const handleRecalculate = useCallback(() => runCalculation(false), [runCalculation]);
  // Recalculation — keeps the entered prices, same payload but isRecalculate=true (as in SingleStonePricing).
  const handleRecalculateUpdate = useCallback(() => runCalculation(true), [runCalculation]);

  const recalcUpdateRef = useRef(null);
  const recalcFirstRef = useRef(null);
  useEffect(() => { recalcUpdateRef.current = handleRecalculateUpdate; }, [handleRecalculateUpdate]);
  useEffect(() => { recalcFirstRef.current = handleRecalculate; }, [handleRecalculate]);

  // On keyboard dismiss: a Color/Shape/Type change refetches the price (first calculation);
  // any other edit keeps the entered prices and just recalculates.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      if (!dataChangedRef.current || !clientId || flatStones.length === 0) return;
      const refetchPrices = lookupChangedRef.current;
      dataChangedRef.current = false;
      lookupChangedRef.current = false;
      if (!isAutoRecalculatingRef.current) {
        isAutoRecalculatingRef.current = true;
        const fn = refetchPrices ? recalcFirstRef.current : recalcUpdateRef.current;
        Promise.resolve(fn?.()).finally(() => {
          isAutoRecalculatingRef.current = false;
        });
      }
    });
    return () => sub.remove();
  }, [clientId, flatStones.length]);

  const openEditModal = useCallback((idx) => {
    setEditingIndex(idx);
    setIsNewStoneEdit(false);
    setEditModalVisible(true);
  }, []);

  // Add a brand-new stone (empty fields) and open the editor to fill it in. On modal close
  // the recalculation runs as a first calculation so the new stone gets priced and merged
  // into the stones data.
  const addNewStone = useCallback(() => {
    const newStone = {
      Type: selectedType,
      Color: '',
      Shape: '',
      MmSize: '',
      SieveSize: '',
      Pcs: 0,
      Weight: 0,
      CtWeight: 0,
      Price: 0,
      Markup: 0,
    };
    dataChangedRef.current = true;
    // Brand-new stone has no price yet → refetch it from the client rate chart (first calc).
    lookupChangedRef.current = true;
    const newIndex = flatStonesRef.current.length;
    setFlatStones(prev => [...prev, { stoneIndex: prev.length, stone: { ...newStone } }]);
    setEditingIndex(newIndex);
    setIsNewStoneEdit(true);
    setEditModalVisible(true);
  }, [selectedType]);

  const closeEditModal = useCallback(() => {
    setEditingIndex(null);
    setIsNewStoneEdit(false);
    setEditModalVisible(false);
    if (dataChangedRef.current && clientId && flatStonesRef.current.length > 0) {
      const refetchPrices = lookupChangedRef.current;
      dataChangedRef.current = false;
      lookupChangedRef.current = false;
      if (!isAutoRecalculatingRef.current) {
        isAutoRecalculatingRef.current = true;
        const fn = refetchPrices ? recalcFirstRef.current : recalcUpdateRef.current;
        Promise.resolve(fn?.()).finally(() => {
          isAutoRecalculatingRef.current = false;
        });
      }
    }
  }, [clientId]);

  const selectTopType = useCallback((type) => {
    setSelectedType(type);
    setTopTypeModalVisible(false);
  }, []);

  const selectPerStoneType = useCallback((idx, type) => {
    dataChangedRef.current = true;
    setStoneTypeOverrides(prev => ({ ...prev, [idx]: type }));
    setPerStoneTypeModalIndex(null);
  }, []);

  const selectPerStoneShape = useCallback((idx, shape) => {
    updateStoneField(idx, 'Shape', shape);
    setPerStoneShapeModalIndex(null);
    // Shape affects the stone rate — run a fresh first calculation (Price refetched).
    setShapeVersion(v => v + 1);
  }, [updateStoneField]);

  // Add a new shape typed by the user, then select it for the current stone.
  const addNewShape = useCallback(() => {
    const val = newShapeText.trim().toUpperCase();
    if (!val) return;
    setShapeOptions(prev => (prev.includes(val) ? prev : [...prev, val]));
    setNewShapeText('');
    if (perStoneShapeModalIndex !== null) selectPerStoneShape(perStoneShapeModalIndex, val);
  }, [newShapeText, perStoneShapeModalIndex, selectPerStoneShape]);

  // Shape list for the modal: options + the stone's current shape if it isn't already listed.
  const shapeListForModal = useMemo(() => {
    const cur = perStoneShapeModalIndex !== null
      ? String(getEffectiveStone(perStoneShapeModalIndex).Shape || '').trim()
      : '';
    return cur && !shapeOptions.includes(cur) ? [...shapeOptions, cur] : shapeOptions;
  }, [perStoneShapeModalIndex, shapeOptions, getEffectiveStone]);

  const renderStoneRow = (item, idx) => {
    const eff = getEffectiveStone(idx);
    const isMissing = num(eff.Price) <= 0;
    const displayType = stoneTypeOverrides[idx] || eff.Type || selectedType;
    const stoneColor = eff.Color || '';
    const colorBg = getStoneBg(stoneColor) || colors.backgroundSecondary;

    return (
      <View key={idx} style={[s.stoneCard, isMissing && s.stoneCardMissing]}>
        <View style={[s.stoneColorBar, { backgroundColor: colorBg }]}>
          <Text style={s.stoneColorBarText}>{stoneColor || '—'}</Text>
          <Text style={s.stoneColorHint}>Tap edit icon for more changes</Text>
        </View>
        <View style={s.stoneMainRow}>
          <View style={s.stoneFieldWrap}>
            <Text style={s.stoneFieldLabel}>Type</Text>
            <TouchableOpacity
              style={s.selectWrap}
              onPress={() => setPerStoneTypeModalIndex(idx)}
              activeOpacity={0.7}
            >
              <Text style={s.selectText}>{String(displayType).slice(0, 2).toUpperCase()}</Text>
              <Icon name="arrow-drop-down" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={s.stoneFieldWrapSmall}>
            <Text style={s.stoneFieldLabel}>Shape</Text>
            <TouchableOpacity
              style={s.selectWrap}
              onPress={() => setPerStoneShapeModalIndex(idx)}
              activeOpacity={0.7}
            >
              <Text style={s.selectText}>
                {String(eff.Shape || '—').slice(0, 2).toUpperCase()}
              </Text>
              <Icon name="arrow-drop-down" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={s.stoneFieldWrapSmall}>
            <Text style={s.stoneFieldLabel}>Pcs</Text>
            <TextInput
              style={s.priceInput}
              value={stoneEdits[idx]?.Pcs !== undefined ? String(stoneEdits[idx].Pcs) : String(eff.Pcs ?? 0)}
              onChangeText={(v) => updateStoneField(idx, 'Pcs', v)}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textLight}
            />
          </View>

          <View style={s.stoneFieldWrapPrice}>
            <Text style={s.stoneFieldLabel}>Price ($/CT)</Text>
            <TextInput
              style={[s.priceInput, isMissing && s.priceInputMissing]}
              value={stoneEdits[idx]?.Price !== undefined ? String(stoneEdits[idx].Price) : (num(eff.Price) > 0 ? String(num(eff.Price)) : '')}
              onChangeText={(v) => updateStoneField(idx, 'Price', v)}
              keyboardType="decimal-pad"
              placeholder="--"
              placeholderTextColor={colors.textLight}
            />
          </View>

          <TouchableOpacity style={s.editBtn} onPress={() => openEditModal(idx)} activeOpacity={0.7}>
            <Icon name="edit" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>

      </View>
    );
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Icon name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerTitleWrap}>
          <Text style={s.headerTitle}>PricingCalci</Text>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.summaryHeaderRow}>
            <Text style={s.pageTitle}>Stones Summary</Text>
            <TouchableOpacity style={s.addStoneBtnTop} onPress={addNewStone} activeOpacity={0.8}>
              <Icon name="add" size={16} color={colors.primary} />
              <Text style={s.addStoneBtnText}>Add New Stone</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={s.typeSelectorRow}
            onPress={() => setTopTypeModalVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={s.typeSelectorValue} numberOfLines={1}>
              {selectedType || 'Select Stone Type'}
            </Text>
            <Icon name="arrow-drop-down" size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          {flatStones.length === 0 ? (
            <View style={s.emptyTypeState}>
              <Text style={s.emptyTypeText}>No stones yet</Text>
            </View>
          ) : (
            flatStones.map((item, idx) => renderStoneRow(item, idx))
          )}

          <View style={{ height: 120 }} />
        </ScrollView>

      <View style={s.bottomSection}>
        <View style={s.bottomBtnRow}>
          <TouchableOpacity
            style={[s.recalcBtn, isCalculating && s.recalcBtnDisabled]}
            onPress={handleRecalculateUpdate}
            activeOpacity={0.85}
            disabled={isCalculating}
          >
            {isCalculating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Icon name="refresh" size={18} color="#fff" />
            )}
            <Text style={s.recalcBtnText}>{isCalculating ? 'Calculating...' : 'RECALCULATE'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.previewBtn, !pricingResults[selectedType] && s.previewBtnDisabled]}
            onPress={() => {
              const result = pricingResults[selectedType];
              if (!result) return;
              navigation.navigate('PricingPreview', {
                pricingEntries: [result],
                clientName: selectedClient?.name || selectedClient?.Name || 'Client',
                metalKt,
                modify: true,
                preCropImageKey: '@pre_crop_image',
              });
            }}
            activeOpacity={0.85}
            disabled={!pricingResults[selectedType]}
          >
            <Icon name="visibility" size={18} color={pricingResults[selectedType] ? colors.primary : colors.textSecondary} />
            <Text style={[s.previewBtnText, !pricingResults[selectedType] && s.previewBtnTextDisabled]}>
              {pricingResults[selectedType] ? 'ADMIN PREVIEW' : 'Recalculate First'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[s.clientPreviewBtn, !pricingResults[selectedType] && s.clientPreviewBtnDisabled]}
          onPress={() => {
            const result = pricingResults[selectedType];
            if (!result) return;
            navigation.navigate('PricingPreview', {
              pricingEntries: [result],
              clientName: selectedClient?.name || selectedClient?.Name || 'Client',
              metalKt,
              modify: true,
              isClientPreview: true,
              preCropImageKey: '@pre_crop_image',
            });
          }}
          activeOpacity={0.85}
          disabled={!pricingResults[selectedType]}
        >
          <Icon name="visibility" size={18} color="#fff" />
          <Text style={s.clientPreviewBtnText}>CLIENT PREVIEW</Text>
        </TouchableOpacity>
      </View>
      </View>

      {/* TOP TYPE SELECTOR MODAL */}
      <Modal visible={topTypeModalVisible} transparent animationType="slide" onRequestClose={() => setTopTypeModalVisible(false)}>
        <View style={s.typeModalOverlay}>
          <View style={s.typeModalContent}>
            <View style={s.typeModalHeader}>
              <Text style={s.typeModalTitle}>Select Stone Type</Text>
              <TouchableOpacity onPress={() => setTopTypeModalVisible(false)} activeOpacity={0.7}>
                <Icon name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={allTypes}
              keyExtractor={(item) => item}
              renderItem={({ item }) => {
                const isSelected = item === selectedType;
                const typeData = findTypeData(item);
                const hasStones = typeData?.editableStones?.length > 0;
                return (
                  <TouchableOpacity
                    style={[s.typeModalItem, isSelected && s.typeModalItemSelected]}
                    onPress={() => selectTopType(item)}
                    activeOpacity={0.7}
                  >
                    <View style={s.typeModalItemLeft}>
                      <Text style={[s.typeModalItemText, isSelected && s.typeModalItemTextSelected]}>
                        {item}
                      </Text>
                      {hasStones && (
                        <Text style={s.typeModalItemBadge}>
                          {typeData.editableStones.length}
                        </Text>
                      )}
                    </View>
                    {isSelected && <Icon name="check" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* PER-STONE TYPE SELECTOR MODAL */}
      <Modal visible={perStoneTypeModalIndex !== null} transparent animationType="slide" onRequestClose={() => setPerStoneTypeModalIndex(null)}>
        <View style={s.typeModalOverlay}>
          <View style={s.typeModalContent}>
            <View style={s.typeModalHeader}>
              <Text style={s.typeModalTitle}>Change Stone Type</Text>
              <TouchableOpacity onPress={() => setPerStoneTypeModalIndex(null)} activeOpacity={0.7}>
                <Icon name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={allTypes}
              keyExtractor={(item) => item}
              renderItem={({ item }) => {
                const idx = perStoneTypeModalIndex;
                const currentType = idx !== null ? (stoneTypeOverrides[idx] || flatStones[idx]?.stone?.Type || selectedType) : '';
                const isSelected = item === currentType;
                const typeData = findTypeData(item);
                const hasStones = typeData?.editableStones?.length > 0;
                return (
                  <TouchableOpacity
                    style={[s.typeModalItem, isSelected && s.typeModalItemSelected]}
                    onPress={() => selectPerStoneType(perStoneTypeModalIndex, item)}
                    activeOpacity={0.7}
                  >
                    <View style={s.typeModalItemLeft}>
                      <Text style={[s.typeModalItemText, isSelected && s.typeModalItemTextSelected]}>
                        {item}
                      </Text>
                      {hasStones && (
                        <Text style={s.typeModalItemBadge}>
                          {typeData.editableStones.length}
                        </Text>
                      )}
                    </View>
                    {isSelected && <Icon name="check" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* PER-STONE SHAPE SELECTOR MODAL */}
      <Modal visible={perStoneShapeModalIndex !== null} transparent animationType="slide" onRequestClose={() => setPerStoneShapeModalIndex(null)}>
        <View style={s.typeModalOverlay}>
          <View style={s.typeModalContent}>
            <View style={s.typeModalHeader}>
              <Text style={s.typeModalTitle}>Change Shape</Text>
              <TouchableOpacity onPress={() => setPerStoneShapeModalIndex(null)} activeOpacity={0.7}>
                <Icon name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={shapeListForModal}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const currentShape = perStoneShapeModalIndex !== null ? (getEffectiveStone(perStoneShapeModalIndex).Shape || '') : '';
                const isSelected = item === currentShape;
                return (
                  <TouchableOpacity
                    style={[s.typeModalItem, isSelected && s.typeModalItemSelected]}
                    onPress={() => selectPerStoneShape(perStoneShapeModalIndex, item)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.typeModalItemText, isSelected && s.typeModalItemTextSelected]}>
                      {item}
                    </Text>
                    {isSelected && <Icon name="check" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              }}
              ListFooterComponent={
                <View style={s.addShapeRow}>
                  <TextInput
                    style={s.addShapeInput}
                    value={newShapeText}
                    onChangeText={setNewShapeText}
                    placeholder="Add new shape"
                    placeholderTextColor={colors.textLight}
                    autoCapitalize="characters"
                    onSubmitEditing={addNewShape}
                    returnKeyType="done"
                  />
                  <TouchableOpacity style={s.addShapeBtn} onPress={addNewShape} activeOpacity={0.85}>
                    <Icon name="add" size={18} color="#fff" />
                    <Text style={s.addShapeBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
              }
            />
          </View>
        </View>
      </Modal>

      {/* EDIT STONE MODAL */}
      <Modal visible={editModalVisible} transparent animationType="slide" onRequestClose={closeEditModal}>
        <View style={s.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.modalKeyboard}>
            <View style={s.modalContent}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Edit Stone</Text>
                <TouchableOpacity onPress={closeEditModal} activeOpacity={0.7}>
                  <Icon name="close" size={22} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              {editingIndex !== null && (
                <ScrollView style={s.modalScroll} keyboardShouldPersistTaps="handled">
                  <View style={s.modalFields}>
                    {isNewStoneEdit && (
                      <View style={s.modalFieldRow}>
                        <View style={s.modalFieldHalf}>
                          <Text style={s.modalFieldLabel}>Type</Text>
                          <TouchableOpacity
                            style={s.modalSelectInput}
                            onPress={() => setPerStoneTypeModalIndex(editingIndex)}
                            activeOpacity={0.7}
                          >
                            <Text style={s.modalSelectText} numberOfLines={1}>
                              {stoneTypeOverrides[editingIndex] || getEffectiveStone(editingIndex).Type || selectedType || 'Select'}
                            </Text>
                            <Icon name="arrow-drop-down" size={18} color={colors.textSecondary} />
                          </TouchableOpacity>
                        </View>
                        <View style={s.modalFieldHalf}>
                          <Text style={s.modalFieldLabel}>Shape</Text>
                          <TouchableOpacity
                            style={s.modalSelectInput}
                            onPress={() => setPerStoneShapeModalIndex(editingIndex)}
                            activeOpacity={0.7}
                          >
                            <Text style={s.modalSelectText} numberOfLines={1}>
                              {getEffectiveStone(editingIndex).Shape || 'Select'}
                            </Text>
                            <Icon name="arrow-drop-down" size={18} color={colors.textSecondary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                    <View style={s.modalFieldRow}>
                      <View style={s.modalFieldHalf}>
                        <Text style={s.modalFieldLabel}>Color</Text>
                        <TextInput
                          style={s.modalFieldInput}
                          value={getEffectiveStone(editingIndex).Color || ''}
                          onChangeText={(v) => updateStoneField(editingIndex, 'Color', v)}
                        />
                      </View>
                      <View style={s.modalFieldHalf}>
                        <Text style={s.modalFieldLabel}>MM</Text>
                        <TextInput
                          style={s.modalFieldInput}
                          value={getEffectiveStone(editingIndex).MmSize || ''}
                          onChangeText={(v) => updateStoneField(editingIndex, 'MmSize', v)}
                        />
                      </View>
                    </View>
                    <View style={s.modalFieldRow}>
                      <View style={s.modalFieldHalf}>
                        <Text style={s.modalFieldLabel}>Sieve</Text>
                        <TextInput
                          style={s.modalFieldInput}
                          value={getEffectiveStone(editingIndex).SieveSize || ''}
                          onChangeText={(v) => updateStoneField(editingIndex, 'SieveSize', v)}
                        />
                      </View>
                      <View style={s.modalFieldHalf}>
                        <Text style={s.modalFieldLabel}>Pcs</Text>
                        <TextInput
                          style={s.modalFieldInput}
                          keyboardType="number-pad"
                          value={String(getEffectiveStone(editingIndex).Pcs ?? 0)}
                          onChangeText={(v) => updateStoneField(editingIndex, 'Pcs', v)}
                        />
                      </View>
                    </View>
                    <View style={s.modalFieldRow}>
                      <View style={s.modalFieldHalf}>
                        <Text style={s.modalFieldLabel}>Avg Wt</Text>
                        <TextInput
                          style={s.modalFieldInput}
                          keyboardType="decimal-pad"
                          value={String(getEffectiveStone(editingIndex).Weight ?? 0)}
                          onChangeText={(v) => updateStoneField(editingIndex, 'Weight', v)}
                        />
                      </View>
                      <View style={s.modalFieldHalf}>
                        <Text style={s.modalFieldLabel}>Ct Wt</Text>
                        <TextInput
                          style={s.modalFieldInput}
                          keyboardType="decimal-pad"
                          value={String(getEffectiveStone(editingIndex).CtWeight ?? 0)}
                          onChangeText={(v) => updateStoneField(editingIndex, 'CtWeight', v)}
                        />
                      </View>
                    </View>
                    <View style={s.modalFieldRow}>
                      <View style={s.modalFieldHalf}>
                        <Text style={s.modalFieldLabel}>Markup</Text>
                        <TextInput
                          style={s.modalFieldInput}
                          keyboardType="decimal-pad"
                          value={String(getEffectiveStone(editingIndex).Markup ?? 0)}
                          onChangeText={(v) => updateStoneField(editingIndex, 'Markup', v)}
                        />
                      </View>
                      <View style={s.modalFieldHalf}>
                        <Text style={[s.modalFieldLabel, num(getEffectiveStone(editingIndex).Price) <= 0 && s.modalFieldLabelError]}>
                          $/Ct *
                        </Text>
                        <TextInput
                          style={[s.modalFieldInput, num(getEffectiveStone(editingIndex).Price) <= 0 && s.modalFieldInputError]}
                          keyboardType="decimal-pad"
                          value={String(getEffectiveStone(editingIndex).Price ?? 0)}
                          onChangeText={(v) => updateStoneField(editingIndex, 'Price', v)}
                        />
                      </View>
                    </View>

                    {(() => {
                      const stoneType = editingIndex !== null ? (stoneTypeOverrides[editingIndex] || getEffectiveStone(editingIndex).Type || selectedType) : '';
                      const isLab = isLabType(stoneType);
                      const isSilver = metalKt?.includes('Silver');
                      const isPlatinum = metalKt?.includes('Platinum');
                      const dutyFields = [];
                      if (isSilver) {
                        dutyFields.push('UndercutPrice');
                        dutyFields.push(isLab ? 'LabDuties' : 'SilverAndLabsDuties');
                      } else if (isPlatinum) {
                        dutyFields.push('UndercutPrice', 'NaturalDuties');
                      } else {
                        if (!isLab) {
                          dutyFields.push('UndercutPrice', 'NaturalDuties');
                        } else {
                          dutyFields.push('LabDuties');
                        }
                      }
                      if (dutyFields.length === 0) return null;
                      return (
                        <View style={s.modalDutySection}>
                          <Text style={s.modalDutySectionTitle}>Stone Duties</Text>
                          <View style={s.modalFieldRow}>
                            {dutyFields.map(key => (
                              <View style={s.modalFieldHalf} key={key}>
                                <Text style={s.modalFieldLabel}>{DUTY_CONFIG[key]?.label || key}</Text>
                                <TextInput
                                  style={s.modalFieldInput}
                                  value={dutyEdits[key] ?? ''}
                                  onChangeText={(v) => updateDuty(key, v)}
                                  keyboardType="decimal-pad"
                                  placeholder="0"
                                  placeholderTextColor={colors.textLight}
                                />
                              </View>
                            ))}
                          </View>
                        </View>
                      );
                    })()}
                  </View>
                </ScrollView>
              )}

              <TouchableOpacity
                style={s.modalDoneBtn}
                onPress={closeEditModal}
                activeOpacity={0.85}
              >
                <Text style={s.modalDoneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.primary,
  },
  backBtn: { padding: 4 },
  headerTitleWrap: { flex: 1, marginLeft: 8 },
  headerTitle: { fontFamily: fonts.bold, fontSize: fonts.base, color: '#fff' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16 },

  pageTitle: { fontFamily: fonts.bold, fontSize: fonts.lg, color: colors.primary, marginBottom: 12 },

  typeSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.background,
    marginBottom: 16,
  },
  typeSelectorValue: { fontFamily: fonts.medium, fontSize: fonts.sm, color: colors.textPrimary, flex: 1 },

  emptyTypeState: { alignItems: 'center', paddingVertical: 20 },
  emptyTypeText: { fontFamily: fonts.regular, fontSize: fonts.sm, color: colors.textLight },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addStoneBtnTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryExtraLight || colors.backgroundSecondary,
  },
  addStoneBtnText: {
    fontFamily: fonts.medium,
    fontSize: fonts.xs,
    color: colors.primary,
  },

  stoneCard: {
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
    overflow: 'hidden',
  },
  stoneColorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  stoneColorBarText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  stoneColorHint: {
    fontFamily: fonts.medium,
    fontSize: 9,
    color: colors.error,
  },
  stoneCardMissing: {
    borderWidth: 1.5,
    borderColor: colors.error,
    backgroundColor: '#FEF2F2',
  },

  stoneMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 8,
  },
  stoneFieldWrap: { flex: 1.5 },
  stoneFieldWrapSmall: { flex: 1.5 },
  stoneFieldWrapPrice: { flex: 1.5 },
  stoneFieldLabel: { fontFamily: fonts.bold, fontSize: 10, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.05, marginBottom: 4 },

  selectWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.backgroundSecondary,
  },
  selectText: { fontFamily: fonts.regular, fontSize: fonts.sm, color: colors.textPrimary, flex: 1 },

  priceInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: fonts.medium,
    fontSize: fonts.sm,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    textAlign: 'right',
  },
  priceInputMissing: {
    borderColor: colors.error,
    color: colors.error,
  },

  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },

  bottomSection: {
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
  },

  bottomBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  clientPreviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 10,
  },
  clientPreviewBtnDisabled: { opacity: 0.5 },
  clientPreviewBtnText: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm,
    color: '#fff',
    letterSpacing: 0.5,
  },
  recalcBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  recalcBtnDisabled: { opacity: 0.6 },
  recalcBtnText: { fontFamily: fonts.bold, fontSize: fonts.sm, color: '#fff', letterSpacing: 0.5 },
  previewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  previewBtnText: { fontFamily: fonts.bold, fontSize: fonts.sm, color: colors.primary, letterSpacing: 0.5 },
  previewBtnDisabled: { opacity: 0.5 },
  previewBtnTextDisabled: { color: colors.textSecondary },
  typeModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  typeModalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  typeModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  typeModalTitle: { fontFamily: fonts.bold, fontSize: fonts.base, color: colors.textPrimary },

  typeModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  typeModalItemSelected: { backgroundColor: colors.primaryExtraLight },

  addShapeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addShapeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: fonts.sm,
    color: colors.textPrimary,
    backgroundColor: colors.backgroundSecondary,
  },
  addShapeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  addShapeBtnText: { fontFamily: fonts.bold, fontSize: fonts.sm, color: '#fff' },
  typeModalItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  typeModalItemText: { fontFamily: fonts.medium, fontSize: fonts.sm, color: colors.textPrimary },
  typeModalItemTextSelected: { fontFamily: fonts.bold, color: colors.primary },
  typeModalItemBadge: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.primary,
    backgroundColor: colors.primaryExtraLight,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalKeyboard: { flex: 1, justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontFamily: fonts.bold, fontSize: fonts.base, color: colors.textPrimary },

  modalScroll: { maxHeight: 500 },
  modalFields: { padding: 16 },
  modalFieldRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  modalFieldHalf: { flex: 1 },
  modalFieldLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.05,
    marginBottom: 4,
  },
  modalFieldLabelError: { color: colors.error },
  modalFieldInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: fonts.sm,
    color: colors.textPrimary,
    backgroundColor: colors.backgroundSecondary,
  },
  modalFieldInputError: { borderColor: colors.error },
  modalSelectInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.backgroundSecondary,
  },
  modalSelectText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fonts.sm,
    color: colors.textPrimary,
  },

  modalDutySection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    marginTop: 4,
  },
  modalDutySectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.05,
    marginBottom: 10,
  },

  modalDoneBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  modalDoneBtnText: { fontFamily: fonts.bold, fontSize: fonts.sm, color: '#fff' },
});
