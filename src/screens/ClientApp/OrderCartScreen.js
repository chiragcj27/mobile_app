import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { colors } from '../../constants/colors';
import { useCart } from '../../context/CartContext';
import { getCart, removeCartLine } from '../../services/cartStorage';
import catalogApi from '../../services/catalogApi';

const editIcon = require('../../assets/icons/edit.svg');
const PAGE_HORIZONTAL_PADDING = 20;

const formatCurrency = (amount) => {
  const numeric = Number(amount || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '$0000';
  return `$${numeric.toLocaleString('en-US')}`;
};

const getFilterMeta = (selectedFilters) => {
  const source = selectedFilters && typeof selectedFilters === 'object' ? selectedFilters : {};
  const toText = (value) => {
    if (Array.isArray(value)) return value.join(', ');
    return String(value ?? '').trim();
  };
  const metal = toText(source.metal) || '10 kt';
  const stone = toText(source.stone) || 'Lab Grown';
  const length = toText(source.length || source.size) || '18"';
  return `${metal}    ${stone}    ${length}`;
};

const buildCardHeading = (entry) => {
  const subcategory = String(entry?.subcategoryName || '').trim();
  const profile = String(entry?.subcategoryProfileName || '').trim();
  const category = String(entry?.categoryName || '').trim();
  if (profile) return [subcategory, profile, category].filter(Boolean).join(' ');
  return [subcategory, category].filter(Boolean).join(' ');
};

const resolveShippingAddress = (cart) => {
  const entries = Array.isArray(cart?.entries) ? cart.entries : [];
  for (const entry of entries) {
    const filters = entry?.selectedFilters && typeof entry.selectedFilters === 'object' ? entry.selectedFilters : {};
    const fromFilter =
      filters.shippingAddress ||
      filters.shipping_address ||
      filters.address ||
      filters.deliveryAddress ||
      filters.delivery_address;
    if (fromFilter) return String(fromFilter).trim();
  }
  return 'Shipping address to be confirmed';
};

const resolveCurrency = (cart) => {
  const entries = Array.isArray(cart?.entries) ? cart.entries : [];
  for (const entry of entries) {
    const filters = entry?.selectedFilters && typeof entry.selectedFilters === 'object' ? entry.selectedFilters : {};
    const fromFilter = filters.currency || filters.orderCurrency;
    if (fromFilter) return String(fromFilter).trim().toUpperCase();
  }
  return 'USD';
};

const OrderCartScreen = ({ navigation }) => {
  const SWIPE_BUTTON_HEIGHT = 62;
  const SWIPE_KNOB_SIZE = 44;
  const SWIPE_HORIZONTAL_PADDING = 10;
  const SWIPE_BASE_SEGMENT_WIDTH = 104;
  const tabBarHeight = useBottomTabBarHeight();
  const { refreshCartCount } = useCart();

  const [displayRows, setDisplayRows] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [orderRemarks, setOrderRemarks] = useState('');

  const [swipeTrackWidth, setSwipeTrackWidth] = useState(0);
  const swipeTranslateX = useRef(new Animated.Value(0)).current;
  const dragStartX = useRef(0);
  const hasCompletedSwipe = useRef(false);

  const maxSwipeDistance = Math.max(
    0,
    swipeTrackWidth - SWIPE_KNOB_SIZE - SWIPE_HORIZONTAL_PADDING * 2,
  );

  const fillWidth = swipeTranslateX.interpolate({
    inputRange: [0, maxSwipeDistance || 1],
    outputRange: [SWIPE_BASE_SEGMENT_WIDTH, swipeTrackWidth || SWIPE_BUTTON_HEIGHT],
    extrapolate: 'clamp',
  });

  const swipeTextColor = swipeTranslateX.interpolate({
    inputRange: [0, Math.max(1, maxSwipeDistance * 0.75), maxSwipeDistance || 1],
    outputRange: ['#FFFFFF', '#FFFFFF', colors.primary],
    extrapolate: 'clamp',
  });

  const loadCart = useCallback(async () => {
    const cart = await getCart();
    const rows = [];
    (cart.entries || []).forEach((entry) => {
      const cardHeading = buildCardHeading(entry);
      const metaText = getFilterMeta(entry.selectedFilters);
      (entry.lines || []).forEach((line, index) => {
        const totalQty = Number(line?.totalQty || 0);
        const unitPrice = Number(line?.unitPrice || 0);
        rows.push({
          key: `${entry.id}-${String(line?.productId)}-${index}`,
          entryId: entry.id,
          productId: String(line?.productId || ''),
          cardHeading,
          description: String(line?.description || '').trim() || 'Description',
          imageUrl: line?.imageUrl || entry.subcategoryThumbnailImage || '',
          totalQty,
          totalAmount: totalQty > 0 && unitPrice > 0 ? totalQty * unitPrice : 0,
          metaText,
        });
      });
    });
    setDisplayRows(rows);
    setSubmitError('');
  }, []);

  const createOrderFromCart = useCallback(async () => {
    const cart = await getCart();
    const entries = Array.isArray(cart?.entries) ? cart.entries : [];
    const payloadItems = [];

    entries.forEach((entry) => {
      const selectedFilters =
        entry?.selectedFilters && typeof entry.selectedFilters === 'object' ? entry.selectedFilters : {};
      (entry?.lines || []).forEach((line) => {
        const totalQty = Number(line?.totalQty || 0);
        if (!Number.isFinite(totalQty) || totalQty < 1) return;
        const unitPrice = Number(line?.unitPrice || 0);
        payloadItems.push({
          productId: line?.productId ? String(line.productId) : undefined,
          styleNo: line?.styleNo ? String(line.styleNo) : undefined,
          title: line?.title || line?.description || buildCardHeading(entry),
          imageUrl: line?.imageUrl || entry?.subcategoryThumbnailImage || '',
          quantity: totalQty,
          unitPrice: Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : undefined,
          lineTotal:
            Number.isFinite(unitPrice) && unitPrice > 0
              ? Number((unitPrice * totalQty).toFixed(2))
              : undefined,
          remarks: line?.note || '',
          meta: {
            selectedFilters,
            whiteQty: Number(line?.quantities?.W || 0),
            yellowQty: Number(line?.quantities?.Y || 0),
            roseQty: Number(line?.quantities?.R || 0),
            pointer: Number(line?.pointer || 0),
            totalDiamondWeightCt: Number(line?.totalDiamondWeightCt || 0),
            subcategoryId: entry?.subcategoryId || '',
            categoryName: entry?.categoryName || '',
            subcategoryName: entry?.subcategoryName || '',
            subcategoryProfileName: entry?.subcategoryProfileName || '',
          },
        });
      });
    });

    if (!payloadItems.length) {
      throw new Error('Your cart is empty.');
    }

    const totalAmount = payloadItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
    const shippingAddress = resolveShippingAddress(cart);
    const currency = resolveCurrency(cart);

    const sanitizedRemarks = orderRemarks.trim();

    return catalogApi.post('/orders', {
      items: payloadItems,
      shippingAddress,
      currency,
      notes: sanitizedRemarks || undefined,
      totalAmount: totalAmount > 0 ? Number(totalAmount.toFixed(2)) : undefined,
      orderMeta: {
        source: 'mobile_cart_swipe_purchase',
        entryCount: entries.length,
        hasOrderLevelRemarks: Boolean(sanitizedRemarks),
      },
    });
  }, [orderRemarks]);

  useFocusEffect(
    useCallback(() => {
      hasCompletedSwipe.current = false;
      swipeTranslateX.setValue(0);
      loadCart();
    }, [loadCart, swipeTranslateX]),
  );

  const swipePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => displayRows.length > 0,
        onMoveShouldSetPanResponder: () => displayRows.length > 0,
        onPanResponderGrant: () => {
          swipeTranslateX.stopAnimation((value) => {
            dragStartX.current = Number(value || 0);
          });
        },
        onPanResponderMove: (_, gestureState) => {
          const next = Math.max(0, Math.min(maxSwipeDistance, dragStartX.current + gestureState.dx));
          swipeTranslateX.setValue(next);
        },
        onPanResponderRelease: () => {
          swipeTranslateX.stopAnimation((value) => {
            const shouldComplete = maxSwipeDistance > 0 && Number(value || 0) >= maxSwipeDistance * 0.85;
            Animated.spring(swipeTranslateX, {
              toValue: shouldComplete ? maxSwipeDistance : 0,
              useNativeDriver: false,
              bounciness: 0,
              speed: 20,
            }).start(async ({ finished }) => {
              if (finished && shouldComplete && !hasCompletedSwipe.current && !isSubmitting) {
                hasCompletedSwipe.current = true;
                setIsSubmitting(true);
                setSubmitError('');
                try {
                  await createOrderFromCart();
                  navigation.navigate('OrderPlaced');
                } catch (error) {
                  const message =
                    error instanceof Error ? error.message : 'Could not place order. Please try again.';
                  setSubmitError(message);
                  hasCompletedSwipe.current = false;
                  Animated.spring(swipeTranslateX, {
                    toValue: 0,
                    useNativeDriver: false,
                    bounciness: 0,
                    speed: 20,
                  }).start();
                } finally {
                  setIsSubmitting(false);
                }
              }
            });
          });
        },
        onPanResponderTerminate: () => {
          Animated.spring(swipeTranslateX, {
            toValue: 0,
            useNativeDriver: false,
            bounciness: 0,
            speed: 20,
          }).start();
        },
      }),
    [createOrderFromCart, displayRows.length, isSubmitting, maxSwipeDistance, navigation, swipeTranslateX],
  );

  const onRemoveRow = async (entryId, productId) => {
    await removeCartLine(entryId, productId);
    await refreshCartCount();
    await loadCart();
    swipeTranslateX.setValue(0);
    hasCompletedSwipe.current = false;
    setSubmitError('');
  };

  const onHeaderBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.getParent()?.navigate('Dashboard');
    }
  };

  const hasItems = displayRows.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.headerBackButton} activeOpacity={0.8} onPress={onHeaderBack}>
          <MaterialIcons name="chevron-left" size={26} color="#151515" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Proceed with Checkout</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.contentContainer, { paddingBottom: tabBarHeight + 92 }]}>
        {!hasItems ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Your cart is empty</Text>
            <Text style={styles.emptySub}>Add items from order review to continue later.</Text>
          </View>
        ) : (
          <>
            {displayRows.map((item) => (
              <View key={item.key} style={styles.card}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.closeButton}
                  onPress={() => onRemoveRow(item.entryId, item.productId)}>
                  <MaterialIcons name="close" size={18} color="#C6C8CC" />
                </TouchableOpacity>

                <View style={styles.topRow}>
                  <View style={styles.imageFrame}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.image} resizeMode="contain" />
                    ) : (
                      <View style={styles.imagePlaceholder} />
                    )}
                  </View>

                  <View style={styles.textWrap}>
                    <Text style={styles.name}>{item.cardHeading}</Text>
                    <Text style={styles.description}>{item.description}</Text>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaText}>{item.metaText}</Text>
                      <TouchableOpacity activeOpacity={0.8}>
                        <Image source={editIcon} style={styles.inlineEditIcon} resizeMode="contain" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                <View style={styles.bottomRow}>
                  <Text style={styles.totalUnits}>Total: {item.totalQty} Units</Text>
                  <Text style={styles.totalPrice}>{formatCurrency(item.totalAmount)}</Text>
                </View>
              </View>
            ))}

            <View style={styles.remarkCard}>
              <View style={styles.remarkHeaderRow}>
                <Text style={styles.remarkTitle}>Order Remark</Text>
                <Text style={styles.remarkCounter}>{orderRemarks.length}/240</Text>
              </View>
              <Text style={styles.remarkHint}>This note will be visible to the admin with the full order.</Text>
              <TextInput
                style={styles.remarkInput}
                value={orderRemarks}
                onChangeText={(text) => setOrderRemarks(text.slice(0, 240))}
                placeholder="Add delivery notes, urgency, or any special instruction..."
                placeholderTextColor="#9CA3AF"
                multiline
                textAlignVertical="top"
                maxLength={240}
              />
            </View>
          </>
        )}
      </ScrollView>

      {hasItems ? (
        <View style={[styles.footerWrap, { bottom: Math.max(8, tabBarHeight - 26) }]}>
          {!!submitError && (
            <View style={styles.errorPill}>
              <Text style={styles.errorText}>{submitError}</Text>
            </View>
          )}
          <View style={styles.swipeButton} onLayout={(e) => setSwipeTrackWidth(e.nativeEvent.layout.width)}>
            <Animated.View style={[styles.swipeFill, { width: fillWidth }]} />
            <Animated.Text style={[styles.swipeText, { color: swipeTextColor }]}>
              {isSubmitting ? 'Placing Order...' : 'Swipe to Purchase'}
            </Animated.Text>
            <Animated.View
              style={[
                styles.swipeIconWrap,
                isSubmitting ? styles.swipeIconWrapDisabled : null,
                { transform: [{ translateX: swipeTranslateX }] },
              ]}
              {...swipePanResponder.panHandlers}>
              <MaterialIcons name="keyboard-double-arrow-right" size={20} color={colors.primary} />
            </Animated.View>
          </View>
        </View>
      ) : null}
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
    justifyContent: 'space-between',
    paddingHorizontal: PAGE_HORIZONTAL_PADDING,
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
    fontSize: 16,
    fontWeight: '400',
  },
  scroll: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: PAGE_HORIZONTAL_PADDING,
    paddingTop: 10,
    gap: 12,
  },
  emptyCard: {
    borderRadius: 14,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#151515',
    fontSize: 16,
    fontWeight: '400',
  },
  emptySub: {
    marginTop: 8,
    color: '#6B7280',
    fontSize: 12,
    textAlign: 'center',
  },
  card: {
    borderRadius: 14,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  closeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  topRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  imageFrame: {
    width: 96,
    height: 88,
    borderRadius: 12,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '86%',
    height: '86%',
  },
  imagePlaceholder: {
    width: 46,
    height: 22,
    borderRadius: 8,
    backgroundColor: '#E6E6E6',
  },
  textWrap: {
    flex: 1,
  },
  name: {
    color: '#151515',
    fontSize: 12,
    fontWeight: '400',
  },
  description: {
    marginTop: 6,
    color: '#B1B5BC',
    fontSize: 12,
  },
  metaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  metaText: {
    flex: 1,
    color: '#202020',
    fontSize: 12,
  },
  inlineEditIcon: {
    width: 15,
    height: 15,
  },
  bottomRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalUnits: {
    color: '#181818',
    fontSize: 16,
    fontWeight: '400',
  },
  totalPrice: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '400',
  },
  remarkCard: {
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCEBEE',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  remarkHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  remarkTitle: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '500',
  },
  remarkCounter: {
    fontSize: 11,
    color: '#64748B',
  },
  remarkHint: {
    marginTop: 6,
    color: '#64748B',
    fontSize: 11,
    lineHeight: 16,
  },
  remarkInput: {
    marginTop: 10,
    minHeight: 92,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 10,
    color: '#0F172A',
    fontSize: 13,
    lineHeight: 18,
  },
  footerWrap: {
    position: 'absolute',
    left: PAGE_HORIZONTAL_PADDING,
    right: PAGE_HORIZONTAL_PADDING,
    justifyContent: 'flex-end',
    gap: 8,
    zIndex: 20,
    elevation: 6,
  },
  errorPill: {
    minHeight: 28,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 11,
  },
  swipeButton: {
    height: 62,
    borderRadius: 31,
    backgroundColor: '#1E626B',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  swipeFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 100,
  },
  swipeIconWrap: {
    position: 'absolute',
    left: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F7F8F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E3E5E8',
    zIndex: 2,
  },
  swipeIconWrapDisabled: {
    opacity: 0.6,
  },
  swipeText: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#FFFFFF',
    zIndex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
});

export default OrderCartScreen;
