import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import Icon from './Icon';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';

const TYPE_ICONS = {
  success: 'check-circle',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

const TYPE_ICON_COLORS = {
  success: colors.success,
  error: colors.error,
  warning: colors.warning,
  info: colors.primary,
};

/**
 * BrandedAlert — drop-in replacement for native Alert.alert.
 *
 * Props:
 *   visible   {boolean}   – controls modal visibility
 *   title     {string}    – bold heading
 *   message   {string}    – body text
 *   type      {'info'|'success'|'error'|'warning'}  – icon + accent colour
 *   checklist {Array<{ text: string, status: 'pass'|'fail'|'warning' }>}
 *             – optional checklist rendered below message
 *   buttons   {Array<{ text, style?: 'default'|'destructive'|'cancel', onPress? }>}
 *             – if omitted, a single "OK" button that calls onClose is shown
 *   onClose   {function}  – called when the modal is dismissed (back button / OK)
 */
const CHECKLIST_ICONS = {
  pass: { name: 'check-circle', color: colors.success },
  fail: { name: 'cancel', color: colors.error },
  warning: { name: 'warning', color: colors.warning },
};

const BrandedAlert = ({
  visible,
  title,
  message,
  type = 'info',
  checklist,
  buttons,
  onClose,
  fullScreen = false,
}) => {
  const resolvedButtons =
    buttons && buttons.length > 0
      ? buttons
      : [{ text: 'OK', style: 'default' }];

  const iconName = TYPE_ICONS[type] || 'info';
  const iconColor = TYPE_ICON_COLORS[type] || colors.primary;
  const useColumnLayout = resolvedButtons.length > 2;

  const handlePress = (btn) => {
    // Dismiss first so follow-up alerts don't stack
    onClose?.();
    btn.onPress?.();
  };

  const getBtnBg = (style) => {
    if (style === 'destructive') return colors.error;
    if (style === 'cancel') return colors.backgroundSecondary;
    return colors.primary;
  };

  const getBtnTextColor = (style) => {
    if (style === 'cancel') return colors.primary;
    return '#fff';
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={!fullScreen}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.overlay, fullScreen && styles.overlayFullScreen]}>
        <View style={[styles.card, fullScreen && styles.cardFullScreen]}>
          <View style={styles.iconRow}>
            <Icon name={iconName} size={40} color={iconColor} />
          </View>

          {!!title && <Text style={styles.title}>{title}</Text>}
          {!!message && <Text style={styles.message}>{message}</Text>}

          {checklist && checklist.length > 0 && (
            <ScrollView
              style={[styles.checklist, fullScreen && styles.checklistFullScreen]}
              contentContainerStyle={styles.checklistContent}
              showsVerticalScrollIndicator={false}
            >
              {checklist.map((item, i) => {
                const icon = CHECKLIST_ICONS[item.status] || CHECKLIST_ICONS.warning;
                return (
                  <View key={i} style={styles.checklistRow}>
                    {item.status !== 'fail' && (
                      <Icon name={icon.name} size={18} color={icon.color} />
                    )}
                    <Text style={styles.checklistText}>{item.text}</Text>
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={[styles.buttons, useColumnLayout && styles.buttonsColumn]}>
            {resolvedButtons.map((btn, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.btn,
                  useColumnLayout && styles.btnFull,
                  { backgroundColor: getBtnBg(btn.style) },
                ]}
                onPress={() => handlePress(btn)}
                activeOpacity={0.85}
              >
                <Text style={[styles.btnText, { color: getBtnTextColor(btn.style) }]}>
                  {btn.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  overlayFullScreen: {
    backgroundColor: colors.background,
    padding: 0,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    elevation: 10,
    alignItems: 'center',
  },
  cardFullScreen: {
    maxWidth: undefined,
    borderRadius: 0,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  iconRow: {
    marginBottom: 14,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fonts.lg,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontFamily: fonts.regular,
    fontSize: fonts.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
  },
  checklist: {
    width: '100%',
    maxHeight: 180,
    marginBottom: 16,
  },
  checklistFullScreen: {
    maxHeight: undefined,
    flex: 1,
  },
  checklistContent: {
    gap: 8,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  checklistText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fonts.sm,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  buttonsColumn: {
    flexDirection: 'column',
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFull: {
    flex: undefined,
    width: '100%',
  },
  btnText: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm,
  },
});

export default BrandedAlert;
