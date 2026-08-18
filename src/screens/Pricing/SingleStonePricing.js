import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Animated,
  Keyboard,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Icon from '../../components/common/Icon';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { extraChargesSuffix } from '../../utils/extraCharges';
import { getMetalRateLabel } from '../../constants/metalQualities';

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

const CHARGE_FIELDS = [
  { key: 'Loss', label: 'Loss', suffix: '%', source: 'charges' },
  { key: 'Labour', label: 'Labour', suffix: '/g', source: 'charges' },
  { key: 'ExtraCharges', label: 'Extra', suffix: '%', source: 'charges' },
  { key: 'GoldDuties', label: 'Gold Duty', suffix: '%', source: 'charges', applicableKey: 'GoldDuties' },
  { key: 'LabDuties', label: 'Lab Duty', suffix: '%', source: 'duty', applicableKey: 'LabDuties' },
  { key: 'NaturalDuties', label: 'Natural Duty', suffix: '%', source: 'duty', applicableKey: 'NaturalDuties' },
  { key: 'SilverAndLabsDuties', label: 'Silver+Lab Duty', suffix: '%', source: 'charges', applicableKey: 'SilverAndLabsDuties' },
  { key: 'LossAndLabourDuties', label: 'Loss+labour Duty', suffix: '%', source: 'charges', applicableKey: 'LossAndLabourDuties' },
];

const chargeLabel = (field, type, metalKt) => {
  if (field.key === 'SilverAndLabsDuties') return /lab/i.test(type) ? 'Silver+Lab Duty' : 'Silver';
  if (field.key === 'GoldDuties') {
    if (metalKt?.includes('Silver')) return 'Silver Duty';
    if (metalKt?.includes('Platinum')) return 'Platinum Duty';
    return 'Gold Duty';
  }
  return field.label;
};

const applyChargeOverrides = (data, overrides = {}) => {
  const editableCharges = { ...data.editableCharges };
  const dutyRates = { ...data.dutyRates };
  CHARGE_FIELDS.forEach(({ key, source }) => {
    const v = overrides[key];
    if (v === undefined || v === '') return;
    if (source === 'duty') dutyRates[key] = v;
    else editableCharges[key] = v;
  });
  editableCharges.ExtraChargesType =
    overrides.ExtraChargesType ?? editableCharges.ExtraChargesType ?? 'percentage';
  return { ...data, editableCharges, dutyRates };
};

