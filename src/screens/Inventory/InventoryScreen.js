import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Text,
  Image,
  ActivityIndicator,
  Dimensions,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import TopNavbar from '../../components/common/TopNavbar';
import Icon from '../../components/common/Icon';
import { SearchInput } from '../../components/common';
import {
  useGetDesignTypesQuery,
  useGetDesignsByTypeQuery,
  useLookupDesignsMutation,
} from '../../store/api';
import useDebounce from '../../hooks/useDebounce';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import AddDesignModal from '../../components/modals/AddDesignModal';
import DesignQuotationModal from '../../components/modals/DesignQuotationModal';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NUM_COLS = 2;
const CARD_GAP = 8;
const CARD_WIDTH = (SCREEN_WIDTH - 32 - CARD_GAP * (NUM_COLS - 1)) / NUM_COLS;

const TYPE_ICONS = {
  cad: 'diamond',
  coral: 'draw',
};


export default function InventoryScreen({ navigation }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [vectorSearchImages, setVectorSearchImages] = useState(null);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [selectedDesignId, setSelectedDesignId] = useState(null);
  const [selectedDesignGroupItem, setSelectedDesignGroupItem] = useState(null);
  const [showDesignQuotation, setShowDesignQuotation] = useState(false);

  const debouncedSearch = useDebounce(searchQuery, 1000);

  const { data: designTypes = [], isLoading: typesLoading } = useGetDesignTypesQuery();
  const queryArgs = useMemo(() => ({
    designType: selectedType,
    search: debouncedSearch || undefined,
    category: categoryFilter !== 'all' ? categoryFilter : undefined,
  }), [selectedType, debouncedSearch, categoryFilter]);
  const { data: queryImages = [], isLoading: imagesLoading, isFetching: imagesFetching, refetch: refetchImages } = useGetDesignsByTypeQuery(
    queryArgs,
    { skip: !selectedType },
  );

  const [lookupDesigns, { isLoading: vectorSearchLoading }] = useLookupDesignsMutation();

  const images = vectorSearchImages || queryImages;
  const [categories, setCategories] = useState(['all']);

  useEffect(() => { setCategories(['all']); }, [selectedType]);

  useEffect(() => {
    if (!images.length) return;
    setCategories(prev => {
      const set = new Set(prev.filter(c => c !== 'all'));
      images.forEach(img => {
        const cat = img.Category || img.category;
        if (cat) set.add(cat);
      });
      return set.size === prev.length - 1 ? prev : ['all', ...Array.from(set)];
    });
  }, [images, selectedType]);

  const handleTypePress = useCallback((type) => {
    setSelectedType(type);
    setSearchQuery('');
    setCategoryFilter('all');
    setVectorSearchImages(null);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedType(null);
    setSearchQuery('');
    setCategoryFilter('all');
    setVectorSearchImages(null);
  }, []);

  const runImageSearch = useCallback(async (asset) => {
    if (!selectedType || !asset?.uri) return;
    try {
      const image = {
        uri: asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || `search_${Date.now()}.jpg`,
      };
      const res = await lookupDesigns({ image, designType: selectedType }).unwrap();
      setVectorSearchImages(Array.isArray(res) ? res : res?.images || []);
    } catch (e) {
      Alert.alert('Search Error', 'Failed to search by image. Please try again.');
    }
  }, [selectedType, lookupDesigns]);

  const handleDesignPress = useCallback((item) => {
    const id = item.designId || item._id || item.Key;
    setSelectedDesignId(id);
    setSelectedDesignGroupItem(item);
    setShowDesignQuotation(true);
  }, []);

  const handleCloseDesignQuotation = useCallback(() => {
    setShowDesignQuotation(false);
    setSelectedDesignId(null);
    setSelectedDesignGroupItem(null);
  }, []);

  const handleCameraSearch = useCallback(() => {
    setShowPhotoPicker(true);
  }, []);

  const handlePickFromCamera = useCallback(async () => {
    setShowPhotoPicker(false);
    const result = await launchCamera({ mediaType: 'photo', quality: 0.8 });
    if (result.assets?.length > 0) {
      await runImageSearch(result.assets[0]);
    }
  }, [runImageSearch]);

  const handlePickFromGallery = useCallback(async () => {
    setShowPhotoPicker(false);
    const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8, selectionLimit: 1 });
    if (result.assets?.length > 0) {
      await runImageSearch(result.assets[0]);
    }
  }, [runImageSearch]);

  if (!selectedType) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TopNavbar navigation={navigation} />
        <View style={styles.headerBar}>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>Design Inventory</Text>
            <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)}>
              <Icon name="add" size={24} color={colors.textWhite} />
            </TouchableOpacity>
          </View>
        </View>
        {typesLoading ? (
          <View style={styles.loader}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : (
          <FlatList
            data={designTypes}
            keyExtractor={item => item}
            contentContainerStyle={styles.typesList}
            numColumns={2}
            columnWrapperStyle={styles.typesRow}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.typeCard} onPress={() => handleTypePress(item)} activeOpacity={0.8}>
                <View style={styles.typeIconWrap}>
                  <Icon name={TYPE_ICONS[String(item).toLowerCase()] || 'image'} size={36} color={colors.background} />
                </View>
                <Text style={styles.typeLabel}>{item}</Text>
                <Icon name="chevron-right" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Icon name="inventory-2" size={56} color={colors.textSecondary} />
                <Text style={styles.emptyTitle}>No design types found</Text>
                <Text style={styles.emptySubtitle}>Add a design to get started</Text>
              </View>
            }
          />
        )}
        <AddDesignModal key="types" visible={showAddModal} designType={selectedType} onClose={() => setShowAddModal(false)} />
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <TopNavbar navigation={navigation} />
        <View style={styles.headerBar}>
          <View style={styles.headerContent}>
            <TouchableOpacity onPress={handleBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.backBtn}>
              <Icon name="arrow-back" size={24} color={colors.textWhite} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{selectedType} Designs</Text>
            <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)}>
              <Icon name="add" size={24} color={colors.textWhite} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchContainer}>
            <SearchInput
              placeholder="Search designs..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              onClear={() => setSearchQuery('')}
            />
          </View>
          <TouchableOpacity style={styles.cameraBtn} onPress={handleCameraSearch}>
            <Icon name="camera-alt" size={20} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterToggle} onPress={() => setShowFilters(v => !v)}>
            <Icon name="tune" size={20} color={showFilters ? colors.textWhite : colors.primary} />
          </TouchableOpacity>
        </View>

        {showFilters && categories.length > 1 && (
          <View style={styles.filterBar}>
            <FlatList
              data={categories}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={item => item}
              contentContainerStyle={styles.chipsContainer}
              renderItem={({ item }) => {
                const isActive = categoryFilter === item;
                return (
                  <TouchableOpacity
                    style={[styles.chip, isActive && styles.chipActive]}
                    onPress={() => setCategoryFilter(isActive ? 'all' : item)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                      {item === 'all' ? 'All' : item}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}

        {vectorSearchImages && (
          <View style={styles.imageSearchBar}>
            <Icon name="image" size={18} color={colors.textWhite} />
            <Text style={styles.imageSearchText}>Searching by uploaded image</Text>
            <TouchableOpacity style={styles.imageSearchReset} onPress={() => setVectorSearchImages(null)}>
              <Icon name="close" size={18} color={colors.textWhite} />
            </TouchableOpacity>
          </View>
        )}

        {imagesLoading || vectorSearchLoading ? (
          <View style={styles.loader}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : (
          <FlatList
            data={images}
            keyExtractor={(item, idx) => item.enquiryId || item.designId || item._id || item.Key || String(idx)}
            numColumns={NUM_COLS}
            contentContainerStyle={styles.gridContent}
            columnWrapperStyle={styles.gridRow}
            onRefresh={refetchImages}
            refreshing={imagesFetching}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Icon name="image" size={56} color={colors.textSecondary} />
                <Text style={styles.emptyTitle}>
                  {searchQuery || categoryFilter !== 'all' ? 'No matching designs' : 'No designs yet'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {searchQuery || categoryFilter !== 'all' ? 'Try a different search or filter' : 'Tap + to add a design'}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.gridCardShadow}>
                <TouchableOpacity
                  style={styles.gridCard}
                  activeOpacity={0.85}
                   onPress={() => handleDesignPress(item)}
                >
                   {item.versions && item.versions.length > 1 ? (
                        <View style={styles.versionBadge}>
                          <Text style={styles.versionBadgeText}>Total {item.versions.length} versions available</Text>
                        </View>
                      ) : null}
                  <Image
                    source={{ uri: item.Url || item.url }}
                    style={styles.gridImage}
                    resizeMode="contain"
                  />
                  <View style={styles.gridCardFooter}>
                    {item.Name ? (
                      <Text style={styles.gridCardName} numberOfLines={1}>{item.Name}</Text>
                    ) : null}
                    <View style={styles.gridCardBadgeRow}>
                      {item.Category ? (
                        <Text style={styles.gridCardCategory} numberOfLines={1}>{item.Category}</Text>
                      ) : null}
                   
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          />
        )}

        <AddDesignModal key={selectedType} visible={showAddModal} designType={selectedType} onClose={() => setShowAddModal(false)} />
      </SafeAreaView>
      <Modal visible={showPhotoPicker} transparent animationType="fade" onRequestClose={() => setShowPhotoPicker(false)}>
        <Pressable style={styles.photoPickerOverlay} onPress={() => setShowPhotoPicker(false)}>
          <View style={styles.photoPickerSheet}>
            <Text style={styles.photoPickerTitle}>Search by Image</Text>
            <TouchableOpacity style={styles.photoPickerOption} onPress={handlePickFromCamera}>
              <Icon name="camera-alt" size={22} color={colors.primary} />
              <Text style={styles.photoPickerOptionText}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoPickerOption} onPress={handlePickFromGallery}>
              <Icon name="photo-library" size={22} color={colors.primary} />
              <Text style={styles.photoPickerOptionText}>Choose from Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoPickerCancel} onPress={() => setShowPhotoPicker(false)}>
              <Text style={styles.photoPickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
      <DesignQuotationModal
        visible={showDesignQuotation}
        designId={selectedDesignId}
        designGroupData={selectedDesignGroupItem}
        navigation={navigation}
        onClose={handleCloseDesignQuotation}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerBar: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.textWhite,
    flex: 1,
    marginLeft: 12,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typesList: {
    padding: 16,
    paddingBottom: 40,
  },
  typesRow: {
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },
  typeCard: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.borderLight,
    shadowColor: colors.cardShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  typeIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeLabel: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    textTransform: 'uppercase',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchContainer: { flex: 1, minWidth: 0 },
  cameraBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  filterToggle: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  filterBar: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chipsContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  chipTextActive: {
    color: colors.textWhite,
  },
  gridContent: {
    padding: 16,
    paddingBottom: 40,
  },
  gridRow: {
    gap: CARD_GAP,
    marginBottom: CARD_GAP,
  },
  gridCardShadow: {
    width: CARD_WIDTH,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  gridCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  gridImage: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
    backgroundColor: colors.borderLight,
  },
  gridCardFooter: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 2,
  },
  gridCardName: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  gridCardBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gridCardCategory: {
    fontSize: 10,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    flex: 1,
  },
  versionBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  versionBadgeText: {
    fontSize: 9,
    fontFamily: fonts.bold,
    color: colors.textWhite,
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyTitle: {
    marginTop: 16,
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  emptySubtitle: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  imageSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.primaryLight,
  },
  imageSearchText: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.textWhite,
  },
  imageSearchReset: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  photoPickerSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  photoPickerTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 20,
  },
  photoPickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
    marginBottom: 10,
  },
  photoPickerOptionText: {
    fontSize: 15,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  photoPickerCancel: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 6,
  },
  photoPickerCancelText: {
    fontSize: 15,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
});
