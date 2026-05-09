/**
 * Get FCM Token Screen
 * 
 * Quick utility screen to get your FCM token for testing real notifications.
 * 
 * Usage:
 * 1. Navigate to this screen
 * 2. Copy your FCM token
 * 3. Share with backend team or use in Firebase Console
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import messaging from '@react-native-firebase/messaging';
import { registerForRemoteMessages } from '../../services/pushNotificationService';
import { Button } from '../../components/common';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { Heading, BodyText } from '../../components/common/Text';
import Icon from '../../components/common/Icon';

const GetFCMTokenScreen = ({ navigation }) => {
  const [fcmToken, setFcmToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    getFCMToken();
  }, []);

  const getFCMToken = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Request permission if needed
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (!enabled) {
        setError('Notification permission not granted');
        setLoading(false);
        return;
      }

      const ready = await registerForRemoteMessages();
      if (!ready) {
        setError(
          'Device not ready for remote messages (iOS: wait for APNs — use a real device with Push capability).'
        );
        setLoading(false);
        return;
      }
      
      // Get token
      const token = await messaging().getToken();
      setFcmToken(token);
      setLoading(false);
      
      console.log('📱 FCM Token:', token);
    } catch (err) {
      console.error('Error getting FCM token:', err);
      setError(err.message || 'Failed to get FCM token');
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (fcmToken) {
      try {
        // Try using modern clipboard API
        if (Platform.OS === 'ios' || Platform.OS === 'android') {
          const Clipboard = require('@react-native-clipboard/clipboard').default;
          Clipboard.setString(fcmToken);
          Alert.alert('Copied!', 'FCM token copied to clipboard');
        } else {
          // Fallback: show in alert for manual copy
          shareToken();
        }
      } catch (error) {
        // Fallback: show in alert for manual copy
        shareToken();
      }
    }
  };

  const shareToken = () => {
    if (fcmToken) {
      Alert.alert(
        'FCM Token',
        fcmToken,
        [
          { text: 'Copy', onPress: copyToClipboard },
          { text: 'OK' },
        ],
        { cancelable: true }
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Heading style={styles.title}>Get FCM Token</Heading>
        <BodyText style={styles.description}>
          Use this token to test real notifications from Firebase Console or your backend.
        </BodyText>

        <View style={styles.tokenSection}>
          {loading && (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Loading token...</Text>
            </View>
          )}

          {error && (
            <View style={styles.errorContainer}>
              <Icon name="error-outline" size={24} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
              <Button
                title="Retry"
                onPress={getFCMToken}
                variant="primary"
                style={styles.retryButton}
              />
            </View>
          )}

          {fcmToken && !loading && (
            <View style={styles.tokenContainer}>
              <Text style={styles.tokenLabel}>Your FCM Token:</Text>
              <TouchableOpacity
                style={styles.tokenBox}
                onPress={shareToken}
                activeOpacity={0.7}
              >
                <Text style={styles.tokenText} selectable>
                  {fcmToken}
                </Text>
                <Icon name="content-copy" size={20} color={colors.primary} />
              </TouchableOpacity>
              <View style={styles.buttonRow}>
                <Button
                  title="Copy Token"
                  onPress={copyToClipboard}
                  variant="primary"
                  style={styles.button}
                />
                <Button
                  title="Refresh"
                  onPress={getFCMToken}
                  variant="secondary"
                  style={styles.button}
                />
              </View>
            </View>
          )}
        </View>

        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>How to Use:</Text>
          <Text style={styles.infoText}>
            1. Copy your FCM token above{'\n'}
            2. Go to Firebase Console → Cloud Messaging{'\n'}
            3. Click "Send test message"{'\n'}
            4. Paste your token{'\n'}
            5. Add notification title and body{'\n'}
            6. Add custom data with "link" field{'\n'}
            7. Send and test!
          </Text>
        </View>

        <View style={styles.exampleSection}>
          <Text style={styles.exampleTitle}>Example Custom Data:</Text>
          <View style={styles.codeBox}>
            <Text style={styles.codeText} selectable>
              {`{
  "link": "enquiries/688c68cef4c6b085221fd3cd",
  "enquiryId": "688c68cef4c6b085221fd3cd",
  "type": "enquiry_created"
}`}
            </Text>
          </View>
        </View>

        <Button
          title="Go Back"
          onPress={() => navigation.goBack()}
          variant="secondary"
          style={styles.backButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: fonts.xl,
    marginBottom: 12,
    textAlign: 'center',
  },
  description: {
    fontSize: fonts.md,
    color: colors.textSecondary,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  tokenSection: {
    marginBottom: 24,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: fonts.md,
    color: colors.textSecondary,
  },
  errorContainer: {
    backgroundColor: colors.error + '10',
    padding: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
    alignItems: 'center',
  },
  errorText: {
    fontSize: fonts.sm,
    color: colors.error,
    marginTop: 8,
    marginBottom: 12,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
  },
  tokenContainer: {
    backgroundColor: colors.backgroundSecondary,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tokenLabel: {
    fontSize: fonts.sm,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  tokenBox: {
    backgroundColor: colors.background,
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  tokenText: {
    fontSize: fonts.xs,
    fontFamily: 'monospace',
    color: colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
  },
  infoSection: {
    backgroundColor: colors.info + '10',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: colors.info,
  },
  infoTitle: {
    fontSize: fonts.md,
    fontFamily: fonts.bold,
    color: colors.info,
    marginBottom: 8,
  },
  infoText: {
    fontSize: fonts.sm,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  exampleSection: {
    backgroundColor: colors.backgroundSecondary,
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  exampleTitle: {
    fontSize: fonts.md,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  codeBox: {
    backgroundColor: colors.background,
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeText: {
    fontSize: fonts.xs,
    fontFamily: 'monospace',
    color: colors.textPrimary,
  },
  backButton: {
    marginTop: 8,
  },
});

export default GetFCMTokenScreen;

