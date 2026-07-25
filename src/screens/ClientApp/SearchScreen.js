import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../../constants/colors';
import catalogApi from '../../services/catalogApi';

const { width: SCREEN_W } = Dimensions.get('window');
// 2-column grid: 16px side padding × 2, 10px gap between columns
const PRODUCT_CARD_W = (SCREEN_W - 32 - 10) / 2;

// Expands a word to include its likely singular/plural counterpart so filter
// narrowing treats "ring"/"rings" (and similar) as the same term. Mirrors the
// stemming applied on the backend (chandra_backend/src/routes/search.ts) so
// "necklace"/"necklaces"-style mismatches don't reappear in this client-side
// step.
function singularize(word) {
  if (/ies$/.test(word) && word.length > 3) return `${word.slice(0, -3)}y`;
  if (/(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
  return word;
}

function pluralize(word) {
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

function wordVariants(word) {
  const base = singularize(word);
  return [...new Set([word, base, pluralize(base)])];
}

// ─── Type-pill colour themes ─────────────────────────────────────────────────
const PILL = {
  category:    { bg: '#E6F0F1', text: '#143F45' },   // teal   — category
  profile:     { bg: '#EDE9FE', text: '#5B21B6' },   // violet — subcategory profile
  subcategory: { bg: '#FEF3C7', text: '#92400E' },   // amber  — subcategory
  product:     { bg: '#D1FAE5', text: '#065F46' },   // green  — product
};


// ─── Shared card shell ────────────────────────────────────────────────────────
const ResultCard = ({ imageUrl, pillLabel, pillTheme, onPress, children }) => (
  <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
    {imageUrl ? (
      <Image source={{ uri: imageUrl }} style={styles.cardImg} resizeMode="cover" />
    ) : (
      <View style={[styles.cardImg, styles.imgPlaceholder]} />
    )}
    <View style={styles.cardBody}>
      <View style={[styles.pill, { backgroundColor: pillTheme.bg }]}>
        <Text style={[styles.pillText, { color: pillTheme.text }]}>{pillLabel}</Text>
      </View>
      {children}
    </View>
    <MaterialIcons name="chevron-right" size={22} color={colors.textLight} />
  </TouchableOpacity>
);

// ─── Category card ────────────────────────────────────────────────────────────
const CategoryCard = ({ item, onPress }) => (
  <ResultCard
    imageUrl={item.imageUrl}
    pillLabel="CATEGORY"
    pillTheme={PILL.category}
    onPress={onPress}>
    <Text style={styles.cardTitle} numberOfLines={2}>{item.name}</Text>
    <Text style={styles.cardMeta} numberOfLines={1}>
      {Number(item.designCount || 0)} Designs
    </Text>
  </ResultCard>
);

// ─── Subcategory-profile card ─────────────────────────────────────────────────
// Profiles are grouping labels inside a category (e.g. "Solitaire Rings").
// Tapping navigates to CategoryDetails for the parent category.
const ProfileCard = ({ item, onPress }) => (
  <ResultCard
    imageUrl={item.imageUrl}
    pillLabel="PROFILE"
    pillTheme={PILL.profile}
    onPress={onPress}>
    <Text style={styles.cardTitle} numberOfLines={2}>{item.name}</Text>
    {item.categoryName ? (
      <Text style={styles.cardMeta} numberOfLines={1}>in {item.categoryName}</Text>
    ) : null}
  </ResultCard>
);

// ─── Subcategory card ─────────────────────────────────────────────────────────
const SubcategoryCard = ({ item, onPress }) => {
  const designCount = Number(item.designCount || 0);
  const metaParts = [
    item.categoryName ? `in ${item.categoryName}` : '',
    item.subcategoryProfileName ? `· ${item.subcategoryProfileName}` : '',
    designCount > 0 ? `${designCount} Designs` : '',
  ].filter(Boolean);

  return (
    <ResultCard
      imageUrl={item.imageUrl || item.thumbnailImage}
      pillLabel="SUBCATEGORY"
      pillTheme={PILL.subcategory}
      onPress={onPress}>
      <Text style={styles.cardTitle} numberOfLines={2}>{item.name}</Text>
      {metaParts.length > 0 ? (
        <Text style={styles.cardMeta} numberOfLines={1}>{metaParts.join(' ')}</Text>
      ) : null}
    </ResultCard>
  );
};

// ─── Helpers for product filter values ───────────────────────────────────────
// Products store filter data as [{filterName, filterValue}]. filterValue can be
// a string or an array of strings.
function getFilterVal(filterArr, ...names) {
  if (!Array.isArray(filterArr)) return '';
  for (const name of names) {
    const entry = filterArr.find(
      (f) => String(f.filterName || '').toLowerCase() === name.toLowerCase(),
    );
    if (entry) {
      const v = Array.isArray(entry.filterValue)
        ? entry.filterValue[0]
        : entry.filterValue;
      return v ? String(v) : '';
    }
  }
  return '';
}

// ─── Product card (grid tile matching catalog card design) ────────────────────
const SearchProductCard = ({ item, onPress }) => {
  // totalDiamondWeightCt is the actual carat weight (e.g. 3 ct).
  // pointer is in pointer-units (100 pointer = 1 ct) — used only as fallback.
  const caratCt  = Number(item.totalDiamondWeightCt || 0);
  const pointerPt = Number(item.pointer || 0);
  const filters  = Array.isArray(item.filter) ? item.filter : [];

  // Shape is stored as filterName='stoneshape'
  const shape = getFilterVal(filters, 'stoneshape', 'shape');
  const stone = getFilterVal(filters, 'stone');

  // Up to 1 extra custom filter — skip the common base filters
  const extra = filters
    .filter((f) => {
      const n = String(f.filterName || '').toLowerCase();
      return !['metal', 'stone', 'size', 'stoneshape', 'shape'].includes(n);
    })
    .slice(0, 1)
    .map((f) => (Array.isArray(f.filterValue) ? f.filterValue[0] : f.filterValue))
    .filter(Boolean)
    .map(String);

  const specs = [
    caratCt   > 0 ? `${caratCt} ct`   : '',
    pointerPt > 0 ? `${pointerPt} pt` : '',
    shape,
    stone,
    ...extra,
  ].filter(Boolean);

  // Only show subtitle when it adds new info — styleNo as subtitle only when
  // the name field exists (otherwise styleNo is already shown as the title).
  const subtitle = item.name
    ? (item.styleNo || '')
    : (item.subcategoryName || '');

  return (
    <TouchableOpacity
      style={[styles.productCard, { width: PRODUCT_CARD_W }]}
      onPress={onPress}
      activeOpacity={0.85}>

      {item.displayImage ? (
        <Image
          source={{ uri: item.displayImage }}
          style={styles.productCardImg}
          resizeMode="contain"
        />
      ) : (
        <View style={[styles.productCardImg, styles.productCardImgPlaceholder]} />
      )}

      {/* flex:1 so this block expands and pins the button to the card bottom */}
      <View style={styles.productCardContent}>
        <Text style={styles.productCardName} numberOfLines={2}>
          {item.name || item.styleNo}
        </Text>

        {subtitle ? (
          <Text style={styles.productCardSubtitle} numberOfLines={1}>{subtitle}</Text>
        ) : null}

        {specs.length > 0 ? (
          <View style={styles.specPillRow}>
            {specs.map((s) => (
              <View key={s} style={styles.specPill}>
                <Text style={styles.specPillText}>{s}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <TouchableOpacity style={styles.addToCartBtn} onPress={onPress} activeOpacity={0.85}>
        <Text style={styles.addToCartText}>Add to Cart</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

// ─── Section heading ──────────────────────────────────────────────────────────
const SectionHeading = ({ label, count }) => (
  <View style={styles.sectionHeading}>
    <Text style={styles.sectionLabel}>{label}</Text>
    <Text style={styles.sectionCount}>{count}</Text>
  </View>
);

// ─── Main screen ──────────────────────────────────────────────────────────────
const SearchScreen = ({ navigation }) => {
  const [query, setQuery]                             = useState('');
  const [loading, setLoading]                         = useState(false);
  const [categoryResults, setCategoryResults]         = useState([]);
  const [profileResults, setProfileResults]           = useState([]);
  const [subcategoryResults, setSubcategoryResults]   = useState([]);
  const [productResults, setProductResults]           = useState([]);
  const [hasSearched, setHasSearched]                 = useState(false);

  const inputRef    = useRef(null);
  const debounceRef = useRef(null);

  // Auto-focus search input on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  // Cleanup pending debounce on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Hide the bottom tab bar while this screen is focused
  useFocusEffect(
    useCallback(() => {
      const tabNav = navigation.getParent();
      tabNav?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => tabNav?.setOptions({ tabBarStyle: undefined });
    }, [navigation]),
  );

  // ── Search execution ────────────────────────────────────────────────────────
  const runSearch = useCallback(async (q) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setCategoryResults([]);
      setProfileResults([]);
      setSubcategoryResults([]);
      setProductResults([]);
      setHasSearched(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await catalogApi.get(`/search?q=${encodeURIComponent(trimmed)}`);
      const categories   = Array.isArray(res?.categories)         ? res.categories         : [];
      const profiles     = Array.isArray(res?.subcategoryProfiles)? res.subcategoryProfiles: [];
      const subcategories= Array.isArray(res?.subcategories)      ? res.subcategories      : [];
      const directProds  = Array.isArray(res?.products)           ? res.products           : [];

      setCategoryResults(categories);
      setProfileResults(profiles);
      setSubcategoryResults(subcategories);

      // ── Fetch all products for every matched subcategory in parallel ─────────
      // The base /search only returns up to 8 direct name/styleNo matches.
      // We also pull every product that belongs to matched subcategories so
      // the grid shows the full related catalogue.
      let allProducts = [...directProds];

      if (subcategories.length > 0) {
        const fetches = subcategories.map((sub) =>
          catalogApi
            .get(`/subcategories/${sub._id}/products`)
            .then((r) => ({ sub, list: Array.isArray(r?.products) ? r.products : [] }))
            .catch(() => ({ sub, list: [] })),
        );
        const responses = await Promise.all(fetches);

        for (const { sub, list } of responses) {
          // Enrich each product with its parent subcategory's nav context so
          // handleProductPress can navigate correctly without a second fetch.
          const enriched = list.map((p) => ({
            ...p,
            categoryId:                 p.categoryId                || sub.categoryId,
            categoryName:               p.categoryName              || sub.categoryName              || '',
            subcategoryId:              p.subcategoryId             || sub._id,
            subcategoryName:            p.subcategoryName           || sub.name                      || '',
            subcategoryProfileName:     p.subcategoryProfileName    || sub.subcategoryProfileName    || '',
            subcategoryFilterSchema:    p.subcategoryFilterSchema   || (Array.isArray(sub.filterSchema) ? sub.filterSchema : []),
            subcategoryImages:          p.subcategoryImages         || (Array.isArray(sub.images) ? sub.images : []),
            subcategoryThumbnailImage:  p.subcategoryThumbnailImage || sub.imageUrl || sub.thumbnailImage || '',
            subcategorySubtext:         p.subcategorySubtext        || sub.subtext                  || '',
            specialNotePlaceholderText: p.specialNotePlaceholderText|| sub.specialNotePlaceholderText|| 'Length variation',
          }));
          allProducts = allProducts.concat(enriched);
        }

        // Deduplicate by _id (direct search matches take priority)
        const seen = new Set();
        allProducts = allProducts.filter((p) => {
          const id = String(p._id);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
      }

      // ── Semantic filter narrowing ────────────────────────────────────────────
      // For multi-word queries (e.g. "round rings"), detect which words appear
      // as filter values in the product set (e.g. "round" → stoneshape=Round)
      // and narrow the list to products that satisfy ALL such filter words.
      // Single-word queries skip this so we don't over-restrict.
      const queryWords = trimmed.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
      if (queryWords.length > 1 && allProducts.length > 0) {
        const matchesFilterValue = (product, word) => {
          const pFilters = Array.isArray(product.filter) ? product.filter : [];
          const terms = wordVariants(word);
          return pFilters.some((f) => {
            const vals = Array.isArray(f.filterValue)
              ? f.filterValue
              : [f.filterValue];
            return vals.some((v) => {
              const val = String(v || '').toLowerCase();
              return terms.some((term) => val.includes(term));
            });
          });
        };

        // Words that appear in at least one product's filter values
        const filterTerms = queryWords.filter((w) =>
          allProducts.some((p) => matchesFilterValue(p, w)),
        );

        // Only narrow when the filter terms are a strict subset of the query
        // (i.e. at least one word is a structural term like a category name).
        // If ALL words are filter terms we skip narrowing to avoid empty results
        // for unusual combinations.
        if (filterTerms.length > 0 && filterTerms.length < queryWords.length) {
          allProducts = allProducts.filter((p) =>
            filterTerms.every((term) => matchesFilterValue(p, term)),
          );
        }
      }

      setProductResults(allProducts);
    } catch (err) {
      if (__DEV__) console.warn('[SearchScreen] search error:', err?.message);
      setCategoryResults([]);
      setProfileResults([]);
      setSubcategoryResults([]);
      setProductResults([]);
    } finally {
      setLoading(false);
      setHasSearched(true);
    }
  }, []);

  // ── Debounced input change ──────────────────────────────────────────────────
  const handleChange = useCallback((text) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), 300);
  }, [runSearch]);

  const handleClear = useCallback(() => {
    setQuery('');
    setCategoryResults([]);
    setProfileResults([]);
    setSubcategoryResults([]);
    setProductResults([]);
    setHasSearched(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    inputRef.current?.focus();
  }, []);

  // ── Navigation ──────────────────────────────────────────────────────────────
  // SearchScreen now lives in DashboardStack alongside all destination screens,
  // so a plain navigate pushes the destination onto the same stack — pressing
  // back from the destination returns here naturally.
  const navigateToResult = useCallback((screenName, params) => {
    navigation.navigate(screenName, params);
  }, [navigation]);

  // Category → CategoryDetails
  const handleCategoryPress = useCallback((cat) => {
    navigateToResult('CategoryDetails', {
      categoryId: cat._id,
      categoryName: cat.name,
      categoryBannerImages: Array.isArray(cat.categoryBannerImages) ? cat.categoryBannerImages : [],
      categoryImageUrl: cat.imageUrl || '',
    });
  }, [navigateToResult]);

  // SubcategoryProfile → CategoryDetails for the parent category
  // (The user sees the full category page with the profile group highlighted naturally)
  const handleProfilePress = useCallback((profile) => {
    navigateToResult('CategoryDetails', {
      categoryId: profile.categoryId,
      categoryName: profile.categoryName || '',
      categoryBannerImages: Array.isArray(profile.categoryBannerImages)
        ? profile.categoryBannerImages : [],
      categoryImageUrl: profile.imageUrl || '',
    });
  }, [navigateToResult]);

  // Subcategory → ProductList (or JacketsScreen for the Studs → Jackets flow)
  const handleSubcategoryPress = useCallback((sub) => {
    const isStuds   = String(sub.categoryName || '').trim().toLowerCase() === 'studs';
    const isJackets = String(sub.name         || '').trim().toLowerCase() === 'jackets';
    navigateToResult(isStuds && isJackets ? 'JacketsScreen' : 'ProductList', {
      categoryId:                 sub.categoryId,
      categoryName:               sub.categoryName               || '',
      subcategoryProfileName:     sub.subcategoryProfileName     || '',
      subcategoryId:              sub._id,
      subcategoryName:            sub.name,
      subcategorySubtext:         sub.subtext                    || '',
      subcategoryFilterSchema:    Array.isArray(sub.filterSchema) ? sub.filterSchema : [],
      subcategoryDescription:     sub.description || sub.infoText || sub.subtext || '',
      subcategoryImages:          Array.isArray(sub.images) ? sub.images : [],
      subcategoryThumbnailImage:  sub.imageUrl || sub.thumbnailImage || '',
      specialNotePlaceholderText: sub.specialNotePlaceholderText || 'Length variation',
    });
  }, [navigateToResult]);

  // Product → ProductList for the product's subcategory.
  // The backend already embeds full subcategory nav params on each product result
  // so we never need a second fetch.
  const handleProductPress = useCallback((product) => {
    const isStuds   = String(product.categoryName || '').trim().toLowerCase() === 'studs';
    const isJackets = String(product.subcategoryName || '').trim().toLowerCase() === 'jackets';
    navigateToResult(isStuds && isJackets ? 'JacketsScreen' : 'ProductList', {
      categoryId:                 product.categoryId,
      categoryName:               product.categoryName               || '',
      subcategoryProfileName:     product.subcategoryProfileName     || '',
      subcategoryId:              product.subcategoryId,
      subcategoryName:            product.subcategoryName            || 'Products',
      subcategorySubtext:         product.subcategorySubtext         || '',
      subcategoryFilterSchema:    Array.isArray(product.subcategoryFilterSchema)
        ? product.subcategoryFilterSchema : [],
      subcategoryDescription:     product.subcategoryDescription     || '',
      subcategoryImages:          Array.isArray(product.subcategoryImages)
        ? product.subcategoryImages : [],
      subcategoryThumbnailImage:  product.subcategoryThumbnailImage  || product.displayImage || '',
      specialNotePlaceholderText: product.specialNotePlaceholderText || 'Length variation',
    });
  }, [navigateToResult]);

  // ── Derived display state ───────────────────────────────────────────────────
  const isShortQuery  = query.trim().length < 2;
  const totalResults  =
    categoryResults.length + profileResults.length +
    subcategoryResults.length + productResults.length;
  const showNoResults = hasSearched && !loading && totalResults === 0;
  const showResults   = !loading && totalResults > 0;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>

      {/* ── Header bar ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={24} color={colors.textWhite} />
        </TouchableOpacity>

        <View style={styles.inputWrap}>
          <MaterialIcons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            ref={inputRef}
            style={styles.textInput}
            placeholder="Search by name, category or style no..."
            placeholderTextColor={colors.textLight}
            value={query}
            onChangeText={handleChange}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 ? (
            <TouchableOpacity
              onPress={handleClear}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* ── Results scroll ──────────────────────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}>

        {/* Idle prompt */}
        {isShortQuery && !loading ? (
          <View style={styles.stateWrap}>
            <MaterialIcons name="search" size={52} color={colors.border} />
            <Text style={styles.stateTitle}>Search the catalog</Text>
            <Text style={styles.stateSub}>
              Find by name, category, subcategory or style no.
            </Text>
          </View>
        ) : null}

        {/* Searching spinner */}
        {loading ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Searching…</Text>
          </View>
        ) : null}

        {/* Zero results */}
        {showNoResults ? (
          <View style={styles.stateWrap}>
            <MaterialIcons name="search-off" size={52} color={colors.border} />
            <Text style={styles.stateTitle}>No results found</Text>
            <Text style={styles.stateSub}>Try a different keyword</Text>
          </View>
        ) : null}

        {/* ── 1. Categories ───────────────────────────────────────────────── */}
        {showResults && categoryResults.length > 0 ? (
          <View style={styles.section}>
            <SectionHeading label="CATEGORIES" count={categoryResults.length} />
            {categoryResults.map((item) => (
              <CategoryCard
                key={String(item._id)}
                item={item}
                onPress={() => handleCategoryPress(item)}
              />
            ))}
          </View>
        ) : null}

        {/* ── 2. Subcategory profiles ─────────────────────────────────────── */}
        {showResults && profileResults.length > 0 ? (
          <View style={styles.section}>
            <SectionHeading label="PROFILES" count={profileResults.length} />
            {profileResults.map((item) => (
              <ProfileCard
                key={String(item._id)}
                item={item}
                onPress={() => handleProfilePress(item)}
              />
            ))}
          </View>
        ) : null}

        {/* ── 3. Subcategories ────────────────────────────────────────────── */}
        {showResults && subcategoryResults.length > 0 ? (
          <View style={styles.section}>
            <SectionHeading label="SUBCATEGORIES" count={subcategoryResults.length} />
            {subcategoryResults.map((item) => (
              <SubcategoryCard
                key={String(item._id)}
                item={item}
                onPress={() => handleSubcategoryPress(item)}
              />
            ))}
          </View>
        ) : null}

        {/* ── 4. Products (2-column grid) ──────────────────────────────────── */}
        {showResults && productResults.length > 0 ? (
          <View style={styles.section}>
            <SectionHeading label="PRODUCTS" count={productResults.length} />
            <View style={styles.productGrid}>
              {productResults.map((item) => (
                <SearchProductCard
                  key={String(item._id)}
                  item={item}
                  onPress={() => handleProductPress(item)}
                />
              ))}
            </View>
          </View>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
    gap: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    padding: 0,
    fontFamily: 'AvenirLTStd-Roman',
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 40 },

  // Empty / loading states
  stateWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 10,
  },
  stateTitle: {
    marginTop: 6,
    fontSize: 17,
    fontFamily: 'AvenirLTStd-Heavy',
    color: colors.textSecondary,
  },
  stateSub: {
    fontSize: 13,
    fontFamily: 'AvenirLTStd-Roman',
    color: colors.textLight,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    fontFamily: 'AvenirLTStd-Roman',
    color: colors.textSecondary,
  },

  // Section
  section: {
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'AvenirLTStd-Heavy',
    color: colors.textSecondary,
    letterSpacing: 1,
  },
  sectionCount: {
    fontSize: 11,
    fontFamily: 'AvenirLTStd-Roman',
    color: colors.textLight,
  },

  // Result card (shared shell)
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    marginBottom: 8,
    padding: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  cardImg: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  imgPlaceholder: {
    backgroundColor: colors.borderLight,
  },
  cardBody: {
    flex: 1,
    gap: 3,
  },

  // Type pill
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 2,
  },
  pillText: {
    fontSize: 9,
    fontFamily: 'AvenirLTStd-Heavy',
    letterSpacing: 0.8,
  },

  // Card text
  cardStyleNo: {
    fontSize: 11,
    fontFamily: 'AvenirLTStd-Roman',
    color: colors.textSecondary,
  },
  cardTitle: {
    fontSize: 14,
    fontFamily: 'AvenirLTStd-Medium',
    color: colors.textPrimary,
    lineHeight: 19,
  },
  cardMeta: {
    fontSize: 12,
    fontFamily: 'AvenirLTStd-Roman',
    color: colors.textSecondary,
  },

  // Product grid
  productGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  // Rich product card tile
  productCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
    flexDirection: 'column',
  },
  productCardContent: {
    flex: 1,
  },
  productCardImg: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    marginBottom: 10,
    backgroundColor: colors.borderLight,
  },
  productCardImgPlaceholder: {
    backgroundColor: colors.borderLight,
  },
  productCardName: {
    fontSize: 14,
    fontFamily: 'AvenirLTStd-Heavy',
    color: colors.textPrimary,
    marginBottom: 3,
    lineHeight: 19,
  },
  productCardSubtitle: {
    fontSize: 11,
    fontFamily: 'AvenirLTStd-Roman',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  specPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  specPill: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  specPillText: {
    fontSize: 11,
    fontFamily: 'AvenirLTStd-Roman',
    color: colors.textPrimary,
  },
  addToCartBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  addToCartText: {
    fontSize: 13,
    fontFamily: 'AvenirLTStd-Medium',
    color: colors.textWhite,
  },
});

export default SearchScreen;
