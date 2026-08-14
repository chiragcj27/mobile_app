import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  PermissionsAndroid,
  Text,
} from 'react-native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import {
  useUploadReferenceImagesMutation,
  useUpdateEnquiryMutation,
  useGetChatsByEnquiryV2Query,
} from '../../store/api';
import { useAuth } from '../../context/AuthContext';
import { useUsers } from '../../features/users/usersHooks';
import SuccessAnimation from '../../components/common/SuccessAnimation';
import {
  EnquiryChatCta,
  isEnquiryClientUser,
} from '../../components/enquiry/EnquirySummaryCard';
import BrandedAlert from '../../components/common/BrandedAlert';
import { useBrandedAlert } from '../../hooks/useBrandedAlert';

const normalizeEnquiryChat = (chat) => chat?._originalData || chat;

const getEnquiryChatId = (chat) => {
  if (!chat) return '';
  const n = normalizeEnquiryChat(chat);
  return String(n?._id || n?.id || chat._id || chat.id || '').trim();
};

const getEnquiryChatType = (chat) => {
  if (!chat) return '';
  const n = normalizeEnquiryChat(chat);
  return n?.Type || chat?.type || chat?.Type || '';
};

/** Prefer admin-client thread; if only one chat exists, open it */
const pickClientDirectChat = (chats) => {
  if (!Array.isArray(chats) || chats.length === 0) return null;
  const adminClient = chats.find((c) => getEnquiryChatType(c) === 'admin-client');
  if (adminClient) return adminClient;
  if (chats.length === 1) return chats[0];
  return null;
};

