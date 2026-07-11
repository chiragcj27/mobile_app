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
} from 'react-native';
import Icon from '../../components/common/Icon';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { splitGroupedDataForRecalc } from '../../utils/stoneDataGrouper';

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

const CHARGE_FIELDS = [
  { key: 'Loss', label: 'Loss', suffix: '%', source: 'charges' },
  { key: 'Labour', label: 'Labour', suffix: '/g', source: 'charges' },
  { key: 'ExtraCharges', label: 'Extra', suffix: '%', source: 'charges' },
  { key: 'GoldDuties', label: 'Gold Duty', suffix: '%', source: 'charges', applicableKey: 'GoldDuties' },
  { key: 'LabDuties', label: 'Lab Duty', suffix: '%', source: 'duty', applicableKey: 'LabDuties' },
  { key: 'NaturalDuties', label: 'Natural Duty', suffix: '%', source: 'duty', applicableKey: 'NaturalDuties' },
  { key: 'SilverAndLabsDuties', label: 'Silver+Lab Duty', suffix: '%', source: 'charges', applicableKey: 'SilverAndLabsDuties' },
  { key: 'LossAndLabourDuties', label: 'Loss+Lab Duty', suffix: '%', source: 'charges', applicableKey: 'LossAndLabourDuties' },
];

