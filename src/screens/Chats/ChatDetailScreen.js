import React, { useState, useEffect, useRef, useMemo, useCallback, memo, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Platform,
  Text,
  Dimensions,
  StatusBar,
  Keyboard,
  Image,
  Linking,
  Modal,
  PermissionsAndroid,
  PanResponder,
  Animated,
  ActivityIndicator,
} from 'react-native';
import Video from 'react-native-video';
import ImageZoom from 'react-native-image-pan-zoom';
import { WebView } from 'react-native-webview';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, CommonActions } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useGetClientsQuery, useGetEnquiryByIdQuery, useGetChatsQuery, api } from '../../store/api';
import { useDispatch } from 'react-redux';
import { useChat } from '../../hooks/useChat';
import { useAlert } from '../../context/AlertContext';
import socketService from '../../services/socketService';
import { Card } from '../../components/cards/Cards';
import { Button } from '../../components/common';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import Icon from '../../components/common/Icon';
import { formatDateTime, spacing, responsivePadding } from '../../utils';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { FILE_BASE_URL, API_BASE_URL } from '../../config/apiConfig';
import secureStorage from '../../utils/secureStorage';
import { getUserName } from '../../utils/userUtils';
import { useUsers } from '../../features/users/usersHooks';
import { SwipeableMessage, EmptyState, ChatHeader } from '../../components/chat';
import { useMessageScroll } from '../../hooks/useMessageScroll';
import { formatMessageTime, getMessageStatusIcon, getMessageStatusColor, getSenderColor, isMyMessage as checkIsMyMessage, formatReadTimestamp } from '../../utils/messageUtils';
import { clearChatNotification } from '../../utils/chatNotificationGrouping';

// Safely get window dimensions
let width = 375; // Default width
try {
  const windowDimensions = Dimensions.get('window');
  width = windowDimensions?.width || 375;
} catch (error) {
  if (__DEV__) {
    console.warn('Failed to get window dimensions:', error);
  }
}

const COMPOSER_INPUT_MIN_HEIGHT = 36;
const COMPOSER_INPUT_MAX_HEIGHT = 120;

