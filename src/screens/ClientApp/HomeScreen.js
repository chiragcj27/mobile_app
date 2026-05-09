import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { colors } from '../../constants/colors';
import catalogApi from '../../services/catalogApi';
import CategoryCard from '../../components/client/CategoryCard';
import { useCart } from '../../context/CartContext';
import { appendCartEntry } from '../../services/cartStorage';
import MicImage from '../../assets/images/mic.png';

const firstDefined = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const normalizeSelectedFilters = (filters = {}) => {
  if (!filters || typeof filters !== 'object') return {};
  return Object.entries(filters).reduce((acc, [rawKey, rawValue]) => {
    const key = String(rawKey || '').trim();
    if (!key) return acc;
    acc[key] = rawValue;
    return acc;
  }, {});
};

const toReorderReviewPayload = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const firstItem = items[0] || {};
  const firstMeta = firstItem?.meta || {};
  const firstSnapshot = firstMeta?.productSnapshot || {};
  const baseSelectedFilters = normalizeSelectedFilters(firstMeta?.selectedFilters || {});

  const selectedProductLines = items.map((item, index) => {
    const meta = item?.meta || {};
    const snapshot = meta?.productSnapshot || {};
    const qty = Number(item?.quantity || 0);
    const whiteQty = Number(meta?.whiteQty || 0);
    const yellowQty = Number(meta?.yellowQty || 0);
    const roseQty = Number(meta?.roseQty || 0);
    const lineTotalQty = Number(meta?.totalQty || qty || whiteQty + yellowQty + roseQty || 0);

    return {
      productId: String(firstDefined(item?.productId, item?._id, item?.styleNo, `reorder-${index}`)),
      styleNo: String(item?.styleNo || ''),
      name: String(item?.title || item?.styleNo || `Item ${index + 1}`),
      title: String(item?.title || ''),
      description: String(firstDefined(item?.title, item?.styleNo, 'Ordered item')),
      imageUrl: String(item?.imageUrl || ''),
      pointer: Number(meta?.pointer || 0),
      totalDiamondWeightCt: Number(meta?.totalDiamondWeightCt || 0),
      shapeName: String(meta?.shapeName || ''),
      categoryName: String(firstDefined(meta?.categoryName, snapshot?.categoryName, item?.category, '') || ''),
      subcategoryName: String(
        firstDefined(meta?.subcategoryName, snapshot?.subcategoryName, item?.subCategory, item?.subcategory, '') || '',
      ),
      subcategoryProfileName: String(
        firstDefined(meta?.subcategoryProfileName, snapshot?.subcategoryProfileName, item?.profile, '') || '',
      ),
      quantities: {
        W: whiteQty,
        Y: yellowQty,
        R: roseQty,
      },
      totalQty: lineTotalQty,
      unitPrice: Number(item?.unitPrice || 0),
      note: String(item?.remarks || ''),
    };
  });

  const totalSelectedQty = selectedProductLines.reduce((sum, line) => sum + Number(line?.totalQty || 0), 0);
  const uniqueCategories = new Set(
    selectedProductLines
      .map((line) => String(line?.categoryName || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const hasMixedCategories = uniqueCategories.size > 1;

  return {
    categoryName: String(firstDefined(firstMeta?.categoryName, firstSnapshot?.categoryName, '') || 'Category'),
    subcategoryProfileName: String(
      firstDefined(firstMeta?.subcategoryProfileName, firstSnapshot?.subcategoryProfileName, '') || 'Profile',
    ),
    subcategoryId: String(firstDefined(firstMeta?.subcategoryId, firstSnapshot?.subcategoryId, '') || ''),
    subcategoryName: String(firstDefined(firstMeta?.subcategoryName, firstSnapshot?.subcategoryName, '') || 'Products'),
    subcategorySubtext: '',
    totalSelectedQty,
    selectedProductLines,
    selectedFilters: baseSelectedFilters,
    specialNotePlaceholderText: 'Length variation',
    productImageUrl: String(firstItem?.imageUrl || ''),
    productDescription: String(firstDefined(firstItem?.title, firstItem?.styleNo, '') || ''),
    subcategoryThumbnailImage: String(firstItem?.imageUrl || ''),
    isReorderFlow: true,
    hasMixedCategories,
  };
};

const getOrderSummaryTitle = (order) => {
  const firstItem = Array.isArray(order?.items) ? order.items[0] : null;
  const firstMeta = firstItem?.meta || {};
  const selectedFilters = normalizeSelectedFilters(firstMeta?.selectedFilters || {});
  const totalPieces = (order?.items || []).reduce((sum, item) => sum + Number(item?.quantity || 0), 0);
  const subcategory = firstMeta?.subcategoryName || firstMeta?.productSnapshot?.subcategoryName || '';
  const rawMetal = firstDefined(
    selectedFilters?.metal,
    selectedFilters?.Metal,
    selectedFilters?.metalType,
    selectedFilters?.metal_type,
    selectedFilters?.['Metal Type'],
    '',
  );
  const metalKt = firstDefined(
    selectedFilters?.metalKt,
    selectedFilters?.metal_kt,
    selectedFilters?.kt,
    selectedFilters?.KT,
    '',
  );
  const stoneType = firstDefined(
    selectedFilters?.stoneType,
    selectedFilters?.stone_type,
    selectedFilters?.['Stone Type'],
    selectedFilters?.stone,
    selectedFilters?.Stone,
    '',
  );
  const metal = String(rawMetal || '').trim();
  const kt = String(metalKt || '').trim();
  const metalDisplay = metal && kt && !metal.toLowerCase().includes(kt.toLowerCase()) ? `${metal} ${kt}` : metal || kt;
  const bits = [`${totalPieces} pcs`, subcategory, metalDisplay, stoneType]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return bits.join(' | ');
};

const formatDeliveredOn = (order) => {
  const deliveredAt =
    order?.timeline?.find((entry) => entry?.status === 'order_delivered')?.changedAt ||
    order?.updatedAt ||
    order?.createdAt;
  if (!deliveredAt) return '';
  const date = new Date(deliveredAt);
  if (Number.isNaN(date.getTime())) return '';
  return `Delivered on ${date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })}`;
};

const LIVE_ORDER_STATUSES = new Set([
  'order_received',
  'order_confirmed',
  'order_in_production',
  'order_shipped',
]);

const getLiveStatusLabel = (status) => {
  if (status === 'order_received') return 'Received';
  if (status === 'order_confirmed') return 'Confirmed';
  if (status === 'order_in_production') return 'In Production';
  if (status === 'order_shipped') return 'Shipped';
  return 'Order';
};

const getLiveStatusTheme = (status) => {
  if (status === 'order_received') {
    return { bg: '#E5E7EB', fg: '#374151', accent: '#374151' };
  }
  if (status === 'order_confirmed') {
    return { bg: '#DBEAFE', fg: '#1D4ED8', accent: '#1D4ED8' };
  }
  if (status === 'order_in_production') {
    return { bg: '#FEF3C7', fg: '#B45309', accent: '#D97706' };
  }
  if (status === 'order_shipped') {
    return { bg: '#1FA796', fg: '#FFFFFF', accent: '#0F8C7E' };
  }
  return { bg: '#E5E7EB', fg: '#374151', accent: '#374151' };
};

const getOrderTotalPieces = (order) =>
  (order?.items || []).reduce((sum, item) => sum + Number(item?.quantity || 0), 0);

const getOrderShortLabel = (order) => {
  const firstItem = Array.isArray(order?.items) ? order.items[0] : null;
  const meta = firstItem?.meta || {};
  const subcategory =
    String(
      meta?.subcategoryName ||
        meta?.productSnapshot?.subcategoryName ||
        firstItem?.subCategory ||
        firstItem?.subcategory ||
        '',
    ).trim() || 'Order';
  return subcategory;
};

const chunkPairs = (list = []) => {
  const out = [];
  for (let i = 0; i < list.length; i += 2) {
    out.push(list.slice(i, i + 2));
  }
  return out;
};

const LIVE_STAGE_FLOW = [
  'order_received',
  'order_confirmed',
  'order_in_production',
  'order_shipped',
];

const getLiveStageIndex = (status) => {
  const index = LIVE_STAGE_FLOW.indexOf(String(status || ''));
  return index >= 0 ? index : 0;
};

const HomeScreen = ({ navigation }) => {
  const { refreshCartCount } = useCart();
  const { width } = useWindowDimensions();
  const [banners, setBanners] = useState([]);
  const [categories, setCategories] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [liveOrders, setLiveOrders] = useState([]);
  const [activeReorderIndex, setActiveReorderIndex] = useState(0);
  const [activeLivePage, setActiveLivePage] = useState(0);
  const [loadingBanners, setLoadingBanners] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [bannerError, setBannerError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const reorderListRef = useRef(null);
  const liveOrdersListRef = useRef(null);

  const bannerWidth = width;
  const bannerHeight = bannerWidth * (9 / 16);
  const reorderCardWidth = width - 20 * 2;
  const categoryGap = 8;
  const categoryCardWidth = (width - 20 * 2 - categoryGap) / 2;
  const liveOrderPageWidth = width - 20 * 2;
  const liveOrderCardGap = 10;
  const liveOrderCardWidth = (liveOrderPageWidth - liveOrderCardGap) / 2;
  const livePages = chunkPairs(liveOrders);

  const fetchBanners = useCallback(async () => {
    try {
      setLoadingBanners(true);
      setBannerError('');
      const response = await catalogApi.get('/banners');
      const fetchedBanners = Array.isArray(response?.banners) ? response.banners : [];
      setBanners(fetchedBanners);
    } catch (err) {
      setBannerError(err?.message || 'Failed to load banners');
      setBanners([]);
    } finally {
      setLoadingBanners(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      setLoadingCategories(true);
      setCategoryError('');
      const response = await catalogApi.get('/categories');
      const fetchedCategories = Array.isArray(response?.categories) ? response.categories : [];
      setCategories(fetchedCategories);
    } catch (err) {
      setCategoryError(err?.message || 'Failed to load categories');
      setCategories([]);
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      setLoadingOrders(true);
      const response = await catalogApi.get('/orders/my');
      const fetched = Array.isArray(response?.orders) ? response.orders : [];
      const uniqueMap = new Map();
      fetched.forEach((order) => {
        const key = String(order?._id || order?.orderNumber || '');
        if (!key || uniqueMap.has(key)) return;
        uniqueMap.set(key, order);
      });
      const uniqueOrders = Array.from(uniqueMap.values()).filter(
        (order) => Array.isArray(order?.items) && order.items.length > 0,
      );

      const deliveredSorted = uniqueOrders
        .filter((order) => order?.status === 'order_delivered')
        .sort((a, b) => {
          const aDeliveredAt =
            a?.timeline?.find((entry) => entry?.status === 'order_delivered')?.changedAt ||
            a?.updatedAt ||
            a?.createdAt;
          const bDeliveredAt =
            b?.timeline?.find((entry) => entry?.status === 'order_delivered')?.changedAt ||
            b?.updatedAt ||
            b?.createdAt;
          const aTime = new Date(aDeliveredAt || 0).getTime();
          const bTime = new Date(bDeliveredAt || 0).getTime();
          return bTime - aTime;
        })
        .slice(0, 4);

      const liveSorted = uniqueOrders
        .filter((order) => LIVE_ORDER_STATUSES.has(String(order?.status || '')))
        .sort((a, b) => {
          const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
          const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
          return bTime - aTime;
        });

      setRecentOrders(deliveredSorted);
      setLiveOrders(liveSorted);
    } catch {
      setRecentOrders([]);
      setLiveOrders([]);
    } finally {
      setLoadingOrders(false);
      setActiveReorderIndex(0);
      setActiveLivePage(0);
    }
  }, []);

  useEffect(() => {
    fetchBanners();
    fetchCategories();
  }, [fetchBanners, fetchCategories]);

  useFocusEffect(
    useCallback(() => {
      fetchOrders();
    }, [fetchOrders]),
  );

  useEffect(() => {
    if (recentOrders.length <= 1) return undefined;
    const interval = setInterval(() => {
      setActiveReorderIndex((prev) => {
        const nextIndex = (prev + 1) % recentOrders.length;
        reorderListRef.current?.scrollToOffset({
          offset: nextIndex * reorderCardWidth,
          animated: true,
        });
        return nextIndex;
      });
    }, 3200);
    return () => clearInterval(interval);
  }, [recentOrders.length, reorderCardWidth]);

  const handleReorderAsIs = useCallback(
    async (order) => {
      const payload = toReorderReviewPayload(order);
      if (!Array.isArray(payload?.selectedProductLines) || payload.selectedProductLines.length === 0) return;

      for (const line of payload.selectedProductLines) {
        await appendCartEntry({
          subcategoryId: line?.subcategoryId || payload?.subcategoryId,
          categoryName: line?.categoryName || payload?.categoryName,
          subcategoryProfileName: line?.subcategoryProfileName || payload?.subcategoryProfileName,
          subcategoryName: line?.subcategoryName || payload?.subcategoryName,
          subcategoryThumbnailImage: line?.imageUrl || payload?.subcategoryThumbnailImage,
          selectedFilters: payload?.selectedFilters || {},
          lines: [line],
        });
      }

      await refreshCartCount();
      navigation.getParent()?.navigate('Cart');
    },
    [navigation, refreshCartCount],
  );

  const handleEditFirst = useCallback(
    (order) => {
      const payload = toReorderReviewPayload(order);
      navigation.getParent()?.navigate('Dashboard', {
        screen: 'OrderReview',
        params: payload,
      });
    },
    [navigation],
  );

  const onReorderScrollEnd = useCallback(
    (event) => {
      const offsetX = event?.nativeEvent?.contentOffset?.x || 0;
      const nextIndex = Math.round(offsetX / reorderCardWidth);
      if (nextIndex >= 0 && nextIndex < recentOrders.length) {
        setActiveReorderIndex(nextIndex);
      }
    },
    [recentOrders.length, reorderCardWidth],
  );

  useEffect(() => {
    if (livePages.length <= 1) return undefined;
    const interval = setInterval(() => {
      setActiveLivePage((prev) => {
        const nextIndex = (prev + 1) % livePages.length;
        liveOrdersListRef.current?.scrollToOffset({
          offset: nextIndex * liveOrderPageWidth,
          animated: true,
        });
        return nextIndex;
      });
    }, 3500);
    return () => clearInterval(interval);
  }, [livePages.length, liveOrderPageWidth]);

  const onLiveOrdersScrollEnd = useCallback(
    (event) => {
      const offsetX = event?.nativeEvent?.contentOffset?.x || 0;
      const nextIndex = Math.round(offsetX / liveOrderPageWidth);
      if (nextIndex >= 0 && nextIndex < livePages.length) {
        setActiveLivePage(nextIndex);
      }
    },
    [livePages.length, liveOrderPageWidth],
  );

  const handleOpenOrderDetails = useCallback(
    (order) => {
      navigation.getParent()?.navigate('MyOrders', {
        screen: 'MyOrderDetails',
        params: { order },
      });
    },
    [navigation],
  );

  const handleSeeAllOrders = useCallback(() => {
    navigation.getParent()?.navigate('MyOrders', { screen: 'MyOrdersList' });
  }, [navigation]);

  const renderLiveOrderCard = (order) => {
    const status = String(order?.status || '');
    const theme = getLiveStatusTheme(status);
    const orderNumber = order?.orderNumber || order?._id || 'N/A';
    const pieces = getOrderTotalPieces(order);
    const shortLabel = getOrderShortLabel(order);
    const stageIndex = getLiveStageIndex(status);
    return (
      <TouchableOpacity
        key={`${order?._id || order?.orderNumber || Math.random()}`}
        activeOpacity={0.85}
        style={[styles.liveOrderCard, { width: liveOrderCardWidth }]}
        onPress={() => handleOpenOrderDetails(order)}>
        <View style={[styles.liveStatusPill, { backgroundColor: theme.bg }]}>
          <Text style={[styles.liveStatusPillText, { color: theme.fg }]} numberOfLines={1}>
            {getLiveStatusLabel(status)}
          </Text>
        </View>
        <Text style={styles.liveOrderNumber} numberOfLines={1}>
          #{String(orderNumber)}
        </Text>
        <Text style={styles.liveOrderPieces} numberOfLines={1}>
          {pieces} pcs {'\u00b7'} {shortLabel}
        </Text>
        <View style={styles.liveStatusBar}>
          <View
            style={[
              styles.liveStatusBarFill,
              {
                backgroundColor: theme.accent,
                width: `${((stageIndex + 1) / LIVE_STAGE_FLOW.length) * 100}%`,
              },
            ]}
          />
        </View>
      </TouchableOpacity>
    );
  };

  const renderLiveOrderPage = ({ item: pair }) => (
    <View style={[styles.liveOrderPage, { width: liveOrderPageWidth }]}>
      {pair.map((order) => renderLiveOrderCard(order))}
      {pair.length === 1 ? <View style={{ width: liveOrderCardWidth }} /> : null}
    </View>
  );

  const renderReorderCard = useCallback(
    ({ item }) => (
      <View style={[styles.reorderCard, { width: reorderCardWidth }]}>
        <Text style={styles.reorderTitle}>Reorder your last batch</Text>
        <Text style={styles.reorderMeta} numberOfLines={1}>
          {getOrderSummaryTitle(item)}
        </Text>
        <Text style={styles.reorderDelivered}>{formatDeliveredOn(item)}</Text>
        <View style={styles.reorderActionsRow}>
          <TouchableOpacity style={styles.reorderAsIsButton} activeOpacity={0.85} onPress={() => handleReorderAsIs(item)}>
            <Text style={styles.reorderAsIsText}>Reorder as-is -{'>'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.editFirstButton} activeOpacity={0.8} onPress={() => handleEditFirst(item)}>
            <Text style={styles.editFirstText}>Edit first</Text>
          </TouchableOpacity>
        </View>
      </View>
    ),
    [handleEditFirst, handleReorderAsIs, reorderCardWidth],
  );

  const shouldShowReorder = !loadingOrders && recentOrders.length > 0;
  const shouldShowLiveOrders = !loadingOrders && liveOrders.length > 0;

  const renderBanner = ({ item }) => (
    <View style={[styles.bannerCard, { width: bannerWidth, height: bannerHeight }]}>
      <Image
        source={{ uri: item.imageUrl }}
        style={styles.bannerImage}
        resizeMode="cover"
      />
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.bannerSection}>
        {loadingBanners ? (
          <View style={[styles.bannerSkeletonCard, { height: bannerHeight }]}>
            <View style={styles.bannerSkeletonShine} />
            <View style={styles.bannerSkeletonLineWrap}>
              <View style={styles.bannerSkeletonLinePrimary} />
              <View style={styles.bannerSkeletonLineSecondary} />
            </View>
          </View>
        ) : null}

        {!loadingBanners && bannerError ? (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={fetchBanners}
            style={[styles.bannerFallback, { height: bannerHeight }]}>
            <Text style={styles.fallbackTitle}>Unable to load banners</Text>
            <Text style={styles.fallbackSubtitle}>Tap to retry</Text>
          </TouchableOpacity>
        ) : null}

        {!loadingBanners && !bannerError && banners.length === 0 ? (
          <View style={[styles.bannerFallback, { height: bannerHeight }]}>
            <Text style={styles.fallbackTitle}>No banners available</Text>
          </View>
        ) : null}

        {!loadingBanners && !bannerError && banners.length > 0 ? (
          <FlatList
            data={banners}
            keyExtractor={(item) => item._id || item.imageKey || item.imageUrl}
            renderItem={renderBanner}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            snapToAlignment="center"
            decelerationRate="fast"
            contentContainerStyle={styles.bannerListContent}
          />
        ) : null}
      </View>

      {loadingOrders ? (
        <View style={styles.reorderSection}>
          <View style={styles.reorderSkeletonCard} />
        </View>
      ) : null}

      {shouldShowReorder ? (
        <View style={styles.reorderSection}>
          <FlatList
            ref={reorderListRef}
            data={recentOrders}
            keyExtractor={(item) => item?._id || item?.orderNumber || String(Math.random())}
            renderItem={renderReorderCard}
            horizontal
            pagingEnabled
            snapToAlignment="center"
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onReorderScrollEnd}
          />
          <View style={styles.reorderDotsRow}>
            {recentOrders.map((order, index) => (
              <View
                key={`${order?._id || order?.orderNumber || index}-dot`}
                style={[styles.reorderDot, index === activeReorderIndex && styles.reorderDotActive]}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.newOrderSection}>
        <Text style={styles.newOrderTitle}>Start a new order</Text>
        <View style={styles.newOrderCardsRow}>
          <TouchableOpacity
            activeOpacity={0.9}
            style={[styles.newOrderCard, styles.newOrderCardPrimary, { width: categoryCardWidth }]}
            onPress={() => {
              if (__DEV__) {
                console.log('[HomeScreen] opening BulkOrderParser');
              }
              navigation.navigate('BulkOrderParser');
            }}>
            <View style={styles.newOrderIconWrap}>
              <Image source={MicImage} style={styles.micIconImage} resizeMode="contain" />
            </View>
            <Text style={styles.newOrderCardPrimaryTitle}>Dictate big order</Text>
            <Text style={styles.newOrderCardPrimarySubtext}>10 shapes x 5 carats in 60s</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.9}
            style={[styles.newOrderCard, styles.newOrderCardSecondary, { width: categoryCardWidth }]}>
            <View style={styles.newOrderIconWrap}>
              <MaterialIcons name="bolt" size={21} color="#E3A600" />
            </View>
            <Text style={styles.newOrderCardSecondaryTitle}>From template</Text>
            <Text style={styles.newOrderCardSecondarySubtext} numberOfLines={1}>
              4 saved - Basic 14kt pack...
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {shouldShowLiveOrders ? (
        <View style={styles.liveOrdersSection}>
          <View style={styles.liveOrdersHeader}>
            <Text style={styles.liveOrdersTitle}>
              Live Orders {'\u00b7'} {liveOrders.length}
            </Text>
            <TouchableOpacity activeOpacity={0.8} onPress={handleSeeAllOrders} style={styles.liveOrdersSeeAllBtn}>
              <Text style={styles.liveOrdersSeeAllText}>See all {'\u203A'}</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            ref={liveOrdersListRef}
            data={livePages}
            keyExtractor={(_, index) => `live-page-${index}`}
            renderItem={renderLiveOrderPage}
            horizontal
            pagingEnabled
            snapToAlignment="center"
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onLiveOrdersScrollEnd}
          />

          {livePages.length > 1 ? (
            <View style={styles.liveOrdersDotsRow}>
              {livePages.map((_, index) => (
                <View
                  key={`live-dot-${index}`}
                  style={[styles.liveOrdersDot, index === activeLivePage && styles.liveOrdersDotActive]}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.categoriesSection}>
        <Text style={styles.categoriesTitle}>ALL CATEGORIES</Text>

        {loadingCategories ? (
          <View style={styles.categoryGrid}>
            {[0, 1, 2, 3].map((item) => (
              <View
                key={`category-skeleton-${item}`}
                style={[styles.categorySkeletonCard, { width: categoryCardWidth }]}
              />
            ))}
          </View>
        ) : null}

        {!loadingCategories && categoryError ? (
          <TouchableOpacity style={styles.categoryStateCard} onPress={fetchCategories} activeOpacity={0.8}>
            <Text style={styles.fallbackTitle}>Unable to load categories</Text>
            <Text style={styles.fallbackSubtitle}>Tap to retry</Text>
          </TouchableOpacity>
        ) : null}

        {!loadingCategories && !categoryError && categories.length === 0 ? (
          <View style={styles.categoryStateCard}>
            <Text style={styles.fallbackTitle}>No categories available</Text>
          </View>
        ) : null}

        {!loadingCategories && !categoryError && categories.length > 0 ? (
          <View style={styles.categoryGrid}>
            {categories.map((category) => (
              <CategoryCard
                key={category._id || category.name}
                style={{ width: categoryCardWidth }}
                thumbnailUrl={category.imageUrl}
                title={category.name}
                subtext={`${Number(category.designCount || 0)} Designs`}
                onPress={() =>
                  navigation.navigate('CategoryDetails', {
                    categoryId: category._id,
                    categoryName: category.name,
                    categoryBannerImages: category.categoryBannerImages || [],
                    categoryImageUrl: category.imageUrl || '',
                  })
                }
              />
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  contentContainer: {
    paddingBottom: 20,
  },
  bannerSection: {
    marginTop: 0,
  },
  reorderSection: {
    paddingHorizontal: 20,
    paddingTop: 10,
    marginBottom: 10,
  },
  reorderCard: {
    borderRadius: 16,
    backgroundColor: '#D6DEE2',
    borderWidth: 1.5,
    borderColor: '#0F5F65',
    paddingHorizontal: 28,
    paddingTop: 15,
    paddingBottom: 10,
  },
  reorderTitle: {
    color: '#0F5F65',
    fontSize: 18,
    fontWeight: '700',
  },
  reorderMeta: {
    marginTop: 5,
    color: '#1A525A',
    fontSize: 14,
    fontWeight: '400',
  },
  reorderDelivered: {
    marginTop: 4,
    color: '#1E5D66',
    fontSize: 12,
    fontWeight: '400',
  },
  reorderActionsRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  reorderAsIsButton: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#0F5F65',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  reorderAsIsText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '400',
  },
  editFirstButton: {
    minWidth: 108,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  editFirstText: {
    color: '#1A525A',
    fontSize: 16,
    fontWeight: '400',
  },
  reorderDotsRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  reorderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#AAC0C5',
  },
  reorderDotActive: {
    width: 16,
    borderRadius: 4,
    backgroundColor: '#0F5F65',
  },
  reorderSkeletonCard: {
    height: 184,
    borderRadius: 30,
    backgroundColor: '#E1E8EB',
  },
  newOrderSection: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  newOrderTitle: {
    color: '#0F5F65',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  newOrderCardsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  newOrderCard: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    height: 80,
  },
  newOrderCardPrimary: {
    backgroundColor: '#0F5F65',
  },
  newOrderCardSecondary: {
    backgroundColor: '#EAEAEA',
  },
  newOrderIconWrap: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  micIconImage: {
    width: 18,
    height: 18,
  },
  newOrderCardPrimaryTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  newOrderCardPrimarySubtext: {
    marginTop: 5,
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '400',
  },
  newOrderCardSecondaryTitle: {
    color: '#1A1D22',
    fontSize: 12,
    fontWeight: '700',
  },
  newOrderCardSecondarySubtext: {
    marginTop: 5,
    color: '#767B83',
    fontSize: 10,
    fontWeight: '400',
  },
  liveOrdersSection: {
    paddingHorizontal: 20,
    paddingTop: 6,
    marginTop: 8,
    marginBottom: 6,
  },
  liveOrdersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  liveOrdersTitle: {
    color: '#0F5F65',
    fontSize: 14,
    fontWeight: '700',
  },
  liveOrdersSeeAllBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  liveOrdersSeeAllText: {
    color: '#0F5F65',
    fontSize: 14,
    fontWeight: '500',
  },
  liveOrderPage: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  liveOrderCard: {
    borderRadius: 12,
    backgroundColor: '#F8F8F6',
    borderWidth: 1,
    borderColor: '#E2E6EA',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    height: 100,
  },
  liveStatusPill: {
    alignSelf: 'justify-content',
    borderRadius: 16,
    marginBottom: 5,
    width: 90,
    height: 16,
  },
  liveStatusPillText: {
    alignSelf: 'center',
    fontSize: 10,
    fontWeight: '700',
  },
  liveOrderNumber: {
    color: '#0F0F0F',
    fontSize: 12,
    fontWeight: '700',
  },
  liveOrderPieces: {
    marginTop: 4,
    color: '#1A1D22',
    fontSize: 13,
    fontWeight: '400',
  },
  liveStatusBar: {
    marginTop: 12,
    height: 4,
    width: '100%',
    borderRadius: 2,
    backgroundColor: '#E2E6EA',
    overflow: 'hidden',
  },
  liveStatusBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  liveOrdersDotsRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  liveOrdersDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#AAC0C5',
  },
  liveOrdersDotActive: {
    width: 16,
    borderRadius: 4,
    backgroundColor: '#0F5F65',
  },
  bannerListContent: {
    gap: 0,
  },
  bannerCard: {
    overflow: 'hidden',
    backgroundColor: colors.cardBackground,
  },
  bannerImage: {
    width: '100%',
    height: '100%',
  },
  bannerFallback: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  bannerSkeletonCard: {
    backgroundColor: '#E9ECEF',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  bannerSkeletonShine: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#DDE2E8',
    opacity: 0.7,
  },
  bannerSkeletonLineWrap: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  bannerSkeletonLinePrimary: {
    width: '60%',
    height: 10,
    borderRadius: 6,
    backgroundColor: '#C9D1D9',
  },
  bannerSkeletonLineSecondary: {
    width: '35%',
    height: 8,
    borderRadius: 6,
    backgroundColor: '#C9D1D9',
    opacity: 0.8,
  },
  fallbackTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  fallbackSubtitle: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
  },
  categoriesSection: {
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  categoriesTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '400',
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  categoryStateCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    minHeight: 90,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  categorySkeletonCard: {
    height: 170,
    borderRadius: 12,
    backgroundColor: '#E9ECEF',
  },
});

export default HomeScreen;
