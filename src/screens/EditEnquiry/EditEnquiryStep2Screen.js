import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { Button } from '../../components/common';
import { Heading, CustomText, BodyText } from '../../components/common/Text';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useUploadImageMutation, useUpdateEnquiryMutation } from '../../store/api';
import { useAuth } from '../../context/AuthContext';
import BrandedAlert from '../../components/common/BrandedAlert';
import { useBrandedAlert } from '../../hooks/useBrandedAlert';

const EditEnquiryStep2Screen = ({ route, navigation }) => {
  const { formData, enquiry } = route.params;
  const { user } = useAuth();
  const roleLower = user?.role?.toLowerCase();
  const isClient =
    roleLower === 'client' ||
    roleLower === 'cl' ||
    user?.roleId === 4 ||
    user?.roleNumber === 4;

  const clientIdForApi =
    formData.clientId ||
    (isClient ? user?.clientId : null) ||
    enquiry.clientId ||
    enquiry.ClientId;
  const [selectedImages, setSelectedImages] = useState([]);
  
  // Redux mutations
  const [uploadImage, { isLoading: isUploading }] = useUploadImageMutation();
  const [updateEnquiry, { isLoading: isUpdating }] = useUpdateEnquiryMutation();
  
  const loading = isUploading || isUpdating;

  const { alertConfig, showAlert, hideAlert } = useBrandedAlert();

  // Request camera permission for Android
  const requestCameraPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'App needs access to your camera to take photos',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        return false;
      }
    }
    return true;
  };

  // Request storage permission for Android (supports both images and videos)
  const requestStoragePermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const androidVersion = Platform.Version;
        
        // For Android 13+ (API 33+), need both READ_MEDIA_IMAGES and READ_MEDIA_VIDEO for mixed media
        if (androidVersion >= 33) {
          const imagePermission = 'android.permission.READ_MEDIA_IMAGES';
          const videoPermission = 'android.permission.READ_MEDIA_VIDEO';
          
          // Request both permissions
          const imageGranted = await PermissionsAndroid.request(
            imagePermission,
            {
              title: 'Media Permission',
              message: 'App needs access to your photos and videos',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            }
          );
          
          const videoGranted = await PermissionsAndroid.request(
            videoPermission,
            {
              title: 'Media Permission',
              message: 'App needs access to your videos',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            }
          );
          
          // Return true if at least one is granted (for mixed media, we need both ideally)
          return imageGranted === PermissionsAndroid.RESULTS.GRANTED || 
                 videoGranted === PermissionsAndroid.RESULTS.GRANTED;
        } else {
          // For older Android versions, use READ_EXTERNAL_STORAGE
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          {
            title: 'Storage Permission',
              message: 'App needs access to your storage to select images and videos',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
        }
      } catch (err) {
        return false;
      }
    }
    return true;
  };

  const handleImagePicker = async (source) => {
    const hasCameraPermission = source === 'camera' ? await requestCameraPermission() : true;
    const hasStoragePermission = source === 'library' ? await requestStoragePermission() : true;

    if (!hasCameraPermission || !hasStoragePermission) {
      showAlert('Permission Denied', 'Please grant camera/storage permissions to upload images.', 'warning');
      return;
    }

    // Use 'mixed' for library to allow videos, but 'photo' for camera (camera videos handled separately)
    const options = {
      mediaType: source === 'library' ? 'mixed' : 'photo', // Allow videos from library
      quality: 0.8,
      selectionLimit: 10 - selectedImages.length,
    };

    try {
      const response = source === 'camera' 
        ? await launchCamera(options)
        : await launchImageLibrary(options);

      if (response.didCancel) {
        return;
      }

      if (response.errorMessage) {
        showAlert('Error', response.errorMessage, 'error');
        return;
      }

      if (response.assets && response.assets.length > 0) {
        const newImages = response.assets.map(asset => {
          // Determine file extension based on type or file name
          const isVideo = asset.type?.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm|wmv|flv|3gp)$/i.test(asset.fileName || '');
          const defaultExtension = isVideo ? 'mp4' : 'jpg';
          const defaultName = asset.fileName || `${source}_${Date.now()}.${defaultExtension}`;
          
          return {
          uri: asset.uri,
            type: asset.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
            name: defaultName,
          };
        });

        setSelectedImages(prev => [...prev, ...newImages]);
      }
    } catch (error) {
      showAlert('Error', 'Failed to pick media', 'error');
    }
  };

  const handleRemoveImage = (index) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!user?.id) {
      showAlert('Error', 'User not authenticated', 'error');
      return;
    }

    if (!enquiry?.id) {
      showAlert('Error', 'Enquiry ID is missing', 'error');
      return;
    }

    try {
      // Upload new images
      const uploadedImages = [];
      for (const image of selectedImages) {
        try {
          const imageForm = new FormData();
          imageForm.append('image', {
            uri: image.uri,
            type: image.type,
            name: image.name,
          });

          const uploadResult = await uploadImage(imageForm).unwrap();
          if (uploadResult.key || uploadResult.Key) {
            uploadedImages.push(uploadResult.key || uploadResult.Key);
          }
        } catch (uploadError) {
          // Continue with other images even if one fails
        }
      }

      // Priority mapping for API - form values are already in API format
      const priorityForAPI = formData.priority || 'Normal';

      // Prepare enquiry data according to API payload structure (exact format from user's example)
      const enquiryData = {
        Id: enquiry.id,
        Name: formData.title,
        ClientId: clientIdForApi,
        Priority: priorityForAPI,
        StoneType: formData.stoneType && formData.stoneType.trim() ? formData.stoneType.trim() : null,
        Remarks: formData.description && formData.description.trim() ? formData.description : null,
        ShippingDate: formData.deadline && formData.deadline.trim() ? formData.deadline : null,
        CoralCode: enquiry.CoralCode || enquiry.coralCode || null,
        CadCode: enquiry.CadCode || enquiry.cadCode || null,
        Budget: formData.budget && formData.budget.trim() ? formData.budget.trim() : null,
        SpecialRemarks: formData.specialRemarks && formData.specialRemarks.trim() ? formData.specialRemarks.trim() : null,
      };

      // Add uploaded images to existing images if any
      if (uploadedImages.length > 0) {
        const existingImages = enquiry.images || enquiry.ReferenceImages || [];
        enquiryData.ReferenceImages = [...existingImages, ...uploadedImages];
      }

      

      await updateEnquiry({ id: enquiry.id, ...enquiryData }).unwrap();
      
      
      
      showAlert(
        'Enquiry Updated',
        'Your enquiry has been updated successfully!',
        'info',
        [
          {
            text: 'OK',
            onPress: () => {
              // Go back to SingleEnquiry screen (removes EditEnquiryStep2 from stack)
              // The SingleEnquiry screen will automatically refresh due to cache invalidation
              
              navigation.goBack();
            },
          },
        ],
      );
    } catch (error) {
      showAlert(
        'Error',
        error.data?.error || error.message || 'Failed to update enquiry. Please try again.',
        'error'
      );
    }
  };

  const renderFormSummary = () => {
    const originalData = enquiry?._originalData || enquiry;
    const existingImages = enquiry?.images || enquiry?.ReferenceImages || originalData?.ReferenceImages || [];
    
    return (
      <View style={styles.summaryCard}>
        <CustomText variant="label" style={styles.summaryTitle}>
          Enquiry Summary
        </CustomText>
        <View style={styles.summaryRow}>
          <BodyText style={styles.summaryLabel}>Title:</BodyText>
          <BodyText style={styles.summaryValue}>{formData.title}</BodyText>
        </View>
        {!isClient && (
          <View style={styles.summaryRow}>
            <BodyText style={styles.summaryLabel}>Priority:</BodyText>
            <BodyText style={styles.summaryValue}>{formData.priority}</BodyText>
          </View>
        )}
        {formData.budget && (
          <View style={styles.summaryRow}>
            <BodyText style={styles.summaryLabel}>Budget:</BodyText>
            <BodyText style={styles.summaryValue}>
              {formData.budget ? formData.budget : 'Not specified'}
            </BodyText>
          </View>
        )}
        {formData.specialRemarks && user?.role?.toLowerCase() !== 'client' && user?.roleId !== 4 && user?.roleNumber !== 4 && (
          <View style={styles.summaryRow}>
            <BodyText style={styles.summaryLabel}>Special Remarks:</BodyText>
            <BodyText style={styles.summaryValue}>{formData.specialRemarks}</BodyText>
          </View>
        )}
        {existingImages.length > 0 && (
          <View style={styles.summaryRow}>
            <BodyText style={styles.summaryLabel}>Existing Images:</BodyText>
            <BodyText style={styles.summaryValue}>{existingImages.length}</BodyText>
          </View>
        )}
      </View>
    );
  };

  const renderImageUpload = () => {
    const originalData = enquiry?._originalData || enquiry;
    const existingImages = enquiry?.images || enquiry?.ReferenceImages || originalData?.ReferenceImages || [];
    
    return (
      <View style={styles.section}>
        <CustomText variant="label" style={styles.sectionTitle}>
          Reference Images
        </CustomText>
        
        {existingImages.length > 0 && (
          <View style={styles.existingImagesContainer}>
            <CustomText variant="caption" color="secondary" style={styles.existingImagesLabel}>
              Existing Images ({existingImages.length})
            </CustomText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {existingImages.map((image, index) => {
                const imageUri = typeof image === 'string' 
                  ? image 
                  : (image.Url || image.url || image.URI || image.uri || '');
                return imageUri ? (
                  <View key={index} style={styles.imageContainer}>
                    <Image source={{ uri: imageUri }} style={styles.existingImage} />
                  </View>
                ) : null;
              })}
            </ScrollView>
          </View>
        )}

        {selectedImages.length > 0 && (
          <View style={styles.selectedImagesContainer}>
            <CustomText variant="caption" color="secondary" style={styles.selectedImagesLabel}>
              New Images ({selectedImages.length})
            </CustomText>
            <View style={styles.selectedImagesGrid}>
              {selectedImages.map((image, index) => (
                <View key={index} style={styles.imageContainer}>
                  <Image source={{ uri: image.uri }} style={styles.selectedImage} />
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => handleRemoveImage(index)}>
                    <Icon name="close" size={20} color={colors.textWhite} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}

        {selectedImages.length < 10 && (
          <View style={styles.uploadButtons}>
            <Button
              title="Choose from Library"
              variant="outline"
              onPress={() => handleImagePicker('library')}
              style={styles.uploadButton}
            />
            <Button
              title="Take Photo"
              variant="outline"
              onPress={() => handleImagePicker('camera')}
              style={styles.uploadButton}
            />
          </View>
        )}
      </View>
    );
  };

  const renderInstructions = () => (
    <View style={styles.instructionsCard}>
      <CustomText variant="label" style={styles.instructionsTitle}>
        Instructions
      </CustomText>
      <BodyText style={styles.instructionsText}>
        • You can add up to 10 reference images
      </BodyText>
      <BodyText style={styles.instructionsText}>
        • Images help designers understand your requirements better
      </BodyText>
      <BodyText style={styles.instructionsText}>
        • You can skip this step if you don't have images
      </BodyText>
    </View>
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Heading level={3}>Update References</Heading>
        <CustomText variant="caption" color="secondary">
          Update reference materials (optional)
        </CustomText>
      </View>

      {renderFormSummary()}
      {renderImageUpload()}
      {renderInstructions()}

      <View style={styles.footer}>
        <Button
          title="Update Enquiry"
          onPress={handleSubmit}
          loading={loading}
          style={styles.submitButton}
        />
        
        <Button
          title="Back to Step 1"
          variant="outline"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        />
      </View>
      <BrandedAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        buttons={alertConfig.buttons}
        onClose={hideAlert}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  header: {
    padding: 24,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    shadowColor: colors.shadow || '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  section: {
    padding: 20,
    backgroundColor: colors.background,
    marginBottom: 12,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 12,
    shadowColor: colors.shadow || '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    marginBottom: 16,
    fontSize: fonts.base,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.3,
  },
  summaryCard: {
    backgroundColor: colors.background,
    padding: 18,
    margin: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    shadowColor: colors.shadow || '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryTitle: {
    marginBottom: 14,
    fontSize: fonts.base,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.3,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryLabel: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: fonts.sm,
  },
  summaryValue: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: fonts.sm,
  },
  existingImagesContainer: {
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  existingImagesLabel: {
    marginBottom: 10,
    fontWeight: '600',
    fontSize: fonts.sm,
  },
  selectedImagesContainer: {
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectedImagesLabel: {
    marginBottom: 10,
    fontWeight: '600',
    fontSize: fonts.sm,
  },
  selectedImagesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  imageContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  existingImage: {
    width: 100,
    height: 100,
    borderRadius: 10,
    marginRight: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectedImage: {
    width: 100,
    height: 100,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  removeButton: {
    position: 'absolute',
    top: -10,
    right: -10,
    backgroundColor: colors.error,
    borderRadius: 14,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  uploadButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  uploadButton: {
    flex: 1,
  },
  instructionsCard: {
    backgroundColor: colors.background,
    padding: 18,
    margin: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    shadowColor: colors.shadow || '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  instructionsTitle: {
    marginBottom: 12,
    fontSize: fonts.base,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.3,
  },
  instructionsText: {
    marginBottom: 8,
    color: colors.textSecondary,
    fontSize: fonts.sm,
    fontWeight: '500',
    lineHeight: 20,
  },
  footer: {
    padding: 20,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    shadowColor: colors.shadow || '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  submitButton: {
    marginBottom: 12,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  backButton: {
    marginTop: 8,
  },
});

export default EditEnquiryStep2Screen;

