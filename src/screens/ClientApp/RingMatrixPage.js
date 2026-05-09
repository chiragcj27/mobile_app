import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import catalogApi from '../../services/catalogApi';
import RingProductMatrixCard from '../../components/client/RingProductMatrixCard';
import { computeUnitPriceFromSource, getPricingContext } from '../../services/clientPricingEngine';

const RingMatrixPage = ({ route, navigation }) => {
  const subcategoryId = route?.params?.subcategoryId;
  const categoryName = route?.params?.categoryName || '';
  const subcategoryProfileName = route?.params?.subcategoryProfileName || '';
  const subcategoryName = String(route?.params?.subcategoryName || '').trim();
  const subcategorySubtext = String(route?.params?.subcategorySubtext || '').trim();
  const productImageUrl = route?.params?.productImageUrl || '';
  const subcategoryThumbnailImage = route?.params?.subcategoryThumbnailImage || '';
  const productDescription = route?.params?.productDescription || '';
  const specialNotePlaceholderText =
    route?.params?.specialNotePlaceholderText ||
    route?.params?.specialNotePlaceholder ||
    'Length variation';
  const selectedFilters = useMemo(() => route?.params?.selectedFilters || {}, [route?.params?.selectedFilters]);
  const [stoneShapes, setStoneShapes] = useState([]);
  const [selectedStoneShapes, setSelectedStoneShapes] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quantitiesByProduct, setQuantitiesByProduct] = useState({});
  const [specialNotesByShape, setSpecialNotesByShape] = useState({});
  const [specialRemark, setSpecialRemark] = useState('');
  const [pricingContext, setPricingContext] = useState(null);
  const [isTopFiltersVisible, setIsTopFiltersVisible] = useState(true);
  const [topSectionHeight, setTopSectionHeight] = useState(null);
  const lastScrollYRef = useRef(0);
  const topSectionAnim = useRef(new Animated.Value(1)).current;

  const pills = useMemo(() => {
    const next = [];
    if (subcategoryName) {
      next.push(subcategoryName);
    }

    if (subcategorySubtext) {
      next.push(subcategorySubtext);
    }

    const metalValue = selectedFilters?.metal;
    if (typeof metalValue === 'string' && metalValue.trim()) {
      next.push(metalValue.trim());
    }

    const stoneValue = selectedFilters?.stone;
    if (typeof stoneValue === 'string' && stoneValue.trim()) {
      next.push(stoneValue.trim());
    }

    return next;
  }, [selectedFilters?.metal, selectedFilters?.stone, subcategoryName, subcategorySubtext]);

  const normalizeToken = useCallback(
    (value) =>
      String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ''),
    [],
  );

  const productHasStoneShape = useCallback(
    (product, shapeName) => {
      const entries = Array.isArray(product?.filter) ? product.filter : [];
      const map = entries.reduce((acc, item) => {
        const key = normalizeToken(item?.filterName);
        if (key) acc[key] = item?.filterValue;
        return acc;
      }, {});
      const value = map.stoneshape;
      if (Array.isArray(value)) return value.map(normalizeToken).includes(normalizeToken(shapeName));
      return normalizeToken(value) === normalizeToken(shapeName);
    },
    [normalizeToken],
  );

  const matchesBaseFilters = useCallback(
    (product) => {
      const entries = Array.isArray(product?.filter) ? product.filter : [];
      const map = entries.reduce((acc, item) => {
        const key = normalizeToken(item?.filterName);
        if (key) acc[key] = item?.filterValue;
        return acc;
      }, {});

      return Object.entries(selectedFilters || {}).every(([keyRaw, selectedValue]) => {
        const key = normalizeToken(keyRaw);
        if (key === 'stoneshape') return true;
        const productValue = map[key];
        if (productValue === undefined || productValue === null) return true;
        if (Array.isArray(selectedValue)) {
          const selected = selectedValue.map(normalizeToken).filter(Boolean);
          if (!selected.length) return true;
          if (Array.isArray(productValue)) {
            const productValues = productValue.map(normalizeToken).filter(Boolean);
            return selected.every((value) => productValues.includes(value));
          }
          return selected.includes(normalizeToken(productValue));
        }
        const selected = normalizeToken(selectedValue);
        if (!selected) return true;
        if (Array.isArray(productValue)) {
          return productValue.map(normalizeToken).includes(selected);
        }
        return normalizeToken(productValue) === selected;
      });
    },
    [normalizeToken, selectedFilters],
  );

  const fetchData = useCallback(async () => {
    if (!subcategoryId) {
      setError('Missing subcategory id');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError('');
      const [shapeResponse, productResponse] = await Promise.all([
        catalogApi.get('/stone-shapes'),
        catalogApi.get(`/subcategories/${subcategoryId}/products`),
      ]);
      const shapes = Array.isArray(shapeResponse?.stoneShapes) ? shapeResponse.stoneShapes : [];
      const fetchedProducts = Array.isArray(productResponse?.products) ? productResponse.products : [];
      const products = fetchedProducts.filter(matchesBaseFilters);
      setStoneShapes(shapes);
      setAllProducts(products);
      setQuantitiesByProduct((prev) => {
        const next = {};
        products.forEach((product) => {
          const key = String(product?._id || '');
          if (!key) return;
          next[key] = prev[key] || { W: 0, Y: 0, R: 0 };
        });
        return next;
      });
    } catch (err) {
      setError(err?.message || 'Failed to load ring matrix');
      setStoneShapes([]);
      setAllProducts([]);
      setQuantitiesByProduct({});
    } finally {
      setLoading(false);
    }
  }, [matchesBaseFilters, subcategoryId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    let mounted = true;
    getPricingContext()
      .then((ctx) => {
        if (mounted) setPricingContext(ctx);
      })
      .catch(() => {
        if (mounted) setPricingContext(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const shapeCards = useMemo(
    () =>
      selectedStoneShapes
        .map((shapeName) => {
          const rows = allProducts
            .filter((product) => productHasStoneShape(product, shapeName))
            .sort((a, b) => Number(a?.pointer || 0) - Number(b?.pointer || 0))
            .map((product) => ({
              productId: String(product?._id || ''),
              pointerLabel: `${Number(product?.totalDiamondWeightCt || 0)} ct`,
              priceLabel: `$${ 
                (pricingContext ? computeUnitPriceFromSource(product, selectedFilters, pricingContext) : 0) || 0
              }`,
            }))
            .filter((row) => row.productId);
          if (!rows.length) return null;
          const shapeMeta = stoneShapes.find(
            (shape) => normalizeToken(shape?.name) === normalizeToken(shapeName),
          );
          return {
            shapeName,
            shapeImageUrl: shapeMeta?.thumbnailImage || '',
            rows,
          };
        })
        .filter((card) => Boolean(card && card.rows && card.rows.length)),
    [allProducts, normalizeToken, pricingContext, productHasStoneShape, selectedFilters, selectedStoneShapes, stoneShapes],
  );

  const onCardQuantityValueChange = useCallback((productId, colorKey, rawText) => {
    const digitsOnly = String(rawText ?? '').replace(/[^\d]/g, '');
    const nextValue = digitsOnly.length ? Number(digitsOnly) : 0;
    setQuantitiesByProduct((prev) => {
      const current = prev[productId] || { W: 0, Y: 0, R: 0 };
      return {
        ...prev,
        [productId]: {
          ...current,
          [colorKey]: Number.isFinite(nextValue) ? nextValue : 0,
        },
      };
    });
  }, []);

  const totalSelectedQty = useMemo(
    () =>
      Object.values(quantitiesByProduct).reduce(
        (sum, qty) => sum + Number(qty?.W || 0) + Number(qty?.Y || 0) + Number(qty?.R || 0),
        0,
      ),
    [quantitiesByProduct],
  );

  const shapeNamesByProductId = useMemo(() => {
    const map = {};
    shapeCards.forEach((card) => {
      if (!card || !Array.isArray(card.rows)) return;
      card.rows.forEach((row) => {
        const pid = String(row?.productId || '');
        if (!pid) return;
        map[pid] = card.shapeName;
      });
    });
    return map;
  }, [shapeCards]);

  const activeShapesCount = useMemo(() => {
    const active = new Set();
    Object.entries(quantitiesByProduct).forEach(([productId, qty]) => {
      const total = Number(qty?.W || 0) + Number(qty?.Y || 0) + Number(qty?.R || 0);
      if (total <= 0) return;
      const shapeName = shapeNamesByProductId[productId];
      if (shapeName) active.add(shapeName);
    });
    return active.size;
  }, [quantitiesByProduct, shapeNamesByProductId]);

  const activeCaratVariations = useMemo(() => {
    let count = 0;
    Object.values(quantitiesByProduct).forEach((qty) => {
      const total = Number(qty?.W || 0) + Number(qty?.Y || 0) + Number(qty?.R || 0);
      if (total > 0) count += 1;
    });
    return count;
  }, [quantitiesByProduct]);

  const selectedProductLines = useMemo(
    () =>
      allProducts
        .map((product) => {
          const productId = String(product?._id || '');
          const qty = quantitiesByProduct[productId] || { W: 0, Y: 0, R: 0 };
          const totalForProduct = Number(qty.W || 0) + Number(qty.Y || 0) + Number(qty.R || 0);
          if (!productId || totalForProduct === 0) return null;
          const shapeName = shapeNamesByProductId[productId] || '';
          const noteFromShape =
            typeof specialNotesByShape[shapeName] === 'string' ? specialNotesByShape[shapeName] : '';
          return {
            productId,
            styleNo: product?.styleNo || '',
            name: product?.styleNo || '',
            shapeName,
            imageUrl:
              product?.imageUrl ||
              product?.thumbnailUrl ||
              (Array.isArray(product?.images) ? product.images[0] : '') ||
              productImageUrl,
            description: product?.description || productDescription || '',
            pointer: product?.pointer || 0,
            totalDiamondWeightCt: Number(product?.totalDiamondWeightCt || 0),
            quantities: qty,
            totalQty: totalForProduct,
            unitPrice:
              (pricingContext
                ? computeUnitPriceFromSource(product, selectedFilters, pricingContext)
                : 0) ||
              (Number(product?.price ?? product?.sellingPrice ?? product?.mrp ?? 0) > 0
                ? Number(product?.price ?? product?.sellingPrice ?? product?.mrp ?? 0)
                : 0),
            note: noteFromShape.trim() || specialNotePlaceholderText,
          };
        })
        .filter(Boolean),
    [
      allProducts,
      productDescription,
      productImageUrl,
      pricingContext,
      quantitiesByProduct,
      selectedFilters,
      shapeNamesByProductId,
      specialNotesByShape,
      specialNotePlaceholderText,
    ],
  );

  const canProceed = totalSelectedQty > 0;

  useEffect(() => {
    Animated.timing(topSectionAnim, {
      toValue: isTopFiltersVisible ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [isTopFiltersVisible, topSectionAnim]);

  const animatedTopSectionHeight =
    topSectionHeight === null
      ? undefined
      : topSectionAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.max(topSectionHeight, 1)],
        });

  const animatedTopSectionTranslateY = topSectionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-12, 0],
  });

  const handleMatrixScroll = useCallback((event) => {
    const offsetY = Number(event?.nativeEvent?.contentOffset?.y || 0);
    const currentY = Math.max(0, offsetY);
    const delta = currentY - lastScrollYRef.current;

    // Hide on deliberate downward scroll, show again on slight upward movement.
    if (delta > 8 && currentY > 20) {
      setIsTopFiltersVisible(false);
    } else if (delta < -4) {
      setIsTopFiltersVisible(true);
    } else if (currentY <= 2) {
      setIsTopFiltersVisible(true);
    }

    lastScrollYRef.current = currentY;
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.topSectionAnimatedWrap,
          topSectionHeight === null
            ? isTopFiltersVisible
              ? null
              : styles.topSectionCollapsed
            : {
                height: animatedTopSectionHeight,
              },
          {
            opacity: topSectionAnim,
            transform: [{ translateY: animatedTopSectionTranslateY }],
          },
        ]}
      >
        <View
          style={styles.topWhiteSection}
          onLayout={(event) => {
            const measured = Math.round(Number(event?.nativeEvent?.layout?.height || 0));
            if (measured > 0 && measured !== topSectionHeight) {
              setTopSectionHeight(measured);
            }
          }}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            style={styles.pillsScroll}
            contentContainerStyle={styles.pillsRow}>
            {pills.map((pillText, index) => (
              <View key={`${pillText}-${index}`} style={styles.pill}>
                <Text style={styles.pillText}>{pillText}</Text>
              </View>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shapeRow}>
            {stoneShapes.map((shape) => {
              const name = String(shape?.name || '').trim();
              if (!name) return null;
              const active = selectedStoneShapes.includes(name);
              return (
                <TouchableOpacity
                  key={String(shape?._id || name)}
                  style={styles.shapeItem}
                  onPress={() =>
                    setSelectedStoneShapes((prev) =>
                      prev.includes(name) ? prev.filter((value) => value !== name) : [...prev, name],
                    )
                  }
                  activeOpacity={0.85}
                >
                  <View style={[styles.shapeCircle, active && styles.shapeCircleActive]}>
                    {shape?.thumbnailImage ? (
                      <Image source={{ uri: shape.thumbnailImage }} style={styles.shapeImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.shapeImagePlaceholder} />
                    )}
                  </View>
                  <Text style={styles.shapeTitle}>{name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Animated.View>
      <ScrollView
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        onScroll={handleMatrixScroll}
        scrollEventThrottle={16}>
        {loading ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateText}>Loading matrix...</Text>
          </View>
        ) : null}

        {!loading && error ? (
          <TouchableOpacity style={styles.stateCard} activeOpacity={0.8} onPress={fetchData}>
            <Text style={styles.stateTitle}>Unable to load matrix</Text>
            <Text style={styles.stateText}>Tap to retry</Text>
          </TouchableOpacity>
        ) : null}

        {!loading && !error && shapeCards.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>No matrix to show</Text>
            <Text style={styles.stateText}>Select one or more stone shapes</Text>
          </View>
        ) : null}

        {!loading && !error
          ? shapeCards.map((card) => {
              return (
                <View key={card.shapeName} style={styles.matrixWrap}>
                  <RingProductMatrixCard
                    shapeName={card.shapeName}
                    shapeImageUrl={card.shapeImageUrl}
                    rows={card.rows}
                    quantitiesByProduct={quantitiesByProduct}
                    onChangeQuantityValue={onCardQuantityValueChange}
                  />
                </View>
              );
            })
          : null}

        {!loading && !error ? (
          <View style={styles.statsGrid}>
            <View style={styles.statsCard}>
              <Text style={styles.statsValue}>{totalSelectedQty}</Text>
              <Text style={styles.statsLabel}>Total pcs</Text>
            </View>
            <View style={styles.statsCard}>
              <Text style={styles.statsValue}>{activeShapesCount}</Text>
              <Text style={styles.statsLabel}>Shapes active</Text>
            </View>
            <View style={styles.statsCard}>
              <Text style={styles.statsValue}>{activeCaratVariations}</Text>
              <Text style={styles.statsLabel}>Carat variations</Text>
            </View>
          </View>
        ) : null}

        {!loading && !error && selectedStoneShapes.length > 0 ? (
          <View style={styles.notesSection}>
            <View style={styles.notesHeader}>
              <Text style={styles.notesHeaderText}>
                Special size notes — default size 7. Add notes only where size varies.
              </Text>
            </View>
            <View style={styles.notesBody}>
              {selectedStoneShapes.map((shapeName) => (
                <View key={shapeName} style={styles.noteRow}>
                  <Text style={styles.noteShape}>{shapeName}</Text>
                  <TextInput
                    style={styles.noteInput}
                    placeholder="e.g. 4×size 6, 2×size 8"
                    placeholderTextColor="#B7BBC2"
                    value={typeof specialNotesByShape[shapeName] === 'string' ? specialNotesByShape[shapeName] : ''}
                    onChangeText={(text) =>
                      setSpecialNotesByShape((prev) => ({ ...prev, [shapeName]: String(text ?? '') }))
                    }
                  />
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {!loading && !error ? (
          <View style={styles.specialRemarkSection}>
            <Text style={styles.specialRemarkLabel}>SPECIAL REMARK:</Text>
            <TextInput
              style={styles.specialRemarkInput}
              multiline
              textAlignVertical="top"
              placeholder="Any special instructions for this order..."
              placeholderTextColor="#A8A8A8"
              value={specialRemark}
              onChangeText={setSpecialRemark}
            />
          </View>
        ) : null}
      </ScrollView>
      <TouchableOpacity
        style={[styles.proceedButton, !canProceed && styles.proceedButtonDisabled]}
        disabled={!canProceed}
        onPress={() =>
          navigation.navigate('OrderReview', {
            categoryName,
            subcategoryProfileName,
            subcategoryId,
            subcategoryName,
            subcategorySubtext,
            totalSelectedQty,
            selectedProductLines,
            selectedFilters: {
              ...(selectedFilters || {}),
              stoneShape: selectedStoneShapes,
            },
            specialNotePlaceholderText,
            productImageUrl,
            productDescription,
            subcategoryThumbnailImage,
            specialRemark: specialRemark.trim(),
          })
        }
      >
        <Text style={styles.proceedText}>Add to order - {totalSelectedQty} pcs</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F8FA',
    paddingTop: 8,
  },
  topWhiteSection: {
    backgroundColor: '#FFFFFF',
    paddingTop: 0,
    paddingBottom: 8,
  },
  topSectionAnimatedWrap: {
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  topSectionCollapsed: {
    height: 0,
  },
  contentContainer: {
    paddingTop: 2,
    paddingBottom: 98,
    paddingHorizontal: 20,
  },
  shapeRow: {
    paddingHorizontal: 20,
    gap: 14,
    paddingBottom: 8,
  },
  shapeItem: {
    alignItems: 'center',
  },
  shapeCircle: {
    width: 65,
    height: 65,
    borderRadius: 44,
    borderWidth: 1,
    borderColor: '#E5E7EA',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECEEF2',
  },
  shapeCircleActive: {
    borderWidth: 2,
    borderColor: '#1F5A62',
    backgroundColor: '#FFFFFF',
  },
  shapeImage: {
    width: 54,
    height: 54,
    borderRadius: 37,
  },
  shapeImagePlaceholder: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#DEE2E8',
  },
  shapeTitle: {
    marginTop: 9,
    fontSize: 15,
    fontWeight: '500',
    color: '#2A3A46',
  },
  pillsRow: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    paddingTop: 2,
    gap: 8,
    alignItems: 'center',
  },
  pillsScroll: {
    flexGrow: 0,
    maxHeight: 52,
  },
  pill: {
    height: 40,
    borderRadius: 999,
    backgroundColor: '#1F5A62',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
  },
  matrixWrap: {
    marginTop: 16,
    marginHorizontal: 0,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  statsGrid: {
    marginTop: 14,
    marginHorizontal: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  statsCard: {
    width: '48.5%',
    minHeight: 102,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFF2F5',
    paddingHorizontal: 16,
    paddingVertical: 14,
    justifyContent: 'space-between',
  },
  statsValue: {
    fontSize: 24,
    color: '#0E586C',
    fontWeight: '400',
  },
  statsLabel: {
    fontSize: 12,
    color: '#324768',
    fontWeight: '400',
  },
  notesSection: {
    marginTop: 12,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E8EBF0',
    backgroundColor: '#FFFFFF',
  },
  notesHeader: {
    backgroundColor: '#DEE1E8',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  notesHeaderText: {
    color: '#4B5568',
    fontSize: 16,
    fontWeight: '400',
  },
  notesBody: {
    backgroundColor: '#FFFFFF',
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#E6E6E6',
    gap: 10,
  },
  noteShape: {
    width: 78,
    color: '#111111',
    fontSize: 16,
    fontWeight: '400',
  },
  noteInput: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CCD3DB',
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#1A1A1A',
    fontWeight: '400',
    backgroundColor: '#FFFFFF',
  },
  specialRemarkSection: {
    marginTop: 14,
    marginBottom: 8,
  },
  specialRemarkLabel: {
    color: '#6B7385',
    fontSize: 18 / 2,
    fontWeight: '400',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  specialRemarkInput: {
    minHeight: 118,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#C2C9D2',
    backgroundColor: '#F6F7F9',
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#1A1A1A',
    fontSize: 14,
    fontWeight: '400',
  },
  stateCard: {
    marginTop: 14,
    marginHorizontal: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DFE4EA',
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateTitle: {
    color: '#1C2530',
    fontSize: 14,
    fontWeight: '600',
  },
  stateText: {
    marginTop: 4,
    color: '#6E7C8A',
    fontSize: 12,
  },
  proceedButton: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 10,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F5A62',
  },
  proceedButtonDisabled: {
    backgroundColor: '#89A7AB',
  },
  proceedText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
  },
});

export default RingMatrixPage;