const AddEnquiryStep2Screen = ({ route, navigation }) => {
  const { formData, enquiry: enquiryToEdit, isEditMode, enquiryId } = route.params;
  const { user } = useAuth();
  const [selectedImages, setSelectedImages] = useState([]);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const { alertConfig, showAlert, hideAlert } = useBrandedAlert();
  
  // Fetch and cache users for name resolution
  useUsers();

  const { data: chatsForEnquiry } = useGetChatsByEnquiryV2Query(
    { enquiryId: String(enquiryId || '').trim() },
    { skip: !enquiryId },
  );
  
  // Handle system back button (Android) and swipe back gesture (iOS) to navigate to Enquiries list
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      // Prevent default behavior of going back to previous screen
      e.preventDefault();
      // Navigate directly to Enquiries list
      navigation.navigate('MainTabs', { screen: 'Enquiries' });
    });

    return unsubscribe;
  }, [navigation]);
  
  // Redux mutations
  const [uploadReferenceImages, { isLoading: isUploading }] = useUploadReferenceImagesMutation();
  const [updateEnquiry, { isLoading: isUpdating }] = useUpdateEnquiryMutation();
  
  const loading = isUploading || isUpdating;

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
        // On newer Android versions, permission might not be needed
        return true;
      }
    }
    return true;
  };

  const handleCamera = async () => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      showAlert('Permission Denied', 'Camera permission is required to take photos', 'warning');
      return;
    }

    const options = {
      mediaType: 'photo',
      quality: 0.8,
      saveToPhotos: true,
    };

    launchCamera(options, (response) => {
      if (response.didCancel) {
      } else if (response.errorCode) {
        showAlert('Error', `Camera Error: ${response.errorMessage}`, 'error');
      } else if (response.assets && response.assets.length > 0) {
        const asset = response.assets[0];
        if (asset.uri) {
          setSelectedImages(prev => [...prev, {
            uri: asset.uri,
            type: asset.type || 'image/jpeg',
            name: asset.fileName || `camera_${Date.now()}.jpg`,
          }]);
        }
      }
    });
  };

  const handleGallery = async () => {
    const hasPermission = await requestStoragePermission();
    if (!hasPermission && Platform.OS === 'android') {
      showAlert('Permission Denied', 'Storage permission is required to select images and videos', 'warning');
      return;
    }

    const options = {
      mediaType: 'mixed', // Allow both images and videos
      quality: 0.8,
      selectionLimit: 10, // Allow multiple selection
      includeBase64: false,
      // Don't request extra metadata that might cause parsing errors
      // The native picker will still read fileSize/duration, but we won't use them
    };

    launchImageLibrary(options, (response) => {
      if (response.didCancel) {
        return;
      } else if (response.errorCode) {
        const errorMsg = response.errorMessage || 'Unknown error';
        if (__DEV__) {
          console.error('❌ [AddEnquiryStep2] Image Picker Error:', {
            errorCode: response.errorCode,
            errorMessage: errorMsg,
            fullResponse: response,
          });
        }
        
        // Handle specific error: "For input string" - usually means file metadata issue
        let userMessage = errorMsg;
        if (errorMsg.includes('For input string') || errorMsg.includes('9223372036854775807')) {
          userMessage = 'Unable to read file metadata. This may happen with certain video files. Please try:\n\n1. Selecting a different file\n2. Converting the video to a different format\n3. Using a smaller video file';
        }
        
        showAlert('Error', `Image Picker Error: ${userMessage}`, 'error');
        return;
      } else if (response.assets && response.assets.length > 0) {
        const newImages = response.assets.map((asset, index) => {
          // Determine file extension based on type or file name
          const isVideo = asset.type?.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm|wmv|flv|3gp|m4v)$/i.test(asset.fileName || '');
          const defaultExtension = isVideo ? 'mp4' : 'jpg';
          const defaultName = asset.fileName || `image_${Date.now()}_${index}.${defaultExtension}`;
          
          // Create clean object with ONLY required fields
          // Explicitly exclude fileSize, duration, width, height, etc.
          // to prevent any metadata from being included
          const cleanAsset = {
          uri: asset.uri || '',
            type: asset.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
            name: defaultName,
          };
          
          // Log if there are extra properties (for debugging)
          if (__DEV__) {
            const assetKeys = Object.keys(asset || {});
            const extraKeys = assetKeys.filter(key => !['uri', 'type', 'fileName', 'fileSize', 'width', 'height', 'duration'].includes(key));
            if (extraKeys.length > 0 || asset.fileSize || asset.duration) {
              console.log(`⚠️ [AddEnquiryStep2] Asset ${index} has extra properties:`, {
                hasFileSize: !!asset.fileSize,
                fileSize: asset.fileSize,
                hasDuration: !!asset.duration,
                duration: asset.duration,
                hasWidth: !!asset.width,
                hasHeight: !!asset.height,
                extraKeys,
              });
            }
          }
          
          return cleanAsset;
        }).filter(img => img.uri);
        
        setSelectedImages(prev => [...prev, ...newImages]);
      }
    });
  };

  const handleImagePicker = () => {
    showAlert(
      'Select Media Source',
      'Choose how you want to add images or videos',
      'info',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Camera',
          onPress: handleCamera,
        },
        {
          text: 'Gallery',
          onPress: handleGallery,
        },
      ]
    );
  };

  const removeImage = (index) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    
    if (!user?.id) {
      showAlert('Error', 'User not found. Please login again.', 'error');
      return;
    }
    
    let enquiryData = null; // Declare outside try block for error logging
    
    try {
      // Map Priority from form values to API format
      const priorityMap = {
        'low': 'Low',
        'medium': 'Medium',
        'normal': 'Normal',
        'high': 'High',
        'super high': 'Super High',
        'urgent': 'Urgent',
        // Handle exact matches
        'Low': 'Low',
        'Medium': 'Medium',
        'Normal': 'Normal',
        'High': 'High',
        'Super High': 'Super High',
        'Urgent': 'Urgent',
      };
      
      const mappedPriority = priorityMap[formData.priority?.toLowerCase()] || priorityMap[formData.priority] || formData.priority || 'Medium';
      
      // For new enquiries: Upload reference images and then show success
      if (!isEditMode && enquiryId) {
        // Upload images if any are selected
      if (selectedImages.length > 0) {
          try {
            await uploadReferenceImages({
              enquiryId,
              images: selectedImages,
            }).unwrap();
          } catch (uploadError) {
            if (__DEV__) {
              console.error('❌ Error uploading reference images:', uploadError);
            }
            showAlert(
              'Upload Failed',
              uploadError?.data?.message || uploadError?.data?.error || 'Failed to upload images/videos. The enquiry was created but media could not be uploaded.',
              'error',
              [
                {
                  text: 'Continue Anyway',
                  onPress: () => {
                    navigation.navigate('MainTabs', { screen: 'Enquiries' });
                  },
                },
              ]
            );
            return;
          }
        }

        // Success - show Lottie animation instead of Alert
        setShowSuccessAnimation(true);
        return;
          }
          
      // For edit mode: Upload new images if any are selected
      if (isEditMode && enquiryToEdit?.id && selectedImages.length > 0) {
        try {
          await uploadReferenceImages({
            enquiryId: enquiryToEdit.id,
            images: selectedImages,
          }).unwrap();
        } catch (uploadError) {
          if (__DEV__) {
            console.error('❌ Error uploading reference images:', uploadError);
          }
          // Continue with update even if image upload fails
        }
      }
      
      // Prepare enquiry data according to API structure (only for edit mode)
      
      enquiryData = {
        // Only include Id for updates, not for new enquiries
        ...(isEditMode && enquiryToEdit?.id ? { Id: enquiryToEdit.id } : {}),
        Name: formData.title || '',
        ClientId: formData.clientId || enquiryToEdit?.clientId || user.id, // Use formData.clientId first (from Step 1)
        AssignedTo: formData.assignedTo || enquiryToEdit?.AssignedTo || null,
        Status: formData.status || enquiryToEdit?.status || 'Enquiry Created', // Use formData.status first
        Priority: mappedPriority,
        Quantity: parseInt(formData.quantity) || 1, // Convert to number as per API
        Metal: {
          Color: formData.metalColor || null,
          Qualities: formData.metalQuality ? [formData.metalQuality] : [],
        },
        StyleNumber: formData.styleNumber || null,
        GatiOrderNumber: formData.GatiOrderNumber || null,
        StoneTypes: formData.stoneType && formData.stoneType.trim() ? [formData.stoneType.trim()] : [],
        MetalWeight: {
          From: formData.metalWeightFrom ? (() => {
            const cleaned = formData.metalWeightFrom.toString().replace(/[^0-9.]/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : num;
          })() : null,
          To: formData.metalWeightTo ? (() => {
            const cleaned = formData.metalWeightTo.toString().replace(/[^0-9.]/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : num;
          })() : null,
          Exact: formData.metalWeightExact ? (() => {
            const cleaned = formData.metalWeightExact.toString().replace(/[^0-9.]/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : num;
          })() : null,
        },
        DiamondWeight: {
          From: formData.diamondWeightFrom ? (() => {
            const cleaned = formData.diamondWeightFrom.toString().replace(/[^0-9.]/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : num;
          })() : null,
          To: formData.diamondWeightTo ? (() => {
            const cleaned = formData.diamondWeightTo.toString().replace(/[^0-9.]/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : num;
          })() : null,
          Exact: formData.diamondWeightExact ? (() => {
            const cleaned = formData.diamondWeightExact.toString().replace(/[^0-9.]/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : num;
          })() : null,
        },
        Stamping: formData.stamping || null,
        Remarks: formData.description || '',
        ShippingDate: formData.deadline || null,
        CoralCode: enquiryToEdit?.CoralCode || null,
        CadCode: enquiryToEdit?.CadCode || null,
        Category: formData.category || 'Ring',
        Budget: formData.budget && formData.budget.trim() ? formData.budget.trim() : null,
        SpecialRemarks: formData.specialRemarks && formData.specialRemarks.trim() ? formData.specialRemarks.trim() : null,
        ApprovedDate: formData.approvedDate && formData.approvedDate.trim() ? formData.approvedDate : null,
      };
      
      // Note: ReferenceImages are now uploaded separately via uploadReferenceImages endpoint
      // No need to include them in enquiryData

      // Only proceed with update if in edit mode
      if (isEditMode && enquiryToEdit?.id) {
        const updateResult = await updateEnquiry({ id: enquiryToEdit.id, ...enquiryData }).unwrap();
        
        // Construct updated enquiry object from form data since API only returns _id
        // Normalize priority for display
        const normalizedPriority = priorityMap[formData.priority?.toLowerCase()] || 'Medium';
        const priorityForUI = formData.priority || 'medium';
        
        const updatedEnquiry = {
          ...enquiryToEdit,
          id: enquiryToEdit.id,
          // UI format fields (for display in cards/list)
          title: formData.title,
          description: formData.description,
          priority: priorityForUI,
          deadline: formData.deadline || null,
          category: formData.category,
          stoneType: formData.stoneType,
          metalType: formData.metalColor ? `${formData.metalColor} (${formData.metalQuality || '10K'})` : null,
          updatedAt: new Date().toISOString(),
          // API format fields (for consistency)
          Name: formData.title,
          Remarks: formData.description,
          Priority: normalizedPriority,
          ShippingDate: formData.deadline || null,
          Category: formData.category,
          StoneTypes: formData.stoneType ? [formData.stoneType] : [],
          Quantity: parseInt(formData.quantity) || 1,
          Metal: {
            Color: formData.metalColor || 'Gold',
            Qualities: formData.metalQuality ? [formData.metalQuality] : [],
          },
          MetalWeight: {
            From: formData.metalWeightFrom || null,
            To: formData.metalWeightTo || null,
            Exact: formData.metalWeightExact || null,
          },
          DiamondWeight: {
            From: formData.diamondWeightFrom || null,
            To: formData.diamondWeightTo || null,
            Exact: formData.diamondWeightExact || null,
          },
          Stamping: formData.stamping || null,
          StyleNumber: formData.styleNumber || null,
          GatiOrderNumber: formData.GatiOrderNumber || null,
          Budget: formData.budget && formData.budget.trim() ? formData.budget.trim() : null,
          SpecialRemarks: formData.specialRemarks && formData.specialRemarks.trim() ? formData.specialRemarks.trim() : null,
          ApprovedDate: formData.approvedDate && formData.approvedDate.trim() ? formData.approvedDate : null,
          // Preserve original fields
          ClientId: enquiryToEdit.ClientId || enquiryToEdit.clientId,
          AssignedTo: enquiryToEdit.AssignedTo || enquiryToEdit.assignedTo,
          Status: enquiryToEdit.Status || enquiryToEdit.status,
          CoralCode: enquiryToEdit.CoralCode || enquiryToEdit.coralCode,
          CadCode: enquiryToEdit.CadCode || enquiryToEdit.cadCode,
          clientName: enquiryToEdit.clientName,
          clientId: enquiryToEdit.clientId,
          createdAt: enquiryToEdit.createdAt,
          status: enquiryToEdit.status,
          budget: formData.budget && formData.budget.trim() ? parseFloat(formData.budget) || null : (enquiryToEdit.budget || null),
        };
        
        showAlert(
          'Enquiry Updated',
          'Your enquiry has been updated successfully!',
          'info',
          [
            {
              text: 'OK',
              onPress: () => {
                navigation.navigate('SingleEnquiry', { 
                  enquiryId: enquiryToEdit.id, 
                  enquiry: updatedEnquiry,
                  shouldRefresh: true,
                });
              },
            },
          ]
        );
      } else {
        // This should not happen - new enquiries should return early above
        showAlert(
          'Error',
          'Unexpected error occurred. Please try again.',
          'error'
        );
      }
    } catch (error) {
      if (__DEV__) {
        console.error('❌ Error creating/updating enquiry:', error);
        if (enquiryData) {
          console.error('📤 Enquiry data that was sent:', {
            'Name': enquiryData.Name,
            'ClientId': enquiryData.ClientId,
            'Priority': enquiryData.Priority,
            'Category': enquiryData.Category,
            'Has Images': !!enquiryData.ReferenceImages,
            'Images Count': enquiryData.ReferenceImages?.length || 0,
          });
        }
      }
      
      
      // Provide more detailed error message
      let errorMessage = `Failed to ${isEditMode ? 'update' : 'create'} enquiry.`;
      
      // Check if it's a 500 error (backend server error)
      if (error.status === 500) {
        errorMessage = 'Server error (500). Please check:\n\n';
        errorMessage += '1. Backend server is running properly\n';
        errorMessage += '2. All required fields are provided\n';
        errorMessage += '3. Data format matches backend expectations\n\n';
        if (error.data) {
          if (typeof error.data === 'string') {
            errorMessage += `Error: ${error.data}`;
          } else if (error.data.error) {
            errorMessage += `Error: ${error.data.error}`;
          } else if (error.data.message) {
            errorMessage += `Error: ${error.data.message}`;
          } else {
            errorMessage += 'Check backend logs for details.';
          }
        }
      } else if (error.data) {
        if (typeof error.data === 'string') {
          errorMessage = error.data;
        } else if (error.data.error) {
          errorMessage = error.data.error;
        } else if (error.data.message) {
          errorMessage = error.data.message;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      showAlert(
        'Error',
        errorMessage,
        'error',
        [{ text: 'OK', onPress: () => {} }]
      );
      // Don't navigate on error - stay on the form
      return;
    }
  };

  const handleOpenChat = useCallback(() => {
    const isClient = isEnquiryClientUser(user);
    const enquiryPayload =
      enquiryToEdit || (enquiryId ? { id: enquiryId, _id: enquiryId } : null);

    if (enquiryId) {
      if (isClient) {
        const chats = Array.isArray(chatsForEnquiry) ? chatsForEnquiry : [];
        const direct = pickClientDirectChat(chats);
        const cid = getEnquiryChatId(direct);
        if (direct && cid) {
          navigation.navigate('ChatDetail', {
            chatId: cid,
            chat: direct,
            enquiry: enquiryPayload,
            enquiryId,
            chatType: getEnquiryChatType(direct),
          });
          return;
        }
      }
      navigation.navigate('ChatGroups', {
        enquiryId,
        enquiry: enquiryPayload,
      });
      return;
    }

    if (formData.clientId) {
      navigation.navigate('ChatGroups', {
        clientId: formData.clientId,
      });
    } else {
      showAlert('Info', 'Please complete the enquiry first to access chat', 'info');
    }
  }, [
    user,
    enquiryId,
    enquiryToEdit,
    formData.clientId,
    chatsForEnquiry,
    navigation,
  ]);

  const renderImageUpload = () => (
    <View style={styles.imageCard}>
      <Text style={styles.sectionTitle}>
        Reference Images/Videos
      </Text>
      
      <Text style={styles.sectionSubtitle}>
        Upload reference images or videos to help designers understand your requirements
      </Text>

      <TouchableOpacity style={styles.uploadButton} onPress={handleImagePicker}>
        <Icon name="add-a-photo" size={28} color={colors.primary} />
        <Text style={styles.uploadText}>
          Add Images/Videos
        </Text>
        <Text style={styles.uploadSubtext}>
          Tap to select from camera or gallery
        </Text>
      </TouchableOpacity>

      {selectedImages.length > 0 && (
        <View style={styles.imagesGrid}>
          {selectedImages.map((image, index) => {
            // Check if this is a video
            const isVideo = image.type?.startsWith('video/') || 
                          image.isVideo || 
                          /\.(mp4|mov|avi|mkv|webm|wmv|flv|3gp|m4v)$/i.test(image.name || image.uri || '');
            
            return (
            <View key={index} style={styles.imageContainer}>
                {isVideo ? (
                  <View style={styles.videoPreviewContainer}>
                    <Video
                      source={{ uri: image.uri }}
                      style={styles.videoPreview}
                      paused={true}
                      resizeMode="cover"
                      controls={false}
                    />
                    <View style={styles.videoPlayOverlay}>
                      <Icon name="play-circle-filled" size={32} color={colors.textWhite} />
                    </View>
                  </View>
                ) : (
              <Image
                source={{ uri: image.uri || image }}
                style={styles.image}
              />
                )}
              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => removeImage(index)}>
                <Icon name="close" size={16} color={colors.textWhite} />
              </TouchableOpacity>
            </View>
            );
          })}
        </View>
      )}
    </View>
  );

  const renderInstructions = () => (
    <View style={styles.instructionsCard}>
      <Text style={styles.sectionTitle}>
        Instructions
      </Text>
      
      <View style={styles.instructionItem}>
        <Icon name="info" size={18} color={colors.info} />
        <Text style={styles.instructionText}>
          Make sure to provide clear and detailed descriptions
        </Text>
      </View>

      <View style={styles.instructionItem}>
        <Icon name="photo-camera" size={18} color={colors.info} />
        <Text style={styles.instructionText}>
          Upload high-quality reference images and videos for better results
        </Text>
      </View>

      <View style={styles.instructionItem}>
        <Icon name="schedule" size={18} color={colors.info} />
        <Text style={styles.instructionText}>
          Our team will review and respond within 24 hours
        </Text>
      </View>
    </View>
  );

  return (
    <ScrollView style={styles.container}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>
                {isEditMode ? 'Update References' : 'Complete enquiry'}
              </Text>
              <Text style={styles.headerSubtitle}>
                {isEditMode
                  ? 'Update reference materials (optional)'
                  : 'Add reference images or videos (optional), review instructions, then submit'}
              </Text>
            </View>

      {renderImageUpload()}
      {renderInstructions()}
      <EnquiryChatCta
        user={user}
        onPress={handleOpenChat}
        visible={!!(enquiryId || formData.clientId)}
      />

            <View style={styles.footer}>
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={loading}
                style={[styles.adminActionButton, styles.adminActionButtonPrimary, loading && styles.btnDisabled]}
                activeOpacity={0.85}
              >
                {loading ? (
                  <>
                    <Icon name="hourglass-empty" size={18} color={colors.textWhite} />
                    <Text style={styles.adminActionText}>Submitting...</Text>
                  </>
                ) : (
                  <>
                    <Icon name="check-circle" size={18} color={colors.textWhite} />
                    <Text style={styles.adminActionText}>
                      {isEditMode ? "Update Enquiry" : "Submit Enquiry"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              
              {isEditMode && (
                <TouchableOpacity
                  onPress={() => navigation.goBack()}
                  style={[styles.adminActionButton, styles.adminActionButtonOutline]}
                  activeOpacity={0.85}
                >
                  <Icon name="arrow-back" size={18} color={colors.primary} />
                  <Text style={[styles.adminActionText, styles.adminActionOutlineText]}>
                    Back to Step 1
                  </Text>
                </TouchableOpacity>
              )}
            </View>
      {/* Success Animation Modal */}
      <SuccessAnimation
        visible={showSuccessAnimation}
        onComplete={() => {
          setShowSuccessAnimation(false);
          navigation.navigate('MainTabs', { screen: 'Enquiries' });
        }}
        title="Enquiry Created"
        message="Your enquiry has been created successfully!"
      />
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
    backgroundColor: colors.background,
  },
  header: {
    padding: 16,
    backgroundColor: colors.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  imageCard: {
    margin: 16,
  },
  sectionTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  uploadButton: {
    alignItems: 'center',
    padding: 24,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 8,
    backgroundColor: colors.backgroundSecondary,
  },
  uploadText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.primary,
    marginTop: 8,
    marginBottom: 4,
  },
  uploadSubtext: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  imagesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 16,
    gap: 12,
  },
  imageContainer: {
    position: 'relative',
  },
  image: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  videoPreviewContainer: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: colors.backgroundSecondary,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPreview: {
    width: 80,
    height: 80,
  },
  videoPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  removeButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
  },
  instructionsCard: {
    margin: 16,
    marginBottom: 8,
  },
  instructionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  instructionText: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginLeft: 10,
    flex: 1,
  },
  footer: {
    padding: 20,
    gap: 12,
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
  adminActionButtonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  adminActionText: {
    color: colors.textWhite,
    fontFamily: fonts.medium,
    fontSize: 14,
    marginLeft: 8,
  },
  adminActionOutlineText: {
    color: colors.primary,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});

export default AddEnquiryStep2Screen;