const ChatDetailScreen = ({ route, navigation }) => {
  // Hooks must be called unconditionally at the top level
  const dispatch = useDispatch();
  const authResult = useAuth();
  const user = authResult?.user;
  const alert = useAlert();

  // Early return if critical dependencies are missing
  if (!route) {
    if (__DEV__) {
      console.error('ChatDetailScreen: route is missing');
    }
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors?.background || '#fff' }}>
        <Text style={{ color: colors?.textPrimary || '#000' }}>Error: Missing route parameters</Text>
      </SafeAreaView>
    );
  }

  const { chatId, chat: routeChat, enquiry, enquiryId: routeEnquiryId, chatType } = route?.params || {};
  
  const requestCameraPermission = useCallback(async () => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'Allow access to your camera to take photos.',
          buttonPositive: 'OK',
          buttonNegative: 'Cancel',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      if (__DEV__) {
        console.log('Camera permission request error', err);
      }
      return false;
    }
  }, []);

  const requestStoragePermission = useCallback(async () => {
    if (Platform.OS !== 'android') return true;
    try {
      // For Android 13+ (API 33+), we need READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, or READ_EXTERNAL_STORAGE
      // For Android 10+ (API 29+), we can use scoped storage without permission for most cases
      // DocumentPicker handles permissions internally, but we'll request for older Android versions
      if (Platform.Version >= 33) {
        // Android 13+ - request media permissions
        const permissions = [
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
        ];
        const granted = await PermissionsAndroid.requestMultiple(permissions);
        return Object.values(granted).every(status => status === PermissionsAndroid.RESULTS.GRANTED);
      } else if (Platform.Version >= 29) {
        // Android 10-12 - scoped storage, permission may not be needed but request anyway
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          {
            title: 'Storage Permission',
            message: 'Allow access to your files to share documents.',
            buttonPositive: 'OK',
            buttonNegative: 'Cancel',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        // Android 9 and below
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          {
            title: 'Storage Permission',
            message: 'Allow access to your files to share documents.',
            buttonPositive: 'OK',
            buttonNegative: 'Cancel',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      if (__DEV__) {
        console.log('Storage permission request error', err);
      }
      return false;
    }
  }, []);

  // Get enquiryId from route params (fallback to chat or enquiry object)
  const enquiryId = routeEnquiryId || routeChat?.EnquiryId || routeChat?.enquiryId || enquiry?.id || enquiry?._id;
  
  // Get the specific chatId to use (prioritize direct chatId, then routeChat._id)
  const specificChatId = chatId || routeChat?._id || routeChat?.id;

  /** Avoid "GO_BACK was not handled" when ChatDetail is root or stack has no history (deep link, notification). */
  const handleNavigateBack = useCallback(() => {
    if (!navigation) return;
    try {
      if (typeof navigation.canGoBack === 'function' && navigation.canGoBack()) {
        navigation.goBack();
        return;
      }
    } catch (e) {
      if (__DEV__) {
        console.warn('[ChatDetailScreen] canGoBack/goBack failed:', e?.message);
      }
    }
    try {
      navigation.navigate('MainTabs', { screen: 'Chats' });
    } catch (e2) {
      if (__DEV__) {
        console.warn('[ChatDetailScreen] navigate MainTabs failed, resetting:', e2?.message);
      }
      try {
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [
              {
                name: 'MainTabs',
                state: {
                  routes: [
                    { name: 'Dashboard' },
                    { name: 'Enquiries' },
                    { name: 'Chats' },
                  ],
                  index: 2,
                },
              },
            ],
          })
        );
      } catch (e3) {
        if (__DEV__) {
          console.warn('[ChatDetailScreen] reset failed:', e3?.message);
        }
      }
    }
  }, [navigation]);

  // Use the custom chat hook - this handles everything!
  // Pass routeChat as initialChat so it can be used immediately for message loading
  // Hooks must be called unconditionally - use default values for safety
  const chatHookResult = useChat(enquiryId, chatType, specificChatId, routeChat);
  
  const {
    chat: hookChat,
    messages = [],
    isLoadingChat = false,
    messagesLoading = false,
    chatError,
    isTyping = false,
    typingUser = null, // User who is currently typing { userId, name, email }
    isUploading = false,
    sendMessage: sendChatMessage = () => false,
    sendMedia = () => false,
    sendTyping = () => {},
    refetchMessages = () => Promise.resolve(),
    refetchChat = () => Promise.resolve(),
    loadMoreMessages = () => Promise.resolve(false),
    hasMore = false,
    isLoadingMore = false,
    nextCursor = null,
    updateMessage = () => {},
  } = chatHookResult || {};

  const sendTypingRef = useRef(sendTyping);
  sendTypingRef.current = sendTyping;

  // Use routeChat if it has an _id and hook hasn't loaded yet, otherwise use hookChat
  // This ensures messages can load immediately using routeChat's chatId
  const chat = (hookChat?._id || hookChat?.id) ? hookChat : (routeChat?._id || routeChat?.id ? routeChat : hookChat);
  
  // Get original chat data if available (for accessing ClientId from _originalData)
  const originalChatData = chat?._originalData || routeChat?._originalData || chat || routeChat;

  /** Normalized reply payload for socket + optimistic messages (includes media keys for thread UI). */
  const buildReplyToPayload = useCallback((target) => {
    if (!target) return null;
    const mType = target.messageType || target.MessageType || 'text';
    const mediaKey = target.mediaKey || target.MediaKey;
    const mediaUrl = target.mediaUrl || target.MediaUrl;
    const mediaName = target.mediaName || target.MediaName;
    const rawText = (target.text || target.Message || target.message || '').trim();
    const typeLabel =
      mType === 'image'
        ? 'Photo'
        : mType === 'video'
          ? 'Video'
          : mType === 'audio'
            ? 'Voice message'
            : mType === 'file'
              ? mediaName || 'File'
              : '';
    const text =
      rawText ||
      typeLabel ||
      (mediaName && mType !== 'text' ? String(mediaName) : '') ||
      'Message';
    return {
      _id: target._id || target.id,
      id: target._id || target.id,
      text,
      Message: text,
      message: text,
      senderName: target.senderName || target.SenderName || 'Unknown',
      SenderName: target.senderName || target.SenderName || 'Unknown',
      messageType: mType,
      MessageType: mType,
      mediaUrl,
      MediaUrl: mediaUrl,
      mediaKey,
      MediaKey: mediaKey,
      mediaName,
      MediaName: mediaName,
      audioDuration: target.audioDuration || target.AudioDuration,
      myMessage: checkIsMyMessage(target, user),
    };
  }, [user]);

  // Track last edit time to prevent refetch immediately after editing
  const lastEditTimeRef = useRef(0);
  
  // Update last edit time when editing completes
  useEffect(() => {
    if (!isEditing && lastEditTimeRef.current > 0) {
      // Edit completed, but don't reset immediately - keep it for a few seconds
      // This prevents refetch from overwriting the edit
      setTimeout(() => {
        lastEditTimeRef.current = 0;
      }, 3000); // 3 seconds grace period
    }
  }, [isEditing]);

  // Force refetch when screen is focused (user revisits) and mark messages as read
  // Note: The useChat hook preserves locally edited messages during refetch
  // But we also skip refetch if we just edited a message (within last 3 seconds)
  useFocusEffect(
    React.useCallback(() => {
      if (chat?._id && !messagesLoading) {
        // Clear notification for this chat when screen is focused
        const chatIdToClear = chat?._id || chat?.id || chatId;
        if (chatIdToClear) {
          clearChatNotification(chatIdToClear);
        }
        
        // Don't refetch if we just edited a message (within last 3 seconds)
        // This prevents overwriting the optimistic update with stale data
        const timeSinceLastEdit = Date.now() - lastEditTimeRef.current;
        if (lastEditTimeRef.current > 0 && timeSinceLastEdit < 3000) {
          if (__DEV__) {
            console.log('⏸️ [ChatDetailScreen] Skipping refetch - message was just edited', {
              timeSinceEdit: Math.round(timeSinceLastEdit / 1000) + 's',
            });
          }
          return;
        }
        
        // Small delay to ensure screen is fully mounted
        // The useChat hook will preserve locally edited messages during refetch
        const timer = setTimeout(() => {
          refetchMessages();
        }, 300);
        return () => clearTimeout(timer);
      }
    }, [chat?._id, chatId, refetchMessages, messagesLoading])
  );

  // Socket listeners for message edit/delete events and error handling
  useEffect(() => {
    if (!user || !chat?._id) return;

    const handleMessageEdited = (editedMessage) => {
      if (__DEV__) {
        console.log('✏️ [ChatDetailScreen] messageEdited event received:', editedMessage);
      }
      
      // Backend sends: { _id, ChatId, Message, IsEdited }
      const messageChatId = editedMessage.ChatId || editedMessage.chatId;
      const currentChatId = chat?._id || chat?.id;
      
      if (String(messageChatId).trim() === String(currentChatId).trim()) {
        // Clear loading state
        setIsEditing(false);
        
        // Remove from pending operations
        const messageId = editedMessage._id || editedMessage.id;
        if (messageId) {
          setPendingOperations(prev => {
            const next = new Map(prev);
            next.delete(`edit_${messageId}`);
            return next;
          });
        }
        
        // Update message immediately via updateMessage (useChat hook will handle this via socket listener)
        // Don't refetch immediately - the socket event listener in useChat already updates the message
        // Refetching too early can bring back stale data before backend fully persists
        if (__DEV__) {
          console.log('✏️ [ChatDetailScreen] Message edited - useChat hook will update via socket listener, skipping immediate refetch');
        }
        
        // Only refetch after a longer delay to ensure backend has persisted (if needed)
        // But prefer relying on socket event updates instead of refetch
        setTimeout(() => {
          // Check if message was actually updated by comparing with current state
          const currentMessage = messages.find(m => String(m._id || m.id) === String(messageId));
          const expectedText = editedMessage.Message || editedMessage.message || editedMessage.text || '';
          const currentText = currentMessage?.Message || currentMessage?.message || currentMessage?.text || '';
          
          // Only refetch if message doesn't match expected edit (indicates update didn't work)
          if (currentText !== expectedText && refetchMessages && typeof refetchMessages === 'function') {
            if (__DEV__) {
              console.log('✏️ [ChatDetailScreen] Message text mismatch - refetching to sync:', {
                expected: expectedText.substring(0, 30),
                current: currentText.substring(0, 30),
              });
            }
            try {
              refetchMessages();
            } catch (error) {
              if (__DEV__) {
                console.warn('⚠️ [ChatDetailScreen] Cannot refetch messages - query not started:', error.message);
              }
            }
          }
        }, 300);
      }
    };

    const handleMessageDeleted = (deletedData) => {
      // Backend sends: { _id, ChatId, IsDeleted }
      const messageChatId = deletedData.ChatId || deletedData.chatId;
      const currentChatId = chat?._id || chat?.id;
      
      if (String(messageChatId).trim() === String(currentChatId).trim()) {
        // Clear loading state
        setIsDeleting(false);
        
        // Remove from pending operations
        const messageId = deletedData._id || deletedData.id;
        if (messageId) {
          setPendingOperations(prev => {
            const next = new Map(prev);
            next.delete(`delete_${messageId}`);
            return next;
          });
        }
        
        // Trigger refetch to get updated messages
        if (__DEV__) {
          console.log('🗑️ [ChatDetailScreen] Message deleted, refetching messages');
        }
        setTimeout(() => {
          // Check if message was actually updated by comparing with current state
          const currentMessage = messages.find(m => String(m._id || m.id) === String(messageId));
          const expectedText = editedMessage.Message || editedMessage.message || editedMessage.text || '';
          const currentText = currentMessage?.Message || currentMessage?.message || currentMessage?.text || '';
          
          // Only refetch if message doesn't match expected edit (indicates update didn't work)
          if (currentText !== expectedText && refetchMessages && typeof refetchMessages === 'function') {
            if (__DEV__) {
              console.log('✏️ [ChatDetailScreen] Message text mismatch after socket event - refetching to sync:', {
                expected: expectedText.substring(0, 30),
                current: currentText.substring(0, 30),
              });
            }
            try {
              refetchMessages();
            } catch (error) {
              if (__DEV__) {
                console.warn('⚠️ [ChatDetailScreen] Cannot refetch messages - query not started:', error.message);
              }
            }
          } else if (__DEV__) {
            console.log('✅ [ChatDetailScreen] Message already updated via socket event, skipping refetch');
          }
        }, 1000); // Increased delay to 1 second to allow socket event to process
      }
    };

    // Handle socket errors for edit/delete operations
    const handleSocketError = (error) => {
      const errorMessage = error?.message || error?.toString() || '';
      
      // Check if it's an edit/delete related error
      if (errorMessage.includes('edit') || errorMessage.includes('delete') || 
          errorMessage.includes('Message not found') || 
          errorMessage.includes('cannot edit') || 
          errorMessage.includes('cannot delete') ||
          errorMessage.includes('already deleted')) {
        
        if (__DEV__) {
          console.error('❌ [ChatDetailScreen] Socket error for edit/delete:', errorMessage);
        }
        
        // Clear loading states
        setIsEditing(false);
        setIsDeleting(false);
        
        // Show user-friendly error message
        let userMessage = 'Operation failed. Please try again.';
        if (errorMessage.includes('Message not found')) {
          userMessage = 'Message not found. It may have been deleted.';
        } else if (errorMessage.includes('cannot edit') || errorMessage.includes('You cannot edit')) {
          userMessage = 'You can only edit your own messages.';
        } else if (errorMessage.includes('cannot delete') || errorMessage.includes('You cannot delete')) {
          userMessage = 'You can only delete your own messages.';
        } else if (errorMessage.includes('already deleted')) {
          userMessage = 'This message has already been deleted.';
        } else if (errorMessage.includes('Failed to edit')) {
          userMessage = 'Failed to edit message. Please try again.';
        } else if (errorMessage.includes('Failed to delete')) {
          userMessage = 'Failed to delete message. Please try again.';
        }
        
        alert.error('Error', userMessage);
        
        // Clear pending operations
        setPendingOperations(new Map());
      }
    };

    const unsubscribeEdited = socketService.on('messageEdited', handleMessageEdited);
    const unsubscribeDeleted = socketService.on('messageDeleted', handleMessageDeleted);
    const unsubscribeError = socketService.on('error', handleSocketError);

    return () => {
      if (unsubscribeEdited) unsubscribeEdited();
      if (unsubscribeDeleted) unsubscribeDeleted();
      if (unsubscribeError) unsubscribeError();
    };
  }, [user, chat?._id, chat?.id, refetchMessages, alert]);

  /** Lift composer above keyboard using frame height (iOS + Android). */
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  /** Draft text lives in a ref so typing does not re-render the whole screen (was causing input flicker). */
  const draftMessageRef = useRef('');
  const hasComposerTextRef = useRef(false);
  const [hasComposerText, setHasComposerText] = useState(false);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [showReadReceiptModal, setShowReadReceiptModal] = useState(false);
  const [showMediaViewerModal, setShowMediaViewerModal] = useState(false);
  const [viewerMediaUrl, setViewerMediaUrl] = useState(null);
  const [viewerMediaType, setViewerMediaType] = useState(null); // 'image', 'video', or 'document'
  const [viewerDocumentName, setViewerDocumentName] = useState(null); // For document download
  const [viewerOriginalUrl, setViewerOriginalUrl] = useState(null); // Original PDF URL for fallback
  const [viewerMediaKey, setViewerMediaKey] = useState(null); // Store mediaKey for refreshing expired URLs
  const [webViewError, setWebViewError] = useState(false); // Track if WebView failed to load
  const [isRefreshingUrl, setIsRefreshingUrl] = useState(false); // Track if we're refreshing URL
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingPath, setRecordingPath] = useState(null);
  const recordingTimerRef = useRef(null);
  const audioRecorderPlayerRef = useRef(new AudioRecorderPlayer());
  // iOS: WhatsApp-like hold/slide/lock (PanResponder). Android: single tap starts hands-free (locked) recording.
  const [isLocked, setIsLocked] = useState(false);
  const isRecordingRef = useRef(false);
  const isLockedRef = useRef(false);
  const [slideOffsetX, setSlideOffsetX] = useState(0);
  const [shouldCancel, setShouldCancel] = useState(false);
  const recordingStartTimeRef = useRef(null);
  const recordingTimeRef = useRef(0);
  const startRecordingRef = useRef(async () => {});
  const stopRecordingRef = useRef(async () => {});
  const startLockPulseRef = useRef(() => {});
  const waveformAnim = useRef(new Animated.Value(0)).current;
  const micButtonPulseAnim = useRef(new Animated.Value(1)).current;
  // Voice note playback: WhatsApp-style pause/resume on same bubble
  const [voicePlayback, setVoicePlayback] = useState({ id: null, paused: false });
  const voicePlaybackRef = useRef({ id: null, paused: false });
  const [audioProgress, setAudioProgress] = useState({});
  const [audioDuration, setAudioDuration] = useState({});
  // Message action menu state
  const [showMessageMenu, setShowMessageMenu] = useState(false);
  const [menuMessage, setMenuMessage] = useState(null);
  // Forward message state
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  // Edit message state
  const [editingMessage, setEditingMessage] = useState(null);
  const [editMessageText, setEditMessageText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingOperations, setPendingOperations] = useState(new Map()); // Track pending operations to prevent duplicates
  const scrollViewRef = useRef(null);
  const textInputRef = useRef(null);

  const typingTimeoutRef = useRef(null);
  const swipeAnimations = useRef({});
  const isUserScrollingRef = useRef(false);
  const isUserAtBottomRef = useRef(true); // Track if user is at bottom
  const lastMessageCountRef = useRef(0);
  const scrollPositionRef = useRef({ y: 0, contentHeight: 0, layoutHeight: 0 });
  const isLoadingMoreRef = useRef(false); // Track if currently loading more to prevent duplicate calls
  const hasLoadedMoreRef = useRef(false); // Track if we've already triggered load more in this scroll session
  const scrollOffsetBeforeLoadRef = useRef(0); // Store scroll position before loading more
  const messagesCountBeforeLoadRef = useRef(0); // Store message count before loading more
  const usersListRef = useRef([]); // Store all users list for typing user lookup

  const loading = isLoadingChat || messagesLoading;
  const messagesError = chatError;

  // REMOVED: Unconditional scroll effect that was causing forceful scroll to bottom
  // Auto-scrolling is now handled by the smart scroll logic below (lines 419-482)

  // Fetch clients to resolve sender names
  const { data: clients = [] } = useGetClientsQuery(undefined, {
    skip: !user,
  });

  // Fetch all users to enable name lookup by ID
  const { users: usersList } = useUsers();

  // Fetch chats for forwarding (exclude current chat)
  // Fetch both admin-client and admin-designer chats
  const { data: availableChats1 = [] } = useGetChatsQuery(
    { page: 1, limit: 100, search: '', type: 'admin-client' },
    { skip: !showForwardModal || !user }
  );
  
  const { data: availableChats2 = [] } = useGetChatsQuery(
    { page: 1, limit: 100, search: '', type: 'admin-designer' },
    { skip: !showForwardModal || !user }
  );
  
  // Combine and filter out current chat from available chats
  const forwardableChats = useMemo(() => {
    const currentChatId = chat?._id || chat?.id;
    const allChats = [...(availableChats1 || []), ...(availableChats2 || [])];
    // Remove duplicates and current chat
    const uniqueChats = Array.from(
      new Map(allChats.map(c => [c._id || c.id, c])).values()
    );
    return uniqueChats.filter(
      (c) => (c._id || c.id) !== currentChatId
    );
  }, [availableChats1, availableChats2, chat]);

  // Store users list in ref for typing user lookup
  useEffect(() => {
    if (usersList && usersList.length > 0) {
      usersListRef.current = usersList;
    }
  }, [usersList]);

  // Debug: Track modal state changes
  useEffect(() => {
    console.log('📄 [Modal State] Changed:', {
      showMediaViewerModal,
      viewerMediaUrl,
      viewerMediaType,
      viewerDocumentName,
    });
  }, [showMediaViewerModal, viewerMediaUrl, viewerMediaType, viewerDocumentName]);

  // Helper function to get typing user name from userId using ref
  const getTypingUserName = useCallback((userId) => {
    if (!userId || !usersListRef.current || usersListRef.current.length === 0) {
      return null;
    }
    
    const idStr = String(userId).trim();
    
    // Try to find user in usersListRef
    const foundUser = usersListRef.current.find(u => {
      const userIdFromList = String(u.id || u._id || '').trim();
      const noSpacesId = idStr.replace(/\s/g, '');
      const cleanId = idStr.replace(/^ObjectId\(/, '').replace(/\)$/, '').replace(/\s/g, '');
      return userIdFromList === idStr || userIdFromList === noSpacesId || userIdFromList === cleanId;
    });
    
    if (foundUser) {
      return foundUser.name || foundUser.Name || foundUser.email || foundUser.Email || null;
    }
    
    return null;
  }, []);

  // Always fetch enquiry data if we have enquiryId to ensure we have complete client information
  const { data: fetchedEnquiryData, isLoading: isLoadingEnquiry } = useGetEnquiryByIdQuery(enquiryId, {
    skip: !enquiryId,
  });
  
  // Use fetched enquiry if available, otherwise use route enquiry
  const finalEnquiry = fetchedEnquiryData?._originalData || fetchedEnquiryData || enquiry;
  
  // Helper function to check if a value is a valid client name (not "Unknown Client" or empty)
  const isValidClientName = (name) => {
    return name && 
           typeof name === 'string' && 
           name.trim() !== '' && 
           name.trim().toLowerCase() !== 'unknown client' &&
           name.trim() !== 'Unknown Client';
  };

  // Helper function to get user name from SenderId using cached users
  const getSenderNameFromId = useCallback((senderId) => {
    if (!senderId || !usersList || usersList.length === 0) {
      return null;
    }
    
    const idStr = String(senderId).trim();
    
    // Try to find user in usersList
    const foundUser = usersList.find(u => {
      const userId = String(u.id || u._id || '').trim();
      const noSpacesId = idStr.replace(/\s/g, '');
      const cleanId = idStr.replace(/^ObjectId\(/, '').replace(/\)$/, '').replace(/\s/g, '');
      return userId === idStr || userId === noSpacesId || userId === cleanId;
    });
    
    if (foundUser) {
      return foundUser.name || foundUser.Name || foundUser.email || foundUser.Email || null;
    }
    
    // Fallback to getUserName utility
    const name = getUserName(senderId);
    return name && name !== senderId ? name : null;
  }, [usersList]);

  // Helper function to get user profile data (name, image) from SenderId
  const getSenderProfileData = useCallback((senderId) => {
    if (!senderId || !usersList || usersList.length === 0) {
      return { name: null, image: null };
    }
    
    const idStr = String(senderId).trim();
    
    // Try to find user in usersList
    const foundUser = usersList.find(u => {
      const userId = String(u.id || u._id || '').trim();
      const noSpacesId = idStr.replace(/\s/g, '');
      const cleanId = idStr.replace(/^ObjectId\(/, '').replace(/\)$/, '').replace(/\s/g, '');
      return userId === idStr || userId === noSpacesId || userId === cleanId;
    });
    
    if (foundUser) {
      const name = foundUser.name || foundUser.Name || foundUser.email || foundUser.Email || null;
      // Try to get profile image from various possible fields
      const image = foundUser.profileImage || 
                    foundUser.profilePicture || 
                    foundUser.avatar || 
                    foundUser.photo || 
                    foundUser.picture || 
                    foundUser.image ||
                    foundUser.ProfileImage ||
                    foundUser.ProfilePicture ||
                    foundUser.Avatar ||
                    foundUser.Photo ||
                    foundUser.Picture ||
                    foundUser.Image ||
                    null;
      
      // If image is a relative path, prepend FILE_BASE_URL
      let imageUrl = null;
      if (image) {
        if (typeof image === 'string' && (image.startsWith('http://') || image.startsWith('https://'))) {
          imageUrl = image;
        } else if (typeof image === 'string' && image.trim()) {
          imageUrl = `${FILE_BASE_URL}${image.startsWith('/') ? image : `/${image}`}`;
        }
      }
      
      return { name, image: imageUrl };
    }
    
    // Fallback to getUserName utility
    const name = getUserName(senderId);
    return { 
      name: name && name !== senderId ? name : null, 
      image: null 
    };
  }, [usersList]);

  // Create sender lookup map (senderId -> { name, role })
  const senderMap = useMemo(() => {
    const map = new Map();
    
    // Add clients to map
    clients.forEach(client => {
      const idStr = String(client.id).trim();
      map.set(idStr, { name: client.name, role: 'client' });
    });
    
    // Add all users to map (this includes admins, designers, workers, etc.)
    if (usersList && usersList.length > 0) {
      usersList.forEach(userItem => {
        const idStr = String(userItem.id || userItem._id || '').trim();
        if (idStr) {
          // Only add if not already in map (clients take priority)
          if (!map.has(idStr)) {
            map.set(idStr, { 
              name: userItem.name || userItem.Name || userItem.email || userItem.Email || 'Unknown',
              role: userItem.role || userItem.Role || 'user'
            });
          }
        }
      });
    }
    
    // Add current user to map (override if exists)
    if (user) {
      const userIdStr = String(user.id).trim();
      map.set(userIdStr, { 
        name: user.name || user.email || 'You', 
        role: user.role || 'user' 
      });
    }
    
    return map;
  }, [clients, usersList, user]);

  // Enrich messages with sender names from senderMap
  // Optimized: Cache current time to avoid creating new Date() on every message
  const enrichedMessages = useMemo(() => {
    if (!messages || messages.length === 0) {
      return [];
    }
    
    // Cache current time once for all messages (performance optimization)
    const now = new Date();
    
    return messages.map(msg => {
      // Calculate status based on read receipts (for user's own messages)
      const senderId = msg.SenderId || msg.senderId;
      const isMyMessage = user && String(senderId).trim() === String(user.id).trim();
      const readByArray = msg.ReadBy || msg.readBy || msg.read_by || [];
      const isReadFlag = msg.IsRead || msg.isRead || false;
      
      // Always default to 'sent' for user's messages, or keep original status
      let messageStatus = msg.status || msg.Status || (isMyMessage ? 'sent' : undefined);
      
      // For user's own messages, determine status based on read receipts
      if (isMyMessage && user) {
        // If no status at all, default to 'sent'
        if (!messageStatus) {
          messageStatus = 'sent';
        }
        
        // CRITICAL: Only mark as "read" if someone OTHER than the sender has read it
        // Check ReadBy array - must contain at least one ID that is NOT the sender
        const senderIdStr = String(senderId).trim();
        const userIdStr = String(user?.id || user?._id || user?.Id || '').trim();
        
        let hasReadByOthers = false;
        if (Array.isArray(readByArray) && readByArray.length > 0) {
          // Filter out the sender's ID and check if any OTHER users have read it
          const otherReaders = readByArray.filter(id => {
            const readerId = String(id).trim();
            return readerId !== senderIdStr && 
                   readerId !== userIdStr && 
                   readerId !== '';
          });
          hasReadByOthers = otherReaders.length > 0;
        }
        
        // SAFEGUARD: Check message age - very new messages can't be read yet
        // Optimized: Only calculate if needed (when hasReadByOthers is true)
        const messageTime = msg.Timestamp || msg.timestamp;
        let isVeryNewMessage = false;
        if (hasReadByOthers && messageTime) {
          try {
            const msgDate = new Date(messageTime);
            const ageSeconds = (now - msgDate) / 1000;
            isVeryNewMessage = ageSeconds < 2; // Less than 2 seconds old
          } catch {
            isVeryNewMessage = false;
          }
        }
        
        // IMPORTANT: Don't trust isReadFlag alone - verify ReadBy contains others
        // Only mark as "read" if we have confirmed that others have read it
        // AND the message is not brand new (just sent)
        if (isVeryNewMessage) {
          // Very new messages should always be 'sent', never 'read'
          messageStatus = 'sent';
        } else if (hasReadByOthers) {
          // Confirmed others have read it - mark as 'read'
          messageStatus = 'read';
        } else if (messageStatus === 'sending' || messageStatus === 'failed') {
          // Keep sending/failed status
          messageStatus = messageStatus;
        } else {
          // Default to 'sent' - NOT 'read' unless confirmed
          messageStatus = 'sent';
        }
      } else {
        // For other people's messages, we don't need status
        messageStatus = messageStatus || undefined;
      }
      
      // Normalize message format (handle both API and WebSocket formats)
      const normalizedMsg = {
        ...msg, // Preserve all original fields first
        id: msg._id || msg.id,
        text: msg.Message || msg.message || msg.text || '',
        senderId: msg.SenderId || msg.senderId,
        senderName: msg.SenderName || msg.senderName,
        senderRole: msg.SenderRole || msg.senderRole,
        timestamp: msg.Timestamp || msg.timestamp,
        messageType: msg.MessageType || msg.messageType || 'text',
        mediaKey: msg.Media?.Url || msg.media?.url || msg.mediaKey,
        mediaName: msg.Media?.Name || msg.media?.name || msg.mediaName,
        mediaUrl: msg.Media?.Url || msg.media?.url || msg.mediaUrl,
        isRead: msg.IsRead || msg.isRead || false,
        replyTo: msg.ReplyTo || msg.replyTo || null,
        ReadBy: msg.ReadBy || msg.readBy || msg.read_by || [],
        readBy: msg.ReadBy || msg.readBy || msg.read_by || [],
        status: messageStatus, // Override with calculated status - ALWAYS set
      };
      
      // REMOVED: Excessive console.log that was causing lag
      // Debug logging removed for performance

      // If senderName is already present and not 'Unknown', use it
      if (normalizedMsg.senderName && normalizedMsg.senderName !== 'Unknown') {
        return normalizedMsg;
      }
      
      // Otherwise, try to resolve from senderMap
      const senderIdStr = String(normalizedMsg.senderId).trim();
      const senderInfo = senderMap.get(senderIdStr);
      
      if (senderInfo) {
        return {
          ...normalizedMsg,
          senderName: senderInfo.name,
          senderRole: senderInfo.role,
        };
      }
      
      // Try to get sender name from cached users using helper function
      const senderNameFromCache = getSenderNameFromId(senderIdStr);
      if (senderNameFromCache) {
        return {
          ...normalizedMsg,
          senderName: senderNameFromCache,
          senderRole: normalizedMsg.senderRole || 'user',
        };
      }
      
      // Fallback to current user if senderId matches
      if (user && String(user.id).trim() === senderIdStr) {
        return {
          ...normalizedMsg,
          senderName: user.name || user.email || 'You',
          senderRole: user.role || 'user',
        };
      }
      
      // Final fallback: try getUserName utility
      const userNameFromUtil = getUserName(senderIdStr);
      if (userNameFromUtil && userNameFromUtil !== senderIdStr) {
        return {
          ...normalizedMsg,
          senderName: userNameFromUtil,
          senderRole: normalizedMsg.senderRole || 'user',
        };
      }
      
      // Default fallback
      return {
        ...normalizedMsg,
        senderName: normalizedMsg.senderName || 'Unknown',
        senderRole: normalizedMsg.senderRole || 'user',
      };
    });
  }, [messages, senderMap, user, getSenderNameFromId]);

  // Initialize scroll hook after enrichedMessages is defined
  const { scrollToMessage, storeMessagePosition } = useMessageScroll(enrichedMessages, scrollViewRef);

  // Track scroll position to determine if user is at bottom and detect scroll-to-top for pagination
  const handleScroll = useCallback((event) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    
    // Only update if we have valid dimensions
    if (contentSize.height > 0 && layoutMeasurement.height > 0) {
      scrollPositionRef.current = {
        y: contentOffset.y,
        contentHeight: contentSize.height,
        layoutHeight: layoutMeasurement.height,
      };
      
      // Check if user is near bottom (within 10px for EXTREMELY strict check)
      const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      const isNearBottom = distanceFromBottom <= 10;
      
      // Update if user is at bottom - be EXTREMELY strict
      isUserAtBottomRef.current = isNearBottom;
      
      // AGGRESSIVE blocking: If user scrolls more than 50px from bottom, IMMEDIATELY block auto-scroll
      // This prevents any accidental scrolling when user is viewing older messages
      if (distanceFromBottom > 50) {
        isUserAtBottomRef.current = false;
        // Also set scrolling flag to prevent any auto-scroll attempts
        isUserScrollingRef.current = true;
      }

      // PAGINATION: Check if user scrolled to top (to load older messages)
      // Since messages are oldest first (inverted=false), top = older messages
      const distanceFromTop = contentOffset.y;
      const isNearTop = distanceFromTop <= 100; // Within 100px from top
      
      // Load more messages when user scrolls near top
      if (isNearTop && hasMore && !isLoadingMore && !isLoadingMoreRef.current && !hasLoadedMoreRef.current) {
        isLoadingMoreRef.current = true;
        hasLoadedMoreRef.current = true;
        
        // Store current scroll position and message count before loading
        scrollOffsetBeforeLoadRef.current = contentOffset.y;
        messagesCountBeforeLoadRef.current = enrichedMessages.length;
        
        if (__DEV__) {
          console.log('📜 [Pagination] User scrolled to top, loading older messages...', {
            scrollOffset: contentOffset.y,
            messageCount: enrichedMessages.length,
          });
        }
        
        loadMoreMessages().then((success) => {
          isLoadingMoreRef.current = false;
          
          // Reset flag after a delay to allow another load if user continues scrolling
          setTimeout(() => {
            hasLoadedMoreRef.current = false;
          }, 1000);
          
          if (__DEV__ && success) {
            console.log('📜 [Pagination] Successfully loaded older messages');
          }
        }).catch((error) => {
          isLoadingMoreRef.current = false;
          hasLoadedMoreRef.current = false;
          if (__DEV__) {
            console.error('📜 [Pagination] Error loading more messages:', error);
          }
        });
      }
    }
  }, [hasMore, isLoadingMore, loadMoreMessages]);

  // Track when user starts scrolling
  const handleScrollBeginDrag = useCallback(() => {
    // IMMEDIATELY set scrolling flag to block all auto-scroll
    isUserScrollingRef.current = true;
    
    // Reset load more flag when user starts scrolling (allows new load attempt)
    hasLoadedMoreRef.current = false;
    
    // When user starts scrolling, check if they're at bottom
    // If not, disable auto-scroll IMMEDIATELY
    const { y, contentHeight, layoutHeight } = scrollPositionRef.current;
    if (contentHeight > 0 && layoutHeight > 0) {
      const distanceFromBottom = contentHeight - (y + layoutHeight);
      // If user is more than 30px from bottom, they're clearly viewing older messages
      if (distanceFromBottom > 30) {
        isUserAtBottomRef.current = false;
      }
    }
  }, []);

  // Track when user stops scrolling
  const handleScrollEndDrag = useCallback((event) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const isNearBottom = distanceFromBottom <= 10; // EXTREMELY strict threshold
    
    // Update bottom status when user stops scrolling
    isUserAtBottomRef.current = isNearBottom;
    
    // LONGER delayed clearing of scroll flag to prevent immediate auto-scroll
    // Increased delay to 500ms to ensure user has finished scrolling
    setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 500);
  }, []);

  // Track when momentum scrolling ends (iOS)
  const handleMomentumScrollEnd = useCallback((event) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const isNearBottom = distanceFromBottom <= 10; // EXTREMELY strict threshold
    
    // Update bottom status when momentum scrolling ends
    isUserAtBottomRef.current = isNearBottom;
    
    // LONGER delayed clearing of scroll flag to prevent immediate auto-scroll
    // Increased delay to 500ms to ensure momentum scrolling has fully completed
    setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 500);
  }, []);

  // Maintain scroll position when older messages are loaded (pagination)
  useEffect(() => {
    // Only maintain position if we were loading more and messages increased
    if (isLoadingMoreRef.current && messagesCountBeforeLoadRef.current > 0) {
      const currentCount = messages.length;
      const previousCount = messagesCountBeforeLoadRef.current;
      const messagesAdded = currentCount - previousCount;
      
      // If messages were added (older messages loaded), maintain scroll position
      if (messagesAdded > 0 && scrollViewRef.current && scrollOffsetBeforeLoadRef.current > 0) {
        // Estimate height of new messages (average ~100px per message, adjust based on your message height)
        const estimatedNewHeight = messagesAdded * 100;
        const newOffset = scrollOffsetBeforeLoadRef.current + estimatedNewHeight;
        
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          if (scrollViewRef.current) {
            scrollViewRef.current.scrollToOffset({
              offset: Math.max(0, newOffset),
              animated: false, // Instant scroll to maintain position
            });
            
            if (__DEV__) {
              console.log('📜 [Pagination] Maintained scroll position', {
                messagesAdded,
                oldOffset: scrollOffsetBeforeLoadRef.current,
                newOffset,
              });
            }
          }
        });
        
        // Reset tracking refs
        messagesCountBeforeLoadRef.current = 0;
        scrollOffsetBeforeLoadRef.current = 0;
      }
    }
  }, [messages.length, isLoadingMore]);

  // Scroll to bottom only when new messages arrive AND user is at bottom
  useEffect(() => {
    if (!messages || messages.length === 0) {
      lastMessageCountRef.current = 0;
      return;
    }

    const currentMessageCount = messages.length;
    const previousMessageCount = lastMessageCountRef.current;
    const hasNewMessages = currentMessageCount > previousMessageCount;
    
    // Update message count
    lastMessageCountRef.current = currentMessageCount;

    // Only auto-scroll if:
    // 1. New messages were added (not just updated)
    // 2. User is at or near the bottom (not scrolling up)
    // 3. We're NOT loading older messages (pagination)
    if (hasNewMessages && !isLoadingMoreRef.current) {
      // CRITICAL: Check if user is ACTUALLY scrolling or has scrolled up
      // If user is actively scrolling, NEVER auto-scroll
      if (isUserScrollingRef.current) {
        return;
      }
      
      // Check if user is at bottom using stored scroll position
      const { y, contentHeight, layoutHeight } = scrollPositionRef.current;
      
      // If we don't have valid dimensions yet, it's safe to scroll (initial load)
      if (contentHeight === 0 || layoutHeight === 0) {
        // Only scroll on initial load, not on every message update
        if (previousMessageCount === 0 && enrichedMessages.length > 0) {
          setTimeout(() => {
            scrollViewRef.current?.scrollToIndex({ 
              index: enrichedMessages.length - 1, 
              animated: true,
              viewPosition: 1 
            });
          }, 100);
        }
        return;
      }
      
      // Calculate distance from bottom FIRST (don't trust the ref alone)
      const distanceFromBottom = contentHeight - (y + layoutHeight);
      
      // VERY STRICT: Only scroll if distance is EXTREMELY close (10px instead of 20px)
      // This prevents auto-scroll when user has scrolled up even slightly
      const isActuallyAtBottom = distanceFromBottom <= 10;
      
      // ALSO check the ref for additional safety
      const refSaysAtBottom = isUserAtBottomRef.current;
      
      // REMOVED: Excessive logging for performance
      
      // Only scroll if BOTH conditions are met:
      // 1. User is ACTUALLY at bottom (calculated distance <= 10px)
      // 2. Ref also says user is at bottom (double-check)
      if (isActuallyAtBottom && refSaysAtBottom && enrichedMessages.length > 0) {
        setTimeout(() => {
          scrollViewRef.current?.scrollToIndex({ 
            index: enrichedMessages.length - 1, 
            animated: true,
            viewPosition: 1 
          });
        }, 100);
      }
    }
  }, [messages]);

  useEffect(() => {
    const onShow = (e) => {
      if (e?.endCoordinates) {
        const { height, screenY } = e.endCoordinates;
        const windowHeight = Dimensions.get('window').height;
        const overlapFromBottom = Math.max(0, windowHeight - screenY);
        const h = typeof height === 'number' ? height : 0;
        setKeyboardBottomInset(Math.round(Math.max(h, overlapFromBottom)));
      }
      if (isUserAtBottomRef.current && enrichedMessages.length > 0) {
        setTimeout(() => {
          scrollViewRef.current?.scrollToIndex({
            index: enrichedMessages.length - 1,
            animated: true,
            viewPosition: 1,
          });
        }, 100);
      }
    };
    const onHide = () => {
      setKeyboardBottomInset(0);
    };

    const showSub = Keyboard.addListener('keyboardDidShow', onShow);
    const hideSub = Keyboard.addListener('keyboardDidHide', onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [enrichedMessages.length]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setKeyboardBottomInset(0);
      };
    }, [])
  );

  const sendMessage = async () => {
    const draftTrimmed = draftMessageRef.current.trim();
    // Detailed validation with logging
    if (!draftTrimmed) {
      if (__DEV__) {
        console.warn('⚠️ [ChatDetailScreen] Cannot send: Message is empty', {
          draftLength: draftMessageRef.current.length,
        });
      }
      return;
    }
    
    if (!chat) {
      if (__DEV__) {
        console.error('❌ [ChatDetailScreen] Cannot send: Chat is null/undefined', {
          chat,
          hookChat,
          routeChat,
          chatId: specificChatId,
          enquiryId,
        });
      }
      alert.error('Error', 'Chat not loaded. Please wait a moment and try again.');
      return;
    }

    const messageText = draftTrimmed;
    
    if (__DEV__) {
      console.log('📤 [ChatDetailScreen] Preparing to send message', {
        messageLength: messageText.length,
        chatId: chat?._id || chat?.id,
        hasReply: !!replyingTo,
        socketConnected: socketService.isConnected(),
      });
    }
    // Get reply target before clearing state
    // IMPORTANT: You can reply to ANY message - your own or others (like WhatsApp)
    const previousReply = replyingTo;
    const replyToMessage = buildReplyToPayload(replyingTo);
    
    if (__DEV__ && replyToMessage) {
      console.log('📤 [Send] Sending message with reply:', {
        hasReply: true,
        replyToId: replyToMessage._id || replyToMessage.id,
        replyToText: (replyToMessage.text || replyToMessage.Message || '').substring(0, 30),
        messageText: messageText.substring(0, 30),
        isReplyingToMyMessage: replyToMessage.myMessage || false,
      });
    }
    
    draftMessageRef.current = '';
    hasComposerTextRef.current = false;
    setHasComposerText(false);
    textInputRef.current?.clear?.();
    setReplyingTo(null); // Clear reply after sending
    
    // When user sends a message, always scroll to bottom
    isUserScrollingRef.current = false;
    isUserAtBottomRef.current = true;

    // Send via the hook (now async) with replyTo
    const sent = await sendChatMessage(messageText, replyToMessage);
    
    if (!sent) {
      if (__DEV__) {
        console.error('❌ [ChatDetailScreen] sendChatMessage returned false', {
          messageText: messageText.substring(0, 50),
          chatId: chat?._id || chat?.id,
          socketConnected: socketService.isConnected(),
          hasUser: !!user,
        });
      }
      
      // Check specific reasons for failure
      let errorMessage = 'Failed to send message. ';
      if (!socketService.isConnected()) {
        errorMessage += 'Not connected to server. Please check your internet connection.';
      } else if (!chat) {
        errorMessage += 'Chat not loaded. Please wait a moment and try again.';
      } else if (!user) {
        errorMessage += 'User not authenticated. Please log in again.';
      } else {
        errorMessage += 'Please check your connection and try again.';
      }
      
      alert.error('Error', errorMessage);
      draftMessageRef.current = messageText;
      hasComposerTextRef.current = messageText.trim().length > 0;
      setHasComposerText(hasComposerTextRef.current);
      textInputRef.current?.setNativeProps?.({ text: messageText });
      if (previousReply) setReplyingTo(previousReply); // Restore full reply target on error
    } else {
      // Scroll to bottom after sending
      setTimeout(() => {
        if (enrichedMessages.length > 0) {
          scrollViewRef.current?.scrollToIndex({ 
            index: enrichedMessages.length - 1, 
            animated: true,
            viewPosition: 1 
          });
        }
      }, 200);
      
      if (__DEV__) {
        console.log('✅ [Send] Message sent successfully, reply cleared');
      }
    }
  };

  const handleReplyToMessage = (message) => {
    if (__DEV__) {
      console.log('💬 [Reply] Setting reply target:', {
        messageId: message._id || message.id,
        messageText: (message.text || message.Message || '').substring(0, 30),
        currentReplyingTo: replyingTo?._id || replyingTo?.id,
        isMyMessage: isMyMessage(message),
      });
    }
    
    // IMPORTANT: You can reply to ANY message - your own or others (like WhatsApp)
    // Always set the reply target, even if it's the same message
    // This allows replying to the same message multiple times
    
    // Force state update by creating a new object reference
    // This ensures React detects the change even if it's the same message
    const replyTarget = {
      ...message,
      _replyTimestamp: Date.now(), // Add timestamp to force state update
    };
    
    // Always set the reply target (no restrictions on own messages)
    setReplyingTo(replyTarget);
    
    if (__DEV__) {
      console.log('✅ [Reply] Reply target set:', {
        messageId: replyTarget._id || replyTarget.id,
        replyTimestamp: replyTarget._replyTimestamp,
      });
    }
    
    // Focus on input after a small delay to ensure state is updated
    setTimeout(() => {
      Keyboard.dismiss();
    }, 50);
  };

  const cancelReply = () => {
    setReplyingTo(null);
  };

  const handleTyping = useCallback((text) => {
    draftMessageRef.current = text;
    const has = text.trim().length > 0;
    if (has !== hasComposerTextRef.current) {
      hasComposerTextRef.current = has;
      setHasComposerText(has);
    }

    // Send typing indicator
    if (text.trim() && chat) {
      sendTypingRef.current(true);

      // Clear typing indicator after 2 seconds of no typing
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        sendTypingRef.current(false);
      }, 2000);
    }
  }, [chat]);

  const handleAttachFile = () => {
    setShowMediaModal(true);
  };

  const handleCloseMediaModal = () => {
    setShowMediaModal(false);
  };

  // Voice recording functions
  const VOICE_CANCEL_DX = -72;
  const VOICE_LOCK_DY = -72;

  const probeAudioDurationSeconds = useCallback(async (uri) => {
    if (!uri || isRecording) return null;
    const player = audioRecorderPlayerRef.current;
    try {
      try {
        await player.stopPlayer();
      } catch (_) {
        /* noop */
      }
      player.removePlayBackListener();
      await player.startPlayer(uri);
      return await new Promise((resolve) => {
        const timeout = setTimeout(async () => {
          try {
            await player.stopPlayer();
            player.removePlayBackListener();
          } catch (_) {
            /* noop */
          }
          resolve(null);
        }, 2500);
        player.addPlayBackListener((e) => {
          const d = Math.floor((e.duration || 0) / 1000);
          if (d > 0) {
            clearTimeout(timeout);
            player.stopPlayer().catch(() => {});
            player.removePlayBackListener();
            resolve(d);
          }
        });
      });
    } catch {
      try {
        await player.stopPlayer();
        player.removePlayBackListener();
      } catch (_) {
        /* noop */
      }
      return null;
    }
  }, [isRecording]);

  const requestAudioPermission = useCallback(async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'Allow access to your microphone to record voice notes.',
            buttonPositive: 'OK',
            buttonNegative: 'Cancel',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        if (__DEV__) {
          console.log('Audio permission request error', err);
        }
        return false;
      }
    }
    return true; // iOS permissions are handled automatically
  }, []);

  const startRecording = useCallback(async () => {
    const hasPermission = await requestAudioPermission();
    if (!hasPermission) {
      alert.error('Permission Denied', 'Microphone permission is required to record voice notes.');
      return;
    }

    try {
      const audioRecorderPlayer = audioRecorderPlayerRef.current;
      const path = Platform.select({
        ios: 'voice_note.m4a',
        android: `${RNFS.CachesDirectoryPath}/voice_note_${Date.now()}.mp3`,
      });

      const uri = await audioRecorderPlayer.startRecorder(path);
      audioRecorderPlayer.addRecordBackListener((e) => {
        const timeInSeconds = Math.floor(e.currentPosition / 1000);
        recordingTimeRef.current = timeInSeconds;
        setRecordingTime(timeInSeconds);
      });

      setRecordingPath(uri);
      setIsRecording(true);
      isRecordingRef.current = true;
      recordingTimeRef.current = 0;
      setRecordingTime(0);
      setShouldCancel(false);
      setSlideOffsetX(0);
      setIsLocked(false);
      isLockedRef.current = false;
      recordingStartTimeRef.current = Date.now();

      // Start waveform animation with staggered effect
      const waveformAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(waveformAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(waveformAnim, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      waveformAnimation.start();
      
      // Store animation reference
      recordingTimerRef.current = { waveformAnimation };
    } catch (error) {
      if (__DEV__) {
        console.error('Error starting recording:', error);
      }
      alert.error('Error', 'Failed to start recording. Please try again.');
    }
  }, [requestAudioPermission, alert, waveformAnim]);

  const stopRecording = useCallback(async (shouldSend = false) => {
    let pathToDelete = recordingPath;
    try {
      const audioRecorderPlayer = audioRecorderPlayerRef.current;
      const result = await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();

      // Stop waveform animation
      waveformAnim.stopAnimation();
      // Stop mic button pulse animation
      micButtonPulseAnim.stopAnimation();
      if (recordingTimerRef.current?.waveformAnimation) {
        recordingTimerRef.current.waveformAnimation.stop();
      }

      setIsRecording(false);
      isRecordingRef.current = false;
      setIsLocked(false);
      isLockedRef.current = false;
      setSlideOffsetX(0);
      setShouldCancel(false);

      const recordedPath =
        typeof result === 'string' && result.length > 0 ? result : recordingPath;
      pathToDelete = recordedPath || recordingPath;
      const finalTime = Math.max(recordingTimeRef.current || 0, recordingTime);

      if (shouldSend && pathToDelete && finalTime > 0) {
        // Send voice note
        const minutes = Math.floor(finalTime / 60);
        const seconds = finalTime % 60;
        const durationString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const audioFile = {
          uri: pathToDelete,
          type: Platform.OS === 'ios' ? 'audio/m4a' : 'audio/mp3',
          name: `voice_note_${Date.now()}.${Platform.OS === 'ios' ? 'm4a' : 'mp3'}`,
          messageType: 'audio',
          audioDuration: durationString,
        };

        const prevReply = replyingTo;
        const replyPayload = buildReplyToPayload(prevReply);
        setReplyingTo(null);
        const sent = await sendMedia(audioFile, replyPayload);
        if (!sent) {
          alert.error('Error', 'Failed to send voice note. Please try again.');
          if (prevReply) setReplyingTo(prevReply);
        }
      } else if (pathToDelete) {
        // Delete recording if cancelled
        try {
          if (Platform.OS === 'android' && await RNFS.exists(pathToDelete)) {
            await RNFS.unlink(pathToDelete);
          }
        } catch (error) {
          if (__DEV__) {
            console.log('Error deleting recording:', error);
          }
        }
      }

      setRecordingPath(null);
      recordingTimeRef.current = 0;
      setRecordingTime(0);
      recordingStartTimeRef.current = null;
    } catch (error) {
      if (__DEV__) {
        console.error('Error stopping recording:', error);
      }
      setIsRecording(false);
      isRecordingRef.current = false;
      setIsLocked(false);
      isLockedRef.current = false;
      setRecordingPath(null);
      recordingTimeRef.current = 0;
      setRecordingTime(0);
    }
  }, [recordingPath, recordingTime, sendMedia, alert, waveformAnim, replyingTo, buildReplyToPayload]);

  const startLockPulse = useCallback(() => {
    micButtonPulseAnim.stopAnimation();
    Animated.loop(
      Animated.sequence([
        Animated.timing(micButtonPulseAnim, {
          toValue: 1.1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(micButtonPulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [micButtonPulseAnim]);

  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  useEffect(() => {
    startLockPulseRef.current = startLockPulse;
  }, [startLockPulse]);

  // useMemo (not useEffect) so panHandlers exist on the first render; stale {} broke iOS until a random re-render.
  const voiceNotePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !isRecordingRef.current && !isLockedRef.current,
        onStartShouldSetPanResponderCapture: () => !isRecordingRef.current && !isLockedRef.current,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          isRecordingRef.current &&
          !isLockedRef.current &&
          (Math.abs(gestureState.dx) > 12 || Math.abs(gestureState.dy) > 12),
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          isRecordingRef.current &&
          !isLockedRef.current &&
          (Math.abs(gestureState.dx) > 10 || Math.abs(gestureState.dy) > 10),
        onPanResponderGrant: () => {
          if (!isRecordingRef.current && !isLockedRef.current) {
            startRecordingRef.current();
          }
        },
        onPanResponderMove: (_, gestureState) => {
          if (!isRecordingRef.current || isLockedRef.current) return;
          const { dx, dy } = gestureState;
          setSlideOffsetX(Math.min(0, dx));
          setShouldCancel(dx < VOICE_CANCEL_DX * 0.65);
          if (dy < VOICE_LOCK_DY && Math.abs(dx) < 56) {
            isLockedRef.current = true;
            setIsLocked(true);
            startLockPulseRef.current();
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (isRecordingRef.current && !isLockedRef.current) {
            const cancel = gestureState.dx < VOICE_CANCEL_DX;
            const elapsed = recordingTimeRef.current;
            if (cancel) {
              stopRecordingRef.current(false);
            } else {
              stopRecordingRef.current(elapsed >= 0.5);
            }
          }
          setSlideOffsetX(0);
          setShouldCancel(false);
        },
      }),
    []
  );

  /** Android: one tap on mic starts recording in locked (hands-free) mode; use send / overlay to finish. */
  const handleAndroidMicTap = useCallback(async () => {
    if (isRecordingRef.current) return;
    await startRecording();
    if (!isRecordingRef.current) return;
    isLockedRef.current = true;
    setIsLocked(true);
    startLockPulse();
  }, [startRecording, startLockPulse]);

  /** Locked recording: tap send to finish. */
  const handleMicPress = useCallback(() => {
    if (isRecording && isLocked) {
      stopRecording(true);
    }
  }, [isRecording, isLocked, stopRecording]);

  // Message action menu functions
  const handleMessageLongPress = useCallback((message) => {
    setMenuMessage(message);
    setShowMessageMenu(true);
  }, []);

  const handleCloseMessageMenu = useCallback(() => {
    setShowMessageMenu(false);
    setMenuMessage(null);
  }, []);

  const handleReplyFromMenu = useCallback(() => {
    if (menuMessage) {
      handleReplyToMessage(menuMessage);
    }
    handleCloseMessageMenu();
  }, [menuMessage, handleReplyToMessage, handleCloseMessageMenu]);

  const handleForwardFromMenu = useCallback(() => {
    if (menuMessage) {
      setForwardingMessage(menuMessage);
      setShowForwardModal(true);
    }
    handleCloseMessageMenu();
  }, [menuMessage, handleCloseMessageMenu]);

  const handleReadReceiptsFromMenu = useCallback(() => {
    if (menuMessage) {
      handleShowReadReceipts(menuMessage);
    }
    handleCloseMessageMenu();
  }, [menuMessage, handleCloseMessageMenu]);

  const handleCopyFromMenu = useCallback(() => {
    if (!menuMessage) {
      handleCloseMessageMenu();
      return;
    }

    try {
      // Get message text from various possible fields
      let messageText = 
        menuMessage.text || 
        menuMessage.Message || 
        menuMessage.message || 
        '';
      
      // Remove "Forwarded: " prefix if present (for backward compatibility)
      if (messageText.startsWith('Forwarded: ')) {
        messageText = messageText.replace(/^Forwarded: /, '');
      }

      // Check if it's a media message
      const messageType = menuMessage.messageType || menuMessage.MessageType || 'text';
      const isMediaMessage = ['image', 'video', 'file', 'audio'].includes(messageType);

      let textToCopy = '';
      if (messageText.trim()) {
        textToCopy = messageText.trim();
      } else if (isMediaMessage) {
        // For media messages without text, copy media name
        const mediaName = 
          menuMessage.mediaName || 
          menuMessage.MediaName || 
          'Media';
        
        if (mediaName && mediaName !== 'Media') {
          textToCopy = mediaName;
        } else {
          textToCopy = messageType.charAt(0).toUpperCase() + messageType.slice(1);
        }
      } else {
        // Empty message
        alert.warning('Nothing to copy', 'This message has no text content');
        handleCloseMessageMenu();
        return;
      }

      // Try using clipboard API
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        try {
          const Clipboard = require('@react-native-clipboard/clipboard').default;
          Clipboard.setString(textToCopy);
          alert.success('Copied', 'Message copied to clipboard');
        } catch (clipboardError) {
          // Fallback: Try using React Native's built-in Clipboard if available
          if (__DEV__) {
            console.warn('Clipboard package not available, trying fallback:', clipboardError);
          }
          // Fallback to showing text in alert for manual copy
          alert.info('Copy Message', textToCopy, [
            { text: 'OK' }
          ]);
        }
      } else {
        // Web/other platforms - show in alert
        alert.info('Copy Message', textToCopy, [
          { text: 'OK' }
        ]);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Error copying message:', error);
      }
      alert.error('Error', 'Failed to copy message');
    }
    
    handleCloseMessageMenu();
  }, [menuMessage, alert, handleCloseMessageMenu]);

  const handleEditFromMenu = useCallback(() => {
    if (!menuMessage || !user) {
      handleCloseMessageMenu();
      return;
    }

    // Check if user is the sender
    const senderId = menuMessage.SenderId || menuMessage.senderId;
    if (String(senderId).trim() !== String(user.id).trim()) {
      alert.error('Error', 'You can only edit your own messages');
      handleCloseMessageMenu();
      return;
    }

    // Check if message is already deleted
    if (menuMessage.IsDeleted || menuMessage.isDeleted) {
      alert.error('Error', 'Cannot edit deleted message');
      handleCloseMessageMenu();
      return;
    }

    // Get current message text
    const currentText = menuMessage.text || menuMessage.Message || menuMessage.message || '';
    
    // Remove "Forwarded: " prefix if present
    const textToEdit = currentText.startsWith('Forwarded: ') 
      ? currentText.replace(/^Forwarded: /, '') 
      : currentText;

    setEditingMessage(menuMessage);
    setEditMessageText(textToEdit);
    handleCloseMessageMenu();
  }, [menuMessage, user, alert, handleCloseMessageMenu]);

  const handleDeleteFromMenu = useCallback(() => {
    if (!menuMessage || !user) {
      handleCloseMessageMenu();
      return;
    }

    // Validation: Check if user is the sender
    const senderId = menuMessage.SenderId || menuMessage.senderId;
    if (String(senderId).trim() !== String(user.id).trim()) {
      alert.error('Permission Denied', 'You can only delete your own messages');
      handleCloseMessageMenu();
      return;
    }

    // Validation: Check if message is already deleted
    if (menuMessage.IsDeleted || menuMessage.isDeleted) {
      alert.warning('Already Deleted', 'This message has already been deleted');
      handleCloseMessageMenu();
      return;
    }

    // Validation: Check if already deleting
    const messageId = menuMessage._id || menuMessage.id;
    if (messageId && pendingOperations.has(`delete_${messageId}`)) {
      alert.warning('In Progress', 'Delete operation is already in progress');
      handleCloseMessageMenu();
      return;
    }

    // Show confirmation dialog
    alert.show('error', 'Delete Message', 'Are you sure you want to delete this message? This action cannot be undone.', [
      { 
        text: 'Cancel', 
        style: 'cancel',
        onPress: () => handleCloseMessageMenu()
      },
      { 
        text: 'Delete', 
        style: 'destructive',
        onPress: async () => {
          handleCloseMessageMenu();
          
          if (!messageId) {
            alert.error('Error', 'Invalid message. Cannot delete.');
            return;
          }

          // Check if already in progress
          if (pendingOperations.has(`delete_${messageId}`)) {
            return;
          }

          // Mark as pending
          setPendingOperations(prev => {
            const next = new Map(prev);
            next.set(`delete_${messageId}`, { type: 'delete', messageId, timestamp: Date.now() });
            return next;
          });

          setIsDeleting(true);

          // Optimistic update: Mark message as deleted immediately
          updateMessage(messageId, {
            IsDeleted: true,
            isDeleted: true,
            Message: '',
            message: '',
            text: '',
            MediaUrl: null,
            mediaUrl: null,
            MediaKey: null,
            mediaKey: null,
            MediaName: null,
            mediaName: null,
            Media: null,
            media: null,
            _locallyDeleted: true,
            _deleteTimestamp: Date.now(),
          });

          try {
            // Ensure socket is connected with retry
            let retries = 0;
            const maxRetries = 3;
            let connected = socketService.isConnected();

            while (!connected && retries < maxRetries) {
              if (__DEV__) {
                console.log(`🔄 [ChatDetailScreen] Attempting to connect socket (retry ${retries + 1}/${maxRetries})`);
              }
              await socketService.connect(user.id);
              await new Promise(resolve => setTimeout(resolve, 500));
              connected = socketService.isConnected();
              retries++;
            }

            if (!connected) {
              throw new Error('Failed to connect to server after multiple attempts');
            }

            // Delete message via socket - backend expects { messageId, userId }
            const sent = socketService.deleteMessage(messageId, user.id);
            
            if (sent) {
              // Success - socket event will confirm and update UI
              // Show success message after a short delay
              setTimeout(() => {
                alert.success('Deleted', 'Message deleted successfully');
              }, 500);
              
              // Invalidate RTK Query cache to force fresh fetch
              // getChatMessages uses 'Chat' tag with chatId, so invalidate that specific chat
              if (chatId) {
                dispatch(api.util.invalidateTags([{ type: 'Chat', id: chatId }]));
                if (__DEV__) {
                  console.log('🗑️ [ChatDetailScreen] Invalidated cache for chat:', chatId);
                }
              }
              
              // Refetch after delay to ensure persistence
              // Increased delay to 5 seconds to ensure backend has fully persisted
              setTimeout(() => {
                if (__DEV__) {
                  console.log('🔄 [ChatDetailScreen] Refetching messages after delete to ensure persistence');
                }
                // Only refetch if query is available
                if (refetchMessages && typeof refetchMessages === 'function') {
                  try {
                    refetchMessages();
                  } catch (error) {
                    if (__DEV__) {
                      console.warn('⚠️ [ChatDetailScreen] Cannot refetch messages - query not started:', error.message);
                    }
                  }
                }
              }, 5000);
            } else {
              throw new Error('Failed to send delete request');
            }
          } catch (error) {
            if (__DEV__) {
              console.error('❌ [ChatDetailScreen] Error deleting message:', error);
            }

            // Revert optimistic update
            const originalMessage = messages.find(msg => 
              String(msg._id || msg.id || '').trim() === String(messageId).trim()
            );
            
            if (originalMessage) {
              updateMessage(messageId, {
                IsDeleted: originalMessage.IsDeleted || false,
                isDeleted: originalMessage.isDeleted || false,
                Message: originalMessage.Message || originalMessage.message || originalMessage.text || '',
                message: originalMessage.Message || originalMessage.message || originalMessage.text || '',
                text: originalMessage.Message || originalMessage.message || originalMessage.text || '',
                MediaUrl: originalMessage.MediaUrl || originalMessage.mediaUrl || null,
                mediaUrl: originalMessage.MediaUrl || originalMessage.mediaUrl || null,
                MediaKey: originalMessage.MediaKey || originalMessage.mediaKey || null,
                mediaKey: originalMessage.MediaKey || originalMessage.mediaKey || null,
                MediaName: originalMessage.MediaName || originalMessage.mediaName || null,
                mediaName: originalMessage.MediaName || originalMessage.mediaName || null,
                Media: originalMessage.Media || originalMessage.media || null,
                media: originalMessage.Media || originalMessage.media || null,
              });
            }

            // Show error message
            let errorMessage = 'Failed to delete message. ';
            if (error.message?.includes('connect')) {
              errorMessage += 'Please check your internet connection and try again.';
            } else {
              errorMessage += 'Please try again.';
            }
            
            alert.error('Error', errorMessage);
          } finally {
            setIsDeleting(false);
            // Remove from pending operations after a delay
            setTimeout(() => {
              setPendingOperations(prev => {
                const next = new Map(prev);
                next.delete(`delete_${messageId}`);
                return next;
              });
            }, 1000);
          }
        }
      }
    ]);
  }, [menuMessage, user, chat, alert, handleCloseMessageMenu, pendingOperations, updateMessage, messages, refetchMessages]);

  const handleSaveEdit = useCallback(async () => {
    // Validation: Check required fields
    if (!editingMessage || !user) {
      alert.error('Error', 'Invalid state. Please try again.');
      setEditingMessage(null);
      setEditMessageText('');
      return;
    }

    // Validation: Check message text is not empty
    if (!editMessageText.trim()) {
      alert.warning('Invalid Input', 'Please enter a message to save');
      return;
    }

    // Validation: Check message length (optional - adjust max length as needed)
    const MAX_MESSAGE_LENGTH = 10000; // Adjust based on your requirements
    if (editMessageText.trim().length > MAX_MESSAGE_LENGTH) {
      alert.warning('Message Too Long', `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
      return;
    }

    // Validation: Check if user is the sender
    const senderId = editingMessage.SenderId || editingMessage.senderId;
    if (String(senderId).trim() !== String(user.id).trim()) {
      alert.error('Permission Denied', 'You can only edit your own messages');
      setEditingMessage(null);
      setEditMessageText('');
      return;
    }

    // Validation: Check if message is already deleted
    if (editingMessage.IsDeleted || editingMessage.isDeleted) {
      alert.error('Cannot Edit', 'Cannot edit a deleted message');
      setEditingMessage(null);
      setEditMessageText('');
      return;
    }

    // Check if message text actually changed
    const originalText = editingMessage.text || editingMessage.Message || editingMessage.message || '';
    const cleanedOriginal = originalText.startsWith('Forwarded: ') 
      ? originalText.replace(/^Forwarded: /, '') 
      : originalText;
    
    if (editMessageText.trim() === cleanedOriginal.trim()) {
      // No changes, just close the modal
      setEditingMessage(null);
      setEditMessageText('');
      return;
    }

    const chatId = chat?._id || chat?.id;
    const messageId = editingMessage._id || editingMessage.id;
    const messageIdToUpdate = messageId;
    
    // Validation: Check required IDs
    if (!chatId || !messageId) {
      alert.error('Error', 'Invalid chat or message');
      setEditingMessage(null);
      setEditMessageText('');
      return;
    }

    // Validation: Check if already editing
    if (pendingOperations.has(`edit_${messageId}`)) {
      alert.warning('In Progress', 'Edit operation is already in progress');
      return;
    }

    // Mark as pending
    setPendingOperations(prev => {
      const next = new Map(prev);
      next.set(`edit_${messageId}`, { type: 'edit', messageId, timestamp: Date.now() });
      return next;
    });

    setIsEditing(true);

    // Store original message for rollback
    const originalMessage = { ...editingMessage };

    // Record edit time to prevent premature refetch
    lastEditTimeRef.current = Date.now();
    
    // Optimistic update: Update message immediately in local state
    // The updateMessage function will set _locallyEdited flag and _editTimestamp
    // This ensures the edited message is preserved even if refetch happens
    updateMessage(messageIdToUpdate, {
      Message: editMessageText.trim(),
      message: editMessageText.trim(),
      text: editMessageText.trim(),
      IsEdited: true,
      isEdited: true,
      _locallyEdited: true,
      _editTimestamp: Date.now(),
    });

    if (__DEV__) {
      console.log('✅ [ChatDetailScreen] Optimistically updated message in UI');
    }

    try {
      // Ensure socket is connected with retry mechanism
      let retries = 0;
      const maxRetries = 3;
      let connected = socketService.isConnected();

      while (!connected && retries < maxRetries) {
        if (__DEV__) {
          console.log(`🔄 [ChatDetailScreen] Attempting to connect socket (retry ${retries + 1}/${maxRetries})`);
        }
        await socketService.connect(user.id);
        await new Promise(resolve => setTimeout(resolve, 500));
        connected = socketService.isConnected();
        retries++;
      }

      if (!connected) {
        throw new Error('Failed to connect to server after multiple attempts');
      }

      if (__DEV__) {
        console.log('✏️ [ChatDetailScreen] Attempting to edit message:', {
          chatId,
          messageId,
          userId: user.id,
          newText: editMessageText.trim().substring(0, 50) + '...',
          originalText: cleanedOriginal.substring(0, 50) + '...',
        });
      }

      // Edit message via socket - backend expects { messageId, userId, newMessage }
      const sent = socketService.editMessage(messageId, user.id, editMessageText.trim());
      
      if (sent) {
        if (__DEV__) {
          console.log('✅ [ChatDetailScreen] Edit message sent successfully');
        }
        
        // Close modal immediately for better UX
        setEditingMessage(null);
        setEditMessageText('');
        
        // Show success message after a short delay
        setTimeout(() => {
          alert.success('Message Edited', 'Your message has been updated');
        }, 500);
        
        // Don't invalidate cache or refetch immediately
        // The optimistic update already shows the edited message
        // The socket event 'messageEdited' will confirm the edit and update the message
        // Refetching/invalidating too early can bring back stale data before backend fully persists
        // The useChat hook's handleMessageEdited listener will update the message via socket event
        if (__DEV__) {
          console.log('✅ [ChatDetailScreen] Edit sent - optimistic update applied, waiting for socket confirmation');
        }
      } else {
        throw new Error('Failed to send edit request');
      }
    } catch (error) {
      if (__DEV__) {
        console.error('❌ [ChatDetailScreen] Error editing message:', error);
      }

      // Revert optimistic update on error
      updateMessage(messageIdToUpdate, {
        Message: originalMessage.Message || originalMessage.message || originalMessage.text || cleanedOriginal,
        message: originalMessage.Message || originalMessage.message || originalMessage.text || cleanedOriginal,
        text: originalMessage.Message || originalMessage.message || originalMessage.text || cleanedOriginal,
        IsEdited: originalMessage.IsEdited || originalMessage.isEdited || false,
        isEdited: originalMessage.IsEdited || originalMessage.isEdited || false,
      });

      // Show error message
      let errorMessage = 'Failed to edit message. ';
      if (error.message?.includes('connect')) {
        errorMessage += 'Please check your internet connection and try again.';
      } else if (error.message?.includes('Permission') || error.message?.includes('cannot edit')) {
        errorMessage = 'You can only edit your own messages.';
      } else if (error.message?.includes('not found')) {
        errorMessage = 'Message not found. It may have been deleted.';
      } else {
        errorMessage += 'Please try again.';
      }
      
      alert.error('Error', errorMessage);
    } finally {
      setIsEditing(false);
      // Remove from pending operations after a delay
      setTimeout(() => {
        setPendingOperations(prev => {
          const next = new Map(prev);
          next.delete(`edit_${messageId}`);
          return next;
        });
      }, 1000);
    }
  }, [editingMessage, editMessageText, user, chat, alert, refetchMessages, updateMessage, pendingOperations]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setEditMessageText('');
  }, []);

  // Forward message functions
  const handleForwardMessage = useCallback(async (targetChat) => {
    if (!forwardingMessage || !targetChat || !user) {
      return;
    }

    try {
      const targetChatId = targetChat._id || targetChat.id;
      if (!targetChatId) {
        alert.error('Error', 'Invalid chat selected.');
        return;
      }

      const messageText = forwardingMessage.text || forwardingMessage.Message || forwardingMessage.message || '';
      const messageType = forwardingMessage.messageType || forwardingMessage.MessageType || 'text';
      const mediaKey = forwardingMessage.mediaKey || forwardingMessage.MediaKey;
      const mediaUrl = forwardingMessage.mediaUrl || forwardingMessage.MediaUrl;
      const mediaName = forwardingMessage.mediaName || forwardingMessage.MediaName || 'Media';

      // Ensure socket is connected
      if (!socketService.isConnected()) {
        await socketService.connect(user.id);
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Join target chat room
      socketService.joinChat(targetChatId, user.id);

      // Get target chat display name
      const targetChatName = 
        targetChat.enquiryTitle || 
        targetChat.EnquiryName || 
        targetChat.enquiryName ||
        targetChat.clientName || 
        targetChat.ClientName || 
        targetChat._originalData?.EnquiryName ||
        targetChat._originalData?.enquiryTitle ||
        targetChat._originalData?.ClientName ||
        targetChat._originalData?.clientName ||
        'chat';

      // Get forwarder information (current user who is forwarding)
      const forwarderName = user.name || user.email || user.Name || user.Email || 'Unknown';
      const forwarderId = user.id;

      // Forward message via socket
      if (messageType === 'image' || messageType === 'video' || messageType === 'file' || messageType === 'audio') {
        // Forward media message - send original media name without "Forwarded:" prefix
        const sent = socketService.sendMessage({
          chatId: targetChatId,
          userId: user.id,
          message: mediaName, // Original media name, no prefix
          messageType: messageType,
          mediaUrl: mediaUrl,
          mediaName: mediaName,
          mediaKey: mediaKey,
          isForwarded: true,
          forwardedBy: forwarderId,
          forwardedByName: forwarderName,
          forwardedFrom: {
            senderId: forwardingMessage.senderId || forwardingMessage.SenderId,
            senderName: forwardingMessage.senderName || forwardingMessage.SenderName,
            originalChatId: chat?._id || chat?.id,
            originalTimestamp: forwardingMessage.timestamp || forwardingMessage.Timestamp
          }
        });

        if (sent) {
          alert.success('Forwarded', `Message forwarded to ${targetChatName}`);
        } else {
          alert.error('Error', 'Failed to forward message. Please try again.');
        }
      } else {
        // Forward text message - send original message text without "Forwarded:" prefix
        const sent = socketService.sendMessage({
          chatId: targetChatId,
          userId: user.id,
          message: messageText, // Original message text, no prefix
          messageType: 'text',
          isForwarded: true,
          forwardedBy: forwarderId,
          forwardedByName: forwarderName,
          forwardedFrom: {
            senderId: forwardingMessage.senderId || forwardingMessage.SenderId,
            senderName: forwardingMessage.senderName || forwardingMessage.SenderName,
            originalChatId: chat?._id || chat?.id,
            originalTimestamp: forwardingMessage.timestamp || forwardingMessage.Timestamp
          }
        });

        if (sent) {
          alert.success('Forwarded', `Message forwarded to ${targetChatName}`);
        } else {
          alert.error('Error', 'Failed to forward message. Please try again.');
        }
      }

      setShowForwardModal(false);
      setForwardingMessage(null);
    } catch (error) {
      if (__DEV__) {
        console.error('Error forwarding message:', error);
      }
      alert.error('Error', 'Failed to forward message. Please try again.');
    }
  }, [forwardingMessage, user, alert]);

  const handleShowReadReceipts = (message) => {
    // Removed excessive logging for performance
    setSelectedMessage(message);
    setShowReadReceiptModal(true);
  };

  const handleCloseReadReceiptModal = () => {
    setShowReadReceiptModal(false);
    setSelectedMessage(null);
  };

  const handleMediaOption = (source, mediaType) => {
    setShowMediaModal(false);
    // Small delay to ensure modal closes smoothly
    setTimeout(() => {
      handleImagePicker(source, mediaType);
    }, 300);
  };

  const handleImagePicker = (source, mediaType = 'photo') => {
    const options = {
      mediaType: mediaType === 'video' ? 'video' : 'photo',
      quality: mediaType === 'video' ? 0.7 : 0.8,
      includeBase64: false,
      videoQuality: 'high',
      durationLimit: 300, // 5 minutes max for videos
      maxWidth: 1920,
      maxHeight: 1920,
      allowsEditing: false,
    };

    const picker = source === 'camera' ? launchCamera : launchImageLibrary;

    // For camera, ensure permission
    if (source === 'camera') {
      requestCameraPermission().then((granted) => {
        if (!granted) {
          alert.error('Permission denied', 'Camera permission is required to take photos.');
          return;
        }
        picker(options, (response) => {
          handlePickerResponse(response, mediaType);
        });
      });
      return;
    }

    picker(options, async (response) => {
      handlePickerResponse(response, mediaType);
    });
  };

  const handleDocumentPicker = async () => {
    setShowMediaModal(false);
    
    // Request storage permission for Android
    if (Platform.OS === 'android') {
      const hasPermission = await requestStoragePermission();
      if (!hasPermission) {
        alert.error('Permission Denied', 'Storage permission is required to select files');
        return;
      }
    }

    try {
      const result = await DocumentPicker.pick({
        type: [DocumentPicker.types.allFiles],
        allowMultiSelection: false,
      });

      if (result && result.length > 0) {
        const file = result[0];
        
        // Validate file size (50 MB max)
        const maxSize = 50 * 1024 * 1024; // 50 MB
        if (file.size && file.size > maxSize) {
          alert.warning(
            'File Too Large',
            'File size exceeds 50 MB limit. Please choose a smaller file.'
          );
          return;
        }

        if (__DEV__) {
          console.log('📤 Sending file:', {
            uri: file.uri,
            type: file.type,
            name: file.name,
            size: file.size,
          });
        }

        // Determine message type based on file type
        let messageType = 'file';
        const fileName = file.name || '';
        const fileType = file.type || '';

        if (fileType.startsWith('image/') || fileName.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)) {
          messageType = 'image';
        } else if (fileType.startsWith('video/') || fileName.match(/\.(mp4|mov|avi|mkv|webm|3gp)$/i)) {
          messageType = 'video';
        } else if (
          fileType.startsWith('audio/') ||
          fileName.match(/\.(m4a|mp3|wav|aac|ogg|flac|amr|opus|webm|aiff|caf)$/i)
        ) {
          messageType = 'audio';
        }

        let audioDurationStr = null;
        if (messageType === 'audio') {
          const secs = await probeAudioDurationSeconds(file.uri);
          if (secs != null && secs > 0) {
            audioDurationStr = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
          }
        }

        const prevReply = replyingTo;
        setReplyingTo(null);
        const sent = await sendMedia(
          {
            uri: file.uri,
            type: file.type || 'application/octet-stream',
            name: file.name || `file_${Date.now()}`,
            size: file.size || 0,
            messageType: messageType,
            ...(audioDurationStr ? { audioDuration: audioDurationStr } : {}),
          },
          buildReplyToPayload(prevReply)
        );

        if (!sent) {
          alert.error('Error', 'Failed to send file. Please try again.');
          if (prevReply) setReplyingTo(prevReply);
        }
      }
    } catch (error) {
      if (DocumentPicker.isCancel(error)) {
        // User cancelled, do nothing
        return;
      }
      alert.error(
        'Error',
        error.message || 'Failed to select file. Please try again.'
      );
    }
  };

  const handleAudioPicker = async () => {
    setShowMediaModal(false);

    if (Platform.OS === 'android') {
      const hasPermission = await requestStoragePermission();
      if (!hasPermission) {
        alert.error('Permission Denied', 'Storage permission is required to select audio');
        return;
      }
    }

    try {
      const result = await DocumentPicker.pick({
        type: [DocumentPicker.types.audio],
        allowMultiSelection: false,
      });

      if (!result?.length) return;

      const file = result[0];
      const maxSize = 50 * 1024 * 1024;
      if (file.size && file.size > maxSize) {
        alert.warning('File Too Large', 'Audio exceeds 50 MB limit.');
        return;
      }

      let audioDurationStr = null;
      const secs = await probeAudioDurationSeconds(file.uri);
      if (secs != null && secs > 0) {
        audioDurationStr = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
      }

      const prevReply = replyingTo;
      setReplyingTo(null);
      const sent = await sendMedia(
        {
          uri: file.uri,
          type: file.type?.startsWith('audio/') ? file.type : 'audio/mpeg',
          name: file.name || `audio_${Date.now()}.m4a`,
          size: file.size || 0,
          messageType: 'audio',
          ...(audioDurationStr ? { audioDuration: audioDurationStr } : {}),
        },
        buildReplyToPayload(prevReply)
      );

      if (!sent) {
        alert.error('Error', 'Failed to send audio. Please try again.');
        if (prevReply) setReplyingTo(prevReply);
      }
    } catch (error) {
      if (DocumentPicker.isCancel(error)) return;
      alert.error('Error', error.message || 'Failed to select audio.');
    }
  };

  const handlePickerResponse = async (response, mediaType) => {
    if (response.didCancel) {
      
      return;
    }

    if (response.errorCode) {
      alert.error('Error', response.errorMessage || 'Failed to pick media');
      return;
    }

    const asset = response.assets?.[0];
    if (!asset || !chat) {
      
      return;
    }

    // Validate file size (50 MB max)
    const maxSize = 50 * 1024 * 1024; // 50 MB
    if (asset.fileSize && asset.fileSize > maxSize) {
      alert.warning(
        'File Too Large',
        'File size exceeds 50 MB limit. Please choose a smaller file.'
      );
      return;
    }

    try {
      if (__DEV__) {
        console.log('📤 Sending media:', {
          uri: asset.uri,
          type: asset.type,
          name: asset.fileName,
          size: asset.fileSize,
          mediaType: mediaType,
        });
      }

      // Determine message type
      let messageType = 'file';
      if (asset.type?.startsWith('image/')) {
        messageType = 'image';
      } else if (asset.type?.startsWith('video/')) {
        messageType = 'video';
      }

      const prevReply = replyingTo;
      setReplyingTo(null);
      const sent = await sendMedia(
        {
          uri: asset.uri,
          type: asset.type || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg'),
          name: asset.fileName || asset.uri.split('/').pop() || `${mediaType}_${Date.now()}.${mediaType === 'video' ? 'mp4' : 'jpg'}`,
          size: asset.fileSize || 0,
          messageType: messageType,
        },
        buildReplyToPayload(prevReply)
      );

      if (!sent) {
        alert.error('Error', 'Failed to send media. Please try again.');
        if (prevReply) setReplyingTo(prevReply);
      } else {
        
      }
    } catch (error) {
      alert.error(
        'Error',
        error.message || 'Failed to send media. Please try again.'
      );
    }
  };

  // Helper functions for message styling - using extracted utilities
  const isMyMessage = useCallback((message) => checkIsMyMessage(message, user), [user]);

  const getMediaUrl = useCallback((mediaKey) => {
    if (!mediaKey) return null;
    if (typeof mediaKey === 'string' && (mediaKey.startsWith('http://') || mediaKey.startsWith('https://'))) {
      return mediaKey;
    }
    // Default to legacy files path; backend may expose via /api/files/:key
    return `${FILE_BASE_URL}/api/files/${encodeURIComponent(mediaKey)}`;
  }, []);

  const handleFilePress = async (mediaKey, mediaName, mediaType = null) => {
    console.log('📄 [handleFilePress] Called with:', {
      mediaKey,
      mediaName,
      mediaType,
    });
    
    const url = getMediaUrl(mediaKey);
    console.log('📄 [handleFilePress] Generated URL:', url);
    
    if (url) {
      // Determine media type if not provided
      let type = mediaType;
      if (!type) {
        const name = mediaName || mediaKey || '';
        console.log('📄 [handleFilePress] Detecting type for:', name);
        
        if (name.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)) {
          type = 'image';
        } else if (name.match(/\.(mp4|mov|avi|mkv|webm|3gp)$/i)) {
          type = 'video';
        } else {
          // For PDFs and other documents, download and open with appropriate app
          const isPDF = name.match(/\.(pdf)$/i);
          const isDocument = name.match(/\.(doc|docx|xls|xlsx|ppt|pptx|txt|rtf)$/i);
          
          console.log('📄 [handleFilePress] File type check:', {
            isPDF,
            isDocument,
            name,
          });
          
          if (isPDF || isDocument) {
            // Open document in modal viewer instead of downloading
            // Get the actual file URL (presigned or direct)
            const isFullUrl = typeof mediaKey === 'string' && 
              (mediaKey.startsWith('http://') || mediaKey.startsWith('https://'));
            
            let documentUrl = isFullUrl ? mediaKey : url;
            let mediaKeyForRefresh = null; // Store key for refreshing expired URLs
            
            // If it's a full URL (presigned S3 URL), extract the key if possible
            // Otherwise, if not a full URL, try to get presigned URL
            if (isFullUrl) {
              // Try to extract the S3 key from the presigned URL
              // Format: https://bucket.s3.region.amazonaws.com/key?params
              try {
                const urlObj = new URL(mediaKey);
                const pathname = urlObj.pathname;
                // Remove leading slash and get the key
                const s3Key = pathname.startsWith('/') ? pathname.substring(1) : pathname;
                if (s3Key) {
                  mediaKeyForRefresh = s3Key;
                  console.log('📄 [handleFilePress] Extracted S3 key from URL:', s3Key);
                } else {
                  // Fallback: use the original mediaKey if we can't extract
                  mediaKeyForRefresh = mediaKey;
                }
              } catch (e) {
                // If URL parsing fails, try to extract manually
                const match = mediaKey.match(/s3\.amazonaws\.com\/([^?]+)/) || 
                             mediaKey.match(/s3\.[^/]+\/([^?]+)/);
                if (match && match[1]) {
                  mediaKeyForRefresh = decodeURIComponent(match[1]);
                  console.log('📄 [handleFilePress] Extracted S3 key via regex:', mediaKeyForRefresh);
                } else {
                  // Last resort: use original mediaKey
                  mediaKeyForRefresh = mediaKey;
                }
              }
            } else {
              // Not a full URL - fetch presigned URL and store the key
              mediaKeyForRefresh = mediaKey;
              try {
                const token = await secureStorage.getItem('token');
                if (token) {
                  const encodedKey = encodeURIComponent(mediaKey);
                  const presignUrl = `${API_BASE_URL}/api/enquiries/files/${encodedKey}`;
                  
                  try {
                    const presignResponse = await fetch(presignUrl, {
                      method: 'GET',
                      headers: {
                        'Authorization': `Bearer ${token}`,
                      },
                    });
                    
                    if (presignResponse.ok) {
                      const contentType = presignResponse.headers.get('content-type') || '';
                      if (contentType.includes('application/json')) {
                        const jsonData = await presignResponse.json();
                        documentUrl = jsonData.url || jsonData.videoUrl || jsonData.src || jsonData.location || jsonData.Location || url;
                      }
                    }
                  } catch (e) {
                    // Use original URL if presign fails
                    if (__DEV__) {
                      console.log('[handleFilePress] Presign failed, using original URL:', e);
                    }
                  }
                }
              } catch (e) {
                // Use original URL if token fetch fails
                if (__DEV__) {
                  console.log('[handleFilePress] Token fetch failed, using original URL:', e);
                }
              }
            }
            
            // Open document in modal viewer
            if (__DEV__) {
              console.log('[handleFilePress] Opening document in viewer:', {
                documentUrl,
                fileName: mediaName,
                isFullUrl,
              });
            }
            
            const isPDF = mediaName && mediaName.toLowerCase().endsWith('.pdf');
            
            // Always fetch a fresh presigned URL before opening in modal
            // This ensures we don't try to display expired URLs
            let urlToDisplay = documentUrl;
            if (mediaKeyForRefresh) {
              console.log('📄 [handleFilePress] Fetching fresh URL before opening modal...');
              console.log('📄 [handleFilePress] Media key for refresh:', mediaKeyForRefresh);
              try {
                const token = await secureStorage.getItem('token');
                if (token) {
                  const encodedKey = encodeURIComponent(mediaKeyForRefresh);
                  const presignUrl = `${API_BASE_URL}/api/enquiries/files/${encodedKey}`;
                  console.log('📄 [handleFilePress] Fetching from:', presignUrl);
                  
                  const presignResponse = await fetch(presignUrl, {
                    method: 'GET',
                    headers: {
                      'Authorization': `Bearer ${token}`,
                    },
                  });
                  
                  console.log('📄 [handleFilePress] Presign response status:', presignResponse.status);
                  
                  if (presignResponse.ok) {
                    const contentType = presignResponse.headers.get('content-type') || '';
                    console.log('📄 [handleFilePress] Content-Type:', contentType);
                    
                    if (contentType.includes('application/json')) {
                      const jsonData = await presignResponse.json();
                      console.log('📄 [handleFilePress] Response data:', jsonData);
                      const freshUrl = jsonData.url || jsonData.videoUrl || jsonData.src || jsonData.location || jsonData.Location;
                      if (freshUrl) {
                        urlToDisplay = freshUrl;
                        console.log('📄 [handleFilePress] ✅ Got fresh URL for modal:', freshUrl.substring(0, 100) + '...');
                      } else {
                        console.error('📄 [handleFilePress] ❌ No URL in response');
                        alert.error('Error', 'Failed to get document URL. Please try again.');
                        return;
                      }
                    } else {
                      console.log('📄 [handleFilePress] Non-JSON response, using original URL');
                    }
                  } else {
                    const errorText = await presignResponse.text().catch(() => 'Unable to read error');
                    console.error('📄 [handleFilePress] ❌ Failed to get presigned URL:', presignResponse.status, errorText);
                    alert.error('Error', `Failed to get fresh document URL (${presignResponse.status}). The document link may have expired.`);
                    return;
                  }
                } else {
                  console.error('📄 [handleFilePress] No token available');
                  alert.error('Error', 'Authentication required to view document');
                  return;
                }
              } catch (e) {
                console.error('📄 [handleFilePress] Exception fetching fresh URL:', e);
                alert.error('Error', 'Failed to refresh document URL. Please try again.');
                return;
              }
            } else {
              console.log('📄 [handleFilePress] No mediaKeyForRefresh, using original URL');
              // Check if URL looks expired
              const urlDateMatch = urlToDisplay.match(/X-Amz-Date=(\d{8}T\d{6}Z)/);
              if (urlDateMatch) {
                const urlDate = new Date(urlDateMatch[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z'));
                const now = new Date();
                const hoursDiff = (now - urlDate) / (1000 * 60 * 60);
                if (hoursDiff > 1) {
                  console.warn('📄 [handleFilePress] ⚠️ URL appears to be expired (older than 1 hour)');
                  alert.error('Error', 'This document link has expired. Please try again.');
                  return;
                }
              }
            }
            
            // Use Google Docs Viewer for PDFs (works better in WebView than direct PDF)
            // Use Google Docs Viewer for all documents (works better in WebView than direct PDF)
            // Google Docs Viewer can display PDFs, Word, Excel, etc. in WebView
            let finalUrl = urlToDisplay;
            const encodedUrl = encodeURIComponent(urlToDisplay);
            finalUrl = `https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`;
            console.log('📄 [handleFilePress] Using Google Docs Viewer for document');
            
            // Always log (not just in __DEV__) for debugging
            console.log('📄 [handleFilePress] Opening document:', {
              original: documentUrl,
              finalUrl,
              fileName: mediaName,
              isFullUrl,
              isPDF,
            });
            
            // Set state synchronously
            setViewerMediaUrl(finalUrl);
            setViewerOriginalUrl(urlToDisplay); // Store fresh URL for fallback
            setViewerMediaKey(mediaKeyForRefresh); // Store key for refreshing expired URLs
            setViewerMediaType('document');
            setViewerDocumentName(mediaName || 'Document');
            setWebViewError(false); // Reset error state
            setIsRefreshingUrl(false); // Reset refreshing state
            
            // Log before opening modal
            console.log('📄 [handleFilePress] About to open modal with URL:', finalUrl);
            
            setShowMediaViewerModal(true);
            
            // Log after state update (will execute after render)
            setTimeout(() => {
              console.log('📄 [handleFilePress] Modal should be open now');
            }, 100);
            
            return;
          } else {
            // For other file types, try to open in browser as fallback
            try {
              const supported = await Linking.canOpenURL(url);
              if (supported) {
                await Linking.openURL(url);
              } else {
                alert.error('Error', 'Cannot open this file type');
              }
            } catch (error) {
              alert.error('Error', 'Failed to open file');
            }
          }
          return;
        }
      }
      
      // Open image/video in modal viewer
      setViewerMediaUrl(url);
      setViewerMediaType(type);
      setShowMediaViewerModal(true);
    }
  };

  // Download document from modal
  const handleDownloadDocument = useCallback(async () => {
    if (!viewerMediaUrl || !viewerDocumentName) return;
    
    try {
      if (__DEV__) {
        console.log('[handleDownloadDocument] Starting download:', {
          url: viewerMediaUrl,
          name: viewerDocumentName,
        });
      }
      
      // Fetch the file
      const response = await fetch(viewerMediaUrl, {
        method: 'GET',
      });
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      
      // Get file as array buffer
      const arrayBuffer = await response.arrayBuffer();
      
      if (arrayBuffer.byteLength === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      // Convert to base64
      const bytes = new Uint8Array(arrayBuffer);
      const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let base64 = '';
      let i = 0;
      
      while (i < bytes.length) {
        const a = bytes[i++];
        const b = i < bytes.length ? bytes[i++] : 0;
        const c = i < bytes.length ? bytes[i++] : 0;
        
        const bitmap = (a << 16) | (b << 8) | c;
        
        base64 += base64Chars.charAt((bitmap >> 18) & 63);
        base64 += base64Chars.charAt((bitmap >> 12) & 63);
        base64 += i - 2 < bytes.length ? base64Chars.charAt((bitmap >> 6) & 63) : '=';
        base64 += i - 1 < bytes.length ? base64Chars.charAt(bitmap & 63) : '=';
      }
      
      // Save to Downloads folder
      const sanitizedName = viewerDocumentName.replace(/[^a-z0-9._-]/gi, '_');
      const downloadPath = `${RNFS.DownloadDirectoryPath}/${sanitizedName}`;
      
      await RNFS.writeFile(downloadPath, base64, 'base64');
      
      // Verify file was saved
      const fileExists = await RNFS.exists(downloadPath);
      if (!fileExists) {
        throw new Error('Failed to save downloaded file');
      }
      
      alert.success(
        'Download Complete',
        `File downloaded successfully!\n\nSaved to: Downloads/${sanitizedName}`
      );
    } catch (error) {
      if (__DEV__) {
        console.error('[handleDownloadDocument] Error:', error);
      }
      alert.error('Error', error.message || 'Failed to download file. Please try again.');
    }
  }, [viewerMediaUrl, viewerDocumentName, alert]);

  const handleCloseMediaViewer = () => {
    setShowMediaViewerModal(false);
    setViewerMediaUrl(null);
    setViewerMediaType(null);
    setViewerDocumentName(null);
    setViewerOriginalUrl(null);
    setViewerMediaKey(null);
    setWebViewError(false);
    setIsRefreshingUrl(false);
  };
  
  // Fetch fresh presigned URL for expired URLs
  const fetchFreshPresignedUrl = useCallback(async (mediaKey) => {
    if (!mediaKey) {
      console.log('📄 [fetchFreshPresignedUrl] No mediaKey provided');
      return null;
    }
    
    try {
      setIsRefreshingUrl(true);
      console.log('📄 [fetchFreshPresignedUrl] Starting fetch for key:', mediaKey);
      
      const token = await secureStorage.getItem('token');
      if (!token) {
        console.error('📄 [fetchFreshPresignedUrl] No token available');
        setIsRefreshingUrl(false);
        return null;
      }
      
      const encodedKey = encodeURIComponent(mediaKey);
      const presignUrl = `${API_BASE_URL}/api/enquiries/files/${encodedKey}`;
      
      console.log('📄 [fetchFreshPresignedUrl] Fetching from:', presignUrl);
      console.log('📄 [fetchFreshPresignedUrl] Encoded key:', encodedKey);
      console.log('📄 [fetchFreshPresignedUrl] Token available:', token ? 'Yes' : 'No');
      
      const presignResponse = await fetch(presignUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      console.log('📄 [fetchFreshPresignedUrl] Response status:', presignResponse.status);
      console.log('📄 [fetchFreshPresignedUrl] Response ok:', presignResponse.ok);
      
      if (presignResponse.ok) {
        const contentType = presignResponse.headers.get('content-type') || '';
        console.log('📄 [fetchFreshPresignedUrl] Content-Type:', contentType);
        
        if (contentType.includes('application/json')) {
          const jsonData = await presignResponse.json();
          console.log('📄 [fetchFreshPresignedUrl] Response data:', jsonData);
          const freshUrl = jsonData.url || jsonData.videoUrl || jsonData.src || jsonData.location || jsonData.Location;
          
          if (freshUrl) {
            console.log('📄 [fetchFreshPresignedUrl] ✅ Got fresh URL:', freshUrl.substring(0, 100) + '...');
            setIsRefreshingUrl(false);
            return freshUrl;
          } else {
            console.error('📄 [fetchFreshPresignedUrl] ❌ No URL found in response:', jsonData);
            setIsRefreshingUrl(false);
            return null;
          }
        } else {
          // If response is not JSON, it might be a direct file - return the presignUrl itself
          console.log('📄 [fetchFreshPresignedUrl] Non-JSON response, using presignUrl');
          setIsRefreshingUrl(false);
          return presignUrl;
        }
      } else {
        const errorText = await presignResponse.text().catch(() => 'Unable to read error');
        console.error('📄 [fetchFreshPresignedUrl] ❌ Failed to get presigned URL:', presignResponse.status, errorText);
        setIsRefreshingUrl(false);
        return null;
      }
    } catch (error) {
      console.error('📄 [fetchFreshPresignedUrl] ❌ Exception:', error);
      setIsRefreshingUrl(false);
      return null;
    }
  }, []);
  
  // Check if URL is expired and refresh if needed
  const refreshExpiredUrl = useCallback(async () => {
    if (!viewerMediaKey) {
      console.log('📄 [refreshExpiredUrl] No viewerMediaKey available');
      return;
    }
    
    if (isRefreshingUrl) {
      console.log('📄 [refreshExpiredUrl] Already refreshing, skipping...');
      return;
    }
    
    console.log('📄 [refreshExpiredUrl] Starting refresh for key:', viewerMediaKey);
    const freshUrl = await fetchFreshPresignedUrl(viewerMediaKey);
    
    if (freshUrl) {
      const isPDF = viewerDocumentName && viewerDocumentName.toLowerCase().endsWith('.pdf');
      let finalUrl = freshUrl;
      
      if (!isPDF) {
        // Use Google Docs Viewer for non-PDF documents
        const encodedUrl = encodeURIComponent(freshUrl);
        finalUrl = `https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`;
      }
      
      console.log('📄 [refreshExpiredUrl] ✅ Setting new URL:', finalUrl.substring(0, 100) + '...');
      setViewerMediaUrl(finalUrl);
      setViewerOriginalUrl(freshUrl);
      setWebViewError(false);
      console.log('📄 [refreshExpiredUrl] ✅ State updated, WebView should reload');
    } else {
      console.error('📄 [refreshExpiredUrl] ❌ Failed to refresh URL - no fresh URL returned');
      setWebViewError(true);
    }
  }, [viewerMediaKey, viewerDocumentName, isRefreshingUrl, fetchFreshPresignedUrl]);
  
  // Open document in external browser as fallback
  const handleOpenInBrowser = useCallback(async () => {
    let urlToOpen = viewerOriginalUrl || viewerMediaUrl;
    
    // If we have a mediaKey and the URL might be expired, try to get a fresh one
    if (viewerMediaKey && !isRefreshingUrl) {
      console.log('📄 [handleOpenInBrowser] Checking if URL needs refresh...');
      const freshUrl = await fetchFreshPresignedUrl(viewerMediaKey);
      if (freshUrl) {
        urlToOpen = freshUrl;
        // Also update the stored URLs
        setViewerOriginalUrl(freshUrl);
        const isPDF = viewerDocumentName && viewerDocumentName.toLowerCase().endsWith('.pdf');
        if (!isPDF) {
          const encodedUrl = encodeURIComponent(freshUrl);
          setViewerMediaUrl(`https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`);
        } else {
          setViewerMediaUrl(freshUrl);
        }
      }
    }
    
    if (!urlToOpen) {
      alert.error('Error', 'No URL available to open');
      return;
    }
    
    try {
      const canOpen = await Linking.canOpenURL(urlToOpen);
      if (canOpen) {
        await Linking.openURL(urlToOpen);
      } else {
        alert.error('Error', 'Cannot open this URL in browser');
      }
    } catch (error) {
      console.error('Failed to open URL in browser:', error);
      alert.error('Error', 'Failed to open document in browser');
    }
  }, [viewerOriginalUrl, viewerMediaUrl, viewerMediaKey, viewerDocumentName, isRefreshingUrl, fetchFreshPresignedUrl, alert]);

  const handleVoiceNotePlayback = useCallback(async (message) => {
    const messageId = message.id || message._id;
    const mKey = message.mediaKey || message.MediaKey;
    const mUrl = message.mediaUrl || message.MediaUrl;
    const audioUrl = mUrl || getMediaUrl(mKey);
    if (!audioUrl) return;

    const player = audioRecorderPlayerRef.current;
    const prev = voicePlaybackRef.current;

    if (prev.id === messageId) {
      if (prev.paused) {
        try {
          await player.resumePlayer();
        } catch (e) {
          if (__DEV__) console.warn('[voice] resume failed', e);
        }
        voicePlaybackRef.current = { id: messageId, paused: false };
        setVoicePlayback({ id: messageId, paused: false });
      } else {
        try {
          await player.pausePlayer();
        } catch (e) {
          if (__DEV__) console.warn('[voice] pause failed', e);
        }
        voicePlaybackRef.current = { id: messageId, paused: true };
        setVoicePlayback({ id: messageId, paused: true });
      }
      return;
    }

    try {
      await player.stopPlayer();
    } catch (_) {
      /* noop */
    }
    player.removePlayBackListener();

    voicePlaybackRef.current = { id: messageId, paused: false };
    setVoicePlayback({ id: messageId, paused: false });

    try {
      await player.startPlayer(audioUrl);
    } catch (e) {
      if (__DEV__) console.warn('[voice] start failed', e);
      voicePlaybackRef.current = { id: null, paused: false };
      setVoicePlayback({ id: null, paused: false });
      return;
    }

    player.addPlayBackListener((e) => {
      const currentPosition = Math.floor(e.currentPosition / 1000);
      const duration = Math.floor(e.duration / 1000);
      setAudioProgress((p) => ({ ...p, [messageId]: currentPosition }));
      setAudioDuration((d) => ({ ...d, [messageId]: duration }));
      if (e.duration > 0 && e.currentPosition >= e.duration) {
        voicePlaybackRef.current = { id: null, paused: false };
        setVoicePlayback({ id: null, paused: false });
        player.stopPlayer().catch(() => {});
        player.removePlayBackListener();
      }
    });
  }, [getMediaUrl]);

  // Memoize renderMessage to prevent unnecessary re-renders
  const renderMessage = useCallback((message, index) => {
    // Safety check - ensure message exists
    if (!message) {
      return null;
    }
    
    // Debug logging for audio messages
    if (__DEV__ && (message.messageType === 'audio' || message.MessageType === 'audio')) {
      const mediaKey = message.mediaKey || message.MediaKey;
      const mediaUrl = message.mediaUrl || message.MediaUrl;
      console.log('🎵 [ChatDetailScreen] Rendering audio message:', {
        messageId: message.id || message._id,
        messageType: message.messageType || message.MessageType,
        mediaKey: mediaKey,
        mediaUrl: mediaUrl,
        audioDuration: message.audioDuration || message.AudioDuration,
        hasMediaKey: !!mediaKey,
        hasMediaUrl: !!mediaUrl,
      });
    }
    
    const myMessage = isMyMessage(message);
    const previousMessage = index > 0 ? enrichedMessages[index - 1] : null;
      // In group chats, show sender name above message bubble (WhatsApp style)
      // This helps identify who sent each message when multiple admins/users are reading
      const isGroupChat = true; // All chats are group chats (admin-client or admin-designer)
      
      // Only show sender name if previous message is from a different sender (or if this is the first message)
      const currentSenderId = message.SenderId || message.senderId || (myMessage ? user?.id : null);
      const previousSenderId = previousMessage ? (previousMessage.SenderId || previousMessage.senderId || (isMyMessage(previousMessage) ? user?.id : null)) : null;
      const isDifferentSender = !previousMessage || (currentSenderId && previousSenderId && String(currentSenderId).trim() !== String(previousSenderId).trim());
      
      const showSenderName = isGroupChat && isDifferentSender;
    
    const messageType = message.messageType || message.MessageType;
    const mediaKey = message.mediaKey || message.MediaKey;
    const mediaUrl = message.mediaUrl || message.MediaUrl;
    const mediaName = message.mediaName || message.MediaName;

    const isImage = messageType === 'image';
    const isVideo = messageType === 'video';
    const isFile = messageType === 'file';
    
    // Handle replyTo from multiple possible fields (backend might use different formats)
    const replyTo = message.replyTo || message.ReplyTo || message.ParentMessageId || message.parentMessageId;
    
    // Find the replied message if it exists
    let repliedMessage = null;
    if (replyTo) {
      // Handle different replyTo formats: object, string ID, or nested object
      let replyToId = null;
      let replyToData = null;
      
      if (typeof replyTo === 'string') {
        // Direct string ID
        replyToId = replyTo.trim();
      } else if (replyTo && typeof replyTo === 'object') {
        // Object with _id or id property, or MongoDB ObjectId format
        replyToId = (replyTo._id?.$oid || replyTo._id || replyTo.id || '').toString().trim();
        // If replyTo is an object with message data, use it directly
        if (replyTo.Message || replyTo.message || replyTo.text) {
          replyToData = replyTo;
        }
      } else if (replyTo) {
        // Fallback: try to convert to string
        replyToId = String(replyTo).trim();
      }
      
      if (replyToId && replyToId !== 'null' && replyToId !== 'undefined' && replyToId !== '') {
        // First, try to find in enriched messages
        repliedMessage = enrichedMessages.find(m => {
          const messageId = String(m._id || m.id || '').trim();
          return messageId && messageId === replyToId;
        });
        
        // If not found in enriched messages, use the replyTo object data if available
        if (!repliedMessage && replyToData) {
          const extractedId = replyToData._id?.$oid || replyToData._id || replyToData.id || replyToId;
          repliedMessage = {
            _id: extractedId,
            id: extractedId,
            text: replyToData.Message || replyToData.message || replyToData.text || '',
            Message: replyToData.Message || replyToData.message || replyToData.text || '',
            message: replyToData.Message || replyToData.message || replyToData.text || '',
            senderName: replyToData.SenderName || replyToData.senderName || replyToData.sender?.name || 'Unknown',
            SenderName: replyToData.SenderName || replyToData.senderName || replyToData.sender?.name || 'Unknown',
            senderRole: replyToData.SenderRole || replyToData.senderRole || replyToData.sender?.role || 'user',
            senderRole: replyToData.SenderRole || replyToData.senderRole || replyToData.sender?.role || 'user',
            messageType: replyToData.MessageType || replyToData.messageType || 'text',
            MessageType: replyToData.MessageType || replyToData.messageType || 'text',
            mediaUrl: replyToData.MediaUrl || replyToData.mediaUrl || replyToData.media?.url,
            MediaUrl: replyToData.MediaUrl || replyToData.mediaUrl || replyToData.media?.url,
            mediaKey: replyToData.MediaKey || replyToData.mediaKey || replyToData.media?.key,
            MediaKey: replyToData.MediaKey || replyToData.mediaKey || replyToData.media?.key,
            audioDuration: replyToData.AudioDuration || replyToData.audioDuration,
            AudioDuration: replyToData.AudioDuration || replyToData.audioDuration,
          };
        } else if (!repliedMessage && typeof replyTo === 'object' && (replyTo.Message || replyTo.message || replyTo.text)) {
          // Fallback: create from replyTo object even if it doesn't have all fields
          repliedMessage = {
            _id: replyToId,
            id: replyToId,
            text: replyTo.Message || replyTo.message || replyTo.text || '',
            Message: replyTo.Message || replyTo.message || replyTo.text || '',
            message: replyTo.Message || replyTo.message || replyTo.text || '',
            senderName: replyTo.SenderName || replyTo.senderName || replyTo.sender?.name || 'Unknown',
            SenderName: replyTo.SenderName || replyTo.senderName || replyTo.sender?.name || 'Unknown',
            messageType: replyTo.MessageType || replyTo.messageType || 'text',
            MessageType: replyTo.MessageType || replyTo.messageType || 'text',
            mediaUrl: replyTo.MediaUrl || replyTo.mediaUrl || replyTo.media?.url,
            MediaUrl: replyTo.MediaUrl || replyTo.mediaUrl || replyTo.media?.url,
            mediaKey: replyTo.MediaKey || replyTo.mediaKey || replyTo.media?.key,
            MediaKey: replyTo.MediaKey || replyTo.mediaKey || replyTo.media?.key,
            audioDuration: replyTo.AudioDuration || replyTo.audioDuration,
            AudioDuration: replyTo.AudioDuration || replyTo.audioDuration,
          };
        }
        
        // Debug log only when reply is not found (helps identify issues)
        if (__DEV__ && !repliedMessage) {
          console.log('🔗 [Reply] Message not found in list:', {
            replyToId: replyToId,
            messageId: message._id || message.id,
            replyToType: typeof replyTo,
            replyToKeys: typeof replyTo === 'object' ? Object.keys(replyTo) : null,
            totalMessages: enrichedMessages.length,
          });
        }
      }
    }
    
    // Check if this message should be highlighted
    const isHighlighted = highlightedMessageId && (
      String(message._id || message.id || '').trim() === String(highlightedMessageId).trim()
    );
    
    // Store message position for accurate scrolling
    const messageId = String(message._id || message.id || '').trim();

    const repliedThumbUri = repliedMessage
      ? (repliedMessage.mediaUrl ||
          repliedMessage.MediaUrl ||
          ((repliedMessage.mediaKey || repliedMessage.MediaKey)
            ? getMediaUrl(repliedMessage.mediaKey || repliedMessage.MediaKey)
            : null))
      : null;
    const repliedType = repliedMessage
      ? (repliedMessage.messageType || repliedMessage.MessageType || 'text')
      : 'text';
    const repliedPreviewText = repliedMessage
      ? (() => {
          const raw = (repliedMessage.text || repliedMessage.Message || repliedMessage.message || '').trim();
          if (raw) return raw;
          if (repliedType === 'image') return 'Photo';
          if (repliedType === 'video') return 'Video';
          if (repliedType === 'audio') {
            return (
              repliedMessage.audioDuration ||
              repliedMessage.AudioDuration ||
              'Voice message'
            );
          }
          return 'Message';
        })()
      : '';

    return (
      <View 
        key={message.id} 
        style={[
          styles.messageWrapper,
          isHighlighted && styles.highlightedMessageWrapper
        ]}
        onLayout={(event) => {
          // Store actual message position for accurate scrolling
          if (messageId && event.nativeEvent.layout) {
            const y = event.nativeEvent.layout.y;
            storeMessagePosition(messageId, y);
            if (__DEV__ && isHighlighted) {
              console.log('🔴 [Message Layout] Stored position for highlighted message:', {
                messageId,
                y,
              });
            }
          }
        }}
      >
        {showSenderName && !myMessage ? (
          // WhatsApp style: Profile picture on left, name and bubble on right
          (() => {
            const senderId = message.SenderId || message.senderId;
            const senderProfile = getSenderProfileData(senderId);
            const senderName = message?.senderName || message?.SenderName || senderProfile.name || 'Unknown';
            const senderImage = senderProfile.image;
            const firstLetter = senderName && senderName !== 'Unknown' ? senderName.charAt(0).toUpperCase() : '?';
            
            return (
              <View style={styles.messageWithSenderContainer}>
                {/* Profile Avatar on the left */}
                <View style={styles.senderAvatarContainer}>
                  {senderImage ? (
                    <Image
                      source={{ uri: senderImage }}
                      style={styles.senderAvatar}
                      defaultSource={require('../../assets/images/logo.png')}
                    />
                  ) : (
                    <View style={styles.senderAvatarPlaceholder}>
                      <Text style={styles.senderAvatarText}>{firstLetter}</Text>
                    </View>
                  )}
                </View>
                {/* Name and message bubble on the right */}
                <View style={styles.senderContentContainer}>
                  <Text style={styles.senderNameTextAbove}>
                    {senderName}
                  </Text>
                  <SwipeableMessage
                    message={message}
                    myMessage={myMessage}
                    onSwipeRight={() => handleReplyToMessage(message)}
                    onLongPress={() => handleMessageLongPress(message)}
                  >
          <View style={[
            styles.messageBubble,
            myMessage ? styles.myMessageBubble : styles.otherMessageBubble,
            isImage && styles.imageMessageBubble,
            isVideo && styles.videoMessageBubble,
            isFile && styles.fileMessageBubble,
            isHighlighted && styles.highlightedMessageBubble, // Add highlight to bubble
            repliedMessage && styles.messageBubbleWithReply, // Ensure enough width for reply preview text
          ]}>
            {/* Forwarded Indicator - WhatsApp Style */}
            {message && (message.isForwarded || message.IsForwarded) && (
              <View style={[
                styles.forwardedIndicator,
                myMessage ? styles.forwardedIndicatorMy : styles.forwardedIndicatorOther,
              ]}>
                <Icon 
                  name="forward" 
                  size={14} 
                  color={myMessage ? colors.textWhite : colors.textLight} 
                  style={styles.forwardedIndicatorIcon}
                />
                <Text style={[
                  styles.forwardedIndicatorText,
                  myMessage ? styles.forwardedIndicatorTextMy : styles.forwardedIndicatorTextOther,
                ]}>
                  Forwarded
                </Text>
                {message && (message.forwardedByName || message.ForwardedByName) && (
                  <Text style={[
                    styles.forwardedByNameText,
                    myMessage ? styles.forwardedByNameTextMy : styles.forwardedByNameTextOther,
                  ]}>
                    {' • '}{message.forwardedByName || message.ForwardedByName}
                  </Text>
                )}
              </View>
            )}
            {/* Reply Preview */}
            {repliedMessage && (
              <TouchableOpacity
                style={[
                  styles.replyPreview,
                  myMessage ? styles.replyPreviewMy : styles.replyPreviewOther,
                ]}
                onPress={() => {
                  const messageId = repliedMessage._id || repliedMessage.id;
                  if (messageId) {
                    const messageIdStr = String(messageId).trim();
                    scrollToMessage(messageIdStr, setHighlightedMessageId);
                  }
                }}
                activeOpacity={0.7}
              >
                <View style={[
                  styles.replyPreviewLine,
                  myMessage ? styles.replyPreviewLineMy : styles.replyPreviewLineOther,
                ]} />
                {/* Reply Icon */}
                <Icon
                  name="reply"
                  size={16}
                  color={myMessage ? colors.textWhite : colors.primary}
                  style={styles.replyPreviewIcon}
                />
                <View style={styles.replyPreviewContent}>
                  <Text style={[
                    styles.replyPreviewName,
                    myMessage ? styles.replyPreviewNameMy : styles.replyPreviewNameOther,
                  ]}>
                    {repliedMessage.senderName || 'Unknown'}
                  </Text>
                  {/* Show media thumbnail if replying to image/video */}
                  {(repliedType === 'image' || repliedType === 'video') && repliedThumbUri ? (
                    <View style={styles.replyPreviewMedia}>
                      <Image
                        source={{ uri: repliedThumbUri }}
                        style={styles.replyPreviewThumbnail}
                        resizeMode="cover"
                      />
                      <Text
                        style={[
                          styles.replyPreviewText,
                          myMessage ? styles.replyPreviewTextMy : styles.replyPreviewTextOther,
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {repliedPreviewText}
                      </Text>
                    </View>
                  ) : repliedType === 'audio' ? (
                    <View style={styles.replyPreviewMedia}>
                      <View style={styles.replyPreviewAudioThumb}>
                        <Icon
                          name="mic"
                          size={18}
                          color={myMessage ? colors.textWhite : colors.primary}
                        />
                      </View>
                      <Text
                        style={[
                          styles.replyPreviewText,
                          myMessage ? styles.replyPreviewTextMy : styles.replyPreviewTextOther,
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {repliedPreviewText}
                      </Text>
                    </View>
                  ) : (
                    <Text
                      style={[
                        styles.replyPreviewText,
                        myMessage ? styles.replyPreviewTextMy : styles.replyPreviewTextOther,
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {repliedPreviewText}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            )}
            
            {/* Add small spacing between reply preview and message content for better visual separation */}
            {repliedMessage && (
              <View style={{ height: 4 }} />
            )}
            
            {isImage && mediaKey ? (
              <TouchableOpacity 
                onPress={() => handleFilePress(mediaKey, mediaName, 'image')}
                activeOpacity={0.8}>
                <View style={styles.mediaWrapper}>
                  <Image
                    source={{ uri: mediaUrl || getMediaUrl(mediaKey) }}
                    style={styles.messageImage}
                    resizeMode="cover"
                  />
                  {message.status === 'sending' && (
                    <View style={styles.mediaUploadingOverlay}>
                      <ActivityIndicator size="large" color={colors.textWhite} />
                    </View>
                  )}
                </View>
                {message.text && (
                  <Text style={[
                    styles.messageText,
                    myMessage ? styles.myMessageText : styles.otherMessageText,
                    styles.imageCaption,
                  ]}>
                    {(() => {
                      // Remove "Forwarded: " prefix if message is marked as forwarded
                      const msgText = message.text || '';
                      if ((message.isForwarded || message.IsForwarded) && msgText.startsWith('Forwarded: ')) {
                        return msgText.replace(/^Forwarded: /, '');
                      }
                      return msgText;
                    })()}
                  </Text>
                )}
              </TouchableOpacity>
            ) : isVideo && mediaKey ? (
              <TouchableOpacity 
                onPress={() => handleFilePress(mediaKey, mediaName, 'video')}
                activeOpacity={0.8}
                style={styles.videoContainer}>
                <View style={styles.mediaWrapper}>
                  <Video
                    source={{ uri: mediaUrl || getMediaUrl(mediaKey) }}
                    style={styles.messageVideo}
                    controls={false}
                    resizeMode="cover"
                    paused={true}
                  />
                  {message.status === 'sending' ? (
                    <View style={styles.mediaUploadingOverlay}>
                      <ActivityIndicator size="large" color={colors.textWhite} />
                    </View>
                  ) : (
                    <View style={styles.videoPlayOverlay}>
                      <Icon name="play-circle-filled" size={40} color={colors.textWhite} />
                    </View>
                  )}
                </View>
                {message.text && (
                  <Text style={[
                    styles.messageText,
                    myMessage ? styles.myMessageText : styles.otherMessageText,
                    styles.videoCaption,
                  ]}>
                    {message.text}
                  </Text>
                )}
              </TouchableOpacity>
            ) : isFile && mediaKey ? (
              <TouchableOpacity 
                onPress={() => handleFilePress(mediaKey, mediaName)}
                style={styles.fileMessageContainer}
                activeOpacity={0.8}>
                <View style={styles.mediaWrapper}>
                  <View style={styles.fileMessageInner}>
                    <Icon name="insert-drive-file" size={24} color={myMessage ? colors.textWhite : colors.primary} />
                    <View style={styles.fileMessageInfo}>
                      <Text style={[
                        styles.fileMessageName,
                        myMessage ? styles.myMessageText : styles.otherMessageText,
                      ]} numberOfLines={1}>
                        {mediaName || 'File'}
                      </Text>
                      <Text style={[
                        styles.fileMessageSize,
                        myMessage ? styles.myMessageTime : styles.otherMessageTime,
                      ]}>
                        Tap to download
                      </Text>
                    </View>
                  </View>
                  {message.status === 'sending' && (
                    <View style={styles.mediaUploadingOverlay}>
                      <ActivityIndicator size="large" color={colors.textWhite} />
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            ) : (message.messageType === 'audio' || message.MessageType === 'audio') && mediaKey ? (
              <View style={[
                styles.voiceNoteContainer,
                myMessage && styles.voiceNoteContainerMy
              ]}>
                {/* Profile picture for group chats */}
                {showSenderName && !myMessage && (() => {
                  const senderId = message.SenderId || message.senderId;
                  const senderProfile = getSenderProfileData(senderId);
                  const senderImage = senderProfile.image;
                  const senderName = message?.senderName || message?.SenderName || senderProfile.name || 'Unknown';
                  const firstLetter = senderName && senderName !== 'Unknown' ? senderName.charAt(0).toUpperCase() : '?';
                  
                  return (
                    <View style={styles.voiceNoteAvatar}>
                      {senderImage ? (
                        <Image source={{ uri: senderImage }} style={styles.voiceNoteAvatarImage} />
                      ) : (
                        <View style={[styles.voiceNoteAvatarPlaceholder, { backgroundColor: colors.primary }]}>
                          <Text style={styles.voiceNoteAvatarText}>{firstLetter}</Text>
                        </View>
                      )}
                      <View style={styles.voiceNoteMicIcon}>
                        <Icon name="mic" size={12} color={myMessage ? colors.textWhite : colors.primary} />
                      </View>
                    </View>
                  );
                })()}
                
                {/* Play button */}
                <TouchableOpacity 
                  style={[
                    styles.voiceNotePlayButton,
                    myMessage ? styles.voiceNotePlayButtonMy : styles.voiceNotePlayButtonOther
                  ]}
                  onPress={() => handleVoiceNotePlayback(message)}
                  activeOpacity={0.7}
                >
                  <Icon 
                    name={
                      voicePlayback.id === (message.id || message._id) && !voicePlayback.paused
                        ? 'pause'
                        : 'play-arrow'
                    } 
                    size={20} 
                    color={myMessage ? colors.textWhite : colors.primary} 
                  />
                </TouchableOpacity>
                
                {/* Waveform and progress */}
                <View style={styles.voiceNoteWaveformContainer}>
                  {/* Waveform bars */}
                  <View style={styles.voiceNoteWaveform}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((index) => {
                      const messageId = message.id || message._id;
                      const isPlaying = voicePlayback.id === messageId && !voicePlayback.paused;
                      
                      // Parse duration from message or use playback duration
                      let duration = 0;
                      if (audioDuration[messageId]) {
                        duration = audioDuration[messageId];
                      } else if (message.audioDuration) {
                        const parts = message.audioDuration.split(':');
                        if (parts.length === 2) {
                          duration = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                        }
                      }
                      if (duration === 0) duration = 1; // Prevent division by zero
                      
                      const progress = audioProgress[messageId] || 0;
                      const progressPercent = progress / duration;
                      const barIndex = index - 1;
                      const totalBars = 12;
                      const barProgress = progressPercent * totalBars;
                      
                      // Height varies by position (waveform pattern)
                      const heights = [6, 10, 8, 12, 6, 14, 8, 10, 6, 12, 8, 10];
                      const baseHeight = heights[index - 1] || 8;
                      
                      // Bar is active if it's before the progress point
                      const isActive = isPlaying && barIndex < barProgress;
                      
                      return (
                        <View
                          key={index}
                          style={[
                            styles.voiceNoteWaveformBar,
                            myMessage ? styles.voiceNoteWaveformBarMy : styles.voiceNoteWaveformBarOther,
                            isActive && styles.voiceNoteWaveformBarActive,
                            { height: baseHeight }
                          ]}
                        />
                      );
                    })}
                  </View>
                  
                  {/* Duration and progress */}
                  <View style={styles.voiceNoteInfo}>
                  <Text style={[
                      styles.voiceNoteDuration,
                      myMessage ? styles.voiceNoteDurationMy : styles.voiceNoteDurationOther
                    ]}>
                      {(() => {
                        const messageId = message.id || message._id;
                        if (
                          voicePlayback.id === messageId &&
                          audioProgress[messageId] !== undefined
                        ) {
                          const seconds = audioProgress[messageId];
                          return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
                        }
                        return message.audioDuration || '0:00';
                      })()}
                  </Text>
                  </View>
                </View>
              </View>
            ) : (
              <Text style={[
                styles.messageText,
                myMessage ? styles.myMessageText : styles.otherMessageText,
                repliedMessage && styles.messageTextWithReply, // Add style when there's a reply
              ]}>
                {message.text || message.Message || message.message || ''}
              </Text>
            )}
            
            <View style={styles.messageFooter}>
              <Text style={[
                styles.messageTime,
                myMessage ? styles.myMessageTime : styles.otherMessageTime,
              ]}>
                {formatMessageTime(message.timestamp || message.Timestamp)}
              </Text>
              
              {/* Show icon for user's messages */}
              {myMessage ? (
                <View style={styles.messageStatusContainer}>
                  <Icon
                    name={getMessageStatusIcon(message.status || 'sent')}
                    size={16}
                    color={getMessageStatusColor(message.status || 'sent', true, colors)}
                  />
                </View>
              ) : null}
            </View>
          </View>
                    </SwipeableMessage>
                  </View>
                </View>
              );
            })()
        ) : (
          // Regular message without sender name (my messages or consecutive messages from same sender)
          <View style={!myMessage ? styles.messageWithLeftSpacing : null}>
            <SwipeableMessage
              message={message}
              myMessage={myMessage}
              onSwipeRight={() => handleReplyToMessage(message)}
              onLongPress={() => handleMessageLongPress(message)}
            >
            <View style={[
              styles.messageBubble,
              myMessage ? styles.myMessageBubble : styles.otherMessageBubble,
              isImage && styles.imageMessageBubble,
              isVideo && styles.videoMessageBubble,
              isFile && styles.fileMessageBubble,
              isHighlighted && styles.highlightedMessageBubble,
              repliedMessage && styles.messageBubbleWithReply,
            ]}>
              {/* Reply Preview */}
              {repliedMessage && (
                <TouchableOpacity
                  style={[
                    styles.replyPreview,
                    myMessage ? styles.replyPreviewMy : styles.replyPreviewOther,
                  ]}
                  onPress={() => {
                    const messageId = repliedMessage._id || repliedMessage.id;
                    if (messageId) {
                      const messageIdStr = String(messageId).trim();
                      scrollToMessage(messageIdStr, setHighlightedMessageId);
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.replyPreviewLine,
                    myMessage ? styles.replyPreviewLineMy : styles.replyPreviewLineOther,
                  ]} />
                  <Icon
                    name="reply"
                    size={16}
                    color={myMessage ? colors.textWhite : colors.primary}
                    style={styles.replyPreviewIcon}
                  />
                  <View style={styles.replyPreviewContent}>
                    <Text style={[
                      styles.replyPreviewName,
                      myMessage ? styles.replyPreviewNameMy : styles.replyPreviewNameOther,
                    ]}>
                      {repliedMessage.senderName || 'Unknown'}
                    </Text>
                    {(repliedType === 'image' || repliedType === 'video') && repliedThumbUri ? (
                      <View style={styles.replyPreviewMedia}>
                        <Image
                          source={{ uri: repliedThumbUri }}
                          style={styles.replyPreviewThumbnail}
                          resizeMode="cover"
                        />
                        <Text
                          style={[
                            styles.replyPreviewText,
                            myMessage ? styles.replyPreviewTextMy : styles.replyPreviewTextOther,
                          ]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {repliedPreviewText}
                        </Text>
                      </View>
                    ) : repliedType === 'audio' ? (
                      <View style={styles.replyPreviewMedia}>
                        <View style={styles.replyPreviewAudioThumb}>
                          <Icon
                            name="mic"
                            size={18}
                            color={myMessage ? colors.textWhite : colors.primary}
                          />
                        </View>
                        <Text
                          style={[
                            styles.replyPreviewText,
                            myMessage ? styles.replyPreviewTextMy : styles.replyPreviewTextOther,
                          ]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {repliedPreviewText}
                        </Text>
                      </View>
                    ) : (
                      <Text
                        style={[
                          styles.replyPreviewText,
                          myMessage ? styles.replyPreviewTextMy : styles.replyPreviewTextOther,
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {repliedPreviewText}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              )}
              
              {repliedMessage && (
                <View style={{ height: 4 }} />
              )}
              
              {isImage && mediaKey ? (
                <TouchableOpacity
                  onPress={() => handleFilePress(mediaKey, mediaName, 'image')}
                  activeOpacity={0.8}>
                  <View style={styles.mediaWrapper}>
                    <Image
                      source={{ uri: mediaUrl || getMediaUrl(mediaKey) }}
                      style={styles.messageImage}
                      resizeMode="cover"
                    />
                    {message.status === 'sending' && (
                      <View style={styles.mediaUploadingOverlay}>
                        <ActivityIndicator size="large" color={colors.textWhite} />
                      </View>
                    )}
                  </View>
                {message.text && (
                  <Text style={[
                    styles.messageText,
                    myMessage ? styles.myMessageText : styles.otherMessageText,
                    styles.imageCaption,
                  ]}>
                    {(() => {
                      // Remove "Forwarded: " prefix if message is marked as forwarded
                      const msgText = message.text || '';
                      if ((message.isForwarded || message.IsForwarded) && msgText.startsWith('Forwarded: ')) {
                        return msgText.replace(/^Forwarded: /, '');
                      }
                      return msgText;
                    })()}
                  </Text>
                )}
                </TouchableOpacity>
              ) : isVideo && mediaKey ? (
                <TouchableOpacity 
                  onPress={() => handleFilePress(mediaKey, mediaName, 'video')}
                  activeOpacity={0.8}
                  style={styles.videoContainer}>
                  <View style={styles.mediaWrapper}>
                    <Video
                      source={{ uri: mediaUrl || getMediaUrl(mediaKey) }}
                      style={styles.messageVideo}
                      controls={false}
                      resizeMode="cover"
                      paused={true}
                    />
                    {message.status === 'sending' ? (
                      <View style={styles.mediaUploadingOverlay}>
                        <ActivityIndicator size="large" color={colors.textWhite} />
                      </View>
                    ) : (
                      <View style={styles.videoPlayOverlay}>
                        <Icon name="play-circle-filled" size={40} color={colors.textWhite} />
                      </View>
                    )}
                  </View>
                  {message.text && (
                    <Text style={[
                      styles.messageText,
                      myMessage ? styles.myMessageText : styles.otherMessageText,
                      styles.videoCaption,
                    ]}>
                      {(() => {
                        // Remove "Forwarded: " prefix if message is marked as forwarded
                        const msgText = message.text || '';
                        if ((message.isForwarded || message.IsForwarded) && msgText.startsWith('Forwarded: ')) {
                          return msgText.replace(/^Forwarded: /, '');
                        }
                        return msgText;
                      })()}
                    </Text>
                  )}
                </TouchableOpacity>
              ) : isFile && mediaKey ? (
                <TouchableOpacity 
                  onPress={() => handleFilePress(mediaKey, mediaName)}
                  style={styles.fileMessageContainer}
                  activeOpacity={0.8}>
                    <Icon name="insert-drive-file" size={24} color={myMessage ? colors.textWhite : colors.primary} />
                    <View style={styles.fileMessageInfo}>
                      <Text style={[
                        styles.fileMessageName,
                        myMessage ? styles.myMessageText : styles.otherMessageText,
                      ]} numberOfLines={1}>
                        {mediaName || 'File'}
                      </Text>
                      <Text style={[
                        styles.fileMessageSize,
                        myMessage ? styles.myMessageTime : styles.otherMessageTime,
                      ]}>
                        Tap to download
                      </Text>
                    </View>
                  </TouchableOpacity>
              ) : (message.messageType === 'audio' || message.MessageType === 'audio') && mediaKey ? (
                <View style={[
                  styles.voiceNoteContainer,
                  myMessage && styles.voiceNoteContainerMy
                ]}>
                  {/* Profile picture for group chats */}
                  {showSenderName && !myMessage && (() => {
                    const senderId = message.SenderId || message.senderId;
                    const senderProfile = getSenderProfileData(senderId);
                    const senderImage = senderProfile.image;
                    const senderName = message?.senderName || message?.SenderName || senderProfile.name || 'Unknown';
                    const firstLetter = senderName && senderName !== 'Unknown' ? senderName.charAt(0).toUpperCase() : '?';
                    
                    return (
                      <View style={styles.voiceNoteAvatar}>
                        {senderImage ? (
                          <Image source={{ uri: senderImage }} style={styles.voiceNoteAvatarImage} />
                        ) : (
                          <View style={[styles.voiceNoteAvatarPlaceholder, { backgroundColor: colors.primary }]}>
                            <Text style={styles.voiceNoteAvatarText}>{firstLetter}</Text>
                          </View>
                        )}
                        <View style={styles.voiceNoteMicIcon}>
                          <Icon name="mic" size={12} color={myMessage ? colors.textWhite : colors.primary} />
                        </View>
                      </View>
                    );
                  })()}
                  
                  {/* Play button */}
                  <TouchableOpacity 
                    style={[
                      styles.voiceNotePlayButton,
                      myMessage ? styles.voiceNotePlayButtonMy : styles.voiceNotePlayButtonOther
                    ]}
                    onPress={() => handleVoiceNotePlayback(message)}
                    activeOpacity={0.7}
                  >
                    <Icon 
                      name={
                        voicePlayback.id === (message.id || message._id) && !voicePlayback.paused
                          ? 'pause'
                          : 'play-arrow'
                      } 
                      size={20} 
                      color={myMessage ? colors.textWhite : colors.primary} 
                    />
                  </TouchableOpacity>
                  
                  {/* Waveform and progress */}
                  <View style={styles.voiceNoteWaveformContainer}>
                    <View style={styles.voiceNoteWaveform}>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((index) => {
                        const messageId = message.id || message._id;
                        const isPlaying = voicePlayback.id === messageId && !voicePlayback.paused;
                        
                        // Parse duration from message or use playback duration
                        let duration = 0;
                        if (audioDuration[messageId]) {
                          duration = audioDuration[messageId];
                        } else if (message.audioDuration) {
                          const parts = message.audioDuration.split(':');
                          if (parts.length === 2) {
                            duration = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                          }
                        }
                        if (duration === 0) duration = 1; // Prevent division by zero
                        
                        const progress = audioProgress[messageId] || 0;
                        const progressPercent = progress / duration;
                        const barIndex = index - 1;
                        const totalBars = 12;
                        const barProgress = progressPercent * totalBars;
                        
                        // Height varies by position (waveform pattern)
                        const heights = [6, 10, 8, 12, 6, 14, 8, 10, 6, 12, 8, 10];
                        const baseHeight = heights[index - 1] || 8;
                        
                        // Bar is active if it's before the progress point
                        const isActive = isPlaying && barIndex < barProgress;
                        
                        return (
                          <View
                            key={index}
                            style={[
                              styles.voiceNoteWaveformBar,
                              myMessage ? styles.voiceNoteWaveformBarMy : styles.voiceNoteWaveformBarOther,
                              isActive && styles.voiceNoteWaveformBarActive,
                              { height: baseHeight }
                            ]}
                          />
                        );
                      })}
                    </View>
                    <View style={styles.voiceNoteInfo}>
                    <Text style={[
                        styles.voiceNoteDuration,
                        myMessage ? styles.voiceNoteDurationMy : styles.voiceNoteDurationOther
                      ]}>
                        {(() => {
                          const messageId = message.id || message._id;
                          if (
                            voicePlayback.id === messageId &&
                            audioProgress[messageId] !== undefined
                          ) {
                            const seconds = audioProgress[messageId];
                            return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
                          }
                          return message.audioDuration || '0:00';
                        })()}
                    </Text>
                    </View>
                  </View>
                </View>
              ) : (
                <>
                  {(message.IsDeleted || message.isDeleted) ? (
                    <Text style={[
                      styles.messageText,
                      styles.messageDeletedText,
                      myMessage ? styles.myMessageText : styles.otherMessageText,
                      repliedMessage && styles.messageTextWithReply,
                    ]}>
                      This message was deleted
                    </Text>
                  ) : (
                    <Text style={[
                      styles.messageText,
                      myMessage ? styles.myMessageText : styles.otherMessageText,
                      repliedMessage && styles.messageTextWithReply,
                    ]}>
                      {(() => {
                        // Get message text and remove "Forwarded: " prefix if present
                        const msgText = message.text || message.Message || message.message || '';
                        // Remove "Forwarded: " prefix if message is marked as forwarded
                        if ((message.isForwarded || message.IsForwarded) && msgText.startsWith('Forwarded: ')) {
                          return msgText.replace(/^Forwarded: /, '');
                        }
                        return msgText;
                      })()}
                    </Text>
                  )}
                </>
              )}
              
              <View style={styles.messageFooter}>
                <Text style={[
                  styles.messageTime,
                  myMessage ? styles.myMessageTime : styles.otherMessageTime,
                ]}>
                  {formatMessageTime(message.timestamp || message.Timestamp)}
                </Text>
                
                {/* Edited indicator */}
                {(message.IsEdited || message.isEdited) && (
                  <Text style={[
                    styles.messageEditedText,
                    myMessage ? styles.messageEditedTextMy : styles.messageEditedTextOther,
                  ]}>
                    Edited
                  </Text>
                )}
                
                {myMessage ? (
                  <View style={styles.messageStatusContainer}>
                    <Icon
                      name={getMessageStatusIcon(message.status || 'sent')}
                      size={16}
                      color={getMessageStatusColor(message.status || 'sent', true, colors)}
                    />
                  </View>
                ) : null}
              </View>
            </View>
          </SwipeableMessage>
          </View>
        )}
      </View>
    );
  }, [enrichedMessages, user, isMyMessage, handleReplyToMessage, handleShowReadReceipts, handleFilePress, getMediaUrl, scrollViewRef, highlightedMessageId, storeMessagePosition, scrollToMessage, setHighlightedMessageId, getSenderProfileData, voicePlayback, handleVoiceNotePlayback]);

  // Prepare header props
  const enquiryTitle = finalEnquiry?.title || finalEnquiry?.Name || finalEnquiry?.name || enquiry?.title || enquiry?.Name || enquiry?.name;
  const chatTitle = chat?.EnquiryName || chat?.enquiryTitle || chat?.enquiryName;
  const title = enquiryTitle || chatTitle || 'New Chat';
  
  const clientId = originalChatData?.ClientId || originalChatData?.clientId || originalChatData?.Client?.Id || originalChatData?.Client?.id ||
                   chat?.ClientId || chat?.clientId || chat?.Client?.Id || chat?.Client?.id ||
                   finalEnquiry?.ClientId || finalEnquiry?.clientId || finalEnquiry?.Client?.Id || finalEnquiry?.Client?.id || 
                   enquiry?.ClientId || enquiry?.clientId || enquiry?.Client?.Id || enquiry?.Client?.id;
  
  let clientName = null;
  if (clientId && clients.length > 0) {
    const foundClient = clients.find(c => {
      const cId = String(c.id || c._id).trim();
      const searchId = String(clientId).trim();
      return cId === searchId;
    });
    if (foundClient?.name && isValidClientName(foundClient.name)) {
      clientName = foundClient.name;
    }
  }
  
  if (!clientName) {
    const possibleNames = [
      chat?.ClientName,
      chat?.clientName,
      finalEnquiry?.clientName,
      finalEnquiry?.client?.name,
      finalEnquiry?.Client?.Name,
      finalEnquiry?.Client?.name,
      enquiry?.clientName,
      enquiry?.client?.name,
      enquiry?.Client?.Name,
      enquiry?.Client?.name,
    ];
    clientName = possibleNames.find(name => isValidClientName(name)) || 'Client';
  }
  
  if (!isValidClientName(clientName)) {
    clientName = 'Client';
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <StatusBar backgroundColor={colors.primary} barStyle="light-content" />
          <ChatHeader
            title={title}
            clientName={clientName}
            isLoadingEnquiry={isLoadingEnquiry}
            onBack={handleNavigateBack}
            onInfo={() => alert.info('Chat Info', `Chat: ${title}\nClient: ${clientName}`)}
            isValidClientName={isValidClientName}
          />

        <View
          style={[
            styles.keyboardContainer,
            keyboardBottomInset > 0 && { paddingBottom: keyboardBottomInset },
          ]}>

          {loading && enrichedMessages.length === 0 ? (
            <View style={styles.messagesContainer}>
              <EmptyState loading={loading} error={null} />
            </View>
          ) : !loading && enrichedMessages.length === 0 && !messagesError ? (
            <View style={styles.messagesContainer}>
              <EmptyState loading={false} error={null} />
            </View>
          ) : enrichedMessages.length > 0 ? (
            <FlatList
              ref={scrollViewRef}
              data={enrichedMessages}
              keyExtractor={(item, index) => `msg-${item.id || item._id || index}`}
              renderItem={({ item, index }) => renderMessage(item, index)}
              style={styles.messagesContainer}
              contentContainerStyle={styles.messagesContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              onScroll={handleScroll}
              onScrollBeginDrag={handleScrollBeginDrag}
              onScrollEndDrag={handleScrollEndDrag}
              onMomentumScrollEnd={handleMomentumScrollEnd}
              scrollEventThrottle={16}
              inverted={false}
              removeClippedSubviews={Platform.OS === 'android'} // Better performance on Android
              maxToRenderPerBatch={10}
              updateCellsBatchingPeriod={50}
              initialNumToRender={15}
              windowSize={10}
              scrollEnabled={true}
              directionalLockEnabled={false} // Allow horizontal gestures within FlatList
              onScrollToIndexFailed={(info) => {
                // Fallback if scrollToIndex fails - wait for items to be measured
                if (__DEV__) {
                  console.log('⚠️ [FlatList] scrollToIndexFailed:', {
                    index: info.index,
                    highestMeasuredFrameIndex: info.highestMeasuredFrameIndex,
                    averageItemLength: info.averageItemLength,
                  });
                }
                
                // Calculate how many items need to be measured
                const itemsToMeasure = info.index - info.highestMeasuredFrameIndex;
                // Wait longer if more items need to be measured
                const delay = Math.min(500, Math.max(100, itemsToMeasure * 50));
                
                setTimeout(() => {
                  if (scrollViewRef.current && enrichedMessages.length > info.index) {
                    // Try scrolling to index again if items are now measured
                    try {
                      scrollViewRef.current.scrollToIndex({
                        index: info.index,
                        animated: true,
                        viewPosition: 0.5, // Center the item
                      });
                    } catch (retryError) {
                      // If it still fails, use offset-based scrolling
                      const itemHeight = info.averageItemLength || 110;
                      const offset = itemHeight * info.index;
                      scrollViewRef.current.scrollToOffset({
                        offset: Math.max(100, offset - 150),
                        animated: true,
                      });
                    }
                  }
                }, delay);
              }}
              ListHeaderComponent={
                // Show loading indicator at top when loading older messages
                isLoadingMore ? (
                  <View style={styles.loadMoreContainer}>
                    <Text style={styles.loadMoreText}>Loading older messages...</Text>
                  </View>
                ) : hasMore ? (
                  <View style={styles.loadMoreContainer}>
                    <Text style={styles.loadMoreHint}>Scroll up to load older messages</Text>
                  </View>
                ) : null
              }
              ListFooterComponent={
                isTyping ? (
                  <View style={styles.typingIndicator}>
                    <Text style={styles.typingText}>
                      {(() => {
                        // First try to get name from typingUser object
                        if (typingUser?.name) {
                          return `${typingUser.name} is typing...`;
                        }
                        // If not available, look up from users list using userId
                        if (typingUser?.userId) {
                          const userName = getTypingUserName(typingUser.userId);
                          if (userName) {
                            return `${userName} is typing...`;
                          }
                        }
                        // Fallback
                        return 'Someone is typing...';
                      })()}
                    </Text>
                  </View>
                ) : null
              }
            />
          ) : (
            <View style={styles.messagesContainer}>
              <EmptyState loading={loading} error={messagesError} />
            </View>
          )}

          <View
            style={[
              styles.inputContainer,
              {
                // Bottom inset comes from SafeAreaView edges; keep fixed inner padding for the composer bar.
                paddingBottom: 12,
              },
            ]}>
            {/* Reply Preview (text + media hint like WhatsApp) */}
            {replyingTo && (() => {
              const rp = replyingTo;
              const rType = rp.messageType || rp.MessageType || 'text';
              const rKey = rp.mediaKey || rp.MediaKey;
              const rUrl = rp.mediaUrl || rp.MediaUrl;
              const thumbUri = rUrl || (rKey ? getMediaUrl(rKey) : null);
              const subtitle = buildReplyToPayload(rp)?.text || 'Message';
              return (
                <View style={styles.replyPreviewBar}>
                  <View style={styles.replyPreviewBarContent}>
                    <View style={styles.replyPreviewBarLeft}>
                      <View style={[
                        styles.replyPreviewBarLine,
                        isMyMessage(rp) ? styles.replyPreviewBarLineMy : styles.replyPreviewBarLineOther,
                      ]} />
                      {(rType === 'image' || rType === 'video') && thumbUri ? (
                        <Image
                          source={{ uri: thumbUri }}
                          style={styles.replyPreviewBarThumb}
                          resizeMode="cover"
                        />
                      ) : rType === 'audio' ? (
                        <View style={styles.replyPreviewBarAudioIcon}>
                          <Icon name="mic" size={22} color={colors.primary} />
                        </View>
                      ) : null}
                      <View style={styles.replyPreviewBarText}>
                        <Text style={styles.replyPreviewBarName}>
                          Replying to {rp.senderName || rp.SenderName || 'Unknown'}
                        </Text>
                        <Text style={styles.replyPreviewBarMessage} numberOfLines={1}>
                          {subtitle}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={cancelReply}
                      style={styles.replyPreviewBarClose}
                    >
                      <Icon name="close" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })()}
            
            {/* Recording bar - shown when recording */}
            {isRecording ? (
              <View style={styles.recordingBar}>
                <Text style={styles.recordingBarTimer}>
                  {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
                </Text>
                <View style={styles.recordingBarCenter}>
                  {shouldCancel ? (
                    <Text style={styles.recordingBarCancelText}>
                      Release to cancel
                    </Text>
                  ) : isLocked ? (
                    <Text style={styles.recordingBarSendText}>
                      Tap mic to send
                    </Text>
                  ) : (
                    <Animated.View
                      style={[
                        styles.recordingBarSlideContainer,
                        { transform: [{ translateX: slideOffsetX * 0.35 }] },
                      ]}
                    >
                      <Icon name="chevron-left" size={16} color={colors.textSecondary} />
                      <Text style={styles.recordingBarSlideText}>
                        Slide to cancel
                      </Text>
                      <Text style={styles.recordingBarReleaseHint}>
                        {' • Release to send'}
                      </Text>
                    </Animated.View>
                  )}
                </View>
                {/* Lock button appears after 1 second */}
                {recordingTime >= 1 && !isLocked && (
                  <TouchableOpacity
                    style={styles.recordingBarLockButton}
                    onPress={() => {
                      isLockedRef.current = true;
                      setIsLocked(true);
                      startLockPulse();
                    }}
                    activeOpacity={0.7}
                  >
                    <Icon name="lock" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
                {isLocked ? (
                  <Animated.View
                    style={[
                      styles.recordingBarMicButton,
                      styles.recordingBarMicButtonLocked,
                      {
                        transform: [{ scale: micButtonPulseAnim }],
                      },
                    ]}
                  >
                    <TouchableOpacity 
                      onPress={handleMicPress}
                      activeOpacity={0.7}
                    >
                      <Icon 
                        name="send" 
                        size={24} 
                        color={colors.textWhite} 
                      />
                    </TouchableOpacity>
                  </Animated.View>
                ) : (
                  <View {...voiceNotePanResponder.panHandlers} style={styles.recordingBarMicButton}>
                    <Icon name="mic" size={24} color={colors.textWhite} />
                  </View>
                )}
              </View>
            ) : (
            <View style={styles.inputWrapper}>
              <TouchableOpacity 
                style={styles.attachButton}
                onPress={handleAttachFile}
                disabled={isUploading}>
                <Icon 
                  name={isUploading ? "hourglass-empty" : "attach-file"} 
                  size={20} 
                  color={isUploading ? colors.textLight : colors.textSecondary} 
                />
              </TouchableOpacity>
              
              <View style={styles.textInputContainer}>
                <ComposerMultilineInput
                  ref={textInputRef}
                  placeholder={replyingTo ? 'Type a reply...' : 'Type a message...'}
                  onChangeText={handleTyping}
                />
              </View>
              
              {hasComposerText ? (
                <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
                  <Icon name="send" size={20} color={colors.textWhite} />
                </TouchableOpacity>
              ) : Platform.OS === 'android' ? (
                <TouchableOpacity
                  style={styles.micButton}
                  onPress={handleAndroidMicTap}
                  activeOpacity={0.7}
                  disabled={isRecording}
                >
                  <Icon name="mic" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : (
                <View {...voiceNotePanResponder.panHandlers} style={styles.micButton}>
                  <Icon name="mic" size={20} color={colors.textSecondary} />
                </View>
              )}
            </View>
            )}
          </View>
        </View>

      {/* Lock overlay - shown when locked for hands-free recording */}
      {isRecording && isLocked && (
        <Modal
          visible={isLocked}
          transparent={true}
          animationType="fade"
          onRequestClose={() => stopRecording(true)}
        >
                  <TouchableOpacity 
            style={styles.lockOverlay}
            activeOpacity={1}
                    onPress={() => stopRecording(true)}
                  >
            <View style={styles.lockOverlayContent}>
              <View style={styles.lockOverlayLockIcon}>
                <Icon name="lock" size={24} color={colors.textWhite} />
                </View>
              <Text style={styles.lockOverlayText}>Tap to stop and send</Text>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Custom Media Selection Modal */}
      <Modal
        visible={showMediaModal}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseMediaModal}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={handleCloseMediaModal}
        >
          <View style={styles.modalContainer}>
            <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalContent}>
                {/* Modal Header */}
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Attach Media</Text>
                  <TouchableOpacity
                    onPress={handleCloseMediaModal}
                    style={styles.modalCloseButton}
                  >
                    <Icon name="close" size={24} color={colors.textPrimary} />
                  </TouchableOpacity>
                </View>

                {/* Modal Options */}
                <View style={styles.modalOptions}>
                  {/* Camera Option */}
                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => handleMediaOption('camera', 'photo')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.modalOptionIcon, { backgroundColor: colors.primary + '15' }]}>
                      <Icon name="camera" size={32} color={colors.primary} />
                    </View>
                    <Text style={styles.modalOptionText}>Camera</Text>
                    <Text style={styles.modalOptionSubtext}>Take a photo</Text>
                  </TouchableOpacity>

                  {/* Photo from Gallery */}
                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => handleMediaOption('gallery', 'photo')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.modalOptionIcon, { backgroundColor: colors.accent + '15' }]}>
                      <Icon name="image" size={32} color={colors.accent} />
                    </View>
                    <Text style={styles.modalOptionText}>Photo</Text>
                    <Text style={styles.modalOptionSubtext}>Choose from gallery</Text>
                  </TouchableOpacity>

                  {/* Video from Gallery */}
                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => handleMediaOption('gallery', 'video')}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.modalOptionIcon, { backgroundColor: colors.primaryLight + '15' }]}>
                      <Icon name="video-library" size={32} color={colors.primaryLight} />
                    </View>
                    <Text style={styles.modalOptionText}>Video</Text>
                    <Text style={styles.modalOptionSubtext}>Choose from gallery</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={handleAudioPicker}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.modalOptionIcon, { backgroundColor: colors.primary + '15' }]}>
                      <Icon name="audiotrack" size={32} color={colors.primary} />
                    </View>
                    <Text style={styles.modalOptionText}>Audio</Text>
                    <Text style={styles.modalOptionSubtext}>Voice note or music file</Text>
                  </TouchableOpacity>

                  {/* Document/File Picker */}
                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={handleDocumentPicker}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.modalOptionIcon, { backgroundColor: colors.accent + '15' }]}>
                      <Icon name="attach-file" size={32} color={colors.accent} />
                    </View>
                    <Text style={styles.modalOptionText}>Document</Text>
                    <Text style={styles.modalOptionSubtext}>Choose any file</Text>
                  </TouchableOpacity>
                </View>

                {/* Cancel Button */}
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={handleCloseMediaModal}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Read Receipt Modal - Shows who has read the message */}
      <Modal
        visible={showReadReceiptModal}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseReadReceiptModal}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={handleCloseReadReceiptModal}
        >
          <View style={styles.readReceiptModalContainer}>
            <TouchableOpacity 
              activeOpacity={1} 
              onPress={(e) => e.stopPropagation()}
              style={{ width: '100%', alignItems: 'center' }}
            >
              <View style={styles.readReceiptModalContent}>
                {/* Modal Header */}
                <View style={styles.readReceiptModalHeader}>
                  <Text style={styles.readReceiptModalTitle}>
                    {selectedMessage && (() => {
                      const senderId = selectedMessage.SenderId || selectedMessage.senderId;
                      const isMyMsg = user && String(senderId).trim() === String(user.id).trim();
                      return isMyMsg ? 'Read by' : 'Seen by';
                    })()}
                  </Text>
                  <TouchableOpacity
                    onPress={handleCloseReadReceiptModal}
                    style={styles.modalCloseButton}
                  >
                    <Icon name="close" size={24} color={colors.textPrimary} />
                  </TouchableOpacity>
                </View>

                {/* Message Preview */}
                {selectedMessage && (
                  <View style={styles.readReceiptMessagePreview}>
                    {/* Forwarded indicator - WhatsApp style */}
                    {(selectedMessage.isForwarded || selectedMessage.IsForwarded) && (
                      <View style={styles.readReceiptForwardedBy}>
                        <Icon 
                          name="forward" 
                          size={14} 
                          color={colors.textLight} 
                          style={styles.readReceiptForwardedByIcon}
                        />
                        <Text style={styles.readReceiptForwardedByText}>
                          Forwarded
                        </Text>
                        {(selectedMessage.forwardedByName || selectedMessage.ForwardedByName) && (
                          <Text style={styles.readReceiptForwardedByNameText}>
                            {' • '}{selectedMessage.forwardedByName || selectedMessage.ForwardedByName}
                          </Text>
                        )}
                      </View>
                    )}
                    <Text style={styles.readReceiptMessageText} numberOfLines={2}>
                      {selectedMessage.text || selectedMessage.Message || selectedMessage.message || 'Message'}
                    </Text>
                    <Text style={styles.readReceiptMessageTime}>
                      {formatMessageTime(selectedMessage.timestamp || selectedMessage.Timestamp)}
                    </Text>
                  </View>
                )}

                {/* List of Users */}
                <ScrollView 
                  style={styles.readReceiptList}
                  contentContainerStyle={styles.readReceiptListContent}
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={true}
                  bounces={true}
                  scrollEnabled={true}
                  keyboardShouldPersistTaps="handled"
                >
                  {selectedMessage && (() => {
                    const readByArray = selectedMessage.ReadBy || selectedMessage.readBy || selectedMessage.read_by || [];
                    const readByTimestamps = selectedMessage.ReadByTimestamps || selectedMessage.readByTimestamps || selectedMessage.read_by_timestamps || {};
                    const senderId = selectedMessage.SenderId || selectedMessage.senderId;
                    const isMyMsg = user && String(senderId).trim() === String(user.id).trim();
                    
                    // Removed excessive logging for performance
                    
                    // Process ReadBy array - handle multiple formats from backend:
                    // 1. Array of objects: [{ userId: '123', readAt: '2024-01-01T00:00:00Z' }, ...]
                    // 2. Array of IDs with separate ReadByTimestamps: ['123', '456'] + { '123': '2024-01-01T00:00:00Z', ... }
                    // 3. Mixed format: [{ userId: '123', readAt: '...' }, '456', '789'] - need to merge
                    const processReadBy = () => {
                      const processed = [];
                      const timestampMap = new Map(); // Store timestamps by userId for merging
                      
                      if (!Array.isArray(readByArray)) {
                        return processed;
                      }
                      
                      // First pass: Extract all timestamps from objects and store in map
                      readByArray.forEach((item) => {
                        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                          const userId = String(item.userId || item.user_id || item.id || item.UserId || item.Id || '').trim();
                          const timestamp = item.readAt || item.ReadAt || item.read_at || 
                                           item.timestamp || item.Timestamp || 
                                           item.readTimestamp || item.ReadTimestamp ||
                                           null;
                          
                          if (userId && timestamp) {
                            timestampMap.set(userId, timestamp);
                          }
                        }
                      });
                      
                      // Second pass: Process all items and use stored timestamps
                      readByArray.forEach((item) => {
                        let userId, timestamp;
                        
                        // Check if item is an object with userId and timestamp
                        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                          // Format: { userId: '123', readAt: '...' } or { id: '123', timestamp: '...' }
                          userId = item.userId || item.user_id || item.id || item.UserId || item.Id || item.userId;
                          timestamp = item.readAt || item.ReadAt || item.read_at || 
                                     item.timestamp || item.Timestamp || 
                                     item.readTimestamp || item.ReadTimestamp ||
                                     null;
                          
                          // If timestamp not found in item, check our map (might have been set by another object)
                          if (!timestamp && userId) {
                            timestamp = timestampMap.get(String(userId).trim()) || null;
                          }
                        } else {
                          // Item is just a user ID string/number
                          userId = item;
                          const userIdStr = String(userId).trim();
                          
                          // First check our timestamp map (from objects in first pass)
                          timestamp = timestampMap.get(userIdStr) || null;
                          
                          // If not in map, try to get timestamp from ReadByTimestamps object
                          if (!timestamp && readByTimestamps && typeof readByTimestamps === 'object') {
                            // Try different key formats in ReadByTimestamps
                            timestamp = readByTimestamps[userIdStr] || 
                                       readByTimestamps[userId] || 
                                       readByTimestamps[String(userId)] ||
                                       readByTimestamps[Number(userId)] ||
                                       null;
                            
                            // If still not found, try case-insensitive key matching
                            if (!timestamp) {
                              const matchingKey = Object.keys(readByTimestamps).find(key => 
                                String(key).trim().toLowerCase() === userIdStr.toLowerCase()
                              );
                              if (matchingKey) {
                                timestamp = readByTimestamps[matchingKey];
                              }
                            }
                          }
                        }
                        
                        if (userId) {
                          const userIdStr = String(userId).trim();
                          const processedItem = { 
                            userId: userIdStr, 
                            timestamp: timestamp || null
                          };
                          
                          // Only add if not already added (avoid duplicates)
                          const alreadyExists = processed.some(p => p.userId === userIdStr);
                          if (!alreadyExists) {
                            processed.push(processedItem);
                          }
                        }
                      });
                      
                      return processed;
                    };
                    
                    const processedReaders = processReadBy();
                    
                    // For sent messages: filter out the sender (you can't read your own message)
                    // For received messages: show all readers including yourself if you read it
                    let readers = [];
                    if (isMyMsg) {
                      // This is my sent message - show who has read it (excluding me)
                      const senderIdStr = String(senderId).trim();
                      readers = processedReaders.filter(reader => {
                        const readerId = reader.userId;
                        return readerId !== senderIdStr && readerId !== '';
                      });
                    } else {
                      // This is a received message - show all readers (including me if I read it)
                      readers = processedReaders.filter(reader => {
                        const readerId = reader.userId;
                        return readerId !== '';
                      });
                    }

                    // Removed excessive logging for performance

                    if (readers.length === 0) {
                      return (
                        <View style={styles.readReceiptEmpty}>
                          <Icon name="info-outline" size={48} color={colors.textLight} />
                          <Text style={styles.readReceiptEmptyText}>
                            {isMyMsg 
                              ? 'No one has read this message yet'
                              : 'No one has seen this message yet'}
                          </Text>
                          <Text style={styles.readReceiptEmptySubtext}>
                            {isMyMsg
                              ? 'The message will show as read once someone views it'
                              : 'The message will show as seen once someone views it'}
                          </Text>
                        </View>
                      );
                    }

                    return readers.map((reader, index) => {
                      const userId = reader.userId;
                      const readTimestamp = reader.timestamp;
                      const userName = getUserName(userId);
                      const userInitial = userName?.charAt(0)?.toUpperCase() || '?';
                      const isCurrentUser = user && String(userId).trim() === String(user.id).trim();
                      
                      // Format the read timestamp - prioritize individual user's read timestamp from backend
                      let timestampText = '';
                      
                      if (readTimestamp) {
                        // Use the actual read timestamp from backend for this specific user
                        try {
                          timestampText = formatReadTimestamp(readTimestamp);
                        } catch (error) {
                          // If formatting fails, try to show raw timestamp or fallback
                          try {
                            const date = new Date(readTimestamp);
                            if (!isNaN(date.getTime())) {
                              timestampText = formatReadTimestamp(date.toISOString());
                            }
                          } catch {
                            timestampText = 'Recently';
                          }
                        }
                      } else {
                        // Fallback: If no timestamp available, show "Recently" so user knows message was read
                        // This handles cases where backend sends user ID without timestamp (legacy data)
                        timestampText = 'Recently';
                      }
                      
                      return (
                        <View key={`reader-${userId}-${index}`} style={styles.readReceiptItem}>
                          <View style={[
                            styles.readReceiptAvatar,
                            isCurrentUser && { backgroundColor: colors.primary }
                          ]}>
                            <Text style={styles.readReceiptAvatarText}>{userInitial}</Text>
                          </View>
                          <View style={styles.readReceiptItemContent}>
                            <Text style={styles.readReceiptItemName}>
                              {isCurrentUser ? 'You' : userName}
                            </Text>
                            <Text style={styles.readReceiptItemSubtext}>
                              {isMyMsg ? 'Read this message' : 'Seen this message'}
                            </Text>
                            <Text style={styles.readReceiptItemTime}>
                              {timestampText || 'Recently'}
                            </Text>
                          </View>
                          <Icon name="done-all" size={20} color={colors.primary} />
                        </View>
                      );
                    });
                  })()}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Message Action Menu Modal */}
      <Modal
        visible={showMessageMenu}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseMessageMenu}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={handleCloseMessageMenu}
        >
          <View style={styles.messageMenuContainer}>
            <TouchableOpacity 
              activeOpacity={1} 
              onPress={(e) => e.stopPropagation()}
              style={styles.messageMenuContent}
            >
              <TouchableOpacity
                style={styles.messageMenuOption}
                onPress={handleReplyFromMenu}
              >
                <Icon name="reply" size={24} color={colors.textPrimary} />
                <Text style={styles.messageMenuOptionText}>Reply</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.messageMenuOption}
                onPress={handleCopyFromMenu}
              >
                <Icon name="content-copy" size={24} color={colors.textPrimary} />
                <Text style={styles.messageMenuOptionText}>Copy</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.messageMenuOption}
                onPress={handleForwardFromMenu}
              >
                <Icon name="forward" size={24} color={colors.textPrimary} />
                <Text style={styles.messageMenuOptionText}>Forward</Text>
              </TouchableOpacity>
              
              {/* Edit and Delete options - only for user's own messages */}
              {menuMessage && user && (() => {
                const senderId = menuMessage.SenderId || menuMessage.senderId;
                const isMyMessage = String(senderId).trim() === String(user.id).trim();
                const isDeleted = menuMessage.IsDeleted || menuMessage.isDeleted;
                
                if (!isMyMessage || isDeleted) return null;
                
                return (
                  <>
                    <TouchableOpacity
                      style={styles.messageMenuOption}
                      onPress={handleEditFromMenu}
                    >
                      <Icon name="edit" size={24} color={colors.textPrimary} />
                      <Text style={styles.messageMenuOptionText}>Edit</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={styles.messageMenuOption}
                      onPress={handleDeleteFromMenu}
                    >
                      <Icon name="delete" size={24} color={colors.error} />
                      <Text style={[styles.messageMenuOptionText, { color: colors.error }]}>Delete</Text>
                    </TouchableOpacity>
                  </>
                );
              })()}
              
              <TouchableOpacity
                style={styles.messageMenuOption}
                onPress={handleReadReceiptsFromMenu}
              >
                <Icon name="info" size={24} color={colors.textPrimary} />
                <Text style={styles.messageMenuOptionText}>Read Receipts</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.messageMenuOption, styles.messageMenuCancel]}
                onPress={handleCloseMessageMenu}
              >
                <Text style={styles.messageMenuCancelText}>Cancel</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Edit Message Modal */}
      <Modal
        visible={!!editingMessage}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCancelEdit}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.editMessageModalContainer}>
            <View style={styles.editMessageModalHeader}>
              <Text style={styles.editMessageModalTitle}>Edit Message</Text>
              <TouchableOpacity
                onPress={handleCancelEdit}
                style={styles.modalCloseButton}
              >
                <Icon name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            
            <TextInput
              style={styles.editMessageInput}
              value={editMessageText}
              onChangeText={setEditMessageText}
              placeholder="Edit your message..."
              multiline
              autoFocus
              placeholderTextColor={colors.textLight}
            />
            
            <View style={styles.editMessageModalActions}>
              <TouchableOpacity
                style={[styles.editMessageButton, styles.editMessageCancelButton]}
                onPress={handleCancelEdit}
                disabled={isEditing}
              >
                <Text style={[styles.editMessageCancelText, isEditing && { opacity: 0.5 }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.editMessageButton, 
                  styles.editMessageSaveButton,
                  (isEditing || !editMessageText.trim()) && styles.editMessageSaveButtonDisabled
                ]}
                onPress={handleSaveEdit}
                disabled={isEditing || !editMessageText.trim()}
              >
                {isEditing ? (
                  <View style={styles.editMessageLoadingContainer}>
                    <Text style={styles.editMessageSaveText}>Saving...</Text>
                  </View>
                ) : (
                  <Text style={[styles.editMessageSaveText, !editMessageText.trim() && { opacity: 0.5 }]}>
                    Save
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Forward Message Modal */}
      <Modal
        visible={showForwardModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowForwardModal(false);
          setForwardingMessage(null);
        }}
      >
        <View style={styles.forwardModalContainer}>
          <View style={styles.forwardModalHeader}>
            <Text style={styles.forwardModalTitle}>Forward Message</Text>
            <TouchableOpacity
              onPress={() => {
                setShowForwardModal(false);
                setForwardingMessage(null);
              }}
            >
              <Icon name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          
          <Text style={styles.forwardModalSubtitle}>Select a chat to forward to:</Text>
          
          <FlatList
            data={forwardableChats}
            keyExtractor={(item) => String(item._id || item.id)}
            renderItem={({ item }) => {
              // Get display name with proper fallback chain
              const displayName = 
                item.enquiryTitle || 
                item.EnquiryName || 
                item.enquiryName ||
                item.clientName || 
                item.ClientName || 
                item._originalData?.EnquiryName ||
                item._originalData?.enquiryTitle ||
                item._originalData?.ClientName ||
                item._originalData?.clientName ||
                'Chat';
              
              // Get first letter for avatar
              const avatarLetter = displayName.charAt(0).toUpperCase();
              
              return (
                <TouchableOpacity
                  style={styles.forwardChatItem}
                  onPress={() => handleForwardMessage(item)}
                >
                  <View style={styles.forwardChatAvatar}>
                    <Text style={styles.forwardChatAvatarText}>
                      {avatarLetter}
                    </Text>
                  </View>
                  <View style={styles.forwardChatInfo}>
                    <Text style={styles.forwardChatName}>
                      {displayName}
                    </Text>
                    <Text style={styles.forwardChatType}>
                      {item.Type === 'admin-client' ? 'Client Chat' : 'Designer Chat'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.forwardEmptyContainer}>
                <Text style={styles.forwardEmptyText}>No chats available</Text>
              </View>
            }
          />
        </View>
      </Modal>

      {/* Media Viewer Modal - For viewing images and videos */}
      <Modal
        visible={showMediaViewerModal}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseMediaViewer}
        statusBarTranslucent={true}
      >
        <View style={styles.mediaViewerContainer}>
          <View style={styles.mediaViewerHeader}>
            <TouchableOpacity
              style={styles.mediaViewerCloseButton}
              onPress={handleCloseMediaViewer}
              activeOpacity={0.8}
            >
              <Icon name="close" size={28} color={colors.textWhite} />
            </TouchableOpacity>
            
            {/* Action buttons for documents */}
            {viewerMediaType === 'document' && viewerDocumentName && (
              <View style={styles.documentActionButtons}>
                <TouchableOpacity
                  style={styles.documentActionButton}
                  onPress={handleOpenInBrowser}
                  activeOpacity={0.8}
                >
                  <Icon name="launch" size={24} color={colors.textWhite} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.documentActionButton}
                  onPress={handleDownloadDocument}
                  activeOpacity={0.8}
                >
                  <Icon name="download" size={24} color={colors.textWhite} />
                </TouchableOpacity>
              </View>
            )}
          </View>
          
          {viewerMediaType === 'image' && viewerMediaUrl ? (
            <ImageZoom
              cropWidth={Dimensions.get('window').width}
              cropHeight={Dimensions.get('window').height}
              imageWidth={Dimensions.get('window').width}
              imageHeight={Dimensions.get('window').height}
              enableCenterFocus
              useNativeDriver
              enableSwipeDown={true}
              onSwipeDown={handleCloseMediaViewer}
              pinchToZoom
              panToMove
            >
              <Image
                source={{ uri: viewerMediaUrl }}
                style={styles.mediaViewerImage}
                resizeMode="contain"
              />
            </ImageZoom>
          ) : viewerMediaType === 'video' && viewerMediaUrl ? (
            <View style={styles.mediaViewerVideoContainer}>
              <Video
                source={{ uri: viewerMediaUrl }}
                style={styles.mediaViewerVideo}
                controls={true}
                resizeMode="contain"
                paused={false}
              />
            </View>
          ) : viewerMediaType === 'document' && viewerMediaUrl ? (
            <View style={styles.mediaViewerDocumentContainer}>
              {/* Show helpful message for PDFs on Android - WebView can't display them */}
              {viewerDocumentName && viewerDocumentName.toLowerCase().endsWith('.pdf') && Platform.OS === 'android' && !webViewError && !isRefreshingUrl ? (
                <View style={styles.documentAndroidMessage}>
                  <Icon name="info-outline" size={48} color={colors.primary} />
                  <Text style={styles.documentAndroidMessageTitle}>Opening PDF in Browser</Text>
                  <Text style={styles.documentAndroidMessageText}>
                    PDFs cannot be displayed in the app viewer on Android. The PDF will open in your browser automatically...
                  </Text>
                  <TouchableOpacity
                    style={styles.documentAndroidMessageButton}
                    onPress={handleOpenInBrowser}
                    activeOpacity={0.8}
                  >
                    <Icon name="launch" size={20} color={colors.textWhite} />
                    <Text style={styles.documentAndroidMessageButtonText}>Open Now</Text>
                  </TouchableOpacity>
                </View>
              ) : webViewError && !isRefreshingUrl ? (
                <View style={styles.documentErrorContainer}>
                  <Icon name="error-outline" size={64} color={colors.textSecondary} />
                  <Text style={styles.documentErrorText}>
                    {viewerDocumentName && viewerDocumentName.toLowerCase().endsWith('.pdf') && Platform.OS === 'android'
                      ? 'PDF cannot be displayed in viewer'
                      : 'Failed to load document'}
                  </Text>
                  <Text style={styles.documentErrorSubtext}>
                    {viewerDocumentName && viewerDocumentName.toLowerCase().endsWith('.pdf') && Platform.OS === 'android'
                      ? 'PDFs cannot be displayed in the in-app viewer on Android. Please open in browser or download.'
                      : viewerMediaKey 
                        ? 'The document URL may have expired. Click below to refresh or open in browser.'
                        : 'The document could not be displayed in the viewer.'}
                  </Text>
                  <View style={styles.documentErrorButtons}>
                    {viewerMediaKey && (
                      <TouchableOpacity
                        style={[styles.documentErrorButton, styles.documentErrorButtonSecondary]}
                        onPress={refreshExpiredUrl}
                        activeOpacity={0.8}
                        disabled={isRefreshingUrl}
                      >
                        <Icon name="refresh" size={20} color={colors.primary} />
                        <Text style={[styles.documentErrorButtonText, styles.documentErrorButtonTextSecondary]}>
                          {isRefreshingUrl ? 'Refreshing...' : 'Refresh URL'}
                        </Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.documentErrorButton}
                      onPress={handleOpenInBrowser}
                      activeOpacity={0.8}
                    >
                      <Icon name="launch" size={20} color={colors.textWhite} />
                      <Text style={styles.documentErrorButtonText}>Open in Browser</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : isRefreshingUrl ? (
                <View style={styles.documentErrorContainer}>
                  <Text style={styles.documentLoadingText}>Refreshing document URL...</Text>
                </View>
              ) : (
                <WebView
                  key={viewerMediaUrl} // Force re-render when URL changes
                  source={{ uri: viewerMediaUrl }}
                  style={styles.mediaViewerDocument}
                  startInLoadingState={true}
                  renderLoading={() => (
                    <View style={styles.documentLoadingOverlay}>
                      <Text style={styles.documentLoadingText}>Loading document...</Text>
                    </View>
                  )}
                  scalesPageToFit={true}
                  javaScriptEnabled={true}
                  domStorageEnabled={true}
                  allowsInlineMediaPlayback={true}
                  mediaPlaybackRequiresUserAction={false}
                  originWhitelist={['*']}
                  mixedContentMode="always"
                  // Additional props for better PDF support
                  allowFileAccess={true}
                  allowFileAccessFromFileURLs={Platform.OS === 'android'}
                  allowUniversalAccessFromFileURLs={Platform.OS === 'android'}
                  // Better rendering
                  androidLayerType="hardware"
                  // For Android PDF support
                  androidHardwareAccelerationDisabled={false}
                  // Better error handling
                  onShouldStartLoadWithRequest={(request) => {
                    console.log('📄 [WebView] Should start load:', request.url);
                    // Allow all navigation
                    return true;
                  }}
                  onLoadStart={() => {
                    console.log('📄 [WebView] Load started:', viewerMediaUrl);
                    setWebViewError(false);
                  }}
                  onLoadEnd={(syntheticEvent) => {
                    const { nativeEvent } = syntheticEvent;
                    console.log('📄 [WebView] Load ended:', {
                      url: nativeEvent.url,
                      loading: nativeEvent.loading,
                      canGoBack: nativeEvent.canGoBack,
                      canGoForward: nativeEvent.canGoForward,
                    });
                    
                    // For PDFs, if WebView loads but shows blank, it might not be able to display
                    // Set a timeout to check if content is actually visible
                    if (viewerDocumentName && viewerDocumentName.toLowerCase().endsWith('.pdf')) {
                      setTimeout(() => {
                        // If after 2 seconds the WebView still shows blank, offer to open in browser
                        console.log('📄 [WebView] PDF loaded - checking if displayable...');
                        // We'll rely on user feedback or error detection for now
                      }, 2000);
                    }
                    
                    // Check if the page loaded successfully
                    // If URL changed to an error page or similar, mark as error
                    if (nativeEvent.url && (
                      nativeEvent.url.includes('error') || 
                      nativeEvent.url.includes('blocked') ||
                      nativeEvent.url.includes('denied')
                    )) {
                      setWebViewError(true);
                    }
                  }}
                  onError={(syntheticEvent) => {
                    const { nativeEvent } = syntheticEvent;
                    console.error('📄 [WebView] Error:', {
                      description: nativeEvent.description,
                      domain: nativeEvent.domain,
                      code: nativeEvent.code,
                      url: nativeEvent.url,
                    });
                    
                    // Check if error description mentions expiration or access denied
                    const errorDesc = (nativeEvent.description || '').toLowerCase();
                    if (errorDesc.includes('expired') || errorDesc.includes('access denied') || errorDesc.includes('forbidden')) {
                      console.log('📄 [WebView] Expired/access error detected, attempting refresh...');
                      // Use setTimeout to ensure state is ready
                      setTimeout(() => {
                        refreshExpiredUrl();
                      }, 100);
                    } else {
                      // For PDFs, if direct loading fails, try Google Docs Viewer
                      if (viewerDocumentName && viewerDocumentName.toLowerCase().endsWith('.pdf') && 
                          viewerOriginalUrl && !viewerMediaUrl.includes('docs.google.com')) {
                        console.log('📄 [WebView] Direct PDF loading error, trying Google Docs Viewer...');
                        const encodedUrl = encodeURIComponent(viewerOriginalUrl);
                        const googleDocsUrl = `https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`;
                        setViewerMediaUrl(googleDocsUrl);
                        setWebViewError(false);
                      } else {
                        setWebViewError(true);
                      }
                    }
                  }}
                  onHttpError={(syntheticEvent) => {
                    const { nativeEvent } = syntheticEvent;
                    console.error('📄 [WebView] HTTP error:', {
                      statusCode: nativeEvent.statusCode,
                      description: nativeEvent.description,
                      url: nativeEvent.url,
                    });
                    
                    // Check if it's a 403 Forbidden (likely expired URL)
                    if (nativeEvent.statusCode === 403) {
                      console.log('📄 [WebView] 403 Forbidden detected - URL may be expired, attempting refresh...');
                      // Use setTimeout to ensure state is ready
                      setTimeout(() => {
                        refreshExpiredUrl();
                      }, 100);
                    } else if (nativeEvent.statusCode >= 400) {
                      // For PDFs, if direct loading fails with 400+, try Google Docs Viewer
                      if (viewerDocumentName && viewerDocumentName.toLowerCase().endsWith('.pdf') && 
                          viewerOriginalUrl && !viewerMediaUrl.includes('docs.google.com')) {
                        console.log('📄 [WebView] Direct PDF loading failed, trying Google Docs Viewer...');
                        const encodedUrl = encodeURIComponent(viewerOriginalUrl);
                        const googleDocsUrl = `https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`;
                        setViewerMediaUrl(googleDocsUrl);
                        setWebViewError(false);
                      } else {
                        setWebViewError(true);
                      }
                    }
                  }}
                  onMessage={(event) => {
                    console.log('📄 [WebView] Message from WebView:', event.nativeEvent.data);
                    // Check for error messages from the page
                    const message = event.nativeEvent.data;
                    if (message && (
                      message.toLowerCase().includes('error') ||
                      message.toLowerCase().includes('failed') ||
                      message.toLowerCase().includes('blocked')
                    )) {
                      setWebViewError(true);
                    }
                  }}
                />
              )}
            </View>
          ) : null}
        </View>
      </Modal>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  keyboardContainer: {
    flex: 1,
  },
  headerContainer: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 44 : 24,
    paddingBottom: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAvatarContainer: {
    marginRight: 12,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.textWhite + '30',
  },
  headerAvatarText: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  headerText: {
    flex: 1,
    justifyContent: 'center',
  },
  chatTitle: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.textWhite,
    marginBottom: 2,
  },
  clientName: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textWhite,
    opacity: 0.85,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  headerIconButton: {
    padding: 8,
    marginLeft: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 20,
    backgroundColor: 'transparent',
  },
  messageContainer: {
    marginBottom: 16,
  },
  myMessageContainer: {
    alignItems: 'flex-end',
  },
  otherMessageContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: width * 0.75, // 75% of screen width
    minWidth: 60, // Ensure minimum width for short messages
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    flexShrink: 1,
  },
  // Ensure reply preview text has room, even for very short messages
  messageBubbleWithReply: {
    minWidth: width * 0.55, // ~55% of screen width
  },
  myMessageBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
    marginLeft: 'auto',
  },
  otherMessageBubble: {
    backgroundColor: colors.background,
    borderBottomLeftRadius: 4,
    marginRight: 'auto',
  },
  highlightedMessageBubble: {
    borderWidth: 3,
    borderColor: colors.primary, // Theme color border
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6, // Android shadow
    // Slight theme color tint on bubble (10% opacity: rgba(16, 53, 52, 0.1))
    backgroundColor: 'rgba(16, 53, 52, 0.1)',
  },
  messageText: {
    fontSize: 13,
    lineHeight: 20,
    flexWrap: 'wrap',
  },
  messageTextWithReply: {
    marginTop: 2, // Small margin when there's a reply preview above for better spacing
  },
  myMessageText: {
    color: colors.textWhite,
  },
  otherMessageText: {
    color: colors.textPrimary,
  },
  messageInfo: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  messageTime: {
    marginRight: 8,
    fontSize: 10,
  },
  messageEditedText: {
    fontSize: 10,
    fontFamily: fonts.regular,
    marginRight: 4,
    fontStyle: 'italic',
  },
  messageEditedTextMy: {
    color: colors.textWhite,
    opacity: 0.8,
  },
  messageEditedTextOther: {
    color: colors.textLight,
    opacity: 0.8,
  },
  messageDeletedText: {
    fontStyle: 'italic',
    opacity: 0.6,
  },
  senderName: {
    fontWeight: '500',
    flexShrink: 1,
    fontSize: 13,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    marginTop: 16,
    marginBottom: 8,
  },
  inputContainer: {
    padding: 16,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: Platform.OS === 'ios' ? 16 : 16,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end', // Changed from 'center' to 'flex-end' to align buttons with bottom of expanding input
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 6,
    minHeight: 50,
  },
  mediaWrapper: {
    position: 'relative',
    zIndex: 1,
  },
  mediaUploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    elevation: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileMessageInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textInput: {
    // Remove flex: 1 to allow height to work properly
    width: '100%', // Use width instead of flex
    fontSize: fonts.base,
    color: colors.textPrimary,
    paddingVertical: 8,
    paddingHorizontal: 0,
    textAlignVertical: 'top', // Shows text from top for multiline
    includeFontPadding: false,
    // Height will be set dynamically via inline style
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: colors.borderLight,
  },
  
  // New styles for modern chat design
  messageWrapper: {
    marginBottom: 0, // Minimal spacing between messages like WhatsApp
  },
  highlightedMessageWrapper: {
    backgroundColor: 'rgba(16, 53, 52, 0.2)', // Theme color background (20% opacity)
    borderRadius: 8,
    padding: 4,
    marginHorizontal: -4,
    marginVertical: 2,
    borderWidth: 3,
    borderColor: colors.primary, // Theme color border
  },
  senderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    marginLeft: 8,
  },
  senderAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  senderInitial: {
    fontSize: fonts.xs,
    fontFamily: fonts.bold,
    color: colors.textWhite,
  },
  // WhatsApp style: Profile picture on left, name and bubble on right
  messageWithSenderContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 1,
  },
  // Left spacing for messages from other users (to align with profile picture position)
  messageWithLeftSpacing: {
    marginLeft: 40, // 32px (avatar width) + 8px (margin) = 40px total
  },
  senderAvatarContainer: {
    marginRight: 8,
    marginTop: 2,
  },
  senderAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.backgroundSecondary,
  },
  senderAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  senderAvatarText: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textWhite,
    fontWeight: '700',
  },
  senderContentContainer: {
    flex: 1,
    flexDirection: 'column',
  },
  senderNameTextAbove: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.primary, // Use theme color for sender names
    fontWeight: '600',
    marginBottom: 0, // Reduced spacing between name and message
    marginLeft: 0,
  },
  // Sender name below message bubble (for group chats) - kept for backward compatibility
  senderNameBelow: {
    marginTop: 2,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  senderNameBelowMy: {
    alignItems: 'flex-end',
    marginRight: 12,
  },
  senderNameBelowOther: {
    alignItems: 'flex-start',
    marginLeft: 12,
  },
  senderNameText: {
    fontSize: 10,
    fontFamily: fonts.medium,
    letterSpacing: 0.2,
  },
  senderNameTextMy: {
    color: colors.textSecondary,
    opacity: 0.8,
  },
  senderNameTextOther: {
    color: colors.primary, // Use theme color for other users' names
    opacity: 0.9,
  },
  messageFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  messageStatusContainer: {
    marginLeft: 4,
    justifyContent: 'center',
    alignItems: 'center',
    width: 16,
    height: 16,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  textInputContainer: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 20,
     paddingHorizontal: 16,
    paddingVertical: 0,
    minHeight: 10,
    // Height range is applied on ComposerMultilineInput (min/max + scroll; avoids per-keystroke layout thrash).
    justifyContent: 'flex-start', // Top alignment for multiline
    overflow: 'hidden', // Ensure content doesn't overflow container
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  // Image message styles
  imageMessageBubble: {
    padding: 0,
    overflow: 'hidden',
  },
  messageImage: {
    width: width * 0.65,
    height: width * 0.65,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
  },
  videoMessageBubble: {
    padding: 0,
    overflow: 'hidden',
  },
  videoContainer: {
    width: width * 0.65,
    maxHeight: width * 0.8,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
    overflow: 'hidden',
  },
  messageVideo: {
    width: '100%',
    height: width * 0.65,
    backgroundColor: colors.backgroundSecondary,
  },
  videoCaption: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  imageCaption: {
    padding: 8,
    marginTop: 4,
  },
  // File message styles
  fileMessageBubble: {
    padding: 12,
  },
  fileMessageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 200,
  },
  fileMessageInfo: {
    marginLeft: 12,
    flex: 1,
  },
  fileMessageName: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    marginBottom: 4,
  },
  fileMessageSize: {
    fontSize: fonts.sm,
    opacity: 0.7,
  },
  loadMoreButton: {
    padding: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  loadMoreText: {
    color: colors.primary,
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
  },
  loadMoreContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreHint: {
    fontSize: fonts.sm,
    color: colors.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  typingIndicator: {
    padding: 8,
    marginLeft: 8,
  },
  typingText: {
    color: colors.textLight,
    fontSize: fonts.sm,
    fontStyle: 'italic',
  },
  // Media Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    paddingTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: fonts.xl,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  modalOption: {
    alignItems: 'center',
    width: '45%',
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  modalOptionIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalOptionText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  modalOptionSubtext: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  modalCancelButton: {
    marginHorizontal: 20,
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  // Read Receipt Modal Styles
  readReceiptModalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  readReceiptModalContent: {
    backgroundColor: colors.background,
    borderRadius: 20,
    width: width * 0.92, // Increased from 0.85 to 0.92 (92% width)
    maxHeight: '85%', // Increased from 70% to 85%
    minHeight: 450, // Increased minimum height for better visibility
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
    overflow: 'hidden', // Ensure content doesn't overflow
    flexDirection: 'column', // Ensure flex layout for proper scrolling
  },
  readReceiptModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  readReceiptModalTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  readReceiptMessagePreview: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: colors.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  readReceiptMessageText: {
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  readReceiptMessageTime: {
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    color: colors.textLight,
    marginTop: 4,
  },
  readReceiptForwardedBy: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  readReceiptForwardedByIcon: {
    marginRight: 6,
  },
  readReceiptForwardedByText: {
    fontSize: fonts.xs,
    fontFamily: fonts.medium,
    color: colors.textLight,
    letterSpacing: 0.2,
  },
  readReceiptForwardedByNameText: {
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    color: colors.textLight,
    opacity: 0.7,
  },
  // Forwarded indicator styles - WhatsApp style
  forwardedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    paddingBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.2)',
  },
  forwardedIndicatorMy: {
    borderBottomColor: 'rgba(255, 255, 255, 0.2)',
  },
  forwardedIndicatorOther: {
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  forwardedIndicatorIcon: {
    marginRight: 4,
    transform: [{ rotate: '0deg' }],
  },
  forwardedIndicatorText: {
    fontSize: fonts.xs,
    fontFamily: fonts.medium,
    letterSpacing: 0.2,
  },
  forwardedIndicatorTextMy: {
    color: colors.textWhite,
    opacity: 0.9,
  },
  forwardedIndicatorTextOther: {
    color: colors.textLight,
    opacity: 0.8,
  },
  forwardedByNameText: {
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    opacity: 0.7,
  },
  forwardedByNameTextMy: {
    color: colors.textWhite,
  },
  forwardedByNameTextOther: {
    color: colors.textLight,
  },
  readReceiptList: {
    flex: 1, // Use flex to take available space
    paddingVertical: 8,
    minHeight: 250, // Increased minimum height for better scrolling
  },
  readReceiptListContent: {
    paddingBottom: 20, // Extra padding at bottom for better scrolling
    paddingTop: 4,
    flexGrow: 1, // Allow content to grow
  },
  readReceiptItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  readReceiptAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  readReceiptAvatarText: {
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textWhite,
  },
  readReceiptItemContent: {
    flex: 1,
  },
  readReceiptItemName: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  readReceiptItemSubtext: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textLight,
    marginBottom: 2,
  },
  readReceiptItemTime: {
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    color: colors.textLight,
    marginTop: 2,
    opacity: 0.8,
  },
  readReceiptEmpty: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readReceiptEmptyText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  readReceiptEmptySubtext: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textLight,
    textAlign: 'center',
  },
  // Voice Recording Styles
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.error,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 8,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textWhite,
    marginRight: 8,
  },
  recordingTime: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textWhite,
    marginRight: 12,
    minWidth: 40,
  },
  cancelRecordingButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  cancelRecordingText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textWhite,
  },
  sendRecordingButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  micButtonRecording: {
    backgroundColor: colors.error,
    transform: [{ scale: 1.1 }],
  },
  // WhatsApp-like Recording Bar Styles
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    minHeight: 56,
  },
  recordingBarTimer: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    minWidth: 50,
    marginRight: 12,
  },
  recordingBarCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  recordingBarSlideContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
  },
  recordingBarSlideText: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  recordingBarReleaseHint: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  recordingBarCancelText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.error,
  },
  recordingBarSendText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  recordingBarLockButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  recordingBarMicButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingBarMicButtonLocked: {
    backgroundColor: colors.success || '#4CAF50',
  },
  // Lock Overlay Styles (for hands-free recording)
  lockOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 100,
  },
  lockOverlayContent: {
    alignItems: 'center',
  },
  lockOverlayLockIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(60, 60, 60, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  lockOverlayText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textWhite,
  },
  // WhatsApp-like Recording Overlay Styles (deprecated - keeping for reference)
  recordingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 120,
  },
  recordingOverlayContent: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    height: 40,
    marginBottom: 16,
    gap: 3,
  },
  waveformBar: {
    width: 3,
    backgroundColor: colors.textWhite,
    borderRadius: 1.5,
    marginHorizontal: 1.5,
  },
  recordingDuration: {
    fontSize: 56,
    fontFamily: fonts.bold,
    color: colors.textWhite,
    marginBottom: 8,
    letterSpacing: 1,
    fontWeight: '600',
  },
  recordingInstruction: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textWhite,
    opacity: 0.9,
    marginTop: 4,
  },
  cancelInstruction: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  cancelInstructionText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.error,
    marginTop: 8,
    fontWeight: '500',
  },
  lockButton: {
    position: 'absolute',
    top: -100,
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(60, 60, 60, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  lockButtonInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(60, 60, 60, 0.9)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  lockedText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textWhite,
    marginLeft: 8,
    fontWeight: '500',
  },
  // Message Action Menu Styles
  messageMenuContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  messageMenuContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
  },
  messageMenuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  messageMenuOptionText: {
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    marginLeft: 16,
  },
  messageMenuCancel: {
    borderBottomWidth: 0,
    justifyContent: 'center',
    marginTop: 8,
  },
  messageMenuCancelText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.error,
    textAlign: 'center',
  },
  // Forward Modal Styles
  forwardModalContainer: {
    flex: 1,
    backgroundColor: colors.background,
    marginTop: 100,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  forwardModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  forwardModalTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  forwardModalSubtitle: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textLight,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  forwardChatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  forwardChatAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  forwardChatAvatarText: {
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textWhite,
  },
  forwardChatInfo: {
    flex: 1,
  },
  forwardChatName: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  forwardChatType: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textLight,
  },
  forwardEmptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  forwardEmptyText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  // Edit Message Modal Styles
  editMessageModalContainer: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
    maxHeight: '80%',
  },
  editMessageModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  editMessageModalTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  editMessageInput: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    margin: 20,
    minHeight: 100,
    maxHeight: 200,
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  editMessageModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    gap: 12,
  },
  editMessageButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  editMessageCancelButton: {
    backgroundColor: colors.backgroundSecondary,
  },
  editMessageSaveButton: {
    backgroundColor: colors.primary,
  },
  editMessageCancelText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  editMessageSaveText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textWhite,
  },
  editMessageSaveButtonDisabled: {
    opacity: 0.5,
  },
  editMessageLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // WhatsApp-like Voice Note Styles
  voiceNoteContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 200,
  },
  voiceNoteContainerMy: {
    justifyContent: 'flex-end',
  },
  voiceNoteAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
    position: 'relative',
  },
  voiceNoteAvatarImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  voiceNoteAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceNoteAvatarText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textWhite,
  },
  voiceNoteMicIcon: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  voiceNotePlayButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  voiceNotePlayButtonMy: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  voiceNotePlayButtonOther: {
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  voiceNoteWaveformContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  voiceNoteWaveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 24,
    marginRight: 8,
    gap: 2,
  },
  voiceNoteWaveformBar: {
    width: 2.5,
    borderRadius: 1.25,
    minHeight: 4,
    maxHeight: 20,
  },
  voiceNoteWaveformBarMy: {
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  voiceNoteWaveformBarOther: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  voiceNoteWaveformBarActive: {
    backgroundColor: colors.textWhite,
    opacity: 1,
  },
  voiceNoteInfo: {
    minWidth: 40,
    alignItems: 'flex-end',
  },
  voiceNoteDuration: {
    fontSize: fonts.xs,
    fontFamily: fonts.medium,
  },
  voiceNoteDurationMy: {
    color: 'rgba(255, 255, 255, 0.9)',
  },
  voiceNoteDurationOther: {
    color: colors.textPrimary,
  },
  // Reply Preview Styles
  replyPreview: {
    flexDirection: 'row',
    marginBottom: 4, // Reduced further for better proportions with short messages
    alignItems: 'center', // Keep icon/name/text vertically centered for short replies
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 5, // Reduced further for compact display
    paddingBottom: 5, // Reduced further for compact display
    borderLeftWidth: 3,
    borderRadius: 6,
    marginHorizontal: 4,
    minHeight: 40, // Slightly higher to fit icon + two lines without clipping
    overflow: 'hidden', // Ensure content doesn't overflow
  },
  replyPreviewIcon: {
    marginRight: 8,
    marginTop: 2,
  },
  replyPreviewMedia: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  replyPreviewThumbnail: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 8,
    backgroundColor: colors.backgroundSecondary,
  },
  replyPreviewAudioThumb: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 8,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeableContainer: {
    position: 'relative',
  },
  replyIconBackground: {
    position: 'absolute',
    left: 10,
    top: '50%',
    marginTop: -12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  replyPreviewMy: {
    borderLeftColor: colors.textWhite,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  replyPreviewOther: {
    borderLeftColor: colors.primary,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  replyPreviewLine: {
    width: 3,
    marginRight: 8,
    borderRadius: 2,
    alignSelf: 'stretch',
    minHeight: 32,
  },
  replyPreviewLineMy: {
    backgroundColor: colors.textWhite,
  },
  replyPreviewLineOther: {
    backgroundColor: colors.primary,
  },
  replyPreviewContent: {
    flex: 1,
    justifyContent: 'center',
  },
  replyPreviewName: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    marginBottom: 1, // Reduced from 2 for tighter spacing
  },
  replyPreviewNameMy: {
    color: colors.textWhite,
    opacity: 0.9,
  },
  replyPreviewNameOther: {
    color: colors.primary,
  },
  replyPreviewText: {
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    lineHeight: 14, // Tighter line height for more compact display
  },
  replyPreviewTextMy: {
    color: colors.textWhite,
    opacity: 0.7,
  },
  replyPreviewTextOther: {
    color: colors.textSecondary,
  },
  replyPreviewBar: {
    backgroundColor: colors.backgroundSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  replyPreviewBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  replyPreviewBarLeft: {
    flexDirection: 'row',
    flex: 1,
    alignItems: 'center',
  },
  replyPreviewBarLine: {
    width: 4,
    height: 40,
    borderRadius: 2,
    marginRight: 8,
  },
  replyPreviewBarLineMy: {
    backgroundColor: colors.primary,
  },
  replyPreviewBarLineOther: {
    backgroundColor: colors.primary,
  },
  replyPreviewBarThumb: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 8,
    backgroundColor: colors.borderLight,
  },
  replyPreviewBarAudioIcon: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 8,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyPreviewBarText: {
    flex: 1,
  },
  replyPreviewBarName: {
    fontSize: fonts.sm,
    fontFamily: fonts.bold,
    color: colors.primary,
    marginBottom: 2,
  },
  replyPreviewBarMessage: {
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  replyPreviewBarClose: {
    padding: 4,
    marginLeft: 8,
  },
  // Media Viewer Modal Styles
  mediaViewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaViewerCloseButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    right: 20,
    zIndex: 1000,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaViewerImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  mediaViewerVideoContainer: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaViewerVideo: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  mediaViewerHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  documentDownloadButton: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  documentActionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  documentActionButton: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  documentErrorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: colors.background,
  },
  documentErrorText: {
    fontSize: fonts.xl,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  documentErrorSubtext: {
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  documentErrorButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  documentErrorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
    gap: 8,
  },
  documentErrorButtonSecondary: {
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  documentErrorButtonText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textWhite,
  },
  documentErrorButtonTextSecondary: {
    color: colors.primary,
  },
  documentAndroidMessage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: colors.background,
  },
  documentAndroidMessageTitle: {
    fontSize: fonts.xl,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  documentAndroidMessageText: {
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 16,
    lineHeight: 22,
  },
  documentAndroidMessageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
    gap: 8,
  },
  documentAndroidMessageButtonText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textWhite,
  },
  mediaViewerDocumentContainer: {
    flex: 1,
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  mediaViewerDocument: {
    flex: 1,
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
    backgroundColor: '#fff',
  },
  documentLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    zIndex: 1,
  },
  documentLoadingText: {
    fontSize: 16,
    color: colors.textPrimary,
    fontFamily: fonts.medium,
    marginTop: 12,
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
});

/**
 * Memoized composer: text state is owned here (controlled), not by ChatDetailScreen.
 * A full-screen re-render on the first character (send vs mic) used to desync iOS
 * UITextView when the input was uncontrolled — symptoms like only "Aaa" or jumbled keys.
 */
const ComposerMultilineInput = memo(
  forwardRef(function ComposerMultilineInput({ placeholder, onChangeText }, ref) {
    const [text, setText] = useState('');
    const inputRef = useRef(null);

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          setText('');
        },
        setNativeProps: (props) => {
          if (props?.text !== undefined) {
            setText(String(props.text));
          }
        },
      }),
      []
    );

    return (
      <TextInput
        ref={inputRef}
        style={[
          styles.textInput,
          {
            minHeight: COMPOSER_INPUT_MIN_HEIGHT,
            maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
          },
        ]}
        placeholder={placeholder}
        placeholderTextColor={colors.textLight}
        value={text}
        onChangeText={(t) => {
          setText(t);
          onChangeText?.(t);
        }}
        multiline
        maxLength={500}
        scrollEnabled
        blurOnSubmit={false}
        returnKeyType="default"
      />
    );
  })
);

export default ChatDetailScreen;