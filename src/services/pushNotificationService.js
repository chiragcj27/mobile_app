import AsyncStorage from '@react-native-async-storage/async-storage';
import messaging, { AuthorizationStatus } from '@react-native-firebase/messaging';
import { Platform, Alert } from 'react-native';
import notifee from '@notifee/react-native';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * iOS: FCM needs the APNs device token before getToken() (Firebase iOS SDK 10.4+).
 * That token arrives asynchronously after registerForRemoteNotifications — JS often runs first.
 */
export const waitForIosApnsToken = async ({
  maxAttempts = 40,
  intervalMs = 250,
} = {}) => {
  if (Platform.OS !== 'ios') {
    return true;
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const apnsToken = await messaging().getAPNSToken();

      if (apnsToken) {
        return true;
      }
    } catch {
      // Still registering or bridge not ready — keep polling.
    }
    await sleep(intervalMs);
  }
  return false;
};

export const PUSH_TOKEN_STORAGE_KEY = '@chandra/pushToken';

export const isPermissionGranted = (status) =>
  status === AuthorizationStatus.AUTHORIZED ||
  status === AuthorizationStatus.PROVISIONAL;

export const requestPushPermission = async () => {
  try {
    // Check if messaging is available
    if (!messaging) {
      if (__DEV__) {
        console.error('[PushNotification] Firebase messaging is not available');
      }
      return false;
    }

    const currentStatus = await messaging().hasPermission();
    
    if (isPermissionGranted(currentStatus)) {
      return true;
    }
    
    // IMPORTANT: On Android, if permission was previously DENIED, requestPermission() 
    // usually will NOT show the dialog again. However, we'll try anyway in case it works.
    // The dialog will definitely appear if status is NOT_DETERMINED (-1)
    
    if (currentStatus === AuthorizationStatus.DENIED && __DEV__) {
      console.warn('[PushNotification] Permission status is DENIED - dialog may not appear');
    }
    
    // Request permission - this should show the system dialog if status is NOT_DETERMINED
    const newStatus = await messaging().requestPermission({
      alert: true,
      announcement: false,
      badge: true,
      sound: true,
      carPlay: false,
      provisional: true, // iOS: allows silent notifications even if denied
    });
    
    // Verify permission is actually granted by checking Notifee (Android) or re-checking Firebase
    let actuallyGranted = isPermissionGranted(newStatus);
    
    // On Android, also check Notifee permission to ensure it's really granted
    if (Platform.OS === 'android' && actuallyGranted) {
      try {
        const notifeeSettings = await notifee.getNotificationSettings();
        const notifeeGranted = notifeeSettings.authorizationStatus === 1; // 1 = AUTHORIZED
        
        if (!notifeeGranted) {
          if (__DEV__) {
            console.warn('[PushNotification] Firebase says granted but Notifee says NOT granted');
          }
          
          // Request Notifee permission
          const notifeeResult = await notifee.requestPermission();
          
          if (notifeeResult.authorizationStatus === 1) {
            actuallyGranted = true;
          } else {
            actuallyGranted = false;
          }
        }
      } catch (notifeeError) {
        if (__DEV__) {
          console.error('[PushNotification] Error checking Notifee permission:', notifeeError);
        }
        // Continue with Firebase result
      }
    }
    
    // Double-check by getting permission status again
    try {
      const verifyStatus = await messaging().hasPermission();
      const verifyGranted = isPermissionGranted(verifyStatus);
      if (verifyGranted !== actuallyGranted) {
        actuallyGranted = verifyGranted; // Use verification result
      }
    } catch (verifyError) {
      if (__DEV__) {
        console.error('[PushNotification] Error verifying permission:', verifyError);
      }
    }
    
    const granted = actuallyGranted;
    
    if (!granted) {
      // If status is still DENIED and we're on Android, try opening settings
      if (newStatus === AuthorizationStatus.DENIED && Platform.OS === 'android') {
        try {
          await notifee.openNotificationSettings();
        } catch (error) {
          if (__DEV__) {
            console.error('[PushNotification] Could not open settings:', error);
          }
        }
      }
    }
    
    return granted;
  } catch (error) {
    if (__DEV__) {
      console.error('[PushNotification] ERROR requesting permission:', {
        message: error?.message,
        code: error?.code,
        name: error?.name,
        stack: error?.stack,
      });
    }
    
    return false;
  }
};