export default function SingleStonePricing({
  visible,
  onClose,
  onDone,
  catData,
  clientId,
  metalKt,
  selectedClient,
  onRecalculated,
  onModifyPricing,
  onPreviewSummary,
  onRequestRecalculate,
}) {
  const [localGrouped, setLocalGrouped] = useState({});
  const [localCharges, setLocalCharges] = useState({});
  const [isCalculating, setIsCalculating] = useState(false);

  const [inlineEditIndex, setInlineEditIndex] = useState(null);
  const [inlineEditPrice, setInlineEditPrice] = useState('');
  const [editedPrices, setEditedPrices] = useState({});
  const inlinePriceRef = useRef(null);

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const editedPricesRef = useRef(editedPrices);
  const localChargesRef = useRef(localCharges);
  const localGroupedRef = useRef(localGrouped);
  const onRecalculatedRef = useRef(onRecalculated);
  useEffect(() => { editedPricesRef.current = editedPrices; }, [editedPrices]);
  useEffect(() => { localChargesRef.current = localCharges; }, [localCharges]);
  useEffect(() => { localGroupedRef.current = localGrouped; }, [localGrouped]);
  useEffect(() => { onRecalculatedRef.current = onRecalculated; }, [onRecalculated]);

  // Detect when parent finishes recalculation (catData prop updates)
  useEffect(() => {
    if (isCalculating) setIsCalculating(false);
  }, [catData]);

  useEffect(() => {
    if (visible && catData) {
      const entries = splitGroupedDataForRecalc({ dummy: catData });
      const grouped = {};
      entries.forEach(({ type, data }) => {
        grouped[type] = data;
      });
      setLocalGrouped(grouped);
      setLocalCharges({});
      setEditedPrices({});
      setInlineEditIndex(null);
      setInlineEditPrice('');
    }

    return () => {
      if (!visible || !onRecalculatedRef.current) return;
      const grouped = localGroupedRef.current;
      const prices = editedPricesRef.current;
      const charges = localChargesRef.current;
      Object.keys(grouped).forEach(type => {
        const data = grouped[type];
        if (!data) return;
        const mergedStones = (data.editableStones || []).map((s, i) => {
          const key = `${type}_${i}`;
          return prices[key] !== undefined ? { ...s, Price: num(prices[key]) } : s;
        });
        const ch = charges[type] || {};
        const mergedData = {
          ...data,
          editableStones: mergedStones,
          editableCharges: {
            ...data.editableCharges,
            Loss: ch.Loss !== undefined && ch.Loss !== '' ? ch.Loss : data.editableCharges?.Loss,
            Labour: ch.Labour !== undefined && ch.Labour !== '' ? ch.Labour : data.editableCharges?.Labour,
            ExtraCharges: ch.ExtraCharges !== undefined && ch.ExtraCharges !== '' ? ch.ExtraCharges : data.editableCharges?.ExtraCharges,
            GoldDuties: ch.GoldDuties !== undefined && ch.GoldDuties !== '' ? ch.GoldDuties : data.editableCharges?.GoldDuties,
            SilverAndLabsDuties: ch.SilverAndLabsDuties !== undefined && ch.SilverAndLabsDuties !== '' ? ch.SilverAndLabsDuties : data.editableCharges?.SilverAndLabsDuties,
            LossAndLabourDuties: ch.LossAndLabourDuties !== undefined && ch.LossAndLabourDuties !== '' ? ch.LossAndLabourDuties : data.editableCharges?.LossAndLabourDuties,
          },
          dutyRates: {
            ...data.dutyRates,
            LabDuties: ch.LabDuties !== undefined && ch.LabDuties !== '' ? ch.LabDuties : data.dutyRates?.LabDuties,
            NaturalDuties: ch.NaturalDuties !== undefined && ch.NaturalDuties !== '' ? ch.NaturalDuties : data.dutyRates?.NaturalDuties,
          },
        };
        onRecalculatedRef.current(type, mergedData);
      });
    };
  }, [visible, catData]);

  const getEffectivePrice = useCallback((type, index) => {
    const key = `${type}_${index}`;
    if (editedPrices[key] !== undefined) return num(editedPrices[key]);
    const data = localGrouped[type];
    return num(data?.editableStones?.[index]?.Price);
  }, [editedPrices, localGrouped]);

  const getTypeMissingIndices = useCallback((type) => {
    const data = localGrouped[type];
    if (!data || !Array.isArray(data.editableStones)) return new Set();
    return new Set(
      data.editableStones.reduce((acc, s, i) => {
        if (getEffectivePrice(type, i) <= 0) acc.push(i);
        return acc;
      }, [])
    );
  }, [localGrouped, getEffectivePrice]);

  const hasAnyMissing = useMemo(() => {
    return Object.keys(localGrouped).some(type => {
      const missing = getTypeMissingIndices(type);
      return missing.size > 0;
    });
  }, [localGrouped, getTypeMissingIndices]);

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
    if (inlineEditIndex !== null && inlinePriceRef.current) {
      Keyboard.dismiss();
      requestAnimationFrame(() => {
        setTimeout(() => {
          inlinePriceRef.current?.focus();
        }, 150);
      });
    }
  }, [inlineEditIndex]);

  const saveInlineEdit = useCallback(() => {
    if (inlineEditIndex === null) return;
    const [editType] = inlineEditIndex.split('_');

    setEditedPrices(prev => {
      const next = { ...prev, [inlineEditIndex]: inlineEditPrice };
      const missing = getTypeMissingIndices(editType);
      const stillMissing = [...missing].filter(i => {
        const key = `${editType}_${i}`;
        const ep = next[key] !== undefined ? num(next[key]) : num(localGrouped[editType]?.editableStones?.[i]?.Price);
        return ep <= 0;
      });
      if (stillMissing.length > 0) {
        const nextIdx = stillMissing[0];
        const nextKey = `${editType}_${nextIdx}`;
        setTimeout(() => {
          setInlineEditIndex(nextKey);
          const nd = localGrouped[editType]?.editableStones?.[nextIdx];
          setInlineEditPrice(next[nextKey] !== undefined ? String(next[nextKey]) : (num(nd?.Price) > 0 ? String(nd.Price) : ''));
        }, 100);
      } else {
        setInlineEditIndex(null);
        setInlineEditPrice('');
        const allFilled = Object.keys(localGrouped).every(type => {
          const data = localGrouped[type];
          if (!data || !Array.isArray(data.editableStones) || data.editableStones.length === 0) return true;
          return data.editableStones.every((s, i) => {
            const key = `${type}_${i}`;
            return (next[key] !== undefined ? num(next[key]) : num(s.Price)) > 0;
          });
        });
        if (allFilled && onDone) {
          setTimeout(() => onDone(), 200);
        } else if (allFilled && onClose) {
          setTimeout(() => onClose(), 200);
        }
      }
      return next;
    });
  }, [inlineEditIndex, inlineEditPrice, localGrouped, getTypeMissingIndices, onDone, onClose]);

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

  const updateLocalCharge = useCallback((type, field, value) => {
    setLocalCharges(prev => ({
      ...prev,
      [type]: { ...(prev[type] || {}), [field]: value },
    }));
  }, []);

  // Push charge changes to parent on every edit (local state sync)
  useEffect(() => {
    if (!onRecalculatedRef.current) return;
    const types = Object.keys(localCharges);
    if (types.length === 0) return;
    types.forEach(type => {
      const data = localGroupedRef.current[type];
      if (!data) return;
      const ch = localCharges[type] || {};
      const mergedData = {
        ...data,
        editableCharges: {
          ...data.editableCharges,
          Loss: ch.Loss !== undefined && ch.Loss !== '' ? ch.Loss : data.editableCharges?.Loss,
          Labour: ch.Labour !== undefined && ch.Labour !== '' ? ch.Labour : data.editableCharges?.Labour,
          ExtraCharges: ch.ExtraCharges !== undefined && ch.ExtraCharges !== '' ? ch.ExtraCharges : data.editableCharges?.ExtraCharges,
          GoldDuties: ch.GoldDuties !== undefined && ch.GoldDuties !== '' ? ch.GoldDuties : data.editableCharges?.GoldDuties,
          SilverAndLabsDuties: ch.SilverAndLabsDuties !== undefined && ch.SilverAndLabsDuties !== '' ? ch.SilverAndLabsDuties : data.editableCharges?.SilverAndLabsDuties,
          LossAndLabourDuties: ch.LossAndLabourDuties !== undefined && ch.LossAndLabourDuties !== '' ? ch.LossAndLabourDuties : data.editableCharges?.LossAndLabourDuties,
        },
        dutyRates: {
          ...data.dutyRates,
          LabDuties: ch.LabDuties !== undefined && ch.LabDuties !== '' ? ch.LabDuties : data.dutyRates?.LabDuties,
          NaturalDuties: ch.NaturalDuties !== undefined && ch.NaturalDuties !== '' ? ch.NaturalDuties : data.dutyRates?.NaturalDuties,
        },
      };
      onRecalculatedRef.current(type, mergedData);
    });
  }, [localCharges]);

  // Trigger recalculation when keyboard closes after editing duties
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      const charges = localChargesRef.current;
      if (Object.keys(charges).length === 0) return;
      setIsCalculating(true);
      onRequestRecalculateRef.current?.();
    });
    return () => subscription?.remove();
  }, []);

  const getApplicableFields = useCallback((type) => {
    const applicable = localGrouped[type]?.pricingResult?.Applicable;
    return CHARGE_FIELDS.filter(f => {
      if (!f.applicableKey) return true;
      if (!applicable) return true;
      return applicable[f.applicableKey] === true;
    });
  }, [localGrouped]);

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
            return (
              <View key={field.key} style={s.chargeField}>
                <Text style={s.chargeLabel}>{field.label}</Text>
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
    const result = data.pricingResult;

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
              <Text style={[s.stoneCol, s.stoneColType, s.stoneTh]}>Type</Text>
              <Text style={[s.stoneCol, s.stoneColShape, s.stoneTh]}>Shape</Text>
              <Text style={[s.stoneCol, s.stoneColNum, s.stoneTh]}>Ct</Text>
              <Text style={[s.stoneCol, s.stoneColNum, s.stoneTh]}>Pcs</Text>
              <Text style={[s.stoneCol, s.stoneColPrice, s.stoneTh]}>$/Ct</Text>
              <View style={s.stoneColActions} />
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
                  <Text style={[s.stoneCol, s.stoneColType, s.stoneTd]} numberOfLines={1}>
                    {stone.Type || '—'}
                  </Text>
                  <Text style={[s.stoneCol, s.stoneColShape, s.stoneTd]} numberOfLines={1}>
                    {stone.Shape || '—'}
                  </Text>
                  <Text style={[s.stoneCol, s.stoneColNum, s.stoneTd]}>
                    {num(stone.CtWeight).toFixed(2)}
                  </Text>
                  <Text style={[s.stoneCol, s.stoneColNum, s.stoneTd]}>
                    {num(stone.Pcs)}
                  </Text>

                  {isEditing ? (
                    <TextInput
                      ref={inlinePriceRef}
                      style={[s.stoneCol, s.stoneColPrice, s.inlinePriceInput]}
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
                        s.stoneCol, s.stoneColPrice, s.stoneTd,
                        !isEdited && s.stonePriceMissing,
                      ]}
                    >
                      {effectivePrice > 0 ? `$${effectivePrice.toFixed(2)}` : '—'}
                    </Text>
                  )}

                  <View style={s.stoneColActions}>
                    {!isEdited && (
                      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
                        <Icon name="warning" size={16} color={colors.error} />
                      </Animated.View>
                    )}
                    {!isEditing && (
                      <TouchableOpacity
                        onPress={() => startInlineEdit(type, i, stone)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 4 }}
                        style={[s.inlineActionBtn, { borderColor: colors.primary }]}
                      >
                        <Icon name="edit" size={14} color={colors.primary} />
                      </TouchableOpacity>
                    )}
                  </View>
                </Animated.View>
              );
            })}
          </View>

          {renderChargesSection(type)}
        </View>
      );
    }

    return (
      <View key={type} style={s.typeSection}>
        <View style={s.typeSectionHeader}>
          <Icon name="diamond" size={18} color={colors.primary} />
          <Text style={s.typeSectionTitle}>{type}</Text>
          <View style={s.successBadge}>
            <Icon name="check-circle" size={12} color={colors.success} />
            <Text style={s.successBadgeText}>Calculated</Text>
          </View>
        </View>

        <View style={[s.typeCard, isCalculating && s.typeCardCalculating]}>
          <View style={s.typeCardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.typeCardName}>{type}</Text>
              <Text style={s.typeCardStats}>
                {stones.length} stone lines • {stones.reduce((sum, st) => sum + num(st.Pcs), 0)} pcs • {stones.reduce((sum, st) => sum + num(st.CtWeight), 0).toFixed(1)} ct
              </Text>
            </View>
            {isCalculating && <ActivityIndicator size="small" color={colors.primary} />}
          </View>
          {!isCalculating && (
            <View style={s.typeCardBody}>
              <View style={s.typeCardRow}>
                <Text style={s.typeCardLabel}>Metal Value</Text>
                <Text style={s.typeCardValue}>${num(result?.MetalPrice).toFixed(2)}</Text>
              </View>
              <View style={s.typeCardRow}>
                <Text style={s.typeCardLabel}>Diamonds</Text>
                <Text style={s.typeCardValue}>${num(result?.DiamondsPrice).toFixed(2)}</Text>
              </View>
              <View style={s.typeCardRow}>
                <Text style={s.typeCardLabel}>Labour & Duties</Text>
                <Text style={s.typeCardValue}>${num(result?.DutiesAmount).toFixed(2)}</Text>
              </View>
              <View style={[s.typeCardRow, { borderBottomWidth: 0 }]}>
                <Text style={s.typeCardLabelTotal}>Total Price</Text>
                <Text style={s.typeCardValueTotal}>${num(result?.TotalPrice).toFixed(2)}</Text>
              </View>
            </View>
          )}
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
                style={s.recalcAllBtn}
                onPress={onRequestRecalculate}
                activeOpacity={0.85}
              >
                <Icon name="refresh" size={18} color={colors.textWhite} />
                <Text style={s.recalcAllBtnText}>Recalculate All</Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 80 }} />
          </ScrollView>

          <View style={s.bottomBar}>
            <TouchableOpacity
              style={s.bottomBarBtnOutline}
              onPress={onModifyPricing}
              activeOpacity={0.85}
            >
              <Text style={s.bottomBarBtnOutlineText}>Modify Pricing</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.bottomBarBtnPrimary}
              onPress={onPreviewSummary}
              activeOpacity={0.85}
            >
              <Text style={s.bottomBarBtnPrimaryText}>Preview Summary</Text>
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
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  stoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight || '#F0F0F0',
  },
  stoneRowAlt: { backgroundColor: colors.backgroundSecondary || '#F8F8F8' },
  stoneRowMissing: { borderWidth: 1.5, borderColor: colors.error, backgroundColor: colors.error + '10' },

  stoneCol: { textAlign: 'center' },
  stoneColType: { flex: 2.5, textAlign: 'left' },
  stoneColShape: { flex: 2, textAlign: 'left' },
  stoneColNum: { flex: 1.2 },
  stoneColPrice: { flex: 1.8 },
  stoneColActions: { width: 60, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },

  stoneTh: { fontFamily: fonts.bold, fontSize: 11, color: '#fff' },
  stoneTd: { fontFamily: fonts.regular, fontSize: 12, color: colors.textPrimary },
  stonePriceMissing: { color: colors.error, fontWeight: 'bold' },

  inlinePriceInput: {
    borderWidth: 1.5,
    borderColor: colors.error,
    borderRadius: 8,
    backgroundColor: colors.error + '10',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    textAlign: 'left',
  },
  inlineActionBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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

  typeCard: {
    backgroundColor: colors.primaryExtraLight || '#E6F0F1',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
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
    flexDirection: 'row',
    gap: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
  },
  bottomBarBtnOutline: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  bottomBarBtnOutlineText: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 14,
    color: colors.primary,
  },
  bottomBarBtnPrimary: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  bottomBarBtnPrimaryText: {
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
  recalcAllBtnText: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 14,
    color: '#fff',
  },
});
