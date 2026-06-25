import React, { useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  Image,
  Alert,
  ActivityIndicator,
  TextInput,
  Dimensions,
  FlatList,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';

import Icon from '../../components/common/Icon';
import { colors } from '../../constants/colors';
import { useClients } from '../../features/clients/clientsHooks';
import {
  useJwelleryPriceDataMutation,
  useGetStoneTypesQuery,
} from '../../store/api';
import PdfViewer from '../../components/common/PdfViewer';

const screenWidth = Dimensions.get('window').width;

export default function JwelleryEstimate() {
  const [clientId, setClientId] = useState('');
  const [description, setDescription] = useState('');
  const [showClientModal, setShowClientModal] = useState(false);
  const { clients = [] } = useClients();

  const [stoneType, setStoneType] = useState('NaturalRegular');
  const [metalKt, setMetalKt] = useState('18K');
  const { data: stoneTypesData = [] } = useGetStoneTypesQuery();

  const [topView, setTopView] = useState(null);
  const [sideView, setSideView] = useState(null);
  const [angleView, setAngleView] = useState(null);
  const [additionalImages, setAdditionalImages] = useState([]);

  const [compactView, setCompactView] = useState(false);
  const [estimateResult, setEstimateResult] = useState(null);

  const [jwelleryPriceData, { isLoading }] = useJwelleryPriceDataMutation();

  // Fullscreen Image Modal States
  const [isImageModalVisible, setIsImageModalVisible] = useState(false);
  const [modalCurrentIndex, setModalCurrentIndex] = useState(0);
  const [zoomedImageIndex, setZoomedImageIndex] = useState(null);
  const [lastTap, setLastTap] = useState(null);
  const modalFlatListRef = useRef(null);

  // PDF Preview States
  const [pdfHtml, setPdfHtml] = useState(null);
  const [showPdfModal, setShowPdfModal] = useState(false);

  const clientOptions = clients.map(c => ({
    label: c.name || 'Unknown Client',
    value: c.id || c._id,
  }));

  const stoneOptions =
    stoneTypesData.length > 0
      ? stoneTypesData.map(st => ({
          label: st.label,
          value: st.value,
        }))
      : [
          { label: 'Natural Regular', value: 'NaturalRegular' },
          { label: 'Natural Lower', value: 'NaturalLower' },
          { label: 'CVD Lab Grown', value: 'CVDLabGrown' },
        ];

  const metalQualityOptions = [
    { label: '10K', value: '10K' },
    { label: '14K', value: '14K' },
    { label: '18K', value: '18K' },
    { label: '22K', value: '22K' },
    { label: 'Silver 925', value: 'Silver 925' },
    { label: 'Platinum', value: 'Platinum' },
  ];

  const allUploadedImages = [
    topView,
    sideView,
    angleView,
    ...additionalImages,
  ].filter(Boolean);

  const imagesData = allUploadedImages.map(uri => ({ uri, isVideo: false }));

  const selectedClientName =
    clients.find(c => c.id === clientId || c._id === clientId)?.name ||
    'Unknown Client';

  // Find the exact matrix combination based on the selected chips
  const selectedMatrixMatch = estimateResult?.matrix?.find(
    m => m.metalQuality === metalKt && m.stoneType === stoneType,
  );

  const estimatedPrice = selectedMatrixMatch
    ? (
        selectedMatrixMatch.pricing.MetalPrice +
        selectedMatrixMatch.pricing.DiamondsPrice +
        selectedMatrixMatch.pricing.DutiesAmount
      ).toFixed(2)
    : '0.00';

  // Generate HTML for the selected matrix match using brand colors
  const buildPricingHtml = useCallback(() => {
    if (!selectedMatrixMatch) return '';
    const p = selectedMatrixMatch.pricing;

    const stonesHtml = (p.Stones || [])
      .map(
        (s, idx) => `
      <tr style="${idx % 2 === 0 ? `background:${colors.backgroundSecondary}` : ''}">
        <td style="padding:8px;border:1px solid ${colors.border};text-align:center">${s.MmSize || '-'}</td>
        <td style="padding:8px;border:1px solid ${colors.border};text-align:center">${s.Color || '-'}</td>
        <td style="padding:8px;border:1px solid ${colors.border};text-align:center">${s.Shape || '-'}</td>
        <td style="padding:8px;border:1px solid ${colors.border};text-align:center">${s.SieveSize || '-'}</td>
        <td style="padding:8px;border:1px solid ${colors.border};text-align:right">${s.Weight || 0}</td>
        <td style="padding:8px;border:1px solid ${colors.border};text-align:center">${s.Pcs || 0}</td>
        <td style="padding:8px;border:1px solid ${colors.border};text-align:right">${s.CtWeight || 0}</td>
        <td style="padding:8px;border:1px solid ${colors.border};text-align:right">${s.Markup || 0}</td>
        <td style="padding:8px;border:1px solid ${colors.border};text-align:right">$${s.Price || 0}</td>
      </tr>
    `,
      )
      .join('');

    const applicableDuties = p.Applicable
      ? Object.entries(p.Applicable)
          .filter(([_, value]) => value)
          .map(([key]) => key.replace(/([A-Z])/g, ' $1').trim())
          .join(', ')
      : 'None';

    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; padding: 30px; color: ${colors.textPrimary}; background-color: ${colors.background}; }
          .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid ${colors.accent}; padding-bottom: 20px; }
          .header h1 { color: ${colors.primary}; margin: 0; font-size: 28px; }
          .header p { color: ${colors.textSecondary}; margin: 5px 0; font-size: 14px; }
          .section { margin: 25px 0; }
          .section-title { background: ${colors.primary}; color: ${colors.textWhite}; padding: 10px 15px; font-size: 16px; font-weight: bold; margin-bottom: 15px; border-radius: 4px; }
          .info-grid { display: table; width: 100%; margin-bottom: 15px; }
          .info-row { display: table-row; }
          .info-label { display: table-cell; padding: 8px; font-weight: bold; color: ${colors.textSecondary}; width: 40%; border-bottom: 1px solid ${colors.borderLight}; }
          .info-value { display: table-cell; padding: 8px; color: ${colors.textPrimary}; border-bottom: 1px solid ${colors.borderLight}; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th { background: ${colors.primaryLight}; color: ${colors.textWhite}; padding: 10px; text-align: center; font-size: 13px; border: 1px solid ${colors.border}; }
          td { padding: 8px; border: 1px solid ${colors.border}; font-size: 12px; }
          .total-section { background: ${colors.backgroundSecondary}; padding: 20px; border-radius: 8px; margin-top: 20px; border: 1px solid ${colors.border}; }
          .total-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid ${colors.borderLight}; }
          .total-label { font-weight: bold; color: ${colors.textSecondary}; }
          .total-value { color: ${colors.textPrimary}; font-weight: bold; }
          .grand-total { font-size: 20px; color: ${colors.primary}; margin-top: 15px; padding-top: 15px; border-top: 2px solid ${colors.accent}; }
          .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 2px solid ${colors.borderLight}; color: ${colors.textLight}; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Chandra Jewels</h1>
          <p>Pricing Breakdown Estimate</p>
          <p>${currentDate}</p>
        </div>

        <div class="section">
          <div class="section-title">Estimate Information</div>
          <div class="info-grid">
            <div class="info-row">
              <div class="info-label">Client Name:</div>
              <div class="info-value">${selectedClientName}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Selected Stone Type:</div>
              <div class="info-value">${stoneType}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Total Pieces:</div>
              <div class="info-value">${p.TotalPieces || 0}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Diamond Weight:</div>
              <div class="info-value">${p.DiamondWeight || 0} ct</div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Selected Metal Details</div>
          <div class="info-grid">
            <div class="info-row">
              <div class="info-label">Quality:</div>
              <div class="info-value">${metalKt}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Weight:</div>
              <div class="info-value">${p.Metal?.Weight || selectedMatrixMatch.metalWeightGrams || 0} g</div>
            </div>
            <div class="info-row">
              <div class="info-label">Rate:</div>
              <div class="info-value">$${p.Metal?.Rate || 0}/g</div>
            </div>
          </div>
        </div>

        ${
          p.Stones && p.Stones.length > 0
            ? `
        <div class="section">
          <div class="section-title">Stones Breakdown (${p.Stones.length} items)</div>
          <table>
            <thead>
              <tr>
                <th>MM</th>
                <th>Color</th>
                <th>Shape</th>
                <th>Sieve</th>
                <th>Avg Wt</th>
                <th>Pcs</th>
                <th>Ct Wt</th>
                <th>Markup</th>
                <th>$/Ct</th>
              </tr>
            </thead>
            <tbody>
              ${stonesHtml}
            </tbody>
          </table>
        </div>`
            : ''
        }

        <div class="section">
          <div class="section-title">Client Charges & Duties</div>
          <div class="info-grid">
            <div class="info-row">
              <div class="info-label">Loss:</div>
              <div class="info-value">${p.Client?.Loss || 0}%</div>
            </div>
            <div class="info-row">
              <div class="info-label">Labour:</div>
              <div class="info-value">$${p.Client?.Labour || 0}/g</div>
            </div>
            <div class="info-row">
              <div class="info-label">Extra Charges:</div>
              <div class="info-value">${p.Client?.ExtraCharges || 0}%</div>
            </div>
            <div class="info-row">
              <div class="info-label">Applied Duties:</div>
              <div class="info-value">${applicableDuties}</div>
            </div>
          </div>
        </div>

        <div class="total-section">
          <div class="total-row">
            <span class="total-label">Metal Price:</span>
            <span class="total-value">$${(p.MetalPrice || 0).toFixed(2)}</span>
          </div>
          <div class="total-row">
            <span class="total-label">Diamonds Price:</span>
            <span class="total-value">$${(p.DiamondsPrice || 0).toFixed(2)}</span>
          </div>
          <div class="total-row">
            <span class="total-label">Duties Amount:</span>
            <span class="total-value">$${(p.DutiesAmount || 0).toFixed(2)}</span>
          </div>
          <div class="total-row grand-total">
            <span class="total-label">TOTAL ESTIMATE:</span>
            <span class="total-value">$${estimatedPrice}</span>
          </div>
        </div>

        <div class="footer">
          <p>Generated by App Estimate Viewer</p>
          <p>This is a computer-generated estimate based on AI extraction and selected combinations.</p>
        </div>
      </body>
      </html>`;
  }, [selectedMatrixMatch, selectedClientName, stoneType, metalKt, estimatedPrice]);

  const handleImagePick = setImageFn => {
    launchImageLibrary({ mediaType: 'photo', quality: 0.8 }, response => {
      if (response.didCancel || response.errorCode) return;
      if (response.assets && response.assets.length > 0) {
        setImageFn(response.assets[0].uri);
      }
    });
  };

  const handleAdditionalImagePick = () => {
    if (additionalImages.length >= 5) {
      Alert.alert(
        'Limit Reached',
        'You can only upload up to 5 additional images.',
      );
      return;
    }
    launchImageLibrary({ mediaType: 'photo', quality: 0.8 }, response => {
      if (response.didCancel || response.errorCode) return;
      if (response.assets && response.assets.length > 0) {
        setAdditionalImages([...additionalImages, response.assets[0].uri]);
      }
    });
  };

  const formatImage = (uri, defaultName) => {
    if (!uri) return null;
    return {
      uri,
      type: 'image/jpeg',
      name: defaultName,
    };
  };

  const handleEstimate = async () => {
    if (!clientId) {
      Alert.alert('Missing Field', 'Please select a client.');
      return;
    }
    if (!topView) {
      Alert.alert(
        'Missing Field',
        'Please upload at least the Top View image.',
      );
      return;
    }

    const payload = {
      clientId,
      description,
      imageFrontView: formatImage(topView, 'front.jpg'),
      imageSideView: formatImage(sideView, 'side.jpg'),
      image45view: formatImage(angleView, 'angle.jpg'),
      additionalImages: additionalImages.map((uri, index) =>
        formatImage(uri, `additional_${index}.jpg`),
      ),
    };

    try {
      const response = await jwelleryPriceData(payload).unwrap();
      setEstimateResult(response);
      setCompactView(true);
    } catch (error) {
      Alert.alert('Error', error?.error || 'Failed to calculate pricing.');
    }
  };

  const openImageModal = index => {
    setModalCurrentIndex(index);
    setIsImageModalVisible(true);
  };

  const closeImageModal = () => {
    setIsImageModalVisible(false);
    setZoomedImageIndex(null);
  };

  const handleDoubleTap = index => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (lastTap && now - lastTap < DOUBLE_TAP_DELAY) {
      setZoomedImageIndex(zoomedImageIndex === index ? null : index);
    } else {
      setLastTap(now);
    }
  };

  const renderDropdown = (
    label,
    placeholder,
    value,
    options,
    isVisible,
    setVisible,
    onSelect,
    extraElement = null,
  ) => {
    const selectedLabel =
      options.find(o => o.value === value)?.label || placeholder;

    return (
      <View style={styles.inputContainer}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {extraElement}
        </View>
        <TouchableOpacity
          style={styles.dropdown}
          onPress={() => setVisible(true)}
          activeOpacity={0.8}>
          <Text style={[styles.dropdownText, !value && styles.placeholderText]}>
            {selectedLabel}
          </Text>
          <Icon
            name="arrow-drop-down"
            size={24}
            color={colors.textSecondary || '#516162'}
          />
        </TouchableOpacity>

        <Modal
          visible={isVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setVisible(false)}>
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setVisible(false)}>
            {/* TouchableWithoutFeedback prevents the overlay from stealing the click */}
            <TouchableWithoutFeedback>
              <View style={styles.modalContent}>
                {/* keyboardShouldPersistTaps added to allow clicks even if keyboard was open */}
                <ScrollView showsVerticalScrollIndicator={true} keyboardShouldPersistTaps="handled">
                  {options.map(opt => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.dropdownOption,
                        value === opt.value && styles.dropdownOptionSelected,
                      ]}
                      onPress={() => {
                        onSelect(opt.value);
                        setVisible(false);
                      }}>
                      <Text
                        style={[
                          styles.dropdownOptionText,
                          value === opt.value &&
                            styles.dropdownOptionTextSelected,
                        ]}>
                        {opt.label}
                      </Text>
                      {value === opt.value && (
                        <Icon
                          name="check"
                          size={20}
                          color={colors.primary || '#002626'}
                        />
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  };

  const renderChips = (options, selectedValue, onSelect) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.chipContainer}>
      {options.map(opt => (
        <TouchableOpacity
          key={opt.value}
          style={[
            styles.chip,
            selectedValue === opt.value && styles.chipSelected,
          ]}
          onPress={() => onSelect(opt.value)}>
          <Text
            style={[
              styles.chipText,
              selectedValue === opt.value && styles.chipTextSelected,
            ]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  return (
    <View style={styles.background}>
      {compactView ? (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.DetailBox}>
            <View style={styles.clientHeaderRow}>
              <View style={styles.clientAvatar}>
                <Icon name="person" size={24} color="#ffffff" />
              </View>
              <Text style={styles.clientNameText}>{selectedClientName}</Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.compactImagesScroll}>
              {allUploadedImages.map((uri, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.compactImageWrapper}
                  activeOpacity={0.8}
                  onPress={() => openImageModal(idx)}>
                  <Image source={{ uri }} style={styles.compactImage} />
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.divider} />

            <Text style={styles.sectionTitleBold}>Select Metal Quality</Text>
            {renderChips(metalQualityOptions, metalKt, setMetalKt)}

            <Text style={styles.sectionTitleBold}>Select Stone Type</Text>
            {renderChips(stoneOptions, stoneType, setStoneType)}

            <View style={styles.priceBox}>
              <Text style={styles.priceLabel}>Estimated Price</Text>
              {selectedMatrixMatch ? (
                <>
                  <Text style={styles.priceValue}>${estimatedPrice}</Text>
                  <TouchableOpacity
                    style={styles.breakdownPdfButton}
                    onPress={() => {
                      const html = buildPricingHtml();
                      if (html) {
                        setPdfHtml(html);
                        setShowPdfModal(true);
                      } else {
                        Alert.alert('Error', 'Unable to generate breakdown PDF');
                      }
                    }}>
                    <Icon name="picture-as-pdf" size={20} color="#ffffff" />
                    <Text style={styles.breakdownPdfButtonText}>
                      View Breakdown
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={styles.priceUnavailable}>
                  Pricing unavailable for this combination
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={styles.resetButton}
              onPress={() => {
                setCompactView(false);
                setTopView(null);
                setSideView(null);
                setAngleView(null);
                setAdditionalImages([]);
                setEstimateResult(null);
                setDescription('');
              }}>
              <Text style={styles.resetButtonText}>New Estimate</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.DetailBox}>
            <Text style={styles.DetailHeader}>Estimate Details</Text>
            <Text style={styles.DetailSubs}>
              Provide client details and high-quality imagery for an accurate
              appraisal.
            </Text>

            {renderDropdown(
              'Client*',
              'Select a client...',
              clientId,
              clientOptions,
              showClientModal,
              setShowClientModal,
              setClientId,
            )}

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={styles.descriptionInput}
                placeholder="Mention ring size, special instructions, or details about stones..."
                placeholderTextColor={colors.textLight || '#707978'}
                multiline
                numberOfLines={4}
                value={description}
                onChangeText={setDescription}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.uploadGridRow}>
              <View style={styles.uploadColumn}>
                <Text style={styles.uploadLabelBold}>Top View*</Text>
                <TouchableOpacity
                  style={styles.uploadBoxDashed}
                  onPress={() => handleImagePick(setTopView)}>
                  {topView ? (
                    <Image
                      source={{ uri: topView }}
                      style={styles.uploadedImage}
                    />
                  ) : (
                    <Icon
                      name="cloud-upload"
                      size={26}
                      color={colors.primary || '#002626'}
                    />
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.uploadColumn}>
                <Text style={styles.uploadLabelBold}>Side View</Text>
                <TouchableOpacity
                  style={[styles.uploadBoxDashed, styles.uploadBoxSecondary]}
                  onPress={() => handleImagePick(setSideView)}>
                  {sideView ? (
                    <Image
                      source={{ uri: sideView }}
                      style={styles.uploadedImage}
                    />
                  ) : (
                    <Icon name="add-a-photo" size={26} color={colors.textSecondary || '#516162'} />
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.uploadColumn}>
                <Text style={styles.uploadLabelBold}>45° Angle</Text>
                <TouchableOpacity
                  style={[styles.uploadBoxDashed, styles.uploadBoxSecondary]}
                  onPress={() => handleImagePick(setAngleView)}>
                  {angleView ? (
                    <Image
                      source={{ uri: angleView }}
                      style={styles.uploadedImage}
                    />
                  ) : (
                    <Icon name="view-in-ar" size={26} color={colors.textSecondary || '#516162'} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.additionalImagesContainer}>
              <Text style={styles.uploadLabelBold}>
                Additional Images (Optional)
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.additionalImagesScroll}>
                {additionalImages.map((uri, index) => (
                  <View key={index} style={styles.additionalUploadBox}>
                    <Image source={{ uri }} style={styles.uploadedImage} />
                  </View>
                ))}

                {additionalImages.length < 5 && (
                  <TouchableOpacity
                    style={styles.additionalUploadBox}
                    onPress={handleAdditionalImagePick}>
                    <Icon name="add" size={24} color={colors.textSecondary || '#707978'} />
                  </TouchableOpacity>
                )}
              </ScrollView>
              <Text style={styles.uploadSubTextItalic}>
                Up to 5 additional files
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.estimateButton,
                isLoading && styles.estimateButtonDisabled,
              ]}
              onPress={handleEstimate}
              disabled={isLoading}>
              {isLoading ? (
                <ActivityIndicator color={colors.textWhite || '#ffffff'} />
              ) : (
                <Text style={styles.estimateButtonText}>Check Pricing</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* Fullscreen Image Modal */}
      <Modal
        visible={isImageModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeImageModal}>
        <View style={styles.fullscreenImageBackdrop}>
          <TouchableOpacity
            style={[styles.fullscreenImageCloseButton, { zIndex: 999, elevation: 10 }]}
            onPress={closeImageModal}
            activeOpacity={0.7}>
            <Icon
              name="close"
              size={24}
              color={colors.textWhite || '#ffffff'}
            />
          </TouchableOpacity>
          {imagesData.length > 1 && (
            <View style={styles.modalImageCounter}>
              <Text style={styles.modalImageCounterText}>
                {modalCurrentIndex + 1} / {imagesData.length}
              </Text>
            </View>
          )}
          <FlatList
            ref={modalFlatListRef}
            data={imagesData}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={modalCurrentIndex}
            getItemLayout={(_, index) => ({
              length: screenWidth,
              offset: screenWidth * index,
              index,
            })}
            onMomentumScrollEnd={e => {
              const index = Math.round(
                e.nativeEvent.contentOffset.x / screenWidth,
              );
              setModalCurrentIndex(index);
              setZoomedImageIndex(null);
            }}
            scrollEventThrottle={16}
            scrollEnabled={zoomedImageIndex === null}
            keyExtractor={(_, index) => `modal-img-${index}`}
            renderItem={({ item: media, index }) => (
              <View style={styles.modalImageContainer}>
                <TouchableOpacity
                  activeOpacity={1}
                  onPress={() => handleDoubleTap(index)}
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}>
                  <Image
                    source={{ uri: media.uri }}
                    style={[
                      styles.fullscreenImage,
                      zoomedImageIndex === index &&
                        styles.fullscreenImageZoomed,
                    ]}
                    resizeMode="contain"
                  />
                </TouchableOpacity>

                {zoomedImageIndex === index && (
                  <View style={styles.zoomHintContainer}>
                    <Text style={styles.zoomHintText}>
                      Tap again to zoom out
                    </Text>
                  </View>
                )}
              </View>
            )}
          />
        </View>
      </Modal>

      {/* PDF View Modal */}
      <Modal
        visible={showPdfModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setShowPdfModal(false);
          setPdfHtml(null);
        }}>
        <View style={styles.pdfModalOverlay}>
          <View style={styles.pdfModalContent}>
            <PdfViewer html={pdfHtml} style={styles.pdfViewer} />
            <View style={styles.pdfModalToolbar}>
              <TouchableOpacity
                style={[
                  styles.pdfToolbarBtn,
                  { backgroundColor: 'rgba(0,0,0,0.5)' },
                ]}
                onPress={() => {
                  setShowPdfModal(false);
                  setPdfHtml(null);
                }}
                activeOpacity={0.8}>
                <Icon name="close" size={20} color={colors.textWhite || '#ffffff'} />
                <Text style={styles.pdfToolbarBtnText}>Close Preview</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: colors.backgroundSecondary || '#f5f7f7',
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  DetailBox: {
    backgroundColor: colors.cardBackground || '#ffffff',
    flexDirection: 'column',
    padding: 16,
    borderRadius: 12,
    elevation: 3,
    shadowColor: colors.cardShadow || '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 12,
    borderColor: colors.borderLight || 'rgba(192, 200, 199, 0.3)',
    borderWidth: 1,
  },
  DetailHeader: {
    fontSize: 24,
    color: colors.primary || '#002626',
    fontWeight: '700',
    marginBottom: 4,
  },
  DetailSubs: {
    fontSize: 14,
    color: colors.textSecondary || '#404848',
    fontWeight: '400',
    marginBottom: 16,
  },
  inputContainer: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary || '#1b1c1c',
    marginBottom: 8,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border || '#707978',
    borderRadius: 8,
    padding: 12,
    height: 48,
    backgroundColor: 'transparent',
  },
  dropdownText: {
    fontSize: 16,
    color: colors.textPrimary || '#1b1c1c',
  },
  placeholderText: {
    color: colors.textLight || '#707978',
  },
  descriptionInput: {
    borderWidth: 1,
    borderColor: colors.border || '#707978',
    borderRadius: 8,
    padding: 12,
    height: 100,
    color: colors.textPrimary || '#1b1c1c',
    fontSize: 16,
    backgroundColor: 'transparent',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.modalOverlay || 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: colors.modalBackground || '#ffffff',
    borderRadius: 12,
    minWidth: 250,
    maxWidth: '80%',
    maxHeight: '60%',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || 'rgba(192, 200, 199, 0.3)',
  },
  dropdownOptionSelected: {
    backgroundColor: colors.backgroundSecondary || '#f5f3f3',
  },
  dropdownOptionText: {
    fontSize: 16,
    color: colors.textPrimary || '#1b1c1c',
  },
  dropdownOptionTextSelected: {
    fontWeight: '700',
    color: colors.primary || '#002626',
  },
  uploadGridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 16,
    marginBottom: 16,
  },
  uploadColumn: {
    flex: 1,
    flexDirection: 'column',
    gap: 4,
  },
  uploadLabelBold: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary || '#404848',
    marginBottom: 4,
  },
  uploadBoxDashed: {
    height: 96,
    borderWidth: 1.5,
    borderColor: colors.border || '#C0C8C7',
    borderStyle: 'dashed',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.borderLight || 'rgba(245, 243, 243, 0.5)',
    overflow: 'hidden',
  },
  uploadBoxSecondary: {
    backgroundColor: colors.borderLight || 'rgba(245, 243, 243, 0.3)',
  },
  uploadedImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  additionalImagesContainer: {
    marginTop: 8,
  },
  additionalImagesScroll: {
    gap: 12,
    paddingBottom: 8,
    flexDirection: 'row',
  },
  additionalUploadBox: {
    width: 64,
    height: 64,
    borderWidth: 1.5,
    borderColor: colors.border || '#C0C8C7',
    borderStyle: 'dashed',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  uploadSubTextItalic: {
    fontSize: 12,
    color: colors.textSecondary || '#404848',
    fontStyle: 'italic',
    marginTop: 4,
  },
  estimateButton: {
    backgroundColor: colors.primary || '#002626',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  estimateButtonDisabled: {
    opacity: 0.7,
  },
  estimateButtonText: {
    color: colors.textWhite || '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  clientHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  clientAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary || '#002626',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  clientNameText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary || '#002626',
  },
  compactImagesScroll: {
    gap: 12,
    paddingBottom: 8,
    flexDirection: 'row',
  },
  compactImageWrapper: {
    width: 120,
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border || '#C0C8C7',
  },
  compactImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border || '#E0E5E5',
    marginVertical: 20,
  },
  sectionTitleBold: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary || '#1b1c1c',
    marginBottom: 12,
  },
  chipContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
    paddingBottom: 4,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border || '#C0C8C7',
    backgroundColor: colors.background || '#ffffff',
  },
  chipSelected: {
    backgroundColor: colors.primary || '#002626',
    borderColor: colors.primary || '#002626',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary || '#404848',
  },
  chipTextSelected: {
    color: colors.textWhite || '#ffffff',
  },
  priceBox: {
    backgroundColor: colors.backgroundSecondary || '#f5f7f7',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.borderLight || 'rgba(192, 200, 199, 0.5)',
  },
  priceLabel: {
    fontSize: 14,
    color: colors.textSecondary || '#404848',
    fontWeight: '600',
    marginBottom: 8,
  },
  priceValue: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.primary || '#002626',
    marginBottom: 16,
  },
  priceUnavailable: {
    fontSize: 14,
    color: colors.error || '#d9534f',
    fontStyle: 'italic',
  },
  breakdownPdfButton: {
    flexDirection: 'row',
    backgroundColor: colors.primary || '#002626',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    gap: 8,
  },
  breakdownPdfButtonText: {
    color: colors.textWhite || '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  resetButton: {
    marginTop: 20,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary || '#002626',
    borderRadius: 8,
  },
  resetButtonText: {
    color: colors.primary || '#002626',
    fontSize: 16,
    fontWeight: '700',
  },
  /* Fullscreen Modal Styles */
  fullscreenImageBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  fullscreenImageCloseButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  modalImageCounter: {
    position: 'absolute',
    top: 48,
    alignSelf: 'center',
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  modalImageCounterText: {
    color: colors.textWhite || '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalImageContainer: {
    width: screenWidth,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: screenWidth,
    height: '80%',
  },
  fullscreenImageZoomed: {
    transform: [{ scale: 2 }],
  },
  zoomHintContainer: {
    position: 'absolute',
    bottom: 40,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  zoomHintText: {
    color: colors.textWhite || '#ffffff',
    fontSize: 14,
  },
  /* PDF Modal Styles */
  pdfModalOverlay: {
    flex: 1,
    backgroundColor: colors.modalOverlay || 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  pdfModalContent: {
    width: '100%',
    height: '85%',
    backgroundColor: colors.modalBackground || '#ffffff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  pdfViewer: {
    flex: 1,
  },
  pdfModalToolbar: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
  },
  pdfToolbarBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
  },
  pdfToolbarBtnText: {
    color: colors.textWhite || '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
});