// Check and verify notification permissions
export const checkNotificationPermissions = async () => {
  try {
    const results = {
      firebasePermission: null,
      notifeePermission: null,
      token: null,
      error: null,
    };

    // Check Firebase permission
    try {
      const firebaseStatus = await messaging().hasPermission();
      results.firebasePermission = {
        status: firebaseStatus,
        granted: isPermissionGranted(firebaseStatus),
        statusText: getPermissionStatusText(firebaseStatus),
      };
    } catch (error) {
      results.firebasePermission = { error: error.message };
    }

    // Check Notifee permission (Android)
    if (Platform.OS === 'android') {
      try {
        const notifeeSettings = await notifee.getNotificationSettings();
        results.notifeePermission = {
          authorizationStatus: notifeeSettings.authorizationStatus,
          granted: notifeeSettings.authorizationStatus === 1, // 1 = AUTHORIZED
          statusText: getNotifeeStatusText(notifeeSettings.authorizationStatus),
        };
      } catch (error) {
        results.notifeePermission = { error: error.message };
      }
    } else {
      // iOS uses Firebase permission
      results.notifeePermission = results.firebasePermission;
    }

    // Get FCM token
    try {
      const token = await messaging().getToken();
      results.token = token;
    } catch (error) {
      const errorMsg = `Failed to get token: ${error.message}`;
      if (__DEV__) {
        console.error('[PushNotification]', errorMsg);
      }
      results.error = errorMsg;
    }

    return results;
  } catch (error) {
    return {
      error: error.message,
    };
  }
};

const getPermissionStatusText = (status) => {
  const statusMap = {
    [AuthorizationStatus.NOT_DETERMINED]: 'Not Determined',
    [AuthorizationStatus.DENIED]: 'Denied',
    [AuthorizationStatus.AUTHORIZED]: 'Authorized',
    [AuthorizationStatus.PROVISIONAL]: 'Provisional',
  };
  return statusMap[status] || 'Unknown';
};

const getNotifeeStatusText = (status) => {
  const statusMap = {
    0: 'Not Determined',
    1: 'Authorized',
    2: 'Denied',
    3: 'Provisional',
  };
  return statusMap[status] || 'Unknown';
};

// Request permissions with user feedback
export const requestPermissionsWithFeedback = async () => {
  try {
    // Request Firebase permission
    const firebaseGranted = await requestPushPermission();
    
    // Request Notifee permission (Android)
    if (Platform.OS === 'android') {
      try {
        await notifee.requestPermission();
      } catch (error) {
        if (__DEV__) {
          console.error('Error requesting Notifee permission:', error);
        }
      }
    }

    // Get token
    let token = null;
    try {
      token = await messaging().getToken();
    } catch (error) {
      if (__DEV__) {
        console.error('Error getting FCM token:', error);
      }
    }

    const checkResults = await checkNotificationPermissions();
    
    return {
      success: firebaseGranted && (token !== null),
      firebaseGranted,
      token,
      details: checkResults,
    };
  } catch (error) {
    if (__DEV__) {
      console.error('Error in requestPermissionsWithFeedback:', error);
    }
    return {
      success: false,
      error: error.message,
    };
  }
};

export const registerForRemoteMessages = async () => {
  try {
    if (Platform.OS === 'ios') {
      // Default firebase.json keeps messaging_ios_auto_register_for_remote_messages enabled;
      // AppDelegate already calls registerForRemoteNotifications. Avoid redundant
      // registerDeviceForRemoteMessages() (library warns) and wait for APNs before getToken().
      return await waitForIosApnsToken();
    }
    await messaging().registerDeviceForRemoteMessages();
    
    return true;
  } catch (error) {
    return false;
  }
};

export const getStoredPushToken = () => AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);

export const savePushTokenLocally = (token) =>
  AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);

export const clearStoredPushToken = async () => {
  try {
    await messaging().deleteToken();
  } catch (error) {
  }
  await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
};

export const getDeviceMetadata = () => ({
  platform: Platform.OS,
  osVersion: Platform.Version?.toString() || 'unknown',
});