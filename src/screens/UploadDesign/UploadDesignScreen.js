import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Text,
  Image,
  Platform,
  PermissionsAndroid,
  Modal,
  Clipboard,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
// DocumentPicker is optional - will check if available
let DocumentPicker;
try {
  DocumentPicker = require('react-native-document-picker').default;
} catch (e) {
  DocumentPicker = null;
}
import { Card } from '../../components/cards/Cards';
import { Button, Input } from '../../components/common';
import Icon from '../../components/common/Icon';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { CustomText } from '../../components/common/Text';
import { useValidateImageUploadMutation, useGetEnquiriesQuery } from '../../store/api';
import { useAuth } from '../../context/AuthContext';
import BrandedAlert from '../../components/common/BrandedAlert';

const UploadDesignScreen = ({ route, navigation }) => {
  const { designType, enquiry, enquiryId, returnRoute, isFinalVersion } = route.params || {};

  console.log('[UploadDesignScreen] params:', { designType, enquiryId, isFinalVersion, returnRoute });

  const { user } = useAuth();

  const originalData = enquiry?._originalData || enquiry;

  // Get the code for Coral or CAD (initial value)
  const initialDesignCode =
    designType === 'coral'
      ? originalData?.CoralCode ||
        enquiry?.CoralCode ||
        enquiry?.coralCode ||
        ''
      : originalData?.CadCode || enquiry?.CadCode || enquiry?.cadCode || '';

  // Get existing versions from local prop (may be empty if from list API)
  const localDesignData =
    designType === 'coral'
      ? originalData?.Coral || enquiry?.Coral || []
      : originalData?.Cad || enquiry?.Cad || [];

  const localNextVersion = localDesignData.length + 1;

  // Generate versions 1 to 50
  const allVersions = Array.from({ length: 50 }, (_, i) => ({
    label: `Version ${i + 1}`,
    value: i + 1,
  }));

  const [designCode, setDesignCode] = useState(initialDesignCode);
  const [selectedVersion, setSelectedVersion] = useState(localNextVersion);

  // Fetch enquiry to get accurate version count
  const resolvedEnquiryId = enquiry?.id || enquiry?._id || enquiryId;
  const { data: searchResult } = useGetEnquiriesQuery(
    { id: resolvedEnquiryId, limit: 1 },
    { skip: !resolvedEnquiryId },
  );
  const fullEnquiry = searchResult?.data?.[0] || null;

  useEffect(() => {
    if (!fullEnquiry) return;
    const raw = fullEnquiry?._originalData || fullEnquiry;
    const lastCorObj = raw?.lastCoral;
    const lastCadObj = raw?.lastCad;
    const lastVersion = designType === 'coral' ? lastCorObj?.Version : lastCadObj?.Version;
    const nextVer = lastVersion ? parseInt(lastVersion, 10) + 1 : 1;
    console.log('[UploadDesign] designType:', designType, 'lastCorObj:', lastCorObj, 'lastCadObj:', lastCadObj, 'nextVer:', nextVer);
    setSelectedVersion(nextVer);
  }, [fullEnquiry, designType]);

  const [selectedImages, setSelectedImages] = useState([]);
  const [selectedExcel, setSelectedExcel] = useState(null);
  const [showVersionDropdown, setShowVersionDropdown] = useState(false);
  const [imageValidated, setImageValidated] = useState(false);
  const [cost, setCost] = useState(0);
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [], checklist: [] });
  const showAlert = (title, message, type = 'info', buttons = [], checklist = []) =>
    setAlertConfig({ visible: true, title, message, type, buttons, checklist });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));

  const [validateImageUpload, { isLoading: isUploading }] =
    useValidateImageUploadMutation();

  // Request storage permission for Android (supports both images and videos)
  const requestStoragePermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const androidVersion = Platform.Version;

        // For Android 13+ (API 33+), need both READ_MEDIA_IMAGES and READ_MEDIA_VIDEO for mixed media
        if (androidVersion >= 33) {
          const imagePermission = 'android.permission.READ_MEDIA_IMAGES';
          const videoPermission = 'android.permission.READ_MEDIA_VIDEO';

          // Check current permission status first
          const imageStatus = await PermissionsAndroid.check(imagePermission);
          const videoStatus = await PermissionsAndroid.check(videoPermission);

          // Request image permission if not granted
          let imageGranted = imageStatus;
          if (!imageStatus) {
            imageGranted = await PermissionsAndroid.request(imagePermission, {
              title: 'Media Permission',
              message: 'App needs access to your photos and videos',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            });
            imageGranted = imageGranted === PermissionsAndroid.RESULTS.GRANTED;
          }

          // Request video permission if not granted
          let videoGranted = videoStatus;
          if (!videoStatus) {
            videoGranted = await PermissionsAndroid.request(videoPermission, {
              title: 'Media Permission',
              message: 'App needs access to your videos',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            });
            videoGranted = videoGranted === PermissionsAndroid.RESULTS.GRANTED;
          }

          // For mixed media, we need both permissions
          // Return true only if both are granted
          return imageGranted && videoGranted;
        } else {
          // For older Android versions, use READ_EXTERNAL_STORAGE
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
            {
              title: 'Storage Permission',
              message:
                'App needs access to your storage to select images and videos',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            },
          );
          return granted === PermissionsAndroid.RESULTS.GRANTED;
        }
      } catch (err) {
        console.error('Permission error:', err);
        // On some devices, permissions might not be needed, so return true
        return true;
      }
    }
    return true;
  };

  const handleSelectImages = async () => {
    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
      showAlert(
        'Permission Denied',
        'Storage permission is required to select images and videos. Please grant both photo and video permissions in app settings.',
        'error',
        [{ text: 'OK' }],
      );
      return;
    }

    try {
      const result = await launchImageLibrary({
        mediaType: 'mixed', // Allow both images and videos
        quality: 0.8,
        allowsMultiple: true,
        selectionLimit: 20,
        includeBase64: false,
      });

      if (result.didCancel) {
        return;
      }

      if (result.errorCode) {
        const errorMsg =
          result.errorMessage || `Failed to select media: ${result.errorCode}`;

        // Handle specific error: "For input string" - usually means file metadata issue
        let userMessage = errorMsg;
        if (
          errorMsg.includes('For input string') ||
          errorMsg.includes('9223372036854775807')
        ) {
          userMessage =
            'Unable to read file metadata. This may happen with certain video files. Please try:\n\n1. Selecting a different file\n2. Converting the video to a different format\n3. Using a smaller video file';
        }

        if (__DEV__) {
          console.error('❌ [UploadDesign] Image Picker Error:', {
            errorCode: result.errorCode,
            errorMessage: errorMsg,
            fullResponse: result,
          });
        }

        showAlert('Error', userMessage, 'error', [{ text: 'OK' }]);
        return;
      }

      if (result.assets && result.assets.length > 0) {
        const maxVideoSize = 100 * 1024 * 1024; // 100MB per backend spec
        const maxVideoCount = 5; // Max 5 videos per CAD/Coral version per backend spec
        const errors = [];
        const validAssets = [];

        // Validate each asset
        result.assets.forEach((asset, index) => {
          const isVideo =
            asset.type?.startsWith('video/') ||
            /\.(mp4|mov|avi|mkv|webm|wmv|flv|3gp|m4v)$/i.test(
              asset.fileName || '',
            );

          // Validate video file size
          if (isVideo && asset.fileSize) {
            if (asset.fileSize > maxVideoSize) {
              const sizeMB = (asset.fileSize / (1024 * 1024)).toFixed(2);
              errors.push(
                `${
                  asset.fileName || `Video ${index + 1}`
                }: ${sizeMB}MB exceeds 100MB limit`,
              );
              return;
            }
          }

          validAssets.push(asset);
        });

        // Check video count limit
        const videoCount = validAssets.filter(asset => {
          const isVideo =
            asset.type?.startsWith('video/') ||
            /\.(mp4|mov|avi|mkv|webm|wmv|flv|3gp|m4v)$/i.test(
              asset.fileName || '',
            );
          return isVideo;
        }).length;

        const existingVideoCount = selectedImages.filter(
          img => img.isVideo,
        ).length;

        if (videoCount + existingVideoCount > maxVideoCount) {
          showAlert(
            'Video Limit Exceeded',
            `Maximum ${maxVideoCount} videos allowed per ${
              designType === 'coral' ? 'Coral' : 'CAD'
            } version. You already have ${existingVideoCount} video(s) selected.`,
            'warning',
            [{ text: 'OK' }],
          );
          return;
        }

        // Show errors if any
        if (errors.length > 0) {
          showAlert('File Validation Error', errors.join('\n'), 'warning', [
            { text: 'OK' },
          ]);
          // Still add valid files if any
          if (validAssets.length === 0) {
            return;
          }
        }

        const newImages = validAssets.map((asset, index) => {
          // Determine file extension based on type or file name
          const isVideo =
            asset.type?.startsWith('video/') ||
            /\.(mp4|mov|avi|mkv|webm|wmv|flv|3gp|m4v)$/i.test(
              asset.fileName || '',
            );
          const defaultExtension = isVideo ? 'mp4' : 'jpg';
          const defaultName =
            asset.fileName ||
            `design_${Date.now()}_${index}.${defaultExtension}`;

          // Only include required fields - exclude width, height, fileSize, etc.
          // to prevent backend parsing errors
          return {
            uri: asset.uri,
            type: asset.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
            name: defaultName,
            isVideo: isVideo, // Add flag for UI display only
          };
        });
        setSelectedImages(prev => [...prev, ...newImages]);
      } else {
        showAlert('No Selection', 'No files were selected', 'warning');
      }
    } catch (error) {
      console.error('Error selecting media:', error);
      showAlert('Error', error.message || 'Failed to select media files. Please try again.', 'error', [{ text: 'OK' }]);
    }
  };

  const handleSelectExcel = async () => {
    if (!DocumentPicker) {
      showAlert('Feature Not Available', 'Document picker is not installed. Please install react-native-document-picker to use this feature.', 'warning', [{ text: 'OK' }]);
      return;
    }

    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
      showAlert('Permission Denied', 'Storage permission is required to select files', 'error');
      return;
    }

    try {
      const result = await DocumentPicker.pick({
        type: [
          DocumentPicker.types.xls,
          DocumentPicker.types.xlsx,
          DocumentPicker.types.csv,
        ],
        allowMultiSelection: false,
      });

      if (result && result.length > 0) {
        const file = result[0];
        setSelectedExcel({
          uri: file.uri,
          name: file.name,
          type: file.type || 'application/vnd.ms-excel',
          size: file.size,
        });
      }
    } catch (error) {
      if (
        DocumentPicker &&
        DocumentPicker.isCancel &&
        DocumentPicker.isCancel(error)
      ) {
        return;
      }
      showAlert('Error', 'Failed to select Excel file', 'error');
    }
  };

  const handleRemoveImage = index => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleRemoveExcel = () => {
    setSelectedExcel(null);
  };

  const handleValidateImages = async () => {
    if (!designCode || designCode.trim() === '') {
      showAlert('Validation Error', `Please enter ${designType === 'coral' ? 'Coral' : 'CAD'} Code`, 'warning');
      return;
    }

    if (selectedImages.length === 0) {
      showAlert('Warning', 'Please select at least one image to validate', 'warning');
      return;
    }

    if (!enquiry?.id && !enquiry?._id && !enquiryId) {
      showAlert('Error', 'Enquiry ID is missing', 'error');
      return;
    }

    try {
      const enquiryId2 = enquiry?.id || enquiry?._id || enquiryId;
    

      // Validate only the first image (API accepts single image)
      const firstImage = selectedImages[0];
      
      if (__DEV__) {
        console.log('🔍 [UploadDesign] Validating image:', {
          enquiryId2,
          imageUri: firstImage.uri?.substring(0, 50) + '...',
          imageType: firstImage.type,
          imageName: firstImage.name,
        });
      }

      const result = await validateImageUpload({
        image: firstImage,
        enquiryId: enquiryId2,
      }).unwrap();

      if (__DEV__) {
        console.log('✅ [UploadDesign] Image validation successful:', result);
      }

      // Store validation result in AsyncStorage for Final Look PDF
      try {
        await AsyncStorage.setItem(`@validation_${enquiryId2}`, JSON.stringify(result));
      } catch (e) {
        if (__DEV__) console.warn('⚠️ Failed to store validation result:', e.message);
      }

      // Display validation results
      const summary = result?.summary || 'Validation completed';
      const issues = result?.issues;
      const hasIssues = Array.isArray(issues) && issues.length > 0;

      const checklist = hasIssues
        ? issues.map(issue => ({ text: issue, status: 'fail' }))
        : [{ text: summary, status: 'pass' }];

      showAlert(
        'Validation Result',
        hasIssues ? summary : '',
        hasIssues ? 'warning' : 'success',
        [
          {
            text: 'Continue',
            onPress: () => {
              navigation.navigate('UploadExcel', {
                enquiryId: enquiryId2,
                designType,
                version: selectedVersion.toString(),
                designCode: designCode.trim(),
                images: selectedImages,
                validationResult: result,
                cost: cost,
                returnRoute,
                isFinalVersion,
              });
            },
          },
          {
            text: 'Re-Upload',
            onPress: () => {
              // Clear selected images to allow re-upload
              setSelectedImages([]);
            },
            style: 'cancel',
          },
        ],
        checklist,
      );
    } catch (error) {
      const errorMessage =
        error?.data?.message ||
        (typeof error?.data === 'string' ? error.data : null) ||
        error?.message ||
        'Failed to validate image. Please try again.';
      showAlert('Validation Failed', errorMessage, 'warning');
    }
  };

  const renderVersionDropdown = () => {
    return (
      <View style={styles.dropdownContainer}>
        <TouchableOpacity
          style={styles.dropdown}
          onPress={() => setShowVersionDropdown(!showVersionDropdown)}
          activeOpacity={0.7}
        >
          <Text style={styles.dropdownText}>Version {selectedVersion}</Text>
          <Icon name="arrow-drop-down" size={24} color={colors.textSecondary} />
        </TouchableOpacity>

        <Modal
          visible={showVersionDropdown}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowVersionDropdown(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowVersionDropdown(false)}
          >
            <View style={styles.dropdownModal}>
              <ScrollView
                style={styles.dropdownScrollView}
                nestedScrollEnabled={true}
                showsVerticalScrollIndicator={true}
              >
                {allVersions.map(version => (
                  <TouchableOpacity
                    key={version.value}
                    style={[
                      styles.dropdownOption,
                      selectedVersion === version.value &&
                        styles.dropdownOptionSelected,
                    ]}
                    onPress={() => {
                      setSelectedVersion(version.value);
                      setShowVersionDropdown(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownOptionText,
                        selectedVersion === version.value &&
                          styles.dropdownOptionTextSelected,
                      ]}
                    >
                      {version.label}
                    </Text>
                    {selectedVersion === version.value && (
                      <Icon name="check" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  };

  const renderUploadArea = (
    title,
    onPress,
    files,
    onRemove,
    isMultiple = false,
  ) => (
    <View style={styles.uploadSection}>
      <Text style={styles.uploadLabel}>{title}</Text>
      <TouchableOpacity
        style={styles.uploadArea}
        onPress={onPress}
        activeOpacity={0.7}
      >
        <Icon name="cloud-upload" size={40} color={colors.primary} />
        <Text style={styles.uploadText}>Drag and Drop Here or</Text>
        <Text style={styles.uploadLink}>
          Upload {isMultiple ? 'Files' : 'File'}
        </Text>
      </TouchableOpacity>

      {/* Show selected files */}
      {isMultiple && files.length > 0 && (
        <View style={styles.selectedFilesContainer}>
          {files.map((file, index) => {
            const isVideo =
              file.isVideo ||
              file.type?.startsWith('video/') ||
              /\.(mp4|mov|avi|mkv|webm|wmv|flv|3gp)$/i.test(file.name || '');
            return (
              <View key={index} style={styles.selectedFileItem}>
                {isVideo ? (
                  <View style={styles.videoPreviewContainer}>
                    <Icon name="videocam" size={24} color={colors.primary} />
                  </View>
                ) : (
                  <Image
                    source={{ uri: file.uri }}
                    style={styles.previewImage}
                  />
                )}
                <Text style={styles.fileName} numberOfLines={1}>
                  {file.name}
                </Text>
                <TouchableOpacity
                  onPress={() => onRemove(index)}
                  style={styles.removeButton}
                >
                  <Icon name="close" size={20} color={colors.error} />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {!isMultiple && files && (
        <View style={styles.selectedFilesContainer}>
          <View style={styles.selectedFileItem}>
            <Icon name="insert-drive-file" size={40} color={colors.primary} />
            <Text style={styles.fileName} numberOfLines={1}>
              {files.name}
            </Text>
            <TouchableOpacity onPress={onRemove} style={styles.removeButton}>
              <Icon name="close" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <Card style={styles.card}>
          <Text style={styles.title}>
            Add {designType === 'coral' ? 'Coral' : 'CAD'}
          </Text>

          {/* Code & Cost Fields */}
          <View style={styles.codeBlock}>
            <Text style={styles.label}>
              {designType === 'coral' ? 'Coral' : 'CAD'} Code:
            </Text>
            <View style={styles.codeInputRow}>
              <Input
                value={designCode}
                onChangeText={setDesignCode}
                editable={true}
                placeholder={`Enter ${
                  designType === 'coral' ? 'Coral' : 'CAD'
                } Code`}
                style={styles.codeInput}
              />
              <TouchableOpacity
                style={styles.copyButton}
                onPress={() => {
                  if (designCode) {
                    Clipboard.setString(designCode);
                    showAlert('Copied', 'Code copied to clipboard', 'success');
                  }
                }}
              >
                <Icon name="content-copy" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.costBlock}>
            <Text style={styles.label}>
              {designType === 'coral' ? 'Coral' : 'CAD'} Cost:
            </Text>
            <Input
              value={cost}
              onChangeText={setCost}
              editable={true}
              placeholder={`Enter ${
                designType === 'coral' ? 'Coral' : 'CAD'
              } Cost`}
              inputMode="numeric"
            />
          </View>

          {/* Version Dropdown */}
          <View style={styles.versionContainer}>
            <Text style={styles.label}>Version:</Text>
            {renderVersionDropdown()}
          </View>

          {/* Upload Images/Videos */}
          {renderUploadArea(
            'Upload Images/Videos:',
            handleSelectImages,
            selectedImages,
            handleRemoveImage,
            true,
          )}

          {/* Upload Excel */}
          {/* {renderUploadArea(
            'Upload Excel:',
            handleSelectExcel,
            selectedExcel,
            handleRemoveExcel,
            false
          )} */}
        </Card>
      </ScrollView>

      {/* Upload All Button */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          onPress={handleValidateImages}
          disabled={isUploading}
          style={[
            styles.adminActionButton,
            styles.adminActionButtonPrimary,
            isUploading && styles.btnDisabled,
          ]}
          activeOpacity={0.85}
        >
          {isUploading ? (
            <>
              <Icon name="hourglass-empty" size={18} color={colors.textWhite} />
              <Text style={styles.adminActionText}>Uploading...</Text>
            </>
          ) : (
            <>
              <Icon name="cloud-upload" size={18} color={colors.textWhite} />
              <Text style={styles.adminActionText}>Validate Image</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
      <BrandedAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        checklist={alertConfig.checklist}
        buttons={alertConfig.buttons}
        onClose={hideAlert}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  card: {
    padding: 20,
  },
  title: {
    fontSize: fonts.xl,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 24,
  },
  codeBlock: {
    marginBottom: 16,
  },
  costBlock: {
    marginBottom: 20,
  },
  label: {
    fontSize: fonts.md,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  codeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  codeInput: {
    flex: 1,
    marginRight: 8,
  },
  copyButton: {
    padding: 8,
  },
  versionContainer: {
    marginBottom: 20,
  },
  dropdownContainer: {
    marginBottom: 0,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: colors.surface,
  },
  dropdownText: {
    fontSize: fonts.md,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownModal: {
    backgroundColor: colors.background,
    borderRadius: 12,
    minWidth: 200,
    maxWidth: '80%',
    maxHeight: '60%',
    shadowColor: colors.shadow || colors.textPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  dropdownScrollView: {
    maxHeight: 400,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || colors.border,
  },
  dropdownOptionSelected: {
    backgroundColor: colors.backgroundSecondary || colors.surface,
  },
  dropdownOptionText: {
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  dropdownOptionTextSelected: {
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  uploadSection: {
    marginBottom: 24,
  },
  uploadLabel: {
    fontSize: fonts.md,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  uploadArea: {
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    minHeight: 150,
  },
  uploadText: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: 12,
    marginBottom: 4,
  },
  uploadLink: {
    fontSize: fonts.md,
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  selectedFilesContainer: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectedFileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
    marginBottom: 8,
    maxWidth: '48%',
  },
  previewImage: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 8,
  },
  videoPreviewContainer: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 8,
    backgroundColor: colors.backgroundSecondary || colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileName: {
    flex: 1,
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  removeButton: {
    padding: 4,
    marginLeft: 4,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  adminActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  adminActionButtonPrimary: {
    backgroundColor: colors.primary,
  },
  adminActionText: {
    color: colors.textWhite,
    fontFamily: fonts.medium,
    fontSize: 14,
    marginLeft: 8,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});

export default UploadDesignScreen;
