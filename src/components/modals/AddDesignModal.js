import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Text,
  TextInput,
  Image,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import { useAuth } from '../../context/AuthContext';
import { useInsertDesignMutation } from '../../store/api';
import Icon from '../common/Icon';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';

const DESIGN_TYPES = ['coral', 'Cad'];

export default function AddDesignModal({ visible, onClose, designType: initialType }) {
  const { user } = useAuth();
  const [insertDesign, { isLoading }] = useInsertDesignMutation();

  const [designType, setDesignType] = useState(initialType || 'Cad');
  const [name, setName] = useState('');
  const [image, setImage] = useState(null);
  const [showTypePicker, setShowTypePicker] = useState(false);

  console.log('[AddDesignModal] initialType:', initialType, 'designType:', designType);

  const reset = () => {
    setDesignType(initialType || 'Cad');
    setName('');
    setImage(null);
    setShowTypePicker(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handlePickImage = async () => {
    const result = await launchImageLibrary({ mediaType: 'photo', selectionLimit: 1 });
    if (result.assets?.length > 0) {
      const a = result.assets[0];
      setImage({ uri: a.uri, type: a.type || 'image/jpeg', name: a.fileName || `design_${Date.now()}.jpg` });
    }
  };

  const handleCamera = async () => {
    const result = await launchCamera({ mediaType: 'photo', quality: 0.8 });
    if (result.assets?.length > 0) {
      const a = result.assets[0];
      setImage({ uri: a.uri, type: a.type || 'image/jpeg', name: a.fileName || `camera_${Date.now()}.jpg` });
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    if (!image) return;
    try {
      await insertDesign({
        designType,
        images: image,
        uploadedBy: user?.id || user?._id || user?.userId,
        name: name.trim(),
      }).unwrap();
      handleClose();
    } catch (e) {}
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Add Design</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Design Type</Text>
            <TouchableOpacity style={styles.picker} onPress={() => setShowTypePicker(true)}>
              <Text style={styles.pickerText}>{designType.toUpperCase()}</Text>
              <Icon name="arrow-drop-down" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <Text style={styles.label}>Design Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter design name"
              placeholderTextColor={colors.textTertiary}
              value={name}
              onChangeText={setName}
            />

            <Text style={styles.label}>Design Image</Text>
            {image ? (
              <View style={styles.imagePreviewWrap}>
                <Image source={{ uri: image.uri }} style={styles.imagePreview} />
                <TouchableOpacity style={styles.imageRemove} onPress={() => setImage(null)}>
                  <Icon name="close" size={18} color={colors.textWhite} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.imagePickerRow}>
                <TouchableOpacity style={styles.imagePickerBtn} onPress={handlePickImage}>
                  <Icon name="photo-library" size={24} color={colors.primary} />
                  <Text style={styles.imagePickerText}>Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.imagePickerBtn} onPress={handleCamera}>
                  <Icon name="camera-alt" size={24} color={colors.primary} />
                  <Text style={styles.imagePickerText}>Camera</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={[styles.submitBtn, (!name.trim() || !image) && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!name.trim() || !image || isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.textWhite} />
              ) : (
                <Text style={styles.submitText}>Upload Design</Text>
              )}
            </TouchableOpacity>
          </ScrollView>

          {showTypePicker && (
            <Modal transparent animationType="fade" onRequestClose={() => setShowTypePicker(false)}>
              <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowTypePicker(false)}>
                <View style={styles.pickerModal}>
                  {DESIGN_TYPES.map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[styles.pickerOption, designType === t && styles.pickerOptionActive]}
                      onPress={() => { setDesignType(t); setShowTypePicker(false); }}
                    >
                      <Text style={[styles.pickerOptionText, designType === t && styles.pickerOptionTextActive]}>
                        {t.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </TouchableOpacity>
            </Modal>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  container: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  body: {
    padding: 20,
    paddingBottom: 40,
  },
  label: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 6,
    marginTop: 16,
  },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.backgroundSecondary,
  },
  pickerText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    backgroundColor: colors.backgroundSecondary,
  },
  imagePreviewWrap: {
    position: 'relative',
    alignSelf: 'flex-start',
  },
  imagePreview: {
    width: 120,
    height: 120,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  imageRemove: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePickerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  imagePickerBtn: {
    flex: 1,
    height: 100,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundSecondary,
    gap: 6,
  },
  imagePickerText: {
    fontSize: 12,
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  submitBtn: {
    height: 50,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitText: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.textWhite,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerModal: {
    backgroundColor: colors.background,
    borderRadius: 14,
    width: '70%',
    overflow: 'hidden',
  },
  pickerOption: {
    paddingVertical: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerOptionActive: {
    backgroundColor: colors.primaryLight,
  },
  pickerOptionText: {
    fontSize: 15,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  pickerOptionTextActive: {
    color: colors.primary,
    fontFamily: fonts.bold,
  },
});
