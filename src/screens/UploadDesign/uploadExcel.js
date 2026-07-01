import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
} from 'react-native';
import Icon from '../../components/common/Icon';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useUploadDesignMutation } from '../../store/api';
import BrandedAlert from '../../components/common/BrandedAlert';

let DocumentPicker;
try {
  DocumentPicker = require('react-native-document-picker').default;
} catch (e) {
  DocumentPicker = null;
}

const requestStoragePermission = async () => {
  // Add your permission logic here
  return true;
};

export default function UploadExcelScreen({ route, navigation }) {
  const { enquiryId, designType, designCode, images, validationResul, cost, isFinalVersion, version } = route.params || {};
  const [selectedExcel, setSelectedExcel] = useState(null);
  const [uploadType, setUploadType] = useState(null);
  const [uploadDesign, { isLoading: isUploading }] = useUploadDesignMutation();
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  const showAlert = (title, message, type = 'info', buttons = []) =>
    setAlertConfig({ visible: true, title, message, type, buttons });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));
  const handleSelectExcel = async () => {
    if (!DocumentPicker) {
      showAlert(
        'Feature Not Available',
        'Document picker is not installed. Please install react-native-document-picker to use this feature.',
        'info',
        [{ text: 'OK' }],
      );
      return;
    }

    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
      showAlert(
        'Permission Denied',
        'Storage permission is required to select files',
      );
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

  const handleRemoveExcel = () => {
    setSelectedExcel(null);
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

  const handleUploadAll = async (skipExcel = false) => {
    if (!skipExcel && !selectedExcel) {
      showAlert(
        'Warning',
        'Please select an Excel file to upload',
      );
      return;
    }

    if (!enquiryId) {
      showAlert('Error', 'Enquiry ID is missing', 'error');
      return;
    }

    setUploadType(skipExcel ? 'without' : 'excel');

    try {
      const result = await uploadDesign({
        enquiryId,
        designType: designType,
        version: version,
        images: images || [],
        excel: skipExcel ? null : selectedExcel,
        designCode: designCode || '',
        cost: cost || 0,
        isFinalVersion: isFinalVersion || false,
      }).unwrap();

      console.log('[uploadExcel] uploadDesign succeeded, isFinalVersion:', isFinalVersion, 'version:', version, 'result:', JSON.stringify(result));

      showAlert(
        'Success',
        skipExcel ? 'Successfully uploaded design' : 'Successfully uploaded design with Excel file',
        'success',
        [
          {
            text: 'OK',
            onPress: () => {
              setSelectedExcel(null);
              navigation.pop(2);
            },
          },
        ],
      );
    } catch (error) {
      const errorMessage =
        error?.data?.message ||
        error?.data ||
        error?.message ||
        'Failed to upload design. Please try again.';
      showAlert('Upload Failed', errorMessage, 'error');
    }
  };

  const handleContinueWithoutExcel = () => {
    handleUploadAll(true);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>
        Upload Excel <Text style={styles.optionalText}>(Optional)</Text>
      </Text>

      {renderUploadArea(
        'Upload Excel:',
        handleSelectExcel,
        selectedExcel,
        handleRemoveExcel,
        false,
      )}

      {/* Upload Buttons */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          onPress={() => handleUploadAll(false)}
          style={[styles.uploadButton, !selectedExcel && styles.uploadButtonDisabled]}
          activeOpacity={0.85}
          disabled={!selectedExcel || isUploading}
        >
          {isUploading && uploadType === 'excel' ? (
            <>
              <Icon name="hourglass-empty" size={18} color={colors.textWhite} />
              <Text style={styles.uploadButtonText}>Uploading...</Text>
            </>
          ) : (
            <>
              <Icon name="cloud-upload" size={18} color={colors.textWhite} />
              <Text style={styles.uploadButtonText}>Upload with Excel</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleContinueWithoutExcel}
          style={[
            styles.continueButton,
            isUploading && uploadType === 'without' && styles.continueButtonUploading
          ]}
          activeOpacity={0.85}
          disabled={isUploading}
        >
          {isUploading && uploadType === 'without' ? (
            <>
              <Icon name="hourglass-empty" size={18} color={colors.textWhite} />
              <Text style={[styles.continueButtonText, { color: colors.textWhite, marginLeft: 8 }]}>Uploading...</Text>
            </>
          ) : (
            <Text style={styles.continueButtonText}>Continue without Excel</Text>
          )}
        </TouchableOpacity>
      </View>

      <BrandedAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        buttons={alertConfig.buttons}
        onClose={hideAlert}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 16,
  },
  heading: {
    fontSize: fonts.xl,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    marginBottom: 16,
  },
  optionalText: {
    fontFamily: fonts.bold,
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
    marginTop: 24,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  uploadButtonText: {
    color: colors.textWhite,
    fontFamily: fonts.medium,
    fontSize: 14,
    marginLeft: 8,
  },
  uploadButtonDisabled: {
    backgroundColor: colors.border,
    opacity: 0.6,
  },
  continueButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    marginTop: 12,
  },
  continueButtonUploading: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
  },
  continueButtonText: {
    color: colors.primary,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
});
