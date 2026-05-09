import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { colors } from '../../constants/colors';
import { useCart } from '../../context/CartContext';
import { appendCartEntry } from '../../services/cartStorage';

import EditIcon from '../../assets/icons/edit.svg';

const PAGE_HORIZONTAL_PADDING = 20;

const normalizeFilterMap = (selectedFilters) => {
  const source = selectedFilters && typeof selectedFilters === 'object' ? selectedFilters : {};
  return Object.entries(source).reduce((acc, [rawKey, rawValue]) => {
    const key = String(rawKey || '').trim().toLowerCase();
    if (!key) return acc;
    if (Array.isArray(rawValue)) {
      acc[key] = rawValue.join(', ');
      return acc;
    }
    acc[key] = String(rawValue ?? '').trim();
    return acc;
  }, {});
};

const formatCurrency = (amount) => {
  const numeric = Number(amount || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '$000';
  return `$${numeric.toLocaleString('en-US')}`;
};

const buildSummaryMetaFromFilterMap = (filterMap) => {
  const metal = filterMap.metal || '10 kt';
  const stone = filterMap.stone || 'Lab Grown';
  const length = filterMap.length || filterMap.size || '18"';
  return [`Metal: ${metal}`, `Stone: ${stone}`, `Length: ${length}`].join('    ');
};

const headingTextFromLine = (line) => {
  const sub = String(line?.subcategoryName || '').trim();
  const prof = String(line?.subcategoryProfileName || '').trim();
  const cat = String(line?.categoryName || '').trim();
  const withProfile = [sub, prof, cat].filter(Boolean).join(' ');
  const withoutProfile = [sub, cat].filter(Boolean).join(' ');
  return prof ? withProfile : withoutProfile;
};

const buildLineItem = (line, specialNotePlaceholderText) => {
  const qty = line?.quantities || {};
  const whiteQty = Number(qty.W || 0);
  const yellowQty = Number(qty.Y || 0);
  const roseQty = Number(qty.R || 0);
  const totalQtyFromColors = whiteQty + yellowQty + roseQty;
  const incomingTotalQty = Number(line?.totalQty || 0);
  const totalQty = totalQtyFromColors > 0 ? totalQtyFromColors : incomingTotalQty;
  const incomingAmount = Number(line?.amount || 0);
  const explicitUnitPrice = Number(line?.unitPrice || 0);
  const derivedUnitPrice =
    totalQty > 0 && incomingAmount > 0 ? incomingAmount / totalQty : 0;
  const unitPrice = explicitUnitPrice > 0 ? explicitUnitPrice : derivedUnitPrice;
  return {
    ...line,
    quantities: {
      W: whiteQty,
      Y: yellowQty,
      R: roseQty,
    },
    whiteQty,
    yellowQty,
    roseQty,
    unitPrice,
    totalQty,
    amount: unitPrice > 0 ? unitPrice * totalQty : 0,
    note: String(line?.note || ''),
  };
};

const toTitleCase = (value) =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());