export default function SingleStonePricing({
  visible,
  onClose,
  onDone,
  catData,
  metalKt,
  onRecalculated,
  onPreviewSummary,
  onClientPreview,
  onRequestRecalculate,
  isRecalculating = false,
}) {
  const [localGrouped, setLocalGrouped] = useState({});
  const [localCharges, setLocalCharges] = useState({});
  const [commonMetal, setCommonMetal] = useState({ Weight: '', Rate: '', Ounce: '' });
  const metalTouchedRef = useRef(false);

  const [inlineEditIndex, setInlineEditIndex] = useState(null);
  const [inlineEditPrice, setInlineEditPrice] = useState('');
  const [editedPrices, setEditedPrices] = useState({});
  const inlinePriceRef = useRef(null);
  const selfDismissRef = useRef(false);

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const localChargesRef = useRef(localCharges);
  const localGroupedRef = useRef(localGrouped);
  const onRecalculatedRef = useRef(onRecalculated);
  useEffect(() => { localChargesRef.current = localCharges; }, [localCharges]);
  useEffect(() => { localGroupedRef.current = localGrouped; }, [localGrouped]);
  useEffect(() => { onRecalculatedRef.current = onRecalculated; }, [onRecalculated]);

  useEffect(() => {
    if (!visible) return;
    setLocalCharges({});
    setEditedPrices({});
    setInlineEditIndex(null);
    setInlineEditPrice('');
    metalTouchedRef.current = false;
  }, [visible]);

  useEffect(() => {
    if (!visible || !catData) return;
    const grouped = {};
    (catData.types || []).forEach(type => {
      if (catData.byType?.[type]) grouped[type] = catData.byType[type];
    });
    setLocalGrouped(grouped);
    // Seed the common Metal Weight & Rate from the first type (same idea as PricingCalculator)
    if (metalTouchedRef.current) return;
    const firstType = Object.keys(grouped)[0];
    const m = firstType ? grouped[firstType]?.editableMetal : null;
    const r = firstType ? grouped[firstType]?.pricingResult : null;
    setCommonMetal({
      Weight: m?.Weight != null && m.Weight !== '' ? String(m.Weight) : '',
      Rate: m?.Rate != null && m.Rate !== '' ? String(m.Rate) : '',
      Ounce: m?.Ounce != null ? String(m.Ounce) : r?.GoldRatePerOunce ? String(r.GoldRatePerOunce) : '',
    });
  }, [visible, catData]);

  useEffect(() => {
    if (Object.keys(editedPrices).length === 0) return;
    const grouped = localGroupedRef.current;
    const updated = {};
    Object.keys(grouped).forEach(type => {
      const data = grouped[type];
      if (!data) return;
      let touched = false;
      const mergedStones = (data.editableStones || []).map((s, i) => {
        const v = editedPrices[`${type}_${i}`];
        if (v === undefined || num(v) === num(s.Price)) return s;
        touched = true;
        return { ...s, Price: num(v) };
      });
      if (touched) updated[type] = { ...data, editableStones: mergedStones };
    });
    const types = Object.keys(updated);
    if (types.length === 0) return;
    setLocalGrouped(prev => ({ ...prev, ...updated }));
    types.forEach(type => onRecalculatedRef.current?.(type, updated[type]));
  }, [editedPrices]);

  const getEffectivePrice = useCallback((type, index) => {
    const key = `${type}_${index}`;
    if (editedPrices[key] !== undefined) return num(editedPrices[key]);
    const data = localGrouped[type];
    return num(data?.editableStones?.[index]?.Price);
  }, [editedPrices, localGrouped]);

  const getTypeMissingIndices = useCallback((type) => {
    const stones = localGrouped[type]?.editableStones;
    if (!Array.isArray(stones)) return new Set();
    const missing = new Set();
    stones.forEach((s, i) => { if (getEffectivePrice(type, i) <= 0) missing.add(i); });
    return missing;
  }, [localGrouped, getEffectivePrice]);

  const hasAnyMissing = useMemo(
    () => Object.keys(localGrouped).some(type => getTypeMissingIndices(type).size > 0),
    [localGrouped, getTypeMissingIndices],
  );

  useEffect(() => {
    if (hasAnyMissing) {
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
  }, [hasAnyMissing, shakeAnim, scaleAnim]);

  const startInlineEdit = useCallback((type, index, stone) => {
    const key = `${type}_${index}`;
    setInlineEditIndex(key);
    const local = editedPrices[key];
    setInlineEditPrice(local !== undefined ? String(local) : (num(stone.Price) > 0 ? String(stone.Price) : ''));
  }, [editedPrices]);

  useEffect(() => {
    if (inlineEditIndex === null) return;
    selfDismissRef.current = true;
    Keyboard.dismiss();
    const id = setTimeout(() => inlinePriceRef.current?.focus(), 150);
    return () => clearTimeout(id);
  }, [inlineEditIndex]);

  const saveInlineEdit = useCallback(() => {
    if (inlineEditIndex === null) return;
    const editType = inlineEditIndex.slice(0, inlineEditIndex.lastIndexOf('_'));

    const next = { ...editedPrices, [inlineEditIndex]: inlineEditPrice };
    setEditedPrices(next);

    const priceAt = (type, i, stone) => {
      const v = next[`${type}_${i}`];
      return v !== undefined ? num(v) : num(stone?.Price);
    };

    const stones = localGrouped[editType]?.editableStones || [];
    const nextMissing = stones.findIndex((st, i) => priceAt(editType, i, st) <= 0);
    if (nextMissing !== -1) {
      const nextKey = `${editType}_${nextMissing}`;
      const stone = stones[nextMissing];
      setTimeout(() => {
        setInlineEditIndex(nextKey);
        setInlineEditPrice(
          next[nextKey] !== undefined ? String(next[nextKey])
            : num(stone?.Price) > 0 ? String(stone.Price) : ''
        );
      }, 100);
      return;
    }

    setInlineEditIndex(null);
    setInlineEditPrice('');

    const allFilled = Object.keys(localGrouped).every(type =>
      (localGrouped[type]?.editableStones || []).every((st, i) => priceAt(type, i, st) > 0)
    );
    if (!allFilled) return;
    if (onDone) {
      metalTouchedRef.current = false;
      setTimeout(onDone, 200);
    } else if (onClose) {
      setTimeout(onClose, 200);
    }
  }, [inlineEditIndex, inlineEditPrice, editedPrices, localGrouped, onDone, onClose]);

  useEffect(() => {
    if (hasAnyMissing && inlineEditIndex === null) {
      for (const type of Object.keys(localGrouped)) {
        const missing = getTypeMissingIndices(type);
        if (missing.size > 0) {
          const first = [...missing][0];
          startInlineEdit(type, first, localGrouped[type]?.editableStones?.[first]);
          break;
        }
      }
    }
  }, [hasAnyMissing, inlineEditIndex, localGrouped, getTypeMissingIndices, startInlineEdit]);

  const onRequestRecalculateRef = useRef(onRequestRecalculate);
  useEffect(() => { onRequestRecalculateRef.current = onRequestRecalculate; }, [onRequestRecalculate]);

  const requestRecalculate = useCallback(() => {
    metalTouchedRef.current = false;
    onRequestRecalculateRef.current?.();
  }, []);

  const updateLocalCharge = useCallback((type, field, value) => {
    setLocalCharges(prev => ({
      ...prev,
      [type]: { ...(prev[type] || {}), [field]: value },
    }));
    // The extra-charges type is toggled with a button (no keyboard blur to trigger the
    // keyboardDidHide recalc), so kick off a recalculation once the parent charge state syncs.
    if (field === 'ExtraChargesType') {
      setTimeout(() => requestRecalculate(), 0);
    }
  }, [requestRecalculate]);

  // Common Metal Weight & Rate — one value applied to every stone type (same as PricingCalculator).
  const updateCommonMetal = useCallback((field, value) => {
    metalTouchedRef.current = true;
    setCommonMetal(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'Rate' && parseFloat(value) > 0) next.Ounce = '';
      if (field === 'Ounce' && parseFloat(value) > 0) next.Rate = '';
      return next;
    });
  }, []);

  // Push metal changes to the parent on every edit (recalc happens on keyboard dismiss).
  useEffect(() => {
    if (!metalTouchedRef.current || !onRecalculatedRef.current) return;
    const grouped = localGroupedRef.current;
    const updated = {};
    Object.keys(grouped).forEach(type => {
      if (!grouped[type]) return;
      updated[type] = {
        ...grouped[type],
        editableMetal: { ...grouped[type].editableMetal, ...commonMetal },
      };
    });
    setLocalGrouped(prev => ({ ...prev, ...updated }));
    Object.keys(updated).forEach(type => onRecalculatedRef.current(type, updated[type]));
  }, [commonMetal]);

  // Push charge changes to parent on every edit (local state sync)
  useEffect(() => {
    if (!onRecalculatedRef.current) return;
    const types = Object.keys(localCharges);
    if (types.length === 0) return;
    types.forEach(type => {
      const data = localGroupedRef.current[type];
      if (!data) return;
      onRecalculatedRef.current(type, applyChargeOverrides(data, localCharges[type]));
    });
  }, [localCharges]);

  useEffect(() => {
    if (!visible || !metalTouchedRef.current) return;
    const timer = setTimeout(() => requestRecalculate(), 900);
    return () => clearTimeout(timer);
  }, [visible, commonMetal.Weight, commonMetal.Rate, commonMetal.Ounce, requestRecalculate]);

  // Trigger recalculation when keyboard closes after editing duties
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      if (selfDismissRef.current) {
        selfDismissRef.current = false;
        return;
      }
      const charges = localChargesRef.current;
      // Recalculate when charges or the common metal weight/rate changed.
      if (Object.keys(charges).length === 0 && !metalTouchedRef.current) return;
      requestRecalculate();
    });
    return () => subscription?.remove();
  }, [requestRecalculate]);

  const getApplicableFields = useCallback((type) => {
    const applicable = (catData?.byType?.[type]?.pricingResult ?? localGrouped[type]?.pricingResult)?.Applicable;
    return CHARGE_FIELDS.filter(f => {
      if (f.key === 'SilverAndLabsDuties' && metalKt?.includes('Silver')) return true;
      if (!f.applicableKey) return true;
      if (!applicable) return true;
      return applicable[f.applicableKey] === true;
    });
  }, [catData, localGrouped, metalKt]);

  const renderChargesSection = (type) => {
    const fields = getApplicableFields(type);
    const ch = localCharges[type] || {};

    return (
      <View style={s.chargesSection}>
        <Text style={s.chargesTitle}>Charges & Duties</Text>
        <View style={s.chargesGrid}>
          {fields.map(field => {
            const rawValue = ch[field.key];
            const placeholder = localGrouped[type]?.editableCharges?.[field.key]
              ?? localGrouped[type]?.dutyRates?.[field.key]
              ?? '0';
            const label = chargeLabel(field, type, metalKt);

            if (field.key === 'ExtraCharges') {
              const ecType = ch.ExtraChargesType
                ?? localGrouped[type]?.editableCharges?.ExtraChargesType
                ?? 'percentage';
              return (
                <View key={field.key} style={s.chargeField}>
                  <Text style={s.chargeLabel}>{label}</Text>
                  <View style={s.extraChargeRow}>
                    <View style={[s.chargeInputWrap, { flex: 1 }]}>
                      <TextInput
                        style={s.chargeInput}
                        value={rawValue !== undefined ? String(rawValue) : ''}
                        onChangeText={(v) => updateLocalCharge(type, field.key, v)}
                        keyboardType="decimal-pad"
                        placeholder={String(placeholder)}
                        placeholderTextColor={colors.textLight}
                      />
                      <Text style={s.chargeSuffix}>{extraChargesSuffix(ecType)}</Text>
                    </View>
                    <View style={s.ecToggle}>
                      <TouchableOpacity
                        style={[s.ecToggleBtn, ecType === 'percentage' && s.ecToggleBtnActive]}
                        onPress={() => updateLocalCharge(type, 'ExtraChargesType', 'percentage')}
                      >
                        <Text style={[s.ecToggleText, ecType === 'percentage' && s.ecToggleTextActive]}>%</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.ecToggleBtn, ecType === 'fixed' && s.ecToggleBtnActive]}
                        onPress={() => updateLocalCharge(type, 'ExtraChargesType', 'fixed')}
                      >
                        <Text style={[s.ecToggleText, ecType === 'fixed' && s.ecToggleTextActive]}>$</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            }

            return (
              <View key={field.key} style={s.chargeField}>
                <Text style={s.chargeLabel}>{label}</Text>
                <View style={s.chargeInputWrap}>
                  <TextInput
                    style={s.chargeInput}
                    value={rawValue !== undefined ? String(rawValue) : ''}
                    onChangeText={(v) => updateLocalCharge(type, field.key, v)}
                    keyboardType="decimal-pad"
                    placeholder={String(placeholder)}
                    placeholderTextColor={colors.textLight}
                  />
                  <Text style={s.chargeSuffix}>{field.suffix}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const renderTypeSection = (type) => {
    const data = localGrouped[type];
    if (!data) return null;

    const stones = data.editableStones || [];
    const missing = getTypeMissingIndices(type);
    const hasMissing = missing.size > 0;
    const result = catData?.byType?.[type]?.pricingResult ?? data.pricingResult;

    if (hasMissing) {
      const missingStones = stones
        .map((s, i) => ({ s, i }))
        .filter(({ i }) => missing.has(i));

      return (
        <View key={type} style={s.typeSection}>
          <View style={s.typeSectionHeader}>
            <Icon name="diamond" size={18} color={colors.primary} />
            <Text style={s.typeSectionTitle}>{type}</Text>
            <View style={s.missingBadge}>
              <Icon name="warning" size={12} color={colors.error} />
              <Text style={s.missingBadgeText}>{missing.size} missing</Text>
            </View>
          </View>
          <View style={s.stoneTable}>
            <View style={s.stoneTableHeader}>
              <Text style={[s.stoneCol, s.stoneTh]}>MM</Text>
              <Text style={[s.stoneCol, s.stoneTh]}>Shape</Text>
              <Text style={[s.stoneCol, s.stoneTh]}>Avg Wt</Text>
              <Text style={[s.stoneCol, s.stoneTh]}>Ct wt</Text>
              <Text style={[s.stoneCol, s.stoneTh]}>Pcs</Text>
              <Text style={[s.stoneCol, s.stoneTh]}>$/Ct</Text>
              <View style={s.stoneCol} />
            </View>
            {missingStones.map(({ s: stone, i }, rowIdx) => {
              const effectivePrice = getEffectivePrice(type, i);
              const isEdited = editedPrices[`${type}_${i}`] !== undefined && effectivePrice > 0;
              const isEditing = inlineEditIndex === `${type}_${i}`;
              return (
                <Animated.View
                  key={i}
                  style={[
                    s.stoneRow,
                    rowIdx % 2 === 1 && s.stoneRowAlt,
                    !isEdited && s.stoneRowMissing,
                    !isEdited && { transform: [{ translateX: shakeAnim }, { scale: scaleAnim }] },
                  ]}
                >

                  <Text style={[s.stoneCol, s.stoneTd]}>
                    {stone.MmSize || '—'}
                  </Text>
                  <Text style={[s.stoneCol, s.stoneTd]} numberOfLines={1}>
                    {stone.Shape || '—'}
                  </Text>
                  <Text style={[s.stoneCol, s.stoneTd]}>
                    {stone.Weight || '—'}
                  </Text>
                  <Text style={[s.stoneCol, s.stoneTd]}>
                    {stone.CtWeight || '—'}
                  </Text>
                  <Text style={[s.stoneCol, s.stoneTd]}>
                    {stone.Pcs || '—'}
                  </Text>

                  {isEditing ? (
                    <TextInput
                      ref={inlinePriceRef}
                      style={[s.stoneCol, s.inlinePriceInput]}
                      value={inlineEditPrice}
                      onChangeText={setInlineEditPrice}
                      keyboardType="decimal-pad"
                      placeholder="$/Ct"
                      placeholderTextColor={colors.textLight}
                      onSubmitEditing={saveInlineEdit}
                      returnKeyType="done"
                    />
                  ) : (
                    <Text
                      style={[
                        s.stoneCol, s.stoneTd,
                        !isEdited && s.stonePriceMissing,
                      ]}
                    >
                      {effectivePrice > 0 ? `$${effectivePrice}` : '—'}
                    </Text>
                  )}

                  <View style={s.stoneCol} />
                  </Animated.View>
              );
            })}
          </View>

          {renderChargesSection(type)}
        </View>
      );
    }

    const hasResult = !!result && num(result.TotalPrice) > 0;
    const isPending = isRecalculating || !hasResult;
    const money = v => (isPending ? '—' : `$${num(v)}`);

    return (
      <View key={type} style={s.typeSection}>
        <View style={s.typeSectionHeader}>
          <Icon name="diamond" size={18} color={colors.primary} />
          <Text style={s.typeSectionTitle}>{type}</Text>
          {isPending ? (
            <View style={s.pendingBadge}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
              <Text style={s.pendingBadgeText}>Calculating</Text>
            </View>
          ) : (
            <View style={s.successBadge}>
              <Icon name="check-circle" size={12} color={colors.success} />
              <Text style={s.successBadgeText}>Calculated</Text>
            </View>
          )}
        </View>

        <View style={[s.typeCard, isRecalculating && s.typeCardCalculating]}>
          <View style={s.typeCardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.typeCardName}>{type}</Text>
              <Text style={s.typeCardStats}>
                {stones.length} stone lines • {result?.TotalPieces ?? 0} pcs • {result?.DiamondWeight ?? 0} ct
              </Text>
            </View>
            {isRecalculating && <ActivityIndicator size="small" color={colors.primary} />}
          </View>
          <View style={s.typeCardBody}>
            <View style={s.typeCardRow}>
              <Text style={s.typeCardLabel}>Metal Price</Text>
              <Text style={s.typeCardValue}>{money(result?.MetalPrice)}</Text>
            </View>
            <View style={s.typeCardRow}>
              <Text style={s.typeCardLabel}>Diamonds</Text>
              <Text style={s.typeCardValue}>{money(result?.DiamondsPrice)}</Text>
            </View>
            <View style={s.typeCardRow}>
              <Text style={s.typeCardLabel}>Labour & Duties</Text>
              <Text style={s.typeCardValue}>{money(result?.DutiesAmount)}</Text>
            </View>
            <View style={[s.typeCardRow, { borderBottomWidth: 0 }]}>
              <Text style={s.typeCardLabelTotal}>Total Price</Text>
              <Text style={s.typeCardValueTotal}>{money(result?.TotalPrice)}</Text>
            </View>
          </View>
        </View>

        {renderChargesSection(type)}
      </View>
    );
  };

  if (!visible || !catData) return null;

  const types = catData.types || [];
  const categoryLabel = catData.label || '';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle} numberOfLines={1}>
                {categoryLabel} Pricing
              </Text>
              <Text style={s.headerSub} numberOfLines={1}>
                {types.length} type(s): {types.join(', ')}
              </Text>
            </View>
            <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <Icon name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.scrollBody}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Common Metal Weight & Rate — kept at the top, applies to all types */}
            <View style={s.chargesSection}>
              <Text style={s.chargesTitle}>Metal Weight & Rate</Text>
              <View style={s.chargesGrid}>
                <View style={s.chargeField}>
                  <Text style={s.chargeLabel}>Weight (g)</Text>
                  <View style={s.chargeInputWrap}>
                    <TextInput
                      style={s.chargeInput}
                      value={String(commonMetal.Weight || '')}
                      onChangeText={(v) => updateCommonMetal('Weight', v)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textLight}
                    />
                    <Text style={s.chargeSuffix}>g</Text>
                  </View>
                </View>
                <View style={s.chargeField}>
                  <Text style={s.chargeLabel}>{getMetalRateLabel(metalKt)}</Text>
                  <View style={s.chargeInputWrap}>
                    <TextInput
                      style={s.chargeInput}
                      value={String(commonMetal.Rate || '')}
                      onChangeText={(v) => updateCommonMetal('Rate', v)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textLight}
                    />
                    <Text style={s.chargeSuffix}>$/g</Text>
                  </View>
                </View>
                <View style={s.chargeField}>
                  <Text style={s.chargeLabel}>Per Ounce ($)</Text>
                  <View style={s.chargeInputWrap}>
                    <TextInput
                      style={s.chargeInput}
                      value={String(commonMetal.Ounce ?? '')}
                      onChangeText={(v) => updateCommonMetal('Ounce', v)}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textLight}
                    />
                    <Text style={s.chargeSuffix}>$/oz</Text>
                  </View>
                </View>
              </View>
            </View>

            {hasAnyMissing && (
              <View style={s.globalWarningBanner}>
                <Icon name="warning" size={15} color={colors.secondary} />
                <Text style={s.globalWarningText}>
                  Some stone prices are missing. Fill them below to calculate.
                </Text>
              </View>
            )}

            {types.map(type => renderTypeSection(type))}

            {!hasAnyMissing && (
              <TouchableOpacity
                style={[s.recalcAllBtn, isRecalculating && s.recalcAllBtnDisabled]}
                onPress={requestRecalculate}
                disabled={isRecalculating}
                activeOpacity={0.85}
              >
                {isRecalculating ? (
                  <ActivityIndicator size="small" color={colors.textWhite} />
                ) : (
                  <Icon name="refresh" size={18} color={colors.textWhite} />
                )}
                <Text style={s.recalcAllBtnText}>
                  {isRecalculating ? 'Recalculating...' : 'Recalculate All'}
                </Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 80 }} />
          </ScrollView>

          <View style={s.bottomBar}>
            <TouchableOpacity
              style={s.clientPreviewBtn}
              onPress={onClientPreview}
              activeOpacity={0.85}
            >
              <Icon name="visibility" size={18} color="#fff" />
              <Text style={s.clientPreviewBtnText}>Client Preview</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.adminPreviewBtn}
              onPress={onPreviewSummary}
              activeOpacity={0.85}
            >
              <Icon name="visibility" size={16} color="#fff" />
              <Text style={s.adminPreviewBtnText}>Admin Preview</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '90%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.primary,
  },
  headerTitle: { fontFamily: fonts.bold, fontSize: fonts.base || 15, color: '#fff' },
  headerSub: { fontFamily: fonts.regular, fontSize: fonts.xs || 11, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  closeBtn: { padding: 4 },

  scrollBody: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 100 },

  globalWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.warning + '20',
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  globalWarningText: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: colors.secondary,
    lineHeight: 20,
  },

  typeSection: {
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || '#F0F0F0',
  },
  typeSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  typeSectionTitle: {
    fontFamily: fonts.bold,
    fontSize: fonts.base || 15,
    color: colors.textPrimary,
    flex: 1,
  },
  missingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.error + '15',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  missingBadgeText: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: colors.error,
  },
  successBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.success + '15',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  successBadgeText: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: colors.success,
  },

  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.backgroundSecondary || '#F8F9FB',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pendingBadgeText: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
  },

  stoneTable: {
    borderWidth: 1,
    borderColor: colors.borderLight || '#E8E8E8',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 12,
    backgroundColor: colors.white,
  },
  stoneTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  stoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight || '#F0F0F0',
  },
  stoneRowAlt: { backgroundColor: colors.backgroundSecondary || '#F8F8F8' },
  stoneRowMissing: { borderWidth: 1.5, borderColor: colors.error, backgroundColor: colors.error + '10' },

  stoneCol: { textAlign: 'center', position: 'relative' },

  stoneTh: { fontFamily: fonts.bold, fontSize: 11, color: '#fff' },
  stoneTd: { fontFamily: fonts.regular, fontSize: 12, color: colors.textPrimary },
  stonePriceMissing: { color: colors.error, fontWeight: 'bold' },

  inlinePriceInput: {
    borderWidth: 1.5,
    borderColor: colors.error,
    borderRadius: 8,
    backgroundColor: colors.error + '10',
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  chargesSection: {
    marginTop: 4,
    marginBottom: 8,
  },
  chargesTitle: {
    fontFamily: fonts.bold,
    fontSize: fonts.xs || 12,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.05,
    marginBottom: 8,
  },
  chargesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chargeField: {
    width: '48%',
    marginBottom: 4,
  },
  chargeLabel: {
    fontFamily: fonts.medium,
    fontSize: fonts.xs || 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  chargeInputWrap: {
    position: 'relative',
  },
  chargeInput: {
    backgroundColor: colors.backgroundSecondary || '#F8F9FB',
    borderWidth: 1,
    borderColor: colors.border || '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: fonts.sm || 14,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    paddingRight: 36,
  },
  chargeSuffix: {
    position: 'absolute',
    right: 10,
    top: 10,
    fontSize: fonts.xs || 12,
    color: colors.textSecondary,
    fontFamily: fonts.medium,
  },
  extraChargeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ecToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border || '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
  },
  ecToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.backgroundSecondary || '#F8F9FB',
  },
  ecToggleBtnActive: {
    backgroundColor: colors.primary,
  },
  ecToggleText: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 14,
    color: colors.textPrimary,
  },
  ecToggleTextActive: {
    color: '#fff',
  },

  typeCard: {
    backgroundColor: colors.primaryExtraLight || '#E6F0F1',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.borderLight || '#F0F0F0',
    ...(Platform.OS === 'ios'
      ? {
          overflow: 'visible',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
        }
      : null),
  },
  typeCardHeader: {
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeCardName: {
    fontFamily: fonts.bold,
    fontSize: fonts.base || 15,
    color: colors.primary,
  },
  typeCardStats: {
    fontFamily: fonts.regular,
    fontSize: fonts.sm || 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  typeCardBody: {
    padding: 12,
    paddingTop: 0,
    backgroundColor: colors.background,
  },
  typeCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || '#F0F0F0',
  },
  typeCardLabel: {
    fontFamily: fonts.regular,
    fontSize: fonts.sm || 13,
    color: colors.textSecondary,
  },
  typeCardValue: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: colors.primary,
  },
  typeCardCalculating: {
    backgroundColor: colors.backgroundSecondary || '#F8F9FB',
  },
  typeCardLabelTotal: {
    fontFamily: fonts.bold,
    fontSize: fonts.base || 15,
    color: colors.textPrimary,
  },
  typeCardValueTotal: {
    fontFamily: fonts.bold,
    fontSize: fonts.base || 15,
    color: colors.primary,
  },

  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border || '#E5E7EB',
    padding: 16,
    flexDirection: 'column',
    gap: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
  },
  clientPreviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
  },
  clientPreviewBtnText: {
    fontFamily: fonts.bold,
    fontSize: fonts.base || 15,
    color: '#fff',
  },
  adminPreviewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingVertical: 14,
  },
  adminPreviewBtnText: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 14,
    color: '#fff',
  },
  recalcAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 8,
  },
  recalcAllBtnDisabled: {
    opacity: 0.6,
  },
  recalcAllBtnText: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 14,
    color: '#fff',
  },
});
