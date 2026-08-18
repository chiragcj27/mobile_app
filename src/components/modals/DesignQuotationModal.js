import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView,
  TextInput, ActivityIndicator, Image,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Icon from '../common/Icon';
import BrandedAlert from '../common/BrandedAlert';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import {
  useGetDesignByIdQuery,
  useGetClientsQuery,
  useGetClientByIdQuery,
  useGetStoneTypesQuery,
  useCalculatePricingMutation,
  useGetMetalPricesQuery,
} from '../../store/api';
import { num, makeId, METAL_QUALITY_OPTIONS } from './QuotationModal';
import { normalizeExtraCharges } from '../../utils/extraCharges';
import { getClientStoneOptions } from '../../utils/stoneTypeMapping';

const DesignQuotationModal = ({ visible, designId, designData, designGroupData, navigation, onClose }) => {
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [previewImageUrl, setPreviewImageUrl] = useState(null);

  const effectiveDesignId = useMemo(() => {
    if (!designGroupData || !selectedVersion) return designId;
    const match = designGroupData.images?.find(img => img.version === selectedVersion);
    return match?.designId || designId;
  }, [designGroupData, selectedVersion, designId]);

  const { data: design, isFetching: isFetchingDesign } = useGetDesignByIdQuery(effectiveDesignId, {
    skip: !visible || !effectiveDesignId,
    refetchOnMountOrArgChange: true,
  });

  useEffect(() => {
    if (visible && designGroupData?.versions?.length) {
      setSelectedVersion(prev => prev || designGroupData.versions[0]);
    }
  }, [visible, designGroupData]);

  useEffect(() => {
    if (!visible) {
      setSelectedVersion(null);
      setPreviewImageUrl(null);
    }
  }, [visible]);

  const { data: clients = [] } = useGetClientsQuery();

  const designSource = designData || design;

  const clientOptions = useMemo(() =>
    clients.map(c => ({ label: c.name, value: c.id || c._id })),
    [clients],
  );

  const [selectedClientId, setSelectedClientId] = useState(null);
  const [selectedClientName, setSelectedClientName] = useState('');
  const { data: selectedClientData } = useGetClientByIdQuery(selectedClientId, {
    skip: !visible || !selectedClientId,
  });
  const [showClientDropdown, setShowClientDropdown] = useState(false);

  const [metalKt, setMetalKt] = useState('');
  const [showKtModal, setShowKtModal] = useState(false);
  const [commonMetal, setCommonMetal] = useState({ Weight: '', Rate: '', Ounce: '' });

  const [diamonds, setDiamonds] = useState([]);
  const [missingIndices, setMissingIndices] = useState(new Set());

  const [pricingResult, setPricingResult] = useState(null);

  const [clientMsg, setClientMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: stoneTypesData = [] } = useGetStoneTypesQuery();
  const stoneOptions = useMemo(() =>
    getClientStoneOptions(stoneTypesData, selectedClientData),
    [stoneTypesData, selectedClientData],
  );

  const [showStoneTypePicker, setShowStoneTypePicker] = useState(false);
  const [stoneTypePickerIndex, setStoneTypePickerIndex] = useState(null);
  const [defaultStoneType, setDefaultStoneType] = useState('');

  const [calculatePricing, { isLoading: isCalculating }] = useCalculatePricingMutation();
  const { data: metalPricesData } = useGetMetalPricesQuery(false);

  const getTodayPrice = () => {
    const rateVal = num(commonMetal.Rate);
    if (rateVal <= 0) return 'N/A';
    const ktRate = rateVal * (parseInt(metalKt) / 24);
    return `$${ktRate.toFixed(2)}/g`;
  };

  const [alertCfg, setAlertCfg] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  const showAlert = useCallback((title, message, type = 'info', buttons = []) =>
    setAlertCfg({ visible: true, title, message, type, buttons }), []);
  const hideAlert = useCallback(() => setAlertCfg(p => ({ ...p, visible: false })), []);

  const seededForRef = useRef(null);

  useEffect(() => {
    if (!visible || isFetchingDesign || !designSource) return;
    if (seededForRef.current === effectiveDesignId) return;
    seededForRef.current = effectiveDesignId;

    const rawMetal = designSource.Metal || [];
    const designMetal = Array.isArray(rawMetal) ? rawMetal[0] || {} : rawMetal;
    const designStones = Array.isArray(designSource.Stones)
      ? designSource.Stones
      : Array.isArray(designSource.stones)
        ? designSource.stones
        : [];

    const quality = (designMetal.Quality || '10K').replace(/T$/i, '');
    setMetalKt(quality);

    // Seed the 24K full rate (like PricingCalculator). The backend derives the KT rate from
    // this; sending a KT rate here would get reduced again. For gold use the live 24K price,
    // for silver/platinum their own price.
    const autoRate = (() => {
      const prices = metalPricesData?.prices || {};
      if (/silver\s*925/i.test(quality)) return String(prices.silver?.price ?? 0);
      if (/platinum/i.test(quality)) return String(prices.platinum?.price ?? 0);
      return String(prices.gold?.price ?? 0);
    })();
    setCommonMetal({
      Weight: String(designMetal.Weight ?? 0),
      Rate: autoRate,
      Ounce: '',
    });

    setDiamonds(designStones.length > 0
      ? designStones.map(st => ({
          localId: makeId(),
          Type: st.Type || st.type || '',
          Shape: st.Shape || st.shape || '',
          Carat: num(st.CtWeight ?? st.Carat ?? st.carat),
          MmSize: num(st.MmSize ?? st.mmSize),
          SieveSize: st.SieveSize || st.sieveSize || '',
          Price: num(st.Price ?? st.price),
          Color: st.Color || st.color || '',
          Weight: num(st.Weight ?? st.weight),
          Pcs: num(st.Pcs ?? st.pcs),
          Markup: num(st.Markup ?? st.markup),
        }))
      : []);

    const initialMissing = new Set(
      designStones.reduce((acc, st, i) => { if (num(st.Price ?? st.price) <= 0) acc.push(i); return acc; }, [])
    );
    setMissingIndices(initialMissing);

    setSelectedClientId(null);
    setSelectedClientName('');
    setDefaultStoneType('');
    setPricingResult(null);
    setCopied(false);
  }, [visible, isFetchingDesign, designSource, designId, metalPricesData]);

  const isAutoRecalculatingRef = useRef(false);
  const handleCalculateRef = useRef(null);

  const triggerAutoRecalc = () => {
    if (!selectedClientId || diamonds.length === 0 || !pricingResult) return;
    if (isAutoRecalculatingRef.current) return;
    isAutoRecalculatingRef.current = true;
    setTimeout(() => {
      handleCalculateRef.current?.(true)?.finally?.(() => { isAutoRecalculatingRef.current = false; }) || (isAutoRecalculatingRef.current = false);
    }, 100);
  };

  const updateStonePrice = useCallback((index, value) => {
    setDiamonds(prev => prev.map((d, i) => (i === index ? { ...d, Price: value } : d)));
  }, []);

  // Single place that folds a pricing result into the modal: used by Calculate and by the
  // edits coming back from the Pricing Preview screen.
  const applyPricingResult = useCallback((result) => {
    if (!result) return;
    setPricingResult(result);

    const resultStones = Array.isArray(result.Stones) ? result.Stones : [];
    if (resultStones.length) {
      setDiamonds(prev => resultStones.map((st, i) => ({
        localId: prev[i]?.localId || makeId(),
        Type: st.Type || '',
        Shape: st.Shape || '',
        Carat: num(st.CtWeight),
        MmSize: st.MmSize ?? '',
        SieveSize: st.SieveSize || '',
        Price: num(st.Price),
        Color: st.Color || '',
        Weight: num(st.Weight),
        Pcs: num(st.Pcs),
        Markup: num(st.Markup),
      })));
      setMissingIndices(new Set(
        resultStones.reduce((acc, st, i) => { if (num(st.Price) <= 0) acc.push(i); return acc; }, [])
      ));
    }

    // result.GoldRate24K / Metal.Rate are the 24K full rate; the backend derives the KT rate.
    setCommonMetal(prev => ({
      Weight: String(result.Metal?.Weight ?? prev.Weight),
      Rate: String(result.GoldRate24K ?? result.Metal?.Rate ?? prev.Rate),
      Ounce: String(result.GoldRatePerOunce ?? prev.Ounce),
    }));
    setClientMsg(result.ClientPricingMessage || '');
  }, []);

  // isRecalculate=false → first calc, backend prices stones from the client's rate chart.
  // isRecalculate=true → keep the prices already on the stones (used after filling missing ones).
  const handleCalculate = useCallback(async (isRecalculate = false) => {
    console.log("design Data:", designSource);
    if (!selectedClientId) {
      showAlert('Validation', 'Please select a client first.', 'warning', [{ text: 'OK' }]);
      return;
    }
    if (!diamonds.length && !designSource.isOnlyMetalDesign) {
      showAlert('Validation', 'Please add at least one stone before calculating.', 'warning', [{ text: 'OK' }]);
      return;
    }
    if (num(commonMetal.Weight) <= 0) {
      showAlert('Validation', 'Metal weight must be greater than 0.', 'warning', [{ text: 'OK' }]);
      return;
    }
    const ounceVal = num(commonMetal.Ounce);
    const rateVal = num(commonMetal.Rate);
    if (ounceVal <= 0 && rateVal <= 0) {
      showAlert('Validation', 'Please provide either Metal Rate (per gram) or Per Ounce price.', 'warning', [{ text: 'OK' }]);
      return;
    }

    const clientPricing = selectedClientData?.Pricing || {};

 
    const payload = {
      details: {
        Metal: {
          Weight: num(commonMetal.Weight),
          Quality: metalKt,
          ...(ounceVal > 0
            ? { GoldRatePerOunce: ounceVal }
            : num(commonMetal.Rate) > 0 ? { Rate: num(commonMetal.Rate) } : {}),
        },
        Stones: diamonds.map(d => ({
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
        })).filter(st => st.Type),
        Loss: num(clientPricing.Loss ?? 0),
        Labour: num(clientPricing.Labour ?? 0),
        ExtraCharges: normalizeExtraCharges(clientPricing.ExtraCharges),
        UndercutPrice: num(clientPricing.UndercutPrice ?? 0),
        NaturalDuties: num(clientPricing.NaturalDuties ?? 0),
        LabDuties: num(clientPricing.LabDuties ?? 0),
        GoldDuties: num(clientPricing.GoldDuties ?? 0),
        SilverAndLabsDuties: num(clientPricing.SilverAndLabsDuties ?? 0),
        LossAndLabourDuties: num(clientPricing.LossAndLabourDuties ?? 0),
        Quantity: 1,
      },
      clientId: selectedClientId,
      isRecalculate,
    };

    try {
      console.log('Calculating pricing with payload:', payload);
      const result = await calculatePricing(payload).unwrap();
      applyPricingResult(result);
    } catch (e) {
      showAlert('Calculation Failed', e?.data?.message || 'Failed to calculate pricing. Please try again.', 'error', [{ text: 'OK' }]);
    }
  }, [diamonds, commonMetal, metalKt, selectedClientId, selectedClientName, selectedClientData,
      designSource, applyPricingResult, calculatePricing, showAlert]);
  handleCalculateRef.current = handleCalculate;

  const designImageUrl = designSource?.Url || designSource?.url || null;

  const openPricingPreview = useCallback((isClientPreview) => {
    if (!pricingResult) return;
    onClose?.();
    navigation.navigate('PricingPreview', {
      pricingEntries: [pricingResult],
      clientName: selectedClientName,
      metalKt: pricingResult.MetalKT || metalKt,
      preCropImageUrl: designImageUrl,
      isClientPreview,
      clientId: selectedClientId,
      selectedClient: selectedClientData,
      onEntriesUpdated: entries => applyPricingResult(entries?.[0]),
    });
  }, [pricingResult, selectedClientName, metalKt, designImageUrl, selectedClientId,
      selectedClientData, applyPricingResult, navigation, onClose]);

  const handleCopyMsg = useCallback(() => {
    if (!clientMsg) return;
    Clipboard.setString(clientMsg);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [clientMsg]);

  return (
    <>
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>

          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle} numberOfLines={1}>Design Quotation</Text>
              {designSource?.Description ? <Text style={s.headerSub} numberOfLines={1}>{designSource.Description}</Text> : null}
            </View>
            {isFetchingDesign && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />}
            <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <Icon name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {(
            <ScrollView
              style={s.scrollBody}
              contentContainerStyle={s.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
      
       

              {designGroupData?.versions?.length ? (
                <View style={s.versionRow}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.versionChipsContainer}>
                    {designGroupData.versions.map(v => {
                      const isSelected = selectedVersion === v;
                      const imgEntry = designGroupData.images?.find(i => i.version === v);
                      return (
                        <TouchableOpacity
                          key={v}
                          style={[s.versionChip, isSelected && s.versionChipActive]}
                          onPress={() => setSelectedVersion(v)}
                          activeOpacity={0.8}
                        >
                          <Text style={[s.versionChipText, isSelected && s.versionChipTextActive]}>Version {v}</Text>
                          {imgEntry?.url ? (
                            <TouchableOpacity
                              onPress={() => setPreviewImageUrl(imgEntry.url)}
                              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                              style={s.versionEyeBtn}
                            >
                              <Icon name="remove-red-eye" size={16} color={isSelected ? '#fff' : colors.primary} />
                            </TouchableOpacity>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              {designSource?.enquiryId ? (
                <TouchableOpacity
                  style={s.enquiryLinkBtn}
                  onPress={() => {
                    onClose();
                    navigation?.navigate('SingleEnquiry', { enquiryId: designSource.enquiryId });
                  }}
                  activeOpacity={0.8}
                >
                  <Icon name="open-in-new" size={18} color="#fff" />
                  <Text style={s.enquiryLinkBtnText}>View Related Enquiry</Text>
                </TouchableOpacity>
              ) : null}

              <View style={s.clientSection}>
                <Text style={s.sectionTitle}>Client</Text>
                <TouchableOpacity
                  style={s.clientSelector}
                  onPress={() => setShowClientDropdown(true)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.clientSelectorText, !selectedClientId && s.clientSelectorPlaceholder]}>
                    {selectedClientName || 'Select a client'}
                  </Text>
                  <Icon name="arrow-drop-down" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={s.stoneTypeSection}>
                <Text style={s.sectionTitle}>Stone Type</Text>
                <TouchableOpacity
                  style={s.clientSelector}
                  onPress={() => { setStoneTypePickerIndex(null); setShowStoneTypePicker(true); }}
                  activeOpacity={0.7}
                >
                  <Text style={[s.clientSelectorText, !defaultStoneType && s.clientSelectorPlaceholder]}>
                    {defaultStoneType || 'Set default stone type...'}
                  </Text>
                  <Icon name="arrow-drop-down" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={s.metalSection}>
                <View style={s.metalHeader}>
                  <Text style={s.sectionTitle}>Metal</Text>
                  <View style={s.ktRateContainer}>
                    <TouchableOpacity
                      style={s.qualityChip}
                      onPress={() => setShowKtModal(true)}
                      activeOpacity={0.8}
                    >
                      <Text style={s.qualityChipText}>{metalKt}</Text>
                      <Icon name="arrow-drop-down" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                    <Text style={s.ktRateText}>{getTodayPrice()}</Text>
                  </View>
                </View>
              </View>
              <View style={s.chargesRow}>
                <View style={s.chargeFieldSmall}>
                  <Text style={[s.fieldLabel, (!commonMetal.Weight || parseFloat(commonMetal.Weight) <= 0) && s.fieldLabelError]}>Weight (g) *</Text>
                  <TextInput
                    style={[s.fieldInput, (!commonMetal.Weight || parseFloat(commonMetal.Weight) <= 0) && s.fieldInputError]}
                    keyboardType="decimal-pad"
                    value={String(commonMetal.Weight || '')}
                    onChangeText={v => setCommonMetal(p => ({ ...p, Weight: v }))}
                    onSubmitEditing={() => handleCalculate(false)}
                    placeholder="0"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
                <View style={s.chargeField}>
                  <Text style={[s.fieldLabel, (!commonMetal.Rate || parseFloat(commonMetal.Rate) <= 0) && s.fieldLabelError]}>24K Rate ($/g) *</Text>
                  <TextInput
                    style={[s.fieldInput, (!commonMetal.Rate || parseFloat(commonMetal.Rate) <= 0) && s.fieldInputError]}
                    keyboardType="decimal-pad"
                    value={String(commonMetal.Rate || '')}
                    onChangeText={v => setCommonMetal(p => ({ ...p, Rate: v }))}
                    onSubmitEditing={() => handleCalculate(false)}
                    placeholder="0"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
                <View style={s.chargeFieldSmall}>
                  <Text style={s.fieldLabel}>Per Ounce ($)</Text>
                  <TextInput
                    style={s.fieldInput}
                    keyboardType="decimal-pad"
                    value={String(commonMetal.Ounce || '')}
                    onChangeText={v => setCommonMetal(p => ({ ...p, Ounce: v }))}
                    onSubmitEditing={() => handleCalculate(false)}
                    placeholder="0"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
              </View>
              {num(commonMetal.Rate) <= 0 && num(commonMetal.Ounce) <= 0 && (
                <Text style={s.validationWarning}>Provide Rate per gram or Per Ounce</Text>
              )}

              {/* Missing-price stones: shown after a calc when the client chart had no rate for
                  some stones. Enter $/Ct here and recalculate (like SingleStonePricing). */}
              {pricingResult && missingIndices.size > 0 && (
                <>
                  <View style={s.sectionRow}>
                    <Text style={s.sectionTitle}>Stones needing price ({missingIndices.size})</Text>
                  </View>
                  <View style={s.warningBanner}>
                    <Icon name="warning" size={15} color="#92400E" />
                    <Text style={s.warningText}>No rate found in the client chart for these stones. Enter $/Ct and recalculate.</Text>
                  </View>
                  <View style={s.stoneTable}>
                    <View style={s.stoneTableHeader}>
                      <Text style={[s.stoneCol, s.stoneColType, s.stoneTh]}>Type</Text>
                      <Text style={[s.stoneCol, s.stoneColShape, s.stoneTh]}>Shape</Text>
                      <Text style={[s.stoneCol, s.stoneColNum, s.stoneTh]}>MM</Text>
                      <Text style={[s.stoneCol, s.stoneColNum, s.stoneTh]}>Ct</Text>
                      <Text style={[s.stoneCol, s.stoneColPrice, s.stoneTh]}>$/Ct</Text>
                    </View>
                    {diamonds.map((d, i) => (
                      missingIndices.has(i) ? (
                        <View key={d.localId || i} style={[s.stoneRow, s.stoneRowMissing]}>
                          <Text style={[s.stoneCol, s.stoneColType, s.stoneTd]} numberOfLines={1}>{d.Type || '—'}</Text>
                          <Text style={[s.stoneCol, s.stoneColShape, s.stoneTd]} numberOfLines={1}>{d.Shape || '—'}</Text>
                          <Text style={[s.stoneCol, s.stoneColNum, s.stoneTd]} numberOfLines={1}>{d.MmSize || '—'}</Text>
                          <Text style={[s.stoneCol, s.stoneColNum, s.stoneTd]}>{num(d.Carat).toFixed(2)}</Text>
                          <TextInput
                            style={[s.stoneCol, s.stoneColPrice, s.stonePriceInput]}
                            keyboardType="decimal-pad"
                            value={d.Price ? String(d.Price) : ''}
                            onChangeText={v => updateStonePrice(i, v)}
                            onSubmitEditing={() => handleCalculate(true)}
                            placeholder="$/Ct"
                            placeholderTextColor={colors.textSecondary}
                          />
                        </View>
                      ) : null
                    ))}
                  </View>
                </>
              )}

              {!selectedClientId ? (
                <View style={s.clientRequiredBanner}>
                  <Icon name="person" size={18} color={colors.textSecondary} />
                  <Text style={s.clientRequiredText}>Select a client above to calculate pricing</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[s.calcBtn, (isCalculating || !selectedClientId) && s.calcBtnDisabled]}
                onPress={() => handleCalculate(!!pricingResult)}
                // disabled={isCalculating || !selectedClientId}
                activeOpacity={0.85}
              >
                {isCalculating
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <>
                      <Icon name="calculate" size={18} color="#fff" />
                      <Text style={s.calcBtnText}>{ pricingResult ? 'Recalculate' : 'Calculate Pricing' }</Text>
                    </>}
              </TouchableOpacity>

              {pricingResult && (
                <>
                  <Text style={s.sectionTitle}>Pricing</Text>
                  <View style={s.resultCard}>
                    <View style={s.resultRow}>
                      <Text style={s.resultLbl}>24K Rate ($/g)</Text>
                      <Text style={s.resultVal}>${num(pricingResult.GoldRate24K).toFixed(2)}</Text>
                    </View>
                    <View style={s.resultRow}>
                      <Text style={s.resultLbl}>{metalKt} Rate ($/g)</Text>
                      <Text style={s.resultVal}>${num(pricingResult.GoldRateKT).toFixed(2)}</Text>
                    </View>
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
                    onPress={() => openPricingPreview(false)}
                    activeOpacity={0.85}
                  >
                    <Icon name="visibility" size={18} color="#fff" />
                    <Text style={s.calcBtnText}>Admin Preview</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[s.calcBtn, { backgroundColor: colors.primary }]}
                    onPress={() => openPricingPreview(true)}
                    activeOpacity={0.85}
                  >
                    <Icon name="visibility" size={18} color="#fff" />
                    <Text style={s.calcBtnText}>Client Preview</Text>
                  </TouchableOpacity>
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

      <Modal visible={showClientDropdown} transparent animationType="fade" onRequestClose={() => setShowClientDropdown(false)}>
        <TouchableOpacity style={s.pickerOverlayCentered} activeOpacity={1} onPress={() => setShowClientDropdown(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerSheetCompact}>
            <Text style={s.pickerTitle}>Select Client</Text>
            <ScrollView style={s.pickerScroll} showsVerticalScrollIndicator={false}>
              {clientOptions.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[s.pickerOption, selectedClientId === opt.value && s.pickerOptionSelected]}
                  onPress={() => {
                    setSelectedClientId(opt.value);
                    setSelectedClientName(opt.label);
                    setShowClientDropdown(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[s.pickerOptionText, selectedClientId === opt.value && s.pickerOptionTextSelected]}>
                    {opt.label}
                  </Text>
                  {selectedClientId === opt.value && <Icon name="check" size={16} color={colors.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showStoneTypePicker} transparent animationType="fade" onRequestClose={() => setShowStoneTypePicker(false)}>
        <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => setShowStoneTypePicker(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerSheet}>
            <Text style={s.pickerTitle}>Select Stone Type</Text>
            {stoneOptions.map(opt => {
              const isSelected = stoneTypePickerIndex !== null
                ? diamonds[stoneTypePickerIndex]?.Type === opt.value
                : defaultStoneType === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[s.pickerOption, isSelected && s.pickerOptionSelected]}
                  onPress={() => {
                    if (stoneTypePickerIndex !== null) {
                      setDiamonds(prev => prev.map((d, idx) => idx !== stoneTypePickerIndex ? d : { ...d, Type: opt.value }));
                    } else {
                      setDefaultStoneType(opt.value);
                      setDiamonds(prev => prev.map(d => ({ ...d, Type: opt.value })));
                    }
                    setShowStoneTypePicker(false);
                    setStoneTypePickerIndex(null);
                    triggerAutoRecalc();
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[s.pickerOptionText, isSelected && s.pickerOptionTextSelected]}>
                    {opt.label}
                  </Text>
                  {isSelected && <Icon name="check" size={16} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showKtModal} transparent animationType="fade" onRequestClose={() => setShowKtModal(false)}>
        <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => setShowKtModal(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerSheet}>
            <Text style={s.pickerTitle}>Select Metal Quality</Text>
            {METAL_QUALITY_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt}
                style={[s.pickerOption, metalKt === opt && s.pickerOptionSelected]}
                onPress={() => { setMetalKt(opt); setShowKtModal(false); triggerAutoRecalc(); }}
                activeOpacity={0.8}
              >
                <Text style={[s.pickerOptionText, metalKt === opt && s.pickerOptionTextSelected]}>{opt}</Text>
                {metalKt === opt && <Icon name="check" size={16} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!previewImageUrl} transparent animationType="fade" onRequestClose={() => setPreviewImageUrl(null)}>
        <View style={s.previewOverlay}>
          <TouchableOpacity style={s.previewCloseBtn} onPress={() => setPreviewImageUrl(null)}>
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
          {previewImageUrl ? (
            <Image source={{ uri: previewImageUrl }} style={s.previewImage} resizeMode="contain" />
          ) : null}
        </View>
      </Modal>

      <BrandedAlert
        visible={alertCfg.visible} title={alertCfg.title} message={alertCfg.message}
        type={alertCfg.type} buttons={alertCfg.buttons} onClose={hideAlert}
      />
    </Modal>
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
  headerSub: { fontFamily: fonts.regular, fontSize: fonts.xs || 11, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  closeBtn: { padding: 4 },

  scrollBody: { flex: 1 },
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

  clientSection: { marginBottom: 16 },
  stoneTypeSection: { marginBottom: 16 },
  clientSelector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 8, padding: 12, minHeight: 44,
  },
  clientSelectorText: {
    fontSize: fonts.sm, fontFamily: fonts.regular,
    color: colors.textPrimary, flex: 1,
  },
  clientSelectorPlaceholder: { color: colors.textSecondary },
  clientRequiredBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary + '10', borderRadius: 8,
    padding: 12, marginBottom: 14,
  },
  clientRequiredText: {
    flex: 1, fontFamily: fonts.regular, fontSize: fonts.xs || 12,
    color: colors.textSecondary, lineHeight: 18,
  },
  enquiryLinkBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, paddingVertical: 10, borderRadius: 10, marginBottom: 14,
  },
  enquiryLinkBtnText: {
    fontFamily: fonts.bold, fontSize: fonts.sm || 13, color: '#fff',
  },

  sectionTitle: {
    fontFamily: fonts.bold, fontSize: fonts.sm || 13,
    color: colors.textPrimary, marginBottom: 8, marginTop: 4,
  },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8, marginTop: 4,
  },

  chargesRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  chargeField: { flex: 1.2 },
  chargeFieldSmall: { flex: 0.8 },

  fieldLabel: { fontFamily: fonts.medium, fontSize: fonts.xs || 11, color: colors.textSecondary, marginBottom: 4 },
  fieldLabelError: { color: colors.error || '#EF4444' },
  fieldInput: {
    borderWidth: 1, borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
    fontFamily: fonts.regular, fontSize: fonts.sm || 13,
    color: colors.textPrimary, backgroundColor: colors.background,
  },
  fieldInputError: { borderColor: colors.error || '#EF4444', borderWidth: 1.5 },
  inputHighlight: { borderColor: colors.primary, borderWidth: 1.5 },
  validationWarning: { fontFamily: fonts.regular, fontSize: fonts.xs || 11, color: colors.error || '#EF4444', marginTop: 4, marginLeft: 4 },

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

  stoneCol: { textAlign: 'center' },
  stoneColType: { flex: 2.5, textAlign: 'left' },
  stoneColShape: { flex: 2, textAlign: 'left' },
  stoneColNum: { flex: 1.2 },
  stoneColPrice: { flex: 1.8 },
  stoneColActions: { width: 44, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },

  stoneTh: { fontFamily: fonts.bold, fontSize: 10, color: '#fff' },
  stoneTd: { fontFamily: fonts.regular, fontSize: 11, color: colors.textPrimary },
  stonePriceMissing: { color: colors.error || '#EF4444' },
  stoneRowMissing: { backgroundColor: (colors.error || '#EF4444') + '10' },
  stonePriceInput: {
    borderWidth: 1.5, borderColor: colors.error || '#EF4444',
    borderRadius: 6, paddingVertical: 5, paddingHorizontal: 6,
    fontFamily: fonts.bold, fontSize: 12, color: colors.textPrimary,
    textAlign: 'center', backgroundColor: colors.background,
  },
  stoneTypePlaceholder: { color: colors.textSecondary, fontStyle: 'italic' },

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
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderLight || '#F0F0F0' },
  resultLbl: { fontFamily: fonts.medium, fontSize: fonts.sm || 13, color: colors.textSecondary },
  resultVal: { fontFamily: fonts.bold, fontSize: fonts.sm || 13, color: colors.textPrimary },
  resultTotalRow: { borderBottomWidth: 0, marginTop: 6 },
  resultTotalLbl: { fontFamily: fonts.bold, fontSize: fonts.base || 15, color: colors.textPrimary },
  resultTotalVal: { fontFamily: fonts.bold, fontSize: fonts.lg || 18, color: colors.primary },

  pdfBar: { flexDirection: 'row', gap: 10, padding: 10, backgroundColor: 'rgba(0,0,0,0.75)' },
  pdfBarBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 10, borderRadius: 8,
  },
  pdfBarBtnText: { fontFamily: fonts.medium, fontSize: fonts.xs || 12, color: '#fff' },
  shareBtn: { backgroundColor: colors.primary },

  metalSection: { marginBottom: 16 },
  metalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8, marginTop: 4,
  },
  ktRateContainer: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  qualityChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: colors.background,
  },
  qualityChipText: { fontFamily: fonts.medium, fontSize: fonts.sm || 13, color: colors.textPrimary },
  ktRateText: { fontFamily: fonts.medium, fontSize: fonts.sm || 13, color: colors.primary },

  pickerOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end',
  },
  pickerOverlayCentered: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center',
  },
  pickerSheet: {
    backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 16, paddingBottom: 32, paddingHorizontal: 16,
  },
  pickerSheetCompact: {
    backgroundColor: colors.background, borderRadius: 16,
    paddingTop: 16, paddingBottom: 20, paddingHorizontal: 16,
    width: '85%', maxHeight: '60%',
  },
  pickerScroll: { maxHeight: 300 },
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

  versionRow: {
    marginBottom: 12,
  },
  versionChipsContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  versionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  versionChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  versionChipText: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  versionChipTextActive: {
    color: colors.textWhite,
  },
  versionEyeBtn: {
    padding: 2,
  },

  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: '80%',
  },
});

export default DesignQuotationModal;