const OrderReviewScreen = ({ route, navigation }) => {
  const { refreshCartCount } = useCart();
  const subcategoryId = route?.params?.subcategoryId || '';
  const categoryName = route?.params?.categoryName || 'Category';
  const subcategoryProfileName = route?.params?.subcategoryProfileName || 'Profile';
  const subcategoryName = route?.params?.subcategoryName || 'Products';
  const subcategorySubtext = route?.params?.subcategorySubtext || '';
  const totalSelectedQty = Number(route?.params?.totalSelectedQty || 0);
  const selectedProductLines = Array.isArray(route?.params?.selectedProductLines)
    ? route.params.selectedProductLines
    : [];
  const specialNotePlaceholderText = route?.params?.specialNotePlaceholderText || 'Length variation';
  const productImageUrl = route?.params?.productImageUrl || '';
  const subcategoryThumbnailImage = route?.params?.subcategoryThumbnailImage || '';
  const productDescription = route?.params?.productDescription || '';
  const selectedFiltersMap = useMemo(
    () => normalizeFilterMap(route?.params?.selectedFilters),
    [route?.params?.selectedFilters],
  );
  const isReorderFlow = Boolean(route?.params?.isReorderFlow);
  const parsedItemsCount = Number(route?.params?.parsedItemsCount || 0);
  if (__DEV__) {
    console.log('[OrderReviewScreen] mounted', {
      parsedItemsCount,
      isReorderFlow,
      selectedLines: Array.isArray(selectedProductLines) ? selectedProductLines.length : 0,
      totalSelectedQty,
    });
  }
  const isRingCategory = String(categoryName || '').toLowerCase().includes('ring');

  const resolvedSubcategory = String(subcategoryName || 'Products');
  const resolvedProfile = String(subcategoryProfileName || 'Profile');
  const resolvedCategory = String(categoryName || 'Category');
  const combinedHeading = [resolvedSubcategory, resolvedProfile, resolvedCategory]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  const combinedHeadingWithoutProfile = [resolvedSubcategory, resolvedCategory]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  const shouldShowProfile = String(subcategoryProfileName || '').trim().length > 0;
  const headingText = shouldShowProfile ? combinedHeading : combinedHeadingWithoutProfile;
  const firstSelectedProductDescription = String(selectedProductLines?.[0]?.description || '').trim();
  const headingDescription =
    firstSelectedProductDescription || String(productDescription || '').trim() || 'Description';
  const resolvedImageUrl = subcategoryThumbnailImage || productImageUrl || '';

  const summaryMeta = [
    `Metal: ${selectedFiltersMap.metal || '10 kt'}`,
    `Stone: ${selectedFiltersMap.stone || 'Lab Grown'}`,
    `Length: ${selectedFiltersMap.length || selectedFiltersMap.size || '18"'}`,
  ].join('    ');

  const [lineItems, setLineItems] = useState(() =>
    selectedProductLines.map((line) => buildLineItem(line, specialNotePlaceholderText)),
  );
  const [editingLineId, setEditingLineId] = useState(null);

  const hasItems = lineItems.length > 0;
  const getLineId = (line, index) => {
    const base = String(line?.productId || line?.id || line?.styleNo || line?.pointer || line?.totalDiamondWeightCt || 'line');
    return `${base}-${index}`;
  };
  const updateLineQty = (lineId, color, delta) => {
    setLineItems((prev) =>
      prev.map((line, index) => {
        if (getLineId(line, index) !== lineId) return line;
        const nextValue = Math.max(0, Number(line?.quantities?.[color] || 0) + delta);
        const nextQuantities = {
          ...line.quantities,
          [color]: nextValue,
        };
        return buildLineItem(
          {
            ...line,
            quantities: nextQuantities,
          },
          specialNotePlaceholderText,
        );
      }),
    );
  };
  const updateLineNote = (lineId, nextNote) => {
    setLineItems((prev) =>
      prev.map((line, index) => {
        if (getLineId(line, index) !== lineId) return line;
        return {
          ...line,
          note: nextNote,
        };
      }),
    );
  };
  const removeLineItem = (lineId) => {
    setLineItems((prev) => prev.filter((line, index) => getLineId(line, index) !== lineId));
    if (editingLineId === lineId) {
      setEditingLineId(null);
    }
  };
  const totalSelectedQtyFromLines = useMemo(
    () => lineItems.reduce((sum, line) => sum + Number(line?.totalQty || 0), 0),
    [lineItems],
  );
  const ringShapeCards = useMemo(() => {
    const grouped = new Map();
    lineItems.forEach((line) => {
      const shape = String(line?.shapeName || '').trim() || 'Shape';
      const existing = grouped.get(shape) || [];
      existing.push(line);
      grouped.set(shape, existing);
    });
    return Array.from(grouped.entries()).map(([shapeName, lines]) => ({
      shapeName,
      lines: [...lines].sort(
        (a, b) =>
          Number(a?.totalDiamondWeightCt ?? a?.pointer ?? 0) -
          Number(b?.totalDiamondWeightCt ?? b?.pointer ?? 0),
      ),
    }));
  }, [lineItems]);
  const hasMixedCategories = useMemo(() => {
    if (route?.params?.hasMixedCategories) return true;
    const uniqueCategories = new Set(
      lineItems
        .map((line) => String(line?.categoryName || '').trim().toLowerCase())
        .filter(Boolean),
    );
    return uniqueCategories.size > 1;
  }, [lineItems, route?.params?.hasMixedCategories]);
  const shouldUseRingLayout = isRingCategory && !hasMixedCategories;

  /** Bulk parser flow: split cards when category / profile / subcategory / id differ between lines. */
  const bulkReviewGroups = useMemo(() => {
    if (isReorderFlow || shouldUseRingLayout) return [];
    const keyOf = (line) =>
      [
        String(line?.subcategoryId || '').trim(),
        String(line?.categoryName || '').trim().toLowerCase(),
        String(line?.subcategoryProfileName || '').trim().toLowerCase(),
        String(line?.subcategoryName || '').trim().toLowerCase(),
      ].join('\u0001');
    const order = [];
    const byKey = new Map();
    lineItems.forEach((line, index) => {
      const k = keyOf(line);
      if (!byKey.has(k)) {
        byKey.set(k, { key: k, items: [] });
        order.push(k);
      }
      byKey.get(k).items.push({ line, index });
    });
    return order.map((k) => byKey.get(k));
  }, [lineItems, isReorderFlow, shouldUseRingLayout]);

  const mergedFiltersForLine = (line) => ({
    ...selectedFiltersMap,
    ...normalizeFilterMap(line?.lineSelectedFilters || {}),
  });
  const getLineHeading = (line) => {
    const subcategory = String(line?.subcategoryName || '').trim();
    const profile = String(line?.subcategoryProfileName || '').trim();
    const category = String(line?.categoryName || '').trim();
    if (subcategory && profile && category) return `${subcategory} ${profile} ${category}`;
    if (subcategory && category) return `${subcategory} ${category}`;
    if (subcategory) return subcategory;
    if (category) return category;
    return String(line?.name || line?.title || 'Ordered Item');
  };
  const getLineDescription = (line) => {
    const shapeText = String(line?.shapeName || '').trim();
    if (shapeText) return `${toTitleCase(shapeText)} variation`;
    return String(line?.description || 'Description');
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.headerBackButton} activeOpacity={0.8} onPress={navigation.goBack}>
          <MaterialIcons name="chevron-left" size={26} color="#151515" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Review Your Order</Text>
          {parsedItemsCount > 0 ? <Text style={styles.parsedCountText}>{parsedItemsCount} items parsed</Text> : null}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.contentContainer,
          { paddingBottom: styles.footerWrap.height + 16 },
        ]}>
        {shouldUseRingLayout ? (
          hasItems ? (
            ringShapeCards.map((shapeCard) => (
              <View key={shapeCard.shapeName} style={styles.ringCardWrap}>
                <View style={styles.mainCard}>
                <View style={styles.productInfoRow}>
                  <View style={styles.productInfoTextWrap}>
                    <Text style={styles.headerValue}>{shapeCard.shapeName.toUpperCase()} {subcategoryName.toUpperCase()}</Text>
                    <Text style={styles.headerDescription}>with {subcategorySubtext || 'Studded Shank'}</Text>
                  </View>
                  <View style={styles.productImageFrame}>
                    {resolvedImageUrl ? (
                      <Image source={{ uri: resolvedImageUrl }} style={styles.productImage} resizeMode="contain" />
                    ) : (
                      <View style={styles.productImagePlaceholder} />
                    )}
                  </View>
                </View>

                <View style={styles.divider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryMeta}>
                    Metal: {selectedFiltersMap.metal || '14 kt'}    Stone: {selectedFiltersMap.stone || 'Natural'}
                  </Text>
                  <TouchableOpacity
                    style={styles.inlineIconButton}
                    activeOpacity={0.8}
                    onPress={navigation.goBack}>
                    <EditIcon width={15} height={15} />
                  </TouchableOpacity>
                </View>

                {shapeCard.lines.map((line, lineIndex) => {
                  const lineId = `${shapeCard.shapeName}-${getLineId(line, lineIndex)}`;
                  const isEditing = editingLineId === lineId;
                  return (
                  <View key={lineId} style={styles.lineSection}>
                    <View style={styles.divider} />
                    <View style={styles.pointerRow}>
                      <Text style={styles.pointerTitle}>
                        {Number(line.totalDiamondWeightCt || 0)} ct : {line.totalQty} Units
                      </Text>
                      <Text style={styles.pointerPrice}>{formatCurrency(line.amount)}</Text>
                    </View>

                    <View style={styles.colorsAndEditRow}>
                      <Text style={styles.colorSplit}>
                        White - {line.whiteQty}      Yellow - {line.yellowQty}      Rose - {line.roseQty}
                      </Text>
                      <TouchableOpacity
                        style={styles.inlineIconButton}
                        activeOpacity={0.8}
                        onPress={() => setEditingLineId(isEditing ? null : lineId)}>
                        <EditIcon width={15} height={15} />
                      </TouchableOpacity>
                    </View>
                    {isEditing ? (
                      <View style={styles.inlineEditorWrap}>
                        <View style={styles.qtyControlsRow}>
                          {[
                            { key: 'W', label: 'W', value: line.whiteQty },
                            { key: 'Y', label: 'Y', value: line.yellowQty },
                            { key: 'R', label: 'R', value: line.roseQty },
                          ].map((item) => (
                            <View key={item.key} style={styles.singleColorQtyWrap}>
                              <View
                                style={[
                                  styles.colorDot,
                                  item.key === 'W' && styles.colorDotWhite,
                                  item.key === 'Y' && styles.colorDotYellow,
                                  item.key === 'R' && styles.colorDotRose,
                                ]}>
                                <Text style={styles.colorDotText}>{item.label}</Text>
                              </View>
                              <View style={styles.stepperWrap}>
                                <TouchableOpacity
                                  style={styles.stepperButton}
                                  activeOpacity={0.8}
                                  onPress={() => updateLineQty(lineId, item.key, -1)}>
                                  <Text style={styles.stepperSymbol}>-</Text>
                                </TouchableOpacity>
                                <View style={styles.stepperValueWrap}>
                                  <Text style={styles.stepperValueText}>{item.value}</Text>
                                </View>
                                <TouchableOpacity
                                  style={styles.stepperButton}
                                  activeOpacity={0.8}
                                  onPress={() => updateLineQty(lineId, item.key, 1)}>
                                  <Text style={styles.stepperSymbol}>+</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          ))}
                        </View>
                        <TouchableOpacity
                          style={styles.saveChangesButton}
                          activeOpacity={0.85}
                          onPress={() => setEditingLineId(null)}>
                          <Text style={styles.saveChangesButtonText}>Save Changes</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                )})}
                </View>
              </View>
            ))
          ) : (
            <View style={styles.mainCard}>
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>No ring products selected.</Text>
              </View>
            </View>
          )
        ) : isReorderFlow ? (
          hasItems ? (
            lineItems.map((line, lineIndex) => {
              const lineId = getLineId(line, lineIndex);
              const isEditing = editingLineId === lineId;
              const lineImage = String(line?.imageUrl || resolvedImageUrl || '');
              return (
                <View key={`reorder-card-${lineId}`} style={styles.ringCardWrap}>
                  <View style={styles.mainCard}>
                    <View style={styles.productInfoRow}>
                      <View style={styles.productInfoTextWrap}>
                        <Text style={styles.headerValue}>{getLineHeading(line)}</Text>
                        <Text style={styles.headerDescription}>{getLineDescription(line)}</Text>
                      </View>
                      <View style={styles.reorderImageWrap}>
                        <TouchableOpacity
                          style={styles.removeItemButton}
                          activeOpacity={0.8}
                          onPress={() => removeLineItem(lineId)}>
                          <MaterialIcons name="close" size={13} color="#6A717B" />
                        </TouchableOpacity>
                        <View style={styles.productImageFrame}>
                          {lineImage ? (
                            <Image source={{ uri: lineImage }} style={styles.productImage} resizeMode="contain" />
                          ) : (
                            <View style={styles.productImagePlaceholder} />
                          )}
                        </View>
                      </View>
                    </View>

                    <View style={styles.lineSection}>
                      <View style={styles.divider} />
                      <View style={styles.pointerRow}>
                        <Text style={styles.pointerTitle}>
                          {line?.subcategoryName || line?.name || line?.title || 'Item'} : {line.totalQty} Units
                        </Text>
                        <Text style={styles.pointerPrice}>{formatCurrency(line.amount)}</Text>
                      </View>

                      <View style={styles.colorsAndEditRow}>
                        <Text style={styles.colorSplit}>
                          White - {line.whiteQty}      Yellow - {line.yellowQty}      Rose - {line.roseQty}
                        </Text>
                        <TouchableOpacity
                          style={styles.inlineIconButton}
                          activeOpacity={0.8}
                          onPress={() => setEditingLineId(isEditing ? null : lineId)}>
                          <EditIcon width={15} height={15} />
                        </TouchableOpacity>
                      </View>
                      {isEditing ? (
                        <View style={styles.inlineEditorWrap}>
                          <View style={styles.qtyControlsRow}>
                            {[
                              { key: 'W', label: 'W', value: line.whiteQty },
                              { key: 'Y', label: 'Y', value: line.yellowQty },
                              { key: 'R', label: 'R', value: line.roseQty },
                            ].map((item) => (
                              <View key={item.key} style={styles.singleColorQtyWrap}>
                                <View
                                  style={[
                                    styles.colorDot,
                                    item.key === 'W' && styles.colorDotWhite,
                                    item.key === 'Y' && styles.colorDotYellow,
                                    item.key === 'R' && styles.colorDotRose,
                                  ]}>
                                  <Text style={styles.colorDotText}>{item.label}</Text>
                                </View>
                                <View style={styles.stepperWrap}>
                                  <TouchableOpacity
                                    style={styles.stepperButton}
                                    activeOpacity={0.8}
                                    onPress={() => updateLineQty(lineId, item.key, -1)}>
                                    <Text style={styles.stepperSymbol}>-</Text>
                                  </TouchableOpacity>
                                  <View style={styles.stepperValueWrap}>
                                    <Text style={styles.stepperValueText}>{item.value}</Text>
                                  </View>
                                  <TouchableOpacity
                                    style={styles.stepperButton}
                                    activeOpacity={0.8}
                                    onPress={() => updateLineQty(lineId, item.key, 1)}>
                                    <Text style={styles.stepperSymbol}>+</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            ))}
                          </View>
                          <TouchableOpacity
                            style={styles.saveChangesButton}
                            activeOpacity={0.85}
                            onPress={() => setEditingLineId(null)}>
                            <Text style={styles.saveChangesButtonText}>Save Changes</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}

                      <View style={styles.noteRow}>
                        <Text style={styles.noteLabel}>Note :</Text>
                        <View style={styles.noteBox}>
                          <TextInput
                            value={line.note}
                            onChangeText={(text) => updateLineNote(lineId, text)}
                            placeholder={specialNotePlaceholderText}
                            placeholderTextColor="#B8BDC5"
                            style={styles.noteInput}
                          />
                        </View>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })
          ) : (
            <View style={styles.mainCard}>
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>No products selected.</Text>
              </View>
            </View>
          )
        ) : bulkReviewGroups.length > 1 ? (
          <>
            {bulkReviewGroups.map((group) => {
              const first = group.items[0]?.line;
              const groupImage = String(first?.subcategoryThumbnailImage || first?.imageUrl || '').trim();
              const groupHeading = (first && headingTextFromLine(first)) || headingText;
              const groupDesc =
                String(first?.subcategoryDescription || first?.description || productDescription || '').trim() ||
                headingDescription;
              const groupSummaryMeta = buildSummaryMetaFromFilterMap(mergedFiltersForLine(first));
              return (
                <View key={group.key} style={styles.ringCardWrap}>
                  <View style={styles.mainCard}>
                    <View style={styles.productInfoRow}>
                      <View style={styles.productInfoTextWrap}>
                        <Text style={styles.headerValue}>{groupHeading}</Text>
                        <Text style={styles.headerDescription}>{groupDesc}</Text>
                      </View>
                      <View style={styles.productImageFrame}>
                        {groupImage ? (
                          <Image source={{ uri: groupImage }} style={styles.productImage} resizeMode="contain" />
                        ) : (
                          <View style={styles.productImagePlaceholder} />
                        )}
                      </View>
                    </View>

                    <View style={styles.divider} />
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryMeta}>{groupSummaryMeta}</Text>
                    </View>

                    {group.items.map(({ line, index: lineIndex }) => {
                      const lineId = getLineId(line, lineIndex);
                      const isEditing = editingLineId === lineId;
                      return (
                        <View key={lineId} style={styles.lineSection}>
                          <View style={styles.divider} />
                          <View style={styles.pointerRow}>
                            <Text style={styles.pointerTitle}>
                              {`${line.pointer} Pointer : ${line.totalQty} Units`}
                            </Text>
                            <Text style={styles.pointerPrice}>{formatCurrency(line.amount)}</Text>
                          </View>

                          <View style={styles.colorsAndEditRow}>
                            <Text style={styles.colorSplit}>
                              White - {line.whiteQty}      Yellow - {line.yellowQty}      Rose - {line.roseQty}
                            </Text>
                            <TouchableOpacity
                              style={styles.inlineIconButton}
                              activeOpacity={0.8}
                              onPress={() => setEditingLineId(isEditing ? null : lineId)}>
                              <EditIcon width={15} height={15} />
                            </TouchableOpacity>
                          </View>
                          {isEditing ? (
                            <View style={styles.inlineEditorWrap}>
                              <View style={styles.qtyControlsRow}>
                                {[
                                  { key: 'W', label: 'W', value: line.whiteQty },
                                  { key: 'Y', label: 'Y', value: line.yellowQty },
                                  { key: 'R', label: 'R', value: line.roseQty },
                                ].map((item) => (
                                  <View key={item.key} style={styles.singleColorQtyWrap}>
                                    <View
                                      style={[
                                        styles.colorDot,
                                        item.key === 'W' && styles.colorDotWhite,
                                        item.key === 'Y' && styles.colorDotYellow,
                                        item.key === 'R' && styles.colorDotRose,
                                      ]}>
                                      <Text style={styles.colorDotText}>{item.label}</Text>
                                    </View>
                                    <View style={styles.stepperWrap}>
                                      <TouchableOpacity
                                        style={styles.stepperButton}
                                        activeOpacity={0.8}
                                        onPress={() => updateLineQty(lineId, item.key, -1)}>
                                        <Text style={styles.stepperSymbol}>-</Text>
                                      </TouchableOpacity>
                                      <View style={styles.stepperValueWrap}>
                                        <Text style={styles.stepperValueText}>{item.value}</Text>
                                      </View>
                                      <TouchableOpacity
                                        style={styles.stepperButton}
                                        activeOpacity={0.8}
                                        onPress={() => updateLineQty(lineId, item.key, 1)}>
                                        <Text style={styles.stepperSymbol}>+</Text>
                                      </TouchableOpacity>
                                    </View>
                                  </View>
                                ))}
                              </View>
                              <TouchableOpacity
                                style={styles.saveChangesButton}
                                activeOpacity={0.85}
                                onPress={() => setEditingLineId(null)}>
                                <Text style={styles.saveChangesButtonText}>Save Changes</Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}

                          <View style={styles.noteRow}>
                            <Text style={styles.noteLabel}>Note :</Text>
                            <View style={styles.noteBox}>
                              <TextInput
                                value={line.note}
                                onChangeText={(text) => updateLineNote(lineId, text)}
                                placeholder={specialNotePlaceholderText}
                                placeholderTextColor="#B8BDC5"
                                style={styles.noteInput}
                              />
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </>
        ) : (
          <View style={styles.mainCard}>
            <View style={styles.productInfoRow}>
              <View style={styles.productInfoTextWrap}>
                <Text style={styles.headerValue}>{headingText}</Text>
                <Text style={styles.headerDescription}>{headingDescription}</Text>
              </View>
              <View style={styles.productImageFrame}>
                {resolvedImageUrl ? (
                  <Image source={{ uri: resolvedImageUrl }} style={styles.productImage} resizeMode="contain" />
                ) : (
                  <View style={styles.productImagePlaceholder} />
                )}
              </View>
            </View>

            {!isReorderFlow || !hasMixedCategories ? (
              <>
                <View style={styles.divider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryMeta}>{summaryMeta}</Text>
                </View>
              </>
            ) : null}

            {hasItems ? (
              lineItems.map((line, lineIndex) => {
                const lineId = getLineId(line, lineIndex);
                const isEditing = editingLineId === lineId;
                return (
                <View key={lineId} style={styles.lineSection}>
                  <View style={styles.divider} />
                  <View style={styles.pointerRow}>
                    <Text style={styles.pointerTitle}>
                      {isReorderFlow
                        ? `${line?.subcategoryName || line?.name || line?.title || 'Item'} : ${line.totalQty} Units`
                        : `${line.pointer} Pointer : ${line.totalQty} Units`}
                    </Text>
                    <Text style={styles.pointerPrice}>{formatCurrency(line.amount)}</Text>
                  </View>

                  <View style={styles.colorsAndEditRow}>
                    <Text style={styles.colorSplit}>
                      White - {line.whiteQty}      Yellow - {line.yellowQty}      Rose - {line.roseQty}
                    </Text>
                    <TouchableOpacity
                      style={styles.inlineIconButton}
                      activeOpacity={0.8}
                      onPress={() => setEditingLineId(isEditing ? null : lineId)}>
                      <EditIcon width={15} height={15} />
                    </TouchableOpacity>
                  </View>
                  {isEditing ? (
                    <View style={styles.inlineEditorWrap}>
                      <View style={styles.qtyControlsRow}>
                        {[
                          { key: 'W', label: 'W', value: line.whiteQty },
                          { key: 'Y', label: 'Y', value: line.yellowQty },
                          { key: 'R', label: 'R', value: line.roseQty },
                        ].map((item) => (
                          <View key={item.key} style={styles.singleColorQtyWrap}>
                            <View
                              style={[
                                styles.colorDot,
                                item.key === 'W' && styles.colorDotWhite,
                                item.key === 'Y' && styles.colorDotYellow,
                                item.key === 'R' && styles.colorDotRose,
                              ]}>
                              <Text style={styles.colorDotText}>{item.label}</Text>
                            </View>
                            <View style={styles.stepperWrap}>
                              <TouchableOpacity
                                style={styles.stepperButton}
                                activeOpacity={0.8}
                                onPress={() => updateLineQty(lineId, item.key, -1)}>
                                <Text style={styles.stepperSymbol}>-</Text>
                              </TouchableOpacity>
                              <View style={styles.stepperValueWrap}>
                                <Text style={styles.stepperValueText}>{item.value}</Text>
                              </View>
                              <TouchableOpacity
                                style={styles.stepperButton}
                                activeOpacity={0.8}
                                onPress={() => updateLineQty(lineId, item.key, 1)}>
                                <Text style={styles.stepperSymbol}>+</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </View>
                      <TouchableOpacity
                        style={styles.saveChangesButton}
                        activeOpacity={0.85}
                        onPress={() => setEditingLineId(null)}>
                        <Text style={styles.saveChangesButtonText}>Save Changes</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  <View style={styles.noteRow}>
                    <Text style={styles.noteLabel}>Note :</Text>
                    <View style={styles.noteBox}>
                      <TextInput
                        value={line.note}
                        onChangeText={(text) => updateLineNote(lineId, text)}
                        placeholder={specialNotePlaceholderText}
                        placeholderTextColor="#B8BDC5"
                        style={styles.noteInput}
                      />
                    </View>
                  </View>
                </View>
              )})
            ) : (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>No products selected.</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footerWrap}>
        <View style={styles.totalBadge}>
          <Text style={styles.totalBadgeText}>{totalSelectedQtyFromLines || totalSelectedQty} Designs Added</Text>
        </View>
        <TouchableOpacity
          activeOpacity={hasItems ? 0.85 : 1}
          disabled={!hasItems}
          style={[styles.addCartButton, !hasItems && styles.addCartButtonDisabled]}
          onPress={async () => {
            if (!hasItems) return;
            if (isReorderFlow) {
              for (const line of lineItems) {
                await appendCartEntry({
                  subcategoryId: line?.subcategoryId || subcategoryId,
                  categoryName: line?.categoryName || categoryName,
                  subcategoryProfileName: line?.subcategoryProfileName || subcategoryProfileName,
                  subcategoryName: line?.subcategoryName || subcategoryName,
                  subcategoryThumbnailImage: line?.imageUrl || subcategoryThumbnailImage,
                  selectedFilters: route?.params?.selectedFilters || {},
                  lines: [line],
                });
              }
            } else if (bulkReviewGroups.length > 1) {
              for (const group of bulkReviewGroups) {
                const first = group.items[0]?.line;
                if (!first) continue;
                const groupFilters = mergedFiltersForLine(first);
                await appendCartEntry({
                  subcategoryId: first.subcategoryId || subcategoryId,
                  categoryName: first.categoryName || categoryName,
                  subcategoryProfileName: first.subcategoryProfileName || subcategoryProfileName,
                  subcategoryName: first.subcategoryName || subcategoryName,
                  subcategoryThumbnailImage:
                    first.subcategoryThumbnailImage || first.imageUrl || subcategoryThumbnailImage,
                  selectedFilters: groupFilters,
                  lines: group.items.map(({ line }) => line),
                });
              }
            } else {
              await appendCartEntry({
                subcategoryId,
                categoryName,
                subcategoryProfileName,
                subcategoryName,
                subcategoryThumbnailImage,
                selectedFilters: route?.params?.selectedFilters || {},
                lines: lineItems,
              });
            }
            await refreshCartCount();
            navigation.getParent()?.navigate('Cart');
          }}>
          <Text style={styles.addCartButtonText}>Proceed to Cart</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  headerRow: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAGE_HORIZONTAL_PADDING,
    gap: 8,
  },
  headerBackButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#171717',
    fontSize: 31 / 2,
    fontWeight: '400',
    textAlign: 'right',
  },
  parsedCountText: {
    marginTop: 2,
    color: '#0F5F65',
    fontSize: 11,
    textAlign: 'right',
  },
  scroll: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: PAGE_HORIZONTAL_PADDING,
    paddingTop: 10,
  },
  mainCard: {
    borderRadius: 16,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  ringCardWrap: {
    marginBottom: 12,
  },
  productInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  productInfoTextWrap: {
    flex: 1,
  },
  headerValue: {
    color: '#161616',
    fontSize: 16,
    fontWeight: '400',
    marginBottom: 5,
  },
  headerDescription: {
    color: '#B1B5BC',
    fontSize: 11,
  },
  productImageFrame: {
    width: 92,
    height: 76,
    borderRadius: 12,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productImage: {
    width: '86%',
    height: '86%',
  },
  productImagePlaceholder: {
    width: 46,
    height: 22,
    borderRadius: 8,
    backgroundColor: '#E6E6E6',
  },
  reorderImageWrap: {
    alignItems: 'flex-end',
    gap: 6,
  },
  removeItemButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D4D8DE',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  divider: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E1E3E6',
  },
  summaryRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  summaryMeta: {
    flex: 1,
    color: '#2D2D2D',
    fontSize: 11,
  },
  inlineIconButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineSection: {
    marginTop: 2,
  },
  pointerRow: {
    marginTop: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pointerTitle: {
    color: '#151515',
    fontSize: 16,
    fontWeight: '400',
  },
  pointerPrice: {
    color: '#0F0F0F',
    fontSize: 16,
    fontWeight: '400',
  },
  colorsAndEditRow: {
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  colorSplit: {
    flex: 1,
    color: '#B3B6BC',
    fontSize: 11,
  },
  inlineEditorWrap: {
    marginTop: 10,
  },
  qtyControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  singleColorQtyWrap: {
    flex: 1,
    alignItems: 'center',
  },
  colorDot: {
    width: 20,
    height: 20,
    borderRadius: 16,
    backgroundColor: '#EFEFF1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  colorDotWhite: {
    backgroundColor: '#E9E9EC',
  },
  colorDotYellow: {
    backgroundColor: '#E9DCA0',
  },
  colorDotRose: {
    backgroundColor: '#EBC5CB',
  },
  colorDotText: {
    color: '#404040',
    fontSize: 10,
    fontWeight: '400',
  },
  stepperWrap: {
    width: '100%',
    height: 30,
    borderRadius: 20,
    backgroundColor: '#F2F3F5',
    borderWidth: 1,
    borderColor: '#EBEBED',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  stepperButton: {
    width: 36,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperSymbol: {
    color: '#A5A8AE',
    fontSize: 22,
    fontWeight: '400',
    marginTop: -2,
  },
  stepperValueWrap: {
    flex: 1,
    height: '100%',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#EBEBED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValueText: {
    color: '#595E66',
    fontSize: 28 / 2,
    fontWeight: '400',
  },
  saveChangesButton: {
    marginTop: 12,
    marginLeft: 'auto',
    width: 150,
    height: 36,
    borderRadius: 21,
    backgroundColor: '#165E69',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveChangesButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '400',
  },
  noteRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noteLabel: {
    color: '#3A3A3A',
    fontSize: 12,
    fontWeight: '400',
  },
  noteBox: {
    flex: 1,
    minHeight: 34,
    borderRadius: 4,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  noteInput: {
    color: '#5D636C',
    fontSize: 11,
    padding: 0,
    margin: 0,
  },
  emptyWrap: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  footerWrap: {
    position: 'absolute',
    left: PAGE_HORIZONTAL_PADDING,
    right: PAGE_HORIZONTAL_PADDING,
    bottom: 8,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  totalBadge: {
    flex: 1,
    height: '100%',
    borderRadius: 14,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  totalBadgeText: {
    color: '#1A1A1A',
    fontSize: 14,
    fontWeight: '400',
  },
  addCartButton: {
    width: 132,
    height: '100%',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F5A62',
  },
  addCartButtonDisabled: {
    backgroundColor: '#8AA8AC',
  },
  addCartButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '400',
  },
});

export default OrderReviewScreen;
