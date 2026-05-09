import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDispatch } from 'react-redux';
import { useAuth } from '../context/AuthContext';
import socketService from '../services/socketService';
import { useGetChatMessagesQuery, useUploadChatMediaMutation } from '../store/api';
import { API_BASE_URL, FILE_BASE_URL } from '../config/apiConfig';
import { patchChatListsForLocalOutgoingMessage } from '../utils/chatListRealtimeCache';

/**
 * Custom hook for managing chat functionality
 * @param {string} enquiryId - The enquiry ID
 * @param {string} chatType - 'admin-client' or 'admin-designer'
 * @param {string} chatId - Optional: Direct chat ID to use (if available, skips search)
 * @param {object} initialChat - Optional: Initial chat object (e.g., routeChat) to use immediately
 * @returns {object} Chat state and methods
 */
export const useChat = (enquiryId, chatType, chatId = null, initialChat = null) => {
  const dispatch = useDispatch();
  const { user } = useAuth();
  // Initialize chat state with initialChat or chatId if provided (for immediate message loading)
  const [chat, setChat] = useState(() => {
    // If we have initialChat with an ID, use it immediately
    if (initialChat && (initialChat._id || initialChat.id)) {
      const chatIdValue = initialChat._id || initialChat.id;
      
      return {
        ...initialChat,
        _id: chatIdValue,
        id: chatIdValue,
      };
    }
    // Otherwise, create minimal chat object with chatId if provided
    if (chatId) {
      
      return {
        _id: chatId,
        id: chatId,
        EnquiryId: enquiryId,
        Type: chatType,
      };
    }
    return null;
  });
  const [messages, setMessages] = useState([]);
  const [isLoadingChat, setIsLoadingChat] = useState(true);
  const [chatError, setChatError] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUser, setTypingUser] = useState(null); // Store typing user info { userId, name, email }
  const typingTimeoutRef = useRef(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const presignCacheRef = useRef(new Map());
  const locallyEditedMessagesRef = useRef(new Map()); // Registry to prevent stale API data from overwriting edits
  const joinedChatsRef = useRef(new Set()); // Track which chats we've already joined to prevent infinite loops

  // Upload media mutation
  const [uploadChatMedia, { isLoading: isUploading }] = useUploadChatMediaMutation();

  const getMediaUrlFromKey = useCallback((mediaKey) => {
    if (!mediaKey) return null;
    if (typeof mediaKey === 'string' && (mediaKey.startsWith('http://') || mediaKey.startsWith('https://'))) {
      return mediaKey;
    }
    // Default to legacy files path; also log alternative in case backend differs
    const legacyUrl = `${FILE_BASE_URL}/api/files/${encodeURIComponent(mediaKey)}`;
    const altUrl = `${FILE_BASE_URL}/api/message/file/${encodeURIComponent(mediaKey)}`;
    if (__DEV__) {
      console.log('[media] built media url from key', { mediaKey, legacyUrl, altUrl });
    }
    return legacyUrl;
  }, []);

  const fetchPresignedUrl = useCallback(async (mediaKey) => {
    if (!mediaKey) return null;
    const cache = presignCacheRef.current;
    if (cache.has(mediaKey)) {
      return cache.get(mediaKey);
    }
    try {
      const token = await AsyncStorage.getItem('token');
      const resp = await fetch(`${API_BASE_URL}/api/enquiries/files/${encodeURIComponent(mediaKey)}`, {
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
        },
      });
      if (!resp.ok) {
        throw new Error(`Presign failed ${resp.status}`);
      }
      const data = await resp.json();
      const url = data?.url;
      if (url) {
        cache.set(mediaKey, url);
        if (__DEV__) {
          console.log('[media] presign success', { mediaKey, url });
        }
        return url;
      }
      throw new Error('No url in presign response');
    } catch (error) {
      if (__DEV__) {
        console.log('[media] presign error', mediaKey, error);
      }
      return null;
    }
  }, [API_BASE_URL]);

  const inferMediaFromName = useCallback((maybeName) => {
    if (!maybeName || typeof maybeName !== 'string') return null;
    const trimmed = maybeName.trim();
    if (!trimmed) return null;
    const looksLikeMedia = /\.(png|jpe?g|gif|webp|bmp|mp4|mov|avi|mkv)$/i.test(trimmed);
    if (!looksLikeMedia) return null;
    const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(trimmed);
    const isVideo = /\.(mp4|mov|avi|mkv)$/i.test(trimmed);
    const inferredType = isImage ? 'image' : (isVideo ? 'video' : 'file');
    const mediaKey = trimmed;
    const mediaUrl = getMediaUrlFromKey(mediaKey);
    if (__DEV__) {
      console.log('[media] inferred from name', { trimmed, mediaKey, mediaUrl, inferredType });
    }
    return {
      mediaKey,
      mediaUrl,
      mediaName: trimmed,
      messageType: inferredType,
    };
  }, [getMediaUrlFromKey]);

  // Ensure mediaUrl is available by fetching presigned URL if needed
  const ensurePresignedUrl = useCallback(async (mediaKey) => {
    if (!mediaKey) return null;
    const existing = presignCacheRef.current.get(mediaKey);
    if (existing) return existing;
    return fetchPresignedUrl(mediaKey);
  }, [fetchPresignedUrl]);
  // Determine chat type based on user role
  const getChatType = useCallback(() => {
    if (!user) return null;
    
    const role = user.role?.toLowerCase();
    
    if (role === 'client') {
      return 'admin-client';
    }
    
    if (role === 'coral' || role === 'cad' || role === 'worker' || role === 'designer') {
      return 'admin-designer';
    }
    
    if (role === 'admin') {
      return chatType || 'admin-client';
    }
    
    return chatType || 'admin-client';
  }, [user, chatType]);

  // Fetch chat by enquiry ID
  const fetchChat = useCallback(async () => {
    if (!enquiryId || !user) {
      
      return;
    }
    
    // Use getChatType() to determine type if chatType is not provided
    const type = chatType || getChatType();
    if (!type) {
      
      return;
    }

    

    setIsLoadingChat(true);
    setChatError(null);

    try {
      const token = await AsyncStorage.getItem('token');

      // If we have a direct chatId, fetch that specific chat first
      if (chatId) {
        try {
          
          const chatResponse = await fetch(`${API_BASE_URL}/api/chats/${chatId}`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          if (chatResponse.ok) {
            const chatData = await chatResponse.json();
            const foundChat = chatData.Data || chatData.data || chatData;
            
            if (foundChat && (foundChat._id || foundChat.id)) {
              const chatIdValue = foundChat._id || foundChat.id;
              
              // Ensure _id is set
              setChat({ ...foundChat, _id: chatIdValue, id: chatIdValue });
              setIsLoadingChat(false);
              return;
            } else {
              
            }
          } else {
            
          }
        } catch (chatIdError) {
          
        }
      }

      // Search for chat by enquiry ID
      const searchParams = new URLSearchParams({
        type: type,
        search: enquiryId,
        limit: '50',
      });

      

      const response = await fetch(`${API_BASE_URL}/api/chats?${searchParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        const chats = result.Data || result.data || result;
        
        if (__DEV__) {
          console.log('📋 Chats search result:', { 
            chatsCount: Array.isArray(chats) ? chats.length : 'not array',
            chats: Array.isArray(chats) ? chats.map(c => ({ id: c._id || c.id, type: c.Type || c.type })) : chats
          });
        }
        
        let foundChat = null;
        
        // Try to find by chatId first
        if (chatId && Array.isArray(chats)) {
          foundChat = chats.find(chat => {
            const cId = chat._id || chat.id;
            return String(cId).trim() === String(chatId).trim();
          });
          if (foundChat && __DEV__) {
          }
        }
        
        // Fallback to finding by enquiryId
        if (!foundChat && Array.isArray(chats)) {
          foundChat = chats.find(chat => {
            const chatEnquiryId = chat.EnquiryId || chat.enquiryId;
            const chatTypeValue = chat.Type || chat.type;
            return String(chatEnquiryId).trim() === String(enquiryId).trim() &&
                   String(chatTypeValue).trim() === String(type).trim();
          });
          if (foundChat && __DEV__) {
          }
        }

        if (foundChat) {
          const chatIdValue = foundChat._id || foundChat.id;
          
          // Ensure _id is set
          setChat({ ...foundChat, _id: chatIdValue, id: chatIdValue });
          setIsLoadingChat(false);
          return;
        } else {
          
        }
      } else {
        
      }

      // Create virtual chat if not found (but only if we have a chatId)
      // Without a real chatId, we can't load messages anyway
      if (chatId) {
        
        const virtualChat = {
          _id: chatId,
          id: chatId,
          EnquiryId: enquiryId,
          EnquiryName: 'New Chat',
          Type: type,
          CreatedAt: new Date().toISOString(),
        };
        setChat(virtualChat);
        setChatError(null);
      } else {
        
        setChat(null);
        setChatError('Chat not found and no chatId provided');
      }
      
    } catch (error) {
      
      // Only create fallback if we have a chatId
      if (chatId) {
        const fallbackChat = {
          _id: chatId,
          id: chatId,
          EnquiryId: enquiryId,
          EnquiryName: 'Chat',
          Type: type,
          CreatedAt: new Date().toISOString(),
        };
        setChat(fallbackChat);
      } else {
        setChat(null);
      }
      setChatError(error.message || 'Failed to fetch chat');
    } finally {
      setIsLoadingChat(false);
    }
  }, [enquiryId, user, chatId, chatType, getChatType]);

  // Load messages from API - RTK Query handles caching automatically
  // Use both _id and id to handle different response formats
  // Also use chatId parameter directly if chat state isn't ready yet (for immediate loading)
  const chatIdForQuery = chat?._id || chat?.id || chatId || (initialChat?._id || initialChat?.id);
  
  // Track recent edits to prevent auto-refetch from overwriting them
  const recentEditTimeRef = useRef(0);
  
  const { data: apiMessages, isLoading: messagesLoading, refetch: refetchMessages, error: messagesError } = useGetChatMessagesQuery(
    { chatId: chatIdForQuery, limit: 20 },
    {
      skip: !chatIdForQuery,
      refetchOnFocus: false, // Disabled - we handle refetch manually to prevent overwriting edits
      refetchOnMountOrArgChange: true, // Refetch when chatId changes
    }
  );

  // Debug logging for messages query
  useEffect(() => {
    if (__DEV__) {
      console.log('📨 Messages Query State:', {
        chatId: chatIdForQuery,
        chatIdForQuery,
        chatHasId: !!chat?._id,
        chatHasIdAlt: !!chat?.id,
        skip: !chatIdForQuery,
        isLoading: messagesLoading,
        messagesCount: apiMessages?.length || 0,
        error: messagesError ? { message: messagesError.message, data: messagesError.data } : null,
      });
    }
  }, [chatIdForQuery, messagesLoading, apiMessages?.length, messagesError]);

  const refetchMessagesRef = useRef(refetchMessages);
  useEffect(() => {
    refetchMessagesRef.current = refetchMessages;
  }, [refetchMessages]);

  // Track last processed API messages to prevent unnecessary updates
  const lastApiMessagesRef = useRef(null);
  const lastChatIdRef = useRef(null);
  const messagesRef = useRef(messages); // Store latest messages in ref to avoid dependency issues
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  
  // SIMPLIFIED: Always show messages when API provides them
  useEffect(() => {
    const now = Date.now();
    const applyLocalEditOverride = (message) => {
      if (!message) return message;
      const id = message._id || message.id;
      if (!id) return message;
      const idStr = String(id);
      const localEdit = locallyEditedMessagesRef.current.get(idStr);
      if (localEdit) {
        if (now - localEdit.timestamp >= 60000) {
          locallyEditedMessagesRef.current.delete(idStr);
        } else {
          return {
            ...message,
            Message: localEdit.text,
            message: localEdit.text,
            text: localEdit.text,
            IsEdited: true,
            isEdited: true,
            _locallyEdited: true,
            _editTimestamp: localEdit.timestamp,
          };
        }
      }
      if (message.IsEdited || message.isEdited) {
        return {
          ...message,
          _locallyEdited: true,
          _editTimestamp: message._editTimestamp || now,
        };
      }
      return message;
    };

    // Debug logging
    if (__DEV__) {
      console.log('🔍 Message Effect Trigger:', {
        chatId: chatIdForQuery,
        chatIdForQuery,
        apiMessagesType: typeof apiMessages,
        apiMessagesIsArray: Array.isArray(apiMessages),
        apiMessagesLength: apiMessages?.length || 0,
        currentMessagesLength: messages.length,
        messagesLoading,
        lastChatId: lastChatIdRef.current,
        lastApiIds: lastApiMessagesRef.current?.substring(0, 50),
      });
    }

    if (!chatIdForQuery) {
      if (messages.length > 0) {
        setMessages([]);
      }
      lastChatIdRef.current = null;
      lastApiMessagesRef.current = null;
      return;
    }

    // Track chat changes
    const chatChanged = lastChatIdRef.current !== chatIdForQuery;
    if (chatChanged) {
      lastChatIdRef.current = chatIdForQuery;
      lastApiMessagesRef.current = null; // Always reset on chat change
      
    }

    // Process API messages - SIMPLIFIED LOGIC
    if (apiMessages && Array.isArray(apiMessages)) {
      const apiMessagesIds = apiMessages.length > 0
        ? apiMessages.map(msg => msg._id || msg.id).filter(Boolean).join(',')
        : 'empty';
      
      // Check if we have locally edited messages that should be preserved
      const hasLocallyEditedMessages = messages.some(msg => {
        const id = msg._id || msg.id;
        if (!id) return false;
        const isLocallyEdited = msg._locallyEdited || 
                               (msg.IsEdited && msg._editTimestamp && 
                                (Date.now() - msg._editTimestamp) < 300000);
        return isLocallyEdited;
      });
      
      // Check time since last edit (from ref or messages)
      const editTimestamps = messages.filter(m => m._editTimestamp).map(m => m._editTimestamp || 0);
      const lastEditTime = editTimestamps.length > 0 ? Math.max(...editTimestamps) : recentEditTimeRef.current;
      const timeSinceLastEdit = Date.now() - lastEditTime;
      
      // ALWAYS update if:
      // - Chat changed
      // - Messages are empty  
      // - API messages IDs changed (new messages added/removed)
      // BUT: If we have locally edited messages and API IDs haven't changed, 
      // skip update if it's been less than 3 seconds since last edit (to allow backend to persist)
      const apiIdsChanged = apiMessagesIds !== lastApiMessagesRef.current;
      const shouldSkipDueToRecentEdit = hasLocallyEditedMessages && !apiIdsChanged && timeSinceLastEdit < 3000;
      
      const shouldUpdate = chatChanged || 
                          messages.length === 0 || 
                          (apiIdsChanged && !shouldSkipDueToRecentEdit);
      
      if (__DEV__ && shouldSkipDueToRecentEdit) {
        console.log('⏸️ [useChat] Skipping API update - recent edit detected:', {
          timeSinceEdit: Math.round(timeSinceLastEdit / 1000) + 's',
          hasLocallyEditedMessages,
          apiIdsChanged,
        });
      }
      
      // Update lastApiMessagesRef to prevent repeated checks
      // If we're skipping due to recent edit but IDs haven't changed, mark as processed to prevent repeated checks
      // Otherwise, only mark as processed if we're actually updating
      if (shouldUpdate || (!apiIdsChanged && shouldSkipDueToRecentEdit)) {
        // Mark API messages as processed
        lastApiMessagesRef.current = apiMessagesIds;
      }
      
      if (shouldUpdate) {
        if (__DEV__) {
          console.log('✅ UPDATING MESSAGES:', {
            apiCount: apiMessages.length,
            currentCount: messages.length,
            reason: chatChanged ? 'chat changed' : messages.length === 0 ? 'empty state' : 'api changed',
            firstMessage: apiMessages[0] || null,
            timeSinceLastEdit: recentEditTimeRef.current > 0 ? Math.round((Date.now() - recentEditTimeRef.current) / 1000) + 's' : 'none',
          });
        }

        setMessages(prevMessages => {
          const messageMap = new Map();
          
          // Log prevMessages for debugging
          if (__DEV__) {
            const optimisticAudio = prevMessages.filter(m => {
              const id = m._id || m.id;
              return id && String(id).startsWith('temp-') && (m.messageType === 'audio' || m.MessageType === 'audio');
            });
            if (optimisticAudio.length > 0) {
              console.log('🎵 [useChat] prevMessages contains optimistic audio:', {
                count: optimisticAudio.length,
                messages: optimisticAudio.map(m => ({
                  id: m._id || m.id,
                  mediaKey: m.mediaKey || m.MediaKey,
                  status: m.status,
                })),
              });
            }
          }
          
          // Add existing messages first to preserve their status
          // CRITICAL: Preserve locally edited messages - don't let API overwrite them
          prevMessages.forEach(msg => {
            const id = msg._id || msg.id;
            if (id) {
              messageMap.set(id, applyLocalEditOverride(msg));
            }
          });
          
          // Merge ReadBy arrays - preserve object structure with timestamps
          // Handle both formats: array of objects [{userId, readAt}] or array of IDs ['id1', 'id2']
          const mergeReadBy = (existing, api) => {
            const mergedMap = new Map();
            
            // Process existing ReadBy
            existing.forEach(item => {
              if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                // Object format: { userId: '123', readAt: '...' }
                const userId = String(item.userId || item.user_id || item.id || item.UserId || item.Id || '').trim();
                if (userId) {
                  mergedMap.set(userId, item); // Preserve full object
                }
              } else {
                // ID format: '123' or 123
                const userId = String(item).trim();
                if (userId) {
                  // Convert to object format if not already
                  mergedMap.set(userId, { userId, readAt: null });
                }
              }
            });
            
            // Process API ReadBy (prefer API data as it's more up-to-date)
            api.forEach(item => {
              if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                // Object format: { userId: '123', readAt: '...' }
                const userId = String(item.userId || item.user_id || item.id || item.UserId || item.Id || '').trim();
                if (userId) {
                  mergedMap.set(userId, item); // Overwrite with API data (newer)
                }
              } else {
                // ID format: '123' or 123
                const userId = String(item).trim();
                if (userId) {
                  // Only add if not already present (preserve existing object with timestamp)
                  if (!mergedMap.has(userId)) {
                    mergedMap.set(userId, { userId, readAt: null });
                  }
                }
              }
            });
            
            return Array.from(mergedMap.values());
          };
          
          // Log all API messages to check for audio
          if (__DEV__) {
            const audioMessages = apiMessages.filter(m => m.MessageType === 'audio' || m.messageType === 'audio');
            if (audioMessages.length > 0) {
              console.log('🎵 [useChat] API returned audio messages:', {
                count: audioMessages.length,
                messages: audioMessages.map(m => ({
                  id: m._id || m.id,
                  mediaKey: m.MediaKey || m.mediaKey,
                  audioDuration: m.audioDuration || m.AudioDuration,
                })),
              });
            } else {
              console.log('🎵 [useChat] ⚠️ API returned NO audio messages (total messages:', apiMessages.length, ')');
            }
          }
          
          // Update with API messages (but preserve status if message already exists)
          apiMessages.forEach(msg => {
            const id = msg._id || msg.id;
            if (id && !String(id).startsWith('temp-')) {
              const existingMsg = messageMap.get(id);
              
              // Also check for optimistic messages with matching mediaKey (for media messages)
              if (!existingMsg) {
                const msgMediaKey = msg.MediaKey || msg.mediaKey;
                if (msgMediaKey) {
                  // Find optimistic message with matching mediaKey
                  for (const [mapId, mapMsg] of messageMap.entries()) {
                    if (String(mapId).startsWith('temp-')) {
                      const mapMediaKey = mapMsg.mediaKey || mapMsg.MediaKey;
                      const mapSenderId = mapMsg.SenderId || mapMsg.senderId;
                      const msgSenderId = msg.SenderId || msg.senderId;
                      
                      if (__DEV__ && (msg.MessageType === 'audio' || msg.messageType === 'audio')) {
                        console.log('🎵 [useChat] Checking optimistic match:', {
                          apiMediaKey: msgMediaKey,
                          optimisticMediaKey: mapMediaKey,
                          apiSenderId: msgSenderId,
                          optimisticSenderId: mapSenderId,
                          matches: mapMediaKey && String(mapMediaKey) === String(msgMediaKey) &&
                                   String(mapSenderId) === String(msgSenderId),
                        });
                      }
                      
                      if (mapMediaKey && String(mapMediaKey) === String(msgMediaKey) &&
                          String(mapSenderId) === String(msgSenderId)) {
                        // Found matching optimistic message - use it as existingMsg
                        const optimisticMsg = mapMsg;
                        messageMap.delete(mapId); // Remove optimistic from map
                        
                        // Merge with API message
                        const mergedReadBy = mergeReadBy(optimisticMsg.ReadBy || optimisticMsg.readBy || [], msg.ReadBy || msg.readBy || []);
                        const calculatedStatus = optimisticMsg.status || 'sent';
                        
                        messageMap.set(id, {
                          ...msg, // API data (newer)
                          ...optimisticMsg, // Preserve optimistic updates
                          ReadBy: mergedReadBy,
                          readBy: mergedReadBy,
                          status: calculatedStatus,
                          audioDuration: msg.audioDuration || msg.AudioDuration || optimisticMsg.audioDuration || optimisticMsg.AudioDuration,
                        });
                        
                        if (__DEV__ && (msg.MessageType === 'audio' || msg.messageType === 'audio')) {
                          console.log('🎵 [useChat] ✅ Replaced optimistic audio message with API message:', {
                            optimisticId: mapId,
                            realId: id,
                            mediaKey: msgMediaKey,
                            audioDuration: msg.audioDuration || msg.AudioDuration,
                          });
                        }
                        
                        return; // Skip normal processing
                      }
                    }
                  }
                }
              }
              
              if (existingMsg) {
                // Message already exists - merge carefully to preserve status
                // CRITICAL: If message was locally edited, preserve the edited text even if API returns old data
                // Extended timeout to 5 minutes to handle cases where backend takes time to persist
                // Also check if message text differs from API (indicates local edit that hasn't been persisted yet)
                const hasEditTimestamp = existingMsg._editTimestamp && (Date.now() - existingMsg._editTimestamp) < 300000;
                const hasLocalEditFlag = existingMsg._locallyEdited === true;
                const hasIsEditedFlag = existingMsg.IsEdited || existingMsg.isEdited;
                const textDiffers = existingMsg.Message !== msg.Message || 
                                   existingMsg.message !== msg.message || 
                                   existingMsg.text !== msg.text;
                
                // Consider locally edited if:
                // 1. Explicitly marked as locally edited, OR
                // 2. Has IsEdited flag AND edit timestamp within 5 minutes, OR
                // 3. Text differs from API AND has IsEdited flag (indicates unsaved edit)
                const isLocallyEdited = hasLocalEditFlag || 
                                       (hasIsEditedFlag && hasEditTimestamp) ||
                                       (hasIsEditedFlag && textDiffers && hasEditTimestamp);
                
                // Also check if message was locally deleted
                const isLocallyDeleted = existingMsg._locallyDeleted || 
                                        (existingMsg.IsDeleted && existingMsg._deleteTimestamp && 
                                         (Date.now() - existingMsg._deleteTimestamp) < 300000); // Deleted within last 5 minutes
                
                // Only update ReadBy if API has newer/more complete data
                const existingReadBy = existingMsg.ReadBy || existingMsg.readBy || [];
                const apiReadBy = msg.ReadBy || msg.readBy || [];
                
                const mergedReadBy = mergeReadBy(existingReadBy, apiReadBy);
                
                // Calculate status independently for this message
                const senderId = msg.SenderId || msg.senderId;
                const isMyMessage = user && String(senderId).trim() === String(user.id).trim();
                let calculatedStatus = existingMsg.status || 'sent';
                
                if (isMyMessage) {
                  const senderIdStr = String(senderId).trim();
                  const userIdStr = String(user.id).trim();
                  
                  // Check if ReadBy contains anyone OTHER than the sender
                  // Handle both object and ID formats
                  const otherReaders = mergedReadBy.filter(item => {
                    const readerId = typeof item === 'object' && item !== null
                      ? String(item.userId || item.user_id || item.id || item.UserId || item.Id || '').trim()
                      : String(item).trim();
                    return readerId !== senderIdStr && 
                           readerId !== userIdStr && 
                           readerId !== '';
                  });
                  
                  if (otherReaders.length > 0) {
                    calculatedStatus = 'read';
                  } else {
                    // No other readers - keep as 'sent' (unless it's sending/failed)
                    calculatedStatus = existingMsg.status === 'sending' || existingMsg.status === 'failed' 
                      ? existingMsg.status 
                      : 'sent';
                  }
                }
                
                // Merge message data but preserve calculated status and ReplyTo
                // Preserve ReplyTo from API if it exists (it might be more complete)
                const apiReplyTo = msg.ReplyTo || msg.replyTo || msg.ParentMessageId || msg.parentMessageId;
                const existingReplyTo = existingMsg.ReplyTo || existingMsg.replyTo || existingMsg.ParentMessageId || existingMsg.parentMessageId;
                const finalReplyTo = apiReplyTo || existingReplyTo;
                
                // If locally edited, preserve the edited message text and IsEdited flag
                // Always use the existing message text (which has the edit) over API text
                const preservedMessage = isLocallyEdited ? {
                  Message: existingMsg.Message || existingMsg.message || existingMsg.text || msg.Message || msg.message || msg.text || '',
                  message: existingMsg.Message || existingMsg.message || existingMsg.text || msg.Message || msg.message || msg.text || '',
                  text: existingMsg.Message || existingMsg.message || existingMsg.text || msg.Message || msg.message || msg.text || '',
                  IsEdited: true,
                  isEdited: true,
                } : {};
                
                // If locally deleted, preserve the deleted state
                const preservedDelete = isLocallyDeleted ? {
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
                } : {};
                
                // Merge order is critical: API data first, then existing (optimistic), then preserved (local edits)
                // This ensures locally edited text always wins over API data
                messageMap.set(id, {
                  ...msg, // API data (base)
                  ...existingMsg, // Preserve optimistic updates (status, etc.)
                  // CRITICAL: Preserved message must come last to override API data
                  ...(isLocallyEdited ? preservedMessage : {}), // Override with locally edited text if applicable
                  ...(isLocallyDeleted ? preservedDelete : {}), // Override with locally deleted state if applicable
                  ReadBy: mergedReadBy,
                  readBy: mergedReadBy,
                  status: calculatedStatus, // Use calculated status
                  // Preserve ReplyTo from API (more reliable) or keep existing
                  ReplyTo: finalReplyTo,
                  replyTo: finalReplyTo,
                  ParentMessageId: finalReplyTo,
                  parentMessageId: finalReplyTo,
                  // Preserve audioDuration from either source
                  audioDuration: msg.audioDuration || msg.AudioDuration || existingMsg.audioDuration || existingMsg.AudioDuration,
                  // CRITICAL: Always preserve edit/delete timestamps and flags
                  _editTimestamp: existingMsg._editTimestamp || msg._editTimestamp,
                  _locallyEdited: isLocallyEdited || existingMsg._locallyEdited || false,
                  _deleteTimestamp: existingMsg._deleteTimestamp || msg._deleteTimestamp,
                  _locallyDeleted: isLocallyDeleted || existingMsg._locallyDeleted || false,
                });
                
                if (__DEV__) {
                  if (isLocallyEdited) {
                    console.log('✏️ [useChat] Preserved locally edited message text:', {
                      messageId: id,
                      editedText: preservedMessage.Message?.substring(0, 50),
                      apiText: msg.Message?.substring(0, 50),
                      existingText: existingMsg.Message?.substring(0, 50),
                      timeSinceEdit: existingMsg._editTimestamp ? Math.round((Date.now() - existingMsg._editTimestamp) / 1000) + 's' : 'unknown',
                      hasLocalEditFlag: hasLocalEditFlag,
                      hasIsEditedFlag: hasIsEditedFlag,
                      hasEditTimestamp: hasEditTimestamp,
                      textDiffers: textDiffers,
                      isLocallyEdited: isLocallyEdited,
                    });
                  } else if (hasIsEditedFlag && textDiffers) {
                    console.warn('⚠️ [useChat] Message has IsEdited flag but not marked as locally edited:', {
                      messageId: id,
                      existingText: existingMsg.Message?.substring(0, 50),
                      apiText: msg.Message?.substring(0, 50),
                      hasLocalEditFlag: hasLocalEditFlag,
                      hasEditTimestamp: hasEditTimestamp,
                      editTimestampAge: existingMsg._editTimestamp ? Math.round((Date.now() - existingMsg._editTimestamp) / 1000) + 's' : 'none',
                    });
                  }
                  if (isLocallyDeleted) {
                    console.log('🗑️ [useChat] Preserved locally deleted message state:', {
                      messageId: id,
                      timeSinceDelete: existingMsg._deleteTimestamp ? Math.round((Date.now() - existingMsg._deleteTimestamp) / 1000) : 'unknown',
                    });
                  }
                }
              } else {
                // New message from API - add it
                // Log audio messages for debugging
                if (msg.MessageType === 'audio' || msg.messageType === 'audio') {
                  if (__DEV__) {
                    console.log('🎵 [useChat] Audio message from API:', {
                      id: msg._id || msg.id,
                      messageType: msg.MessageType || msg.messageType,
                      mediaKey: msg.MediaKey || msg.mediaKey,
                      mediaUrl: msg.MediaUrl || msg.mediaUrl,
                      mediaName: msg.MediaName || msg.mediaName,
                      audioDuration: msg.audioDuration || msg.AudioDuration,
                      senderId: msg.SenderId || msg.senderId,
                      timestamp: msg.Timestamp || msg.timestamp,
                    });
                  }
                }
                messageMap.set(id, {
                  ...msg,
                  // Ensure audioDuration is included
                  audioDuration: msg.audioDuration || msg.AudioDuration,
                });
              }
            }
          });

          // Keep optimistic messages (temp-*)
          prevMessages.forEach(msg => {
            const id = msg._id || msg.id;
            if (id && String(id).startsWith('temp-')) {
              // Check if this optimistic message was already replaced
              const wasReplaced = Array.from(messageMap.values()).some(m => {
                const mId = m._id || m.id;
                // If we have a real message with matching mediaKey, the optimistic was replaced
                if (!String(mId).startsWith('temp-')) {
                  const msgMediaKey = msg.mediaKey || msg.MediaKey;
                  const mMediaKey = m.mediaKey || m.MediaKey;
                  if (msgMediaKey && mMediaKey && String(msgMediaKey) === String(mMediaKey)) {
                    const msgSenderId = msg.SenderId || msg.senderId;
                    const mSenderId = m.SenderId || m.senderId;
                    if (String(msgSenderId) === String(mSenderId)) {
                      return true; // Was replaced
                    }
                  }
                }
                return false;
              });
              
              if (!wasReplaced) {
                messageMap.set(id, msg); // Keep optimistic if not replaced
                
                // Log audio optimistic messages being kept
                if (__DEV__ && (msg.messageType === 'audio' || msg.MessageType === 'audio')) {
                  console.log('🎵 [useChat] Keeping optimistic audio message (not in API yet):', {
                    optimisticId: id,
                    mediaKey: msg.mediaKey || msg.MediaKey,
                    audioDuration: msg.audioDuration || msg.AudioDuration,
                    status: msg.status,
                  });
                }
              } else if (__DEV__ && (msg.messageType === 'audio' || msg.MessageType === 'audio')) {
                console.log('🎵 [useChat] Optimistic audio message was already replaced:', {
                  optimisticId: id,
                  mediaKey: msg.mediaKey || msg.MediaKey,
                });
              }
            }
          });
          
          const merged = Array.from(messageMap.values()).sort((a, b) => {
            const timeA = new Date(a.Timestamp || a.timestamp || 0);
            const timeB = new Date(b.Timestamp || b.timestamp || 0);
            return timeA - timeB;
          });
          const mergedWithLocalEdits = merged.map(msg => applyLocalEditOverride(msg));
          
          return mergedWithLocalEdits;
        });
        
        lastApiMessagesRef.current = apiMessagesIds;
        
        // Set cursor
        if (apiMessages[0]?._nextCursor !== undefined) {
          setNextCursor(apiMessages[0]._nextCursor || null);
        } else if (apiMessages.length > 0) {
          const timestamp = apiMessages[0].Timestamp || apiMessages[0].timestamp;
          if (timestamp) setNextCursor(timestamp);
          else setNextCursor(null);
        } else {
          setNextCursor(null);
        }
      } else {
        
      }
    } else if (Array.isArray(apiMessages) && apiMessages.length === 0) {
      // Empty response - only clear temp messages
      if (lastApiMessagesRef.current !== 'empty') {
        setMessages(prev => prev.filter(msg => {
          const id = msg._id || msg.id;
          return !id || !String(id).startsWith('temp-');
        }));
        lastApiMessagesRef.current = 'empty';
        setNextCursor(null);
      }
    }
  }, [apiMessages, chatIdForQuery]);

  // Socket connection and event handlers
  // CRITICAL: Only depend on chatIdForQuery and user.id, NOT messages
  // Adding messages to dependencies causes infinite loop (messages change -> useEffect runs -> joinChat -> messages update -> loop)
  useEffect(() => {
    if (!chatIdForQuery || !user) return;

    // Check if we've already joined this chat to prevent infinite loops
    const chatKey = `${chatIdForQuery}_${user.id}`;
    if (joinedChatsRef.current.has(chatKey)) {
      if (__DEV__) {
        console.log('🔌 [useChat] Already joined this chat, skipping:', { chatId: chatIdForQuery });
      }
      return;
    }

    const setupSocket = async () => {
      if (!socketService.isConnected()) {
        try {
          await socketService.connect(user.id);
        } catch (err) {
          if (__DEV__) {
            console.error('❌ [useChat] Socket connection error:', err);
          }
        }
      }

      if (socketService.isConnected() && chatIdForQuery) {
        // Backend joinChat marks all messages in this chat read for this user and emits messagesRead.
        if (__DEV__) {
          console.log('🔌 [useChat] Joining chat room', {
            chatId: chatIdForQuery,
            userId: user.id,
          });
        }
        socketService.joinChat(chatIdForQuery, user.id);
        // Mark as joined to prevent duplicate joins
        joinedChatsRef.current.add(chatKey);
      }
    };

    setupSocket();

    const handleNewMessage = (message) => {
      const messageChatId = String(message.ChatId || message.chatId || message.EnquiryId || message.enquiryId || '').trim();
      const currentChatId = String(chatIdForQuery || '').trim();
      
      // Log audio messages received via WebSocket
      if (__DEV__ && (message.MessageType === 'audio' || message.messageType === 'audio')) {
        console.log('🎵 [useChat] WebSocket received audio message:', {
          messageId: message._id || message.id,
          chatId: messageChatId,
          currentChatId: currentChatId,
          matches: messageChatId === currentChatId,
          mediaKey: message.MediaKey || message.mediaKey,
          audioDuration: message.audioDuration || message.AudioDuration,
        });
      }
      
      if (messageChatId !== currentChatId) {
        return;
      }

      // Normalize message format
        const senderId = message.SenderId || message.senderId;
        const readByArray = message.ReadBy || message.readBy || message.read_by || [];
        const isReadFlag = message.IsRead || message.isRead || false;
        let statusValue = message.status || 'sent';
        
        // CRITICAL: Only mark as "read" if someone OTHER than the sender has read it
        // If this is my message, check if others have read it
        if (user && String(senderId) === String(user.id)) {
          const senderIdStr = String(senderId).trim();
          const userIdStr = String(user.id).trim();
          
          // Check ReadBy array - must contain at least one ID that is NOT the sender
          // Handle both object format [{userId, readAt}] and ID format ['id1', 'id2']
          let hasReadByOthers = false;
          if (Array.isArray(readByArray) && readByArray.length > 0) {
            // Filter out the sender's ID and check if any OTHER users have read it
            const otherReaders = readByArray.filter(item => {
              // Extract userId from object or use item directly if it's an ID
              const readerId = typeof item === 'object' && item !== null && !Array.isArray(item)
                ? String(item.userId || item.user_id || item.id || item.UserId || item.Id || '').trim()
                : String(item).trim();
              return readerId !== senderIdStr && 
                     readerId !== userIdStr && 
                     readerId !== '';
            });
            hasReadByOthers = otherReaders.length > 0;
          }
          
          // IMPORTANT: Don't trust isReadFlag alone - verify ReadBy contains others
          // Only mark as "read" if we have confirmed that others have read it
          if (hasReadByOthers) {
            statusValue = 'read';
          } else {
            // Default to 'sent' - NOT 'read' unless confirmed
            statusValue = statusValue === 'sending' || statusValue === 'failed' ? statusValue : 'sent';
          }
        }

        const normalizedMessage = {
          _id: message._id || message.id,
          id: message._id || message.id,
          Message: message.Message || message.message || message.text || '',
          message: message.Message || message.message || message.text || '',
          text: message.Message || message.message || message.text || '',
          SenderId: message.SenderId || message.senderId,
          senderId: message.SenderId || message.senderId,
          SenderName: message.SenderId?.Name || message.sender?.name,
          senderName: message.Sender || message.sender,
          SenderRole: message.SenderRole || message.senderRole,
          senderRole: message.SenderRole || message.senderRole,
          Timestamp: message.Timestamp || message.timestamp,
          timestamp: message.Timestamp || message.timestamp,
          MessageType: message.MessageType || message.messageType || 'text',
          messageType: message.MessageType || message.messageType || 'text',
          IsRead: message.IsRead || message.isRead || false,
          isRead: message.IsRead || message.isRead || false,
        Media: message.Media || message.media,
        media: message.Media || message.media,
        MediaKey: message.MediaKey || message.mediaKey || message.media?.key,
        mediaKey: message.MediaKey || message.mediaKey || message.media?.key,
        MediaUrl: message.MediaUrl || message.mediaUrl || message.media?.url,
        mediaUrl: message.MediaUrl || message.mediaUrl || message.media?.url,
        MediaName: message.MediaName || message.mediaName || message.media?.name,
        mediaName: message.MediaName || message.mediaName || message.media?.name,
        ReadBy: readByArray,
        readBy: readByArray,
          ReplyTo: message.ReplyTo || message.replyTo || message.ParentMessageId || message.parentMessageId || null,
          replyTo: message.ReplyTo || message.replyTo || message.ParentMessageId || message.parentMessageId || null,
          ChatId: messageChatId,
          chatId: messageChatId,
        status: statusValue,
        // Include audio duration if present
        ...(message.audioDuration && { audioDuration: message.audioDuration }),
        ...(message.AudioDuration && { audioDuration: message.AudioDuration }),
        };

        // Log audio messages for debugging
        if (normalizedMessage.messageType === 'audio') {
          if (__DEV__) {
            console.log('🎵 [useChat] Audio message received:', {
              id: normalizedMessage.id,
              messageType: normalizedMessage.messageType,
              mediaKey: normalizedMessage.mediaKey,
              mediaUrl: normalizedMessage.mediaUrl,
              mediaName: normalizedMessage.mediaName,
              audioDuration: normalizedMessage.audioDuration || message.audioDuration || message.AudioDuration,
              senderId: normalizedMessage.senderId,
              timestamp: normalizedMessage.timestamp,
            });
          }
        }

        // Infer media info if missing but looks like a media filename
        if ((normalizedMessage.messageType === 'image' || normalizedMessage.messageType === 'video' || normalizedMessage.messageType === 'file' || normalizedMessage.messageType === 'audio') &&
            (!normalizedMessage.mediaKey || !normalizedMessage.mediaUrl)) {
          const inferred = inferMediaFromName(
            normalizedMessage.mediaName ||
            normalizedMessage.MediaName ||
            normalizedMessage.Message ||
            normalizedMessage.message
          );
          if (inferred) {
            normalizedMessage.mediaKey = normalizedMessage.mediaKey || inferred.mediaKey;
            normalizedMessage.MediaKey = normalizedMessage.MediaKey || inferred.mediaKey;
            normalizedMessage.mediaUrl = normalizedMessage.mediaUrl || inferred.mediaUrl;
            normalizedMessage.MediaUrl = normalizedMessage.MediaUrl || inferred.mediaUrl;
            normalizedMessage.mediaName = normalizedMessage.mediaName || inferred.mediaName;
            normalizedMessage.MediaName = normalizedMessage.MediaName || inferred.mediaName;
            if (!normalizedMessage.messageType || normalizedMessage.messageType === 'text') {
              normalizedMessage.messageType = inferred.messageType || normalizedMessage.messageType;
              normalizedMessage.MessageType = inferred.messageType || normalizedMessage.MessageType;
            }
          }
        }

        // If we still have mediaKey but no mediaUrl, try to presign asynchronously
        if (normalizedMessage.mediaKey && !normalizedMessage.mediaUrl) {
          ensurePresignedUrl(normalizedMessage.mediaKey).then((url) => {
            if (url) {
              setMessages(prev => prev.map(msg => {
                const msgId = msg._id || msg.id;
                if (msgId === (normalizedMessage._id || normalizedMessage.id)) {
                  return {
                    ...msg,
                    mediaUrl: url,
                    MediaUrl: url,
                  };
                }
                return msg;
              }));
            }
          });
        }

        setMessages(prev => {
          const newMsgId = normalizedMessage._id || normalizedMessage.id;
          
        if (!newMsgId) {
          return prev; // Invalid message, skip
        }

        // Check if message already exists (by ID)
          const existingIndex = prev.findIndex(msg => {
            const msgId = msg._id || msg.id;
          return String(msgId) === String(newMsgId);
          });
          
          if (existingIndex !== -1) {
          // Update existing message (WebSocket might have newer data)
          return prev.map((msg, index) => 
            index === existingIndex ? normalizedMessage : msg
          );
        }
        
        // Check for optimistic message to replace
          // Match by message content, sender, and if it's a reply, also match by replyTo
          // For media messages (image, video, audio, file), also match by mediaKey
          const optimisticIndex = prev.findIndex(msg => {
            const msgId = msg._id || msg.id;
            if (!String(msgId).startsWith('temp-')) return false;
            
            // Check sender matches
            if (String(msg.SenderId) !== String(normalizedMessage.SenderId)) return false;
            
            // For media messages, match by mediaKey instead of Message text
            const isMediaMessage = (msg.messageType === 'image' || msg.messageType === 'video' || 
                                   msg.messageType === 'audio' || msg.messageType === 'file' ||
                                   normalizedMessage.messageType === 'image' || normalizedMessage.messageType === 'video' ||
                                   normalizedMessage.messageType === 'audio' || normalizedMessage.messageType === 'file');
            
            if (isMediaMessage) {
              // Match by mediaKey for media messages
              const msgMediaKey = msg.mediaKey || msg.MediaKey;
              const normMediaKey = normalizedMessage.mediaKey || normalizedMessage.MediaKey;
              
              if (__DEV__ && normalizedMessage.messageType === 'audio') {
                console.log('🎵 [useChat] WebSocket: Checking optimistic match for audio:', {
                  optimisticMediaKey: msgMediaKey,
                  wsMediaKey: normMediaKey,
                  optimisticId: msgId,
                  matches: msgMediaKey && normMediaKey && String(msgMediaKey) === String(normMediaKey),
                });
              }
              
              if (msgMediaKey && normMediaKey && String(msgMediaKey) === String(normMediaKey)) {
                // MediaKey matches - this is the same message
                return true;
              }
              // If mediaKey doesn't match, fall through to Message text check
            }
            
            // For text messages or if mediaKey didn't match, check Message text
            if (msg.Message !== normalizedMessage.Message) return false;
            
            // If both have replyTo, they must match (handle various formats)
            const msgReplyTo = msg.ReplyTo || msg.replyTo || msg.ParentMessageId || msg.parentMessageId;
            const normReplyTo = normalizedMessage.ReplyTo || normalizedMessage.replyTo || normalizedMessage.ParentMessageId || normalizedMessage.parentMessageId;
            
            if (msgReplyTo || normReplyTo) {
              // Extract IDs from various formats
              const extractReplyId = (reply) => {
                if (!reply) return null;
                if (typeof reply === 'string') return reply.trim();
                if (typeof reply === 'object') {
                  return String(reply._id?.$oid || reply._id || reply.id || reply || '').trim();
                }
                return String(reply).trim();
              };
              
              const msgReplyId = extractReplyId(msgReplyTo);
              const normReplyId = extractReplyId(normReplyTo);
              
              // Both must have replyTo and they must match
              if (!msgReplyId || !normReplyId || msgReplyId !== normReplyId) {
                return false;
              }
            } else {
              // If one has replyTo and the other doesn't, they don't match
              if (msgReplyTo || normReplyTo) {
                return false;
              }
            }
            
            return true;
          });
          
          if (optimisticIndex !== -1) {
            // Replace optimistic message with real one, preserving all fields including ReplyTo
            // Handle ReplyTo from various backend formats
            const extractReplyTo = (msg) => {
              const replyTo = msg.ReplyTo || msg.replyTo || msg.ParentMessageId || msg.parentMessageId;
              if (!replyTo) return null;
              if (typeof replyTo === 'string') return replyTo;
              if (typeof replyTo === 'object') {
                return replyTo._id?.$oid || replyTo._id || replyTo.id || replyTo;
              }
              return replyTo;
            };
            
            const backendReplyTo = extractReplyTo(normalizedMessage);
            
            const replacedMessage = {
              ...normalizedMessage,
              // Ensure ReplyTo is preserved from normalized message (backend response)
              // Support multiple field names for compatibility
              ReplyTo: backendReplyTo,
              replyTo: backendReplyTo,
              ParentMessageId: backendReplyTo,
              parentMessageId: backendReplyTo,
              // Preserve audioDuration
              audioDuration: normalizedMessage.audioDuration || prev[optimisticIndex].audioDuration,
            };
            
            // Log audio message replacement
            if (replacedMessage.messageType === 'audio') {
              if (__DEV__) {
                console.log('🎵 [useChat] ✅ WebSocket: Replaced optimistic audio message with real one:', {
                  optimisticId: prev[optimisticIndex]._id || prev[optimisticIndex].id,
                  realId: replacedMessage._id || replacedMessage.id,
                  audioDuration: replacedMessage.audioDuration,
                  mediaKey: replacedMessage.mediaKey,
                  mediaUrl: replacedMessage.mediaUrl,
                });
              }
            }
            
            if (__DEV__) {
              console.log('✅ [Reply] Replaced optimistic message with real one:', {
                messageId: replacedMessage._id || replacedMessage.id,
                replyTo: backendReplyTo,
                messageText: (replacedMessage.Message || '').substring(0, 30),
              });
            }
            
            return prev.map((msg, index) => 
              index === optimisticIndex ? replacedMessage : msg
            ).sort((a, b) => {
              const timeA = new Date(a.Timestamp || a.timestamp || 0);
              const timeB = new Date(b.Timestamp || b.timestamp || 0);
              return timeA - timeB;
            });
          }
          
        // Log audio message addition
        if (normalizedMessage.messageType === 'audio') {
          if (__DEV__) {
            console.log('🎵 [useChat] Adding new audio message to chat:', {
              messageId: normalizedMessage._id || normalizedMessage.id,
              audioDuration: normalizedMessage.audioDuration,
              mediaKey: normalizedMessage.mediaKey,
              mediaUrl: normalizedMessage.mediaUrl,
              mediaName: normalizedMessage.mediaName,
            });
          }
        }
        
        // Add new message (from WebSocket)
        const updated = [...prev, normalizedMessage];
          return updated.sort((a, b) => {
            const timeA = new Date(a.Timestamp || a.timestamp || 0);
            const timeB = new Date(b.Timestamp || b.timestamp || 0);
            return timeA - timeB;
          });
        });

      const messageSenderId = normalizedMessage.SenderId || normalizedMessage.senderId;
      
      // CRITICAL: For our own messages, ensure they start as 'sent', not 'read'
      // Even if backend sends isRead=true, we should verify ReadBy contains others
      if (user && String(messageSenderId).trim() === String(user.id).trim()) {
        const senderIdStr = String(messageSenderId).trim();
        const userIdStr = String(user.id).trim();
        const readByArray = normalizedMessage.ReadBy || normalizedMessage.readBy || [];
        
        // Check message age - if it's very new (less than 2 seconds), it can't be read yet
        const messageTime = normalizedMessage.Timestamp || normalizedMessage.timestamp;
        const isVeryNewMessage = messageTime && (() => {
          try {
            const msgDate = new Date(messageTime);
            const now = new Date();
            const ageSeconds = (now - msgDate) / 1000;
            return ageSeconds < 2; // Less than 2 seconds old
          } catch {
            return false;
          }
        })();
        
        // Check if ReadBy contains anyone OTHER than the sender
        // Handle both object format [{userId, readAt}] and ID format ['id1', 'id2']
        let hasReadByOthers = false;
        if (Array.isArray(readByArray) && readByArray.length > 0) {
          // Filter out the sender's ID and check if any OTHER users have read it
          const otherReaders = readByArray.filter(item => {
            // Extract userId from object or use item directly if it's an ID
            const readerId = typeof item === 'object' && item !== null && !Array.isArray(item)
              ? String(item.userId || item.user_id || item.id || item.UserId || item.Id || '').trim()
              : String(item).trim();
            return readerId !== senderIdStr && 
                   readerId !== userIdStr && 
                   readerId !== '';
          });
          hasReadByOthers = otherReaders.length > 0;
        }
        
        // SAFEGUARD: Very new messages (just sent) should NEVER be marked as read
        if (isVeryNewMessage) {
          normalizedMessage.status = 'sent';
          normalizedMessage.IsRead = false;
          normalizedMessage.isRead = false;
        } else if (!hasReadByOthers && normalizedMessage.status === 'read') {
          // Backend says read but no other readers - force to 'sent'
          normalizedMessage.status = 'sent';
          normalizedMessage.IsRead = false;
          normalizedMessage.isRead = false;
        } else if (hasReadByOthers) {
          // Confirmed others have read it - mark as 'read'
          normalizedMessage.status = 'read';
        } else {
          // Default to 'sent' for our messages
          normalizedMessage.status = normalizedMessage.status || 'sent';
        }
      }

      // Trigger refetch to sync with API (but don't wait for it)
      // This ensures API and WebSocket stay in sync
      setTimeout(() => {
        try {
          const refetchFn = refetchMessagesRef.current;
          if (refetchFn && typeof refetchFn === 'function') {
            refetchFn();
          }
        } catch (error) {
        
      }
      }, 500);
    };

    const handleMessagesRead = (data) => {
      if (data.chatId === chatIdForQuery) {
        setMessages(prev => prev.map(msg => {
          const msgId = msg._id || msg.id;
          
          // CRITICAL: Only update messages that were actually marked as read
          // If messageIds array is provided, only update those specific messages
          // If not provided, backend might have marked all, but we should be conservative
          const shouldUpdateThisMessage = !data.messageIds || 
                                         (Array.isArray(data.messageIds) && data.messageIds.some(id => 
                                           String(id).trim() === String(msgId).trim()
                                         ));
          
          if (!shouldUpdateThisMessage) {
            // Don't update this message - return as is
            return msg;
          }
          
          const updated = { ...msg };
          const senderId = msg.SenderId || msg.senderId;
          const senderIdStr = String(senderId).trim();
          const userIdStr = String(user?.id).trim();
          
          // Add userIds to ReadBy array (if provided)
          if (Array.isArray(data.userIds) && data.userIds.length > 0) {
            const existingReadBy = new Set(msg.readBy || msg.ReadBy || []);
            data.userIds.forEach(id => {
              const readerId = String(id).trim();
              if (readerId && readerId !== '') {
                existingReadBy.add(readerId);
              }
            });
            updated.readBy = Array.from(existingReadBy);
            updated.ReadBy = updated.readBy;
          }

          // CRITICAL: Only mark as 'read' if this is MY message AND someone OTHER than me has read it
          if (user && String(senderIdStr) === String(userIdStr)) {
            // Check if ReadBy contains anyone OTHER than the sender
            const readByArray = updated.readBy || updated.ReadBy || [];
            let hasReadByOthers = false;
            
            if (Array.isArray(readByArray) && readByArray.length > 0) {
              // Filter out the sender's ID and check if any OTHER users have read it
              // Handle both object format [{userId, readAt}] and ID format ['id1', 'id2']
              const otherReaders = readByArray.filter(item => {
                // Extract userId from object or use item directly if it's an ID
                const readerId = typeof item === 'object' && item !== null && !Array.isArray(item)
                  ? String(item.userId || item.user_id || item.id || item.UserId || item.Id || '').trim()
                  : String(item).trim();
                return readerId !== senderIdStr && 
                       readerId !== userIdStr && 
                       readerId !== '';
              });
              hasReadByOthers = otherReaders.length > 0;
            }
            
            // Only mark as 'read' if others have actually read THIS specific message
            if (hasReadByOthers) {
              updated.isRead = true;
              updated.IsRead = true;
              updated.status = 'read';
            } else {
              // No other readers - keep as 'sent' (don't change to 'read')
              // Preserve existing status if it's 'sending' or 'failed'
              if (updated.status !== 'sending' && updated.status !== 'failed') {
                updated.status = 'sent';
              }
              updated.isRead = false;
              updated.IsRead = false;
            }
          }
          
          return updated;
        }));
      }
    };

    const handleUserTyping = (data) => {
      if (__DEV__) {
        console.log('🔤 [Typing] Event received:', {
          data,
          userId: data.userId,
          currentUserId: user?.id,
          dataChatId: data.chatId,
          chatIdForQuery,
          chatIdMatch: String(data.chatId || '').trim() === String(chatIdForQuery || '').trim(),
          userIdMatch: String(data.userId || '').trim() === String(user?.id || '').trim(),
          isTyping: data.isTyping,
        });
      }
      
      // Use string comparison to handle type mismatches
      const dataUserId = String(data.userId || '').trim();
      const currentUserId = String(user?.id || '').trim();
      const dataChatId = String(data.chatId || '').trim();
      const currentChatId = String(chatIdForQuery || '').trim();
      
      if (dataUserId !== currentUserId && dataChatId === currentChatId) {
        if (__DEV__) {
          console.log('✅ [Typing] Setting typing indicator:', data.isTyping, 'User:', data.user);
        }
        setIsTyping(data.isTyping);
        
        // Store typing user info - always include userId for lookup from users list
        if (data.isTyping && data.userId) {
          setTypingUser({
            userId: data.userId,
            name: data.user?.name || data.user?.Name || data.user?.email || data.user?.Email || null,
            email: data.user?.email || data.user?.Email || null,
          });
        } else if (!data.isTyping) {
          // Clear typing user when typing stops
          setTypingUser(null);
        }
        
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }
        if (data.isTyping) {
          typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
            setTypingUser(null);
          }, 3000);
        }
      } 
    };

    // Handle message edited event
    // Backend sends: { _id, ChatId, Message, IsEdited }
    const handleMessageEdited = (payload) => {
      if (__DEV__) {
        console.log('✏️ [useChat] messageEdited event received:', payload);
      }
      
      const editedMessageId = payload._id || payload.id;
      const incomingText = payload.Message || payload.message || payload.text || '';
      const messageKey = String(editedMessageId || '');
      const localEdit = messageKey ? locallyEditedMessagesRef.current.get(messageKey) : null;
      const shouldRegisterLocalEdit = !!messageKey && !localEdit && incomingText;
      const shouldRefreshLocalEdit = !!localEdit && incomingText && incomingText === localEdit.text;

      if (shouldRegisterLocalEdit) {
        locallyEditedMessagesRef.current.set(messageKey, {
          text: incomingText,
          timestamp: Date.now(),
        });
      } else if (shouldRefreshLocalEdit) {
        locallyEditedMessagesRef.current.set(messageKey, {
          text: localEdit.text,
          timestamp: Date.now(),
        });
      }

      const messageChatId = payload.ChatId || payload.chatId;
      const currentChatId = String(chatIdForQuery || '').trim();
      
      if (__DEV__) {
        console.log('✏️ [useChat] Checking if edited message belongs to current chat:', {
          messageChatId,
          currentChatId,
          matches: String(messageChatId).trim() === currentChatId,
          payloadKeys: Object.keys(payload),
        });
      }
      
      // Check if edited message belongs to current chat
      if (String(messageChatId).trim() === currentChatId) {
        const editedMessageId = payload._id || payload.id;
        const newMessageText = payload.Message || payload.message || payload.text || '';
        
        const finalText = (localEdit && localEdit.text) || newMessageText;

        if (editedMessageId && finalText) {
          if (__DEV__) {
            console.log('✏️ [useChat] Updating edited message in local state:', {
              messageId: editedMessageId,
              newText: finalText,
              isEdited: payload.IsEdited,
              currentMessagesCount: messagesRef.current.length,
            });
          }
          
          // Update message in local state
          setMessages(prev => {
            const updated = prev.map(msg => {
              const msgId = String(msg._id || msg.id || '').trim();
              const editId = String(editedMessageId).trim();
              
              if (msgId === editId) {
                if (__DEV__) {
                  console.log('✅ [useChat] Found and updating message:', msgId, 'with text:', finalText);
                }
                // Track edit time to prevent refetches
                const editTimestamp = Date.now();
                recentEditTimeRef.current = editTimestamp;
                
                return {
                  ...msg,
                Message: finalText,
                message: finalText,
                text: finalText,
                  IsEdited: true,
                  isEdited: true,
                  _locallyEdited: true,
                  _editTimestamp: editTimestamp,
                };
              }
              return msg;
            });
            
            // Verify update
            const wasUpdated = updated.some(msg => {
              const msgId = String(msg._id || msg.id || '').trim();
              const editId = String(editedMessageId).trim();
              return msgId === editId && (msg.IsEdited || msg.isEdited) && msg.Message === finalText;
            });
            
            if (__DEV__) {
              console.log('✏️ [useChat] Message update result:', {
                wasUpdated,
                messageFound: prev.some(msg => String(msg._id || msg.id || '').trim() === String(editedMessageId).trim()),
                updatedMessageText: updated.find(msg => String(msg._id || msg.id || '').trim() === String(editedMessageId).trim())?.Message,
              });
            }
            
            return updated;
          });
        } else {
          if (__DEV__) {
            console.warn('⚠️ [useChat] Cannot update message - missing ID or text:', {
              editedMessageId,
              hasNewText: !!finalText,
              payload,
            });
          }
        }
      } else {
        if (__DEV__) {
          console.log('ℹ️ [useChat] Edited message belongs to different chat, ignoring');
        }
      }
    };

    // Handle message deleted event
    // Backend sends: { _id, ChatId, IsDeleted }
    const handleMessageDeleted = (payload) => {
      if (__DEV__) {
        console.log('🗑️ [useChat] messageDeleted event received:', payload);
      }
      
      // Backend payload structure: { _id, ChatId, IsDeleted }
      const messageChatId = payload.ChatId || payload.chatId;
      const deletedMessageId = payload._id || payload.id;
      const currentChatId = String(chatIdForQuery || '').trim();
      
      // Check if deleted message belongs to current chat
      if (String(messageChatId).trim() === currentChatId && deletedMessageId) {
        if (__DEV__) {
          console.log('🗑️ [useChat] Updating deleted message in local state:', {
            messageId: deletedMessageId,
            chatId: messageChatId,
          });
        }
        
        // Update message in local state (soft delete)
        setMessages(prev => {
          const updated = prev.map(msg => {
            const msgId = String(msg._id || msg.id || '').trim();
            const delId = String(deletedMessageId).trim();
            
            if (msgId === delId) {
              if (__DEV__) {
                console.log('✅ [useChat] Found and marking message as deleted:', msgId);
              }
              return {
                ...msg,
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
              };
            }
            return msg;
          });
          
          // Verify update
          const wasUpdated = updated.some(msg => {
            const msgId = String(msg._id || msg.id || '').trim();
            const delId = String(deletedMessageId).trim();
            return msgId === delId && (msg.IsDeleted || msg.isDeleted);
          });
          
          if (__DEV__) {
            console.log('🗑️ [useChat] Delete update result:', {
              wasUpdated,
              messageFound: prev.some(msg => String(msg._id || msg.id || '').trim() === String(deletedMessageId).trim()),
            });
          }
          
          return updated;
        });
      } else {
        if (__DEV__) {
          console.log('ℹ️ [useChat] Deleted message belongs to different chat, ignoring');
        }
      }
    };

    // Register event listeners
    socketService.on('newMessage', handleNewMessage);
    socketService.on('messagesRead', handleMessagesRead);
    socketService.on('userTyping', handleUserTyping);
    socketService.on('messageEdited', handleMessageEdited);
    socketService.on('messageDeleted', handleMessageDeleted);
    
    // Cleanup
    return () => {
      socketService.off('newMessage', handleNewMessage);
      socketService.off('messagesRead', handleMessagesRead);
      socketService.off('userTyping', handleUserTyping);
      socketService.off('messageEdited', handleMessageEdited);
      socketService.off('messageDeleted', handleMessageDeleted);
      
      if (chatIdForQuery && user) {
        socketService.leaveChat(chatIdForQuery, user.id);
        // Remove from joined chats set when leaving
        const chatKey = `${chatIdForQuery}_${user.id}`;
        joinedChatsRef.current.delete(chatKey);
      }
    };
  }, [chatIdForQuery, user?.id]); // CRITICAL: Only depend on chatIdForQuery and user.id, NOT messages

  // Send message
  const sendMessage = useCallback(async (messageText, replyTo = null) => {
    // Detailed validation with logging
    if (!messageText?.trim()) {
      if (__DEV__) {
        console.error('❌ [useChat] Cannot send message: Message text is empty', {
          messageText,
          hasMessageText: !!messageText,
        });
      }
      return false;
    }
    
    if (!chat) {
      if (__DEV__) {
        console.error('❌ [useChat] Cannot send message: Chat is null/undefined', {
          chat,
          chatIdForQuery,
          enquiryId,
          chatType,
        });
      }
      return false;
    }
    
    if (!user) {
      if (__DEV__) {
        console.error('❌ [useChat] Cannot send message: User is null/undefined', {
          user,
        });
      }
      return false;
    }
    
    if (__DEV__) {
      console.log('📤 [useChat] Attempting to send message', {
        messageLength: messageText.trim().length,
        chatId: chat?._id || chat?.id || chatIdForQuery,
        userId: user?.id,
        hasReply: !!replyTo,
        socketConnected: socketService.isConnected(),
      });
    }

    let actualChatId = chatIdForQuery;
    
    // If chat doesn't exist yet, try to find/create it
    if (!actualChatId) {
      try {
        const token = await AsyncStorage.getItem('token');
        const type = chatType;
        const searchParams = new URLSearchParams({
          type: type,
          search: enquiryId,
          limit: '10',
        });

        const response = await fetch(`${API_BASE_URL}/api/chats?${searchParams.toString()}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const result = await response.json();
          const chats = result.Data || result.data || result;
          const foundChat = Array.isArray(chats) 
            ? chats.find(c => String(c.EnquiryId || c.enquiryId).trim() === String(enquiryId).trim())
            : null;
          
          if (foundChat?._id) {
            actualChatId = foundChat._id;
            setChat(prev => ({
              ...prev,
              _id: foundChat._id,
              EnquiryName: foundChat.EnquiryName || foundChat.enquiryTitle || prev.EnquiryName,
            }));
          }
        }
      } catch (error) {
        
      }

      if (!actualChatId) {
        
        return false;
      }
    }

    // Create optimistic message
    const tempMessageId = `temp-${Date.now()}-${Math.random()}`;
    const replyToId = replyTo?._id || replyTo?.id || null;
    const optimisticMessage = {
      _id: tempMessageId,
      id: tempMessageId,
      Message: messageText.trim(),
      message: messageText.trim(),
      text: messageText.trim(),
      SenderId: user.id,
      senderId: user.id,
      SenderName: user.name || user.email || 'You',
      senderName: user.name || user.email || 'You',
      Timestamp: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      MessageType: 'text',
      messageType: 'text',
      IsRead: false,
      isRead: false,
      ChatId: actualChatId,
      chatId: actualChatId,
      ReplyTo: replyToId ? (replyTo || { _id: replyToId, id: replyToId }) : null,
      replyTo: replyToId ? (replyTo || { _id: replyToId, id: replyToId }) : null,
      status: 'sending',
    };

    // Add optimistic message immediately
    setMessages(prev => [...prev, optimisticMessage]);

    // Ensure socket is connected before sending
    if (!socketService.isConnected()) {
      if (__DEV__) {
        console.warn('⚠️ [useChat] Socket not connected, attempting to reconnect...', {
          chatId: actualChatId,
          userId: user.id,
        });
      }
      
      try {
        await socketService.connect(user.id);
        // Wait a bit for connection to establish
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Rejoin chat room after reconnection
        if (socketService.isConnected() && actualChatId) {
          socketService.joinChat(actualChatId, user.id);
        }
      } catch (error) {
        if (__DEV__) {
          console.error('❌ [useChat] Failed to reconnect socket:', error);
        }
      }
    }

    // Send via WebSocket
    const sent = socketService.sendMessage({
      chatId: actualChatId,
      userId: user.id,
      message: messageText.trim(),
      messageType: 'text',
      parentMessageId: replyTo?._id || replyTo?.id || null,
    });

    if (!sent) {
      if (__DEV__) {
        console.error('❌ [useChat] Failed to send message via WebSocket', {
          chatId: actualChatId,
          userId: user.id,
          socketConnected: socketService.isConnected(),
          messageLength: messageText.trim().length,
        });
      }
      
      // Mark message as failed
      setMessages(prev => prev.map(msg => 
        msg._id === tempMessageId 
          ? { ...msg, status: 'failed' }
          : msg
      ));
      return false;
    }
    
    if (__DEV__) {
      console.log('✅ [useChat] Message sent successfully via WebSocket');
    }

    try {
      patchChatListsForLocalOutgoingMessage(dispatch, {
        userId: user?.id ?? user?._id,
        chatId: actualChatId,
        enquiryId,
        messageBody: messageText.trim(),
        messageType: 'text',
        chatType,
        chat,
      });
    } catch (e) {
      if (__DEV__) {
        console.warn('[useChat] patchChatListsForLocalOutgoingMessage failed', e);
      }
    }

    // Refetch as backup after delay
    setTimeout(() => {
      try {
        const refetchFn = refetchMessagesRef.current;
        if (refetchFn && typeof refetchFn === 'function') {
          refetchFn();
        }
      } catch (error) {
        
      }
    }, 2000);

    return true;
  }, [chat, chatIdForQuery, user, enquiryId, chatType, dispatch]);

  // Send media (optional replyTo same shape as sendMessage)
  const sendMedia = useCallback(async (file, replyTo = null) => {
    if (!file || !chatIdForQuery || !user) {
      return false;
    }

    // Define tempMediaId outside try block so it's accessible in catch
    const tempMediaId = `temp-media-${Date.now()}-${Math.random()}`;
    const replyToId = replyTo?._id || replyTo?.id || null;

    try {
      if (__DEV__) {
        console.log('[sendMedia] start', {
          chatIdForQuery,
          userId: user?.id,
          file,
          hasReply: !!replyToId,
        });
      }

      let messageType = file.messageType || 'file';
      if (!messageType) {
        if (file.type?.startsWith('image/')) {
          messageType = 'image';
        } else if (file.type?.startsWith('video/')) {
          messageType = 'video';
        } else if (file.type?.startsWith('audio/')) {
          messageType = 'audio';
        }
      }

      // Extract audio duration if present
      const audioDuration = file.audioDuration || null;

      // Create optimistic media message immediately so UI shows local thumbnail while uploading
      const initialMediaName = file.name || 'Media file';
      const optimisticMediaMessage = {
        _id: tempMediaId,
        id: tempMediaId,
        Message: initialMediaName,
        message: initialMediaName,
        text: initialMediaName,
        SenderId: user.id,
        senderId: user.id,
        SenderName: user.name || user.email || 'You',
        senderName: user.name || user.email || 'You',
        SenderRole: user.role,
        senderRole: user.role,
        Timestamp: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        MessageType: messageType,
        messageType: messageType,
        // Use a temporary key and local URI until upload completes
        MediaKey: tempMediaId,
        mediaKey: tempMediaId,
        MediaUrl: file.uri,
        mediaUrl: file.uri,
        MediaName: initialMediaName,
        mediaName: initialMediaName,
        ChatId: chatIdForQuery,
        chatId: chatIdForQuery,
        status: 'sending',
        ...(audioDuration && { audioDuration }),
        ...(replyToId
          ? {
              ReplyTo: replyTo || { _id: replyToId, id: replyToId },
              replyTo: replyTo || { _id: replyToId, id: replyToId },
              ParentMessageId: replyToId,
              parentMessageId: replyToId,
            }
          : {}),
      };
      setMessages(prev => [...prev, optimisticMediaMessage]);

      // Now upload the actual media to the server
      const uploadResult = await uploadChatMedia({
        uri: file.uri,
        type: file.type || 'image/jpeg',
        name: file.name || `file_${Date.now()}.jpg`,
      }).unwrap();

      if (__DEV__) {
        console.log('[sendMedia] upload result', uploadResult);
      }

      // Normalize upload response; backend may return a plain string key
      const uploadData = typeof uploadResult === 'string'
        ? { key: uploadResult, name: file.name || uploadResult }
        : (uploadResult || {});

      const mediaUrl = uploadData.Url || uploadData.url || uploadData.Location || uploadData.location;
      const mediaName = uploadData.name || uploadData.fileName || file.name || 'Media file';
      const mediaKey = uploadData.key || uploadData.Key || mediaUrl || uploadResult;
      let finalMediaUrl = mediaUrl || getMediaUrlFromKey(mediaKey);
      // Try presign if direct URL missing or looks like an API path
      if (!finalMediaUrl || finalMediaUrl.includes('/api/files/')) {
        const presigned = await ensurePresignedUrl(mediaKey);
        if (presigned) {
          finalMediaUrl = presigned;
        }
      }

      // Update optimistic message with real media info from server
      setMessages(prev => prev.map(msg => {
        if (msg.id === tempMediaId || msg._id === tempMediaId) {
          return {
            ...msg,
            MediaKey: mediaKey,
            mediaKey: mediaKey,
            MediaUrl: finalMediaUrl,
            mediaUrl: finalMediaUrl,
            MediaName: mediaName,
            mediaName: mediaName,
          };
        }
        return msg;
      }));

      if (__DEV__) {
        console.log('[sendMedia] sending via socket', {
          chatId: chatIdForQuery,
          userId: user.id,
          message: mediaName,
          messageType,
          mediaUrl: finalMediaUrl,
          mediaKey,
          mediaSize: uploadResult.size || file.size || 0,
          audioDuration: audioDuration || null,
        });
        if (!mediaKey && !mediaUrl) {
          console.log('[sendMedia] WARN: mediaKey and mediaUrl are missing; backend returned:', uploadResult);
        }
        if (finalMediaUrl) {
          try {
            const testUrl = new URL(finalMediaUrl);
            console.log('[media] finalMediaUrl', testUrl.toString());
          } catch (e) {
            console.log('[media] finalMediaUrl (raw)', finalMediaUrl);
          }
        } else {
          console.log('[media] finalMediaUrl missing');
        }
      }

      const messageData = {
        chatId: chatIdForQuery,
        userId: user.id,
        message: mediaName,
        messageType: messageType,
        parentMessageId: replyToId,
        mediaUrl: finalMediaUrl,
        mediaName: mediaName,
        mediaKey: mediaKey,
        mediaSize: uploadResult.size || file.size || 0,
        ...(audioDuration && { audioDuration }),
      };
      
      if (__DEV__ && messageType === 'audio') {
        console.log('🎵 [sendMedia] Sending audio message via WebSocket:', {
          ...messageData,
          hasAudioDuration: !!audioDuration,
        });
      }
      
      const sent = socketService.sendMessage(messageData);

      if (__DEV__) {
        console.log('[sendMedia] socket send result', sent);
      }

      if (sent) {
        // Mark optimistic message as sent
        setMessages(prev => prev.map(msg => {
          if (msg.id === tempMediaId || msg._id === tempMediaId) {
            return { ...msg, status: 'sent' };
          }
          return msg;
        }));

        // Refetch after delay to ensure message appears (same for all media types including audio)
        setTimeout(() => {
          try {
            const refetchFn = refetchMessagesRef.current;
            if (refetchFn && typeof refetchFn === 'function') {
              refetchFn();
            }
          } catch (error) {
            if (__DEV__) {
              console.log('[sendMedia] refetch error', error);
            }
          }
        }, 1500);

        try {
          patchChatListsForLocalOutgoingMessage(dispatch, {
            userId: user?.id ?? user?._id,
            chatId: chatIdForQuery,
            enquiryId,
            messageBody: mediaName,
            messageType: messageType || 'image',
            chatType,
            chat,
          });
        } catch (e) {
          if (__DEV__) {
            console.warn('[useChat] patchChatListsForLocalOutgoingMessage (media) failed', e);
          }
        }
      } else {
        // Mark optimistic message as failed
        setMessages(prev => prev.map(msg => {
          if (msg.id === tempMediaId || msg._id === tempMediaId) {
            return { ...msg, status: 'failed' };
          }
          return msg;
        }));
      }

      return sent;
    } catch (error) {
      if (__DEV__) {
        console.log('[sendMedia] error', error);
      }
      // Mark optimistic message as failed on error
      setMessages(prev => prev.map(msg => {
        if (msg.id === tempMediaId || msg._id === tempMediaId) {
          return { ...msg, status: 'failed' };
        }
        return msg;
      }));
      
      if (__DEV__) {
        console.error('[sendMedia] Failed to send media:', error.message || error);
      }
      
      return false;
    }
  }, [chatIdForQuery, user, uploadChatMedia, dispatch, enquiryId, chatType, chat]);

  // Send typing indicator
  const sendTyping = useCallback((isTyping) => {
    if (!chatIdForQuery || !user) return;
    socketService.sendTyping(chatIdForQuery, user.id, isTyping);
  }, [chatIdForQuery, user]);

  // Load more messages (pagination)
  const loadMoreMessages = useCallback(async () => {
    if (!chatIdForQuery || !nextCursor || isLoadingMore || messagesLoading) {
      return false;
    }

    setIsLoadingMore(true);
    
    try {
      const token = await AsyncStorage.getItem('token');
      const response = await fetch(
        `${API_BASE_URL}/api/message/${chatIdForQuery}/messages?before=${nextCursor}&limit=20`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const messagesArray = data.Data || data.data || data;

      if (Array.isArray(messagesArray) && messagesArray.length > 0) {
        setMessages(prev => {
          // Merge old messages with new ones (deduplicate)
          const messageMap = new Map();
          
          // Add existing messages
          prev.forEach(msg => {
            const id = msg._id || msg.id;
            if (id) messageMap.set(id, msg);
          });
          
          // Add new messages (older messages) with normalization
          messagesArray.forEach(msg => {
            const senderId = msg.SenderId || msg.senderId;
            const readByArray = msg.ReadBy || msg.readBy || msg.read_by || [];
            const isReadFlag = msg.IsRead || msg.isRead || false;
            let statusValue = msg.status || 'sent';
            
            // CRITICAL: Only mark as "read" if someone OTHER than the sender has read it
            if (user && String(senderId) === String(user.id)) {
              const senderIdStr = String(senderId).trim();
              const userIdStr = String(user.id).trim();
              
              // Check ReadBy array - must contain at least one ID that is NOT the sender
              // Handle both object format [{userId, readAt}] and ID format ['id1', 'id2']
              let hasReadByOthers = false;
              if (Array.isArray(readByArray) && readByArray.length > 0) {
                // Filter out the sender's ID and check if any OTHER users have read it
                const otherReaders = readByArray.filter(item => {
                  // Extract userId from object or use item directly if it's an ID
                  const readerId = typeof item === 'object' && item !== null && !Array.isArray(item)
                    ? String(item.userId || item.user_id || item.id || item.UserId || item.Id || '').trim()
                    : String(item).trim();
                  return readerId !== senderIdStr && 
                         readerId !== userIdStr && 
                         readerId !== '';
                });
                hasReadByOthers = otherReaders.length > 0;
              }
              
              // IMPORTANT: Don't trust isReadFlag alone - verify ReadBy contains others
              // Only mark as "read" if we have confirmed that others have read it
              if (hasReadByOthers) {
                statusValue = 'read';
              } else {
                // Default to 'sent' - NOT 'read' unless confirmed
                statusValue = statusValue === 'sending' || statusValue === 'failed' ? statusValue : 'sent';
              }
            }

            const normalized = {
              _id: msg._id || msg.id,
              id: msg._id || msg.id,
              Message: msg.Message || msg.message || msg.text || '',
              message: msg.Message || msg.message || msg.text || '',
              text: msg.Message || msg.message || msg.text || '',
              SenderId: msg.SenderId || msg.senderId,
              senderId: msg.SenderId || msg.senderId,
              SenderName: msg.SenderName || msg.senderName,
              senderName: msg.SenderName || msg.senderName,
              SenderRole: msg.SenderRole || msg.senderRole,
              senderRole: msg.SenderRole || msg.senderRole,
              Timestamp: msg.Timestamp || msg.timestamp,
              timestamp: msg.Timestamp || msg.timestamp,
              MessageType: msg.MessageType || msg.messageType || 'text',
              messageType: msg.MessageType || msg.messageType || 'text',
              IsRead: msg.IsRead || msg.isRead || false,
              isRead: msg.IsRead || msg.isRead || false,
              Media: msg.Media || msg.media,
              media: msg.Media || msg.media,
              MediaKey: msg.MediaKey || msg.mediaKey || msg.media?.key,
              mediaKey: msg.MediaKey || msg.mediaKey || msg.media?.key,
              MediaUrl: msg.MediaUrl || msg.mediaUrl || msg.media?.url,
              mediaUrl: msg.MediaUrl || msg.mediaUrl || msg.media?.url,
              MediaName: msg.MediaName || msg.mediaName || msg.media?.name,
              mediaName: msg.MediaName || msg.mediaName || msg.media?.name,
              ChatId: msg.ChatId || msg.chatId || msg.EnquiryId || msg.enquiryId,
              chatId: msg.ChatId || msg.chatId || msg.EnquiryId || msg.enquiryId,
              ReadBy: readByArray,
              readBy: readByArray,
              status: statusValue,
            };

            if ((normalized.messageType === 'image' || normalized.messageType === 'video' || normalized.messageType === 'file') &&
                (!normalized.mediaKey || !normalized.mediaUrl)) {
              const inferred = inferMediaFromName(
                normalized.mediaName ||
                normalized.MediaName ||
                normalized.Message ||
                normalized.message
              );
              if (inferred) {
                normalized.mediaKey = normalized.mediaKey || inferred.mediaKey;
                normalized.MediaKey = normalized.MediaKey || inferred.mediaKey;
                normalized.mediaUrl = normalized.mediaUrl || inferred.mediaUrl;
                normalized.MediaUrl = normalized.MediaUrl || inferred.mediaUrl;
                normalized.mediaName = normalized.mediaName || inferred.mediaName;
                normalized.MediaName = normalized.MediaName || inferred.mediaName;
                if (!normalized.messageType || normalized.messageType === 'text') {
                  normalized.messageType = inferred.messageType || normalized.messageType;
                  normalized.MessageType = inferred.messageType || normalized.MessageType;
                }
              }
            }

            if (normalized.mediaKey && !normalized.mediaUrl) {
              ensurePresignedUrl(normalized.mediaKey).then((url) => {
                if (url) {
                  setMessages(prev => prev.map(existing => {
                    const mid = existing._id || existing.id;
                    if (mid === (normalized._id || normalized.id)) {
                      return {
                        ...existing,
                        mediaUrl: url,
                        MediaUrl: url,
                      };
                    }
                    return existing;
                  }));
                }
              });
            }

            const id = normalized._id || normalized.id;
            if (id) messageMap.set(id, normalized);
          });
          
          return Array.from(messageMap.values()).sort((a, b) => {
            const timeA = new Date(a.Timestamp || a.timestamp || 0);
            const timeB = new Date(b.Timestamp || b.timestamp || 0);
            return timeA - timeB;
          });
        });

        setNextCursor(data.NextCursor || null);
        setIsLoadingMore(false);
        return true;
      }
      
        // No more messages
        setNextCursor(null);
        setIsLoadingMore(false);
        return false;
    } catch (error) {
      
      setIsLoadingMore(false);
      return false;
    }
  }, [chatIdForQuery, nextCursor, isLoadingMore, messagesLoading]);

  // Update chat when chatId or initialChat changes (e.g., when navigating with routeChat)
  useEffect(() => {
    // If initialChat is provided and different from current chat, use it
    if (initialChat && (initialChat._id || initialChat.id)) {
      const initialChatId = initialChat._id || initialChat.id;
      if (!chat?._id || chat._id !== initialChatId) {
        
        setChat({
          ...initialChat,
          _id: initialChatId,
          id: initialChatId,
        });
        return;
      }
    }
    
    // Otherwise, update chat with chatId if it changed
    if (chatId && (!chat?._id || chat._id !== chatId)) {
      
      // Update chat with chatId immediately so messages can load
      setChat(prev => ({
        ...prev,
        _id: chatId,
        id: chatId,
        EnquiryId: enquiryId || prev?.EnquiryId,
        Type: chatType || prev?.Type,
      }));
    }
  }, [chatId, initialChat, enquiryId, chatType, chat?._id]);

  // Load chat on mount
  useEffect(() => {
    if (enquiryId && user) {
      fetchChat();
    }
  }, [enquiryId, chatId, user, fetchChat]);

  // Force refetch when chat is loaded and messages are empty (remount scenario)
  const forceRefetchDoneRef = useRef(null);
  useEffect(() => {
    if (!chatIdForQuery) return;
    
    // Reset ref when chat changes
    if (forceRefetchDoneRef.current !== chatIdForQuery && forceRefetchDoneRef.current !== null) {
      forceRefetchDoneRef.current = null;
    }
    
    // Force refetch if messages are empty and query is not loading
    // This handles the remount scenario where component remounts with empty state
    if (messages.length === 0 && !messagesLoading && forceRefetchDoneRef.current !== chatIdForQuery) {
      if (__DEV__) {
        console.log('🔄 Force refetch triggered - empty messages detected:', {
          chatId: chatIdForQuery,
          messagesLoading,
          apiMessages: apiMessages?.length || 0,
        });
      }
      
      // Small delay to ensure query is ready
      const timer = setTimeout(() => {
        try {
          const refetchFn = refetchMessagesRef.current;
          if (refetchFn && typeof refetchFn === 'function') {
            
            refetchFn().then(() => {
              
            }).catch(err => {
              
            });
            forceRefetchDoneRef.current = chatIdForQuery; // Mark as done for this chat
          } else {
            
          }
        } catch (error) {
          
        }
      }, 500); // Increased delay to ensure query is initialized
      return () => clearTimeout(timer);
    }
  }, [chatIdForQuery, messages.length, messagesLoading, apiMessages]);

  // Debug: Log messages state changes
  useEffect(() => {
    if (__DEV__) {
      console.log('📊 MESSAGES STATE:', {
        count: messages.length,
        chatId: chatIdForQuery,
        apiMessagesCount: apiMessages?.length || 0,
        messagesLoading,
        sample: messages.length > 0 ? messages[0] : null,
      });
    }
  }, [messages.length, chatIdForQuery, apiMessages?.length, messagesLoading]);

  // Function to update a message in local state (for optimistic updates)
  const updateMessage = useCallback((messageId, updates) => {
    // Track edit time to prevent refetches from overwriting edits
    const isEditUpdate = updates.IsEdited || updates.isEdited;
    if (isEditUpdate) {
      recentEditTimeRef.current = Date.now();
      
      const newText = updates.Message || updates.message || updates.text;
      if (newText) {
        // Register this edit in our registry to prevent API overwrites for 60 seconds
        locallyEditedMessagesRef.current.set(String(messageId), {
          text: newText,
          timestamp: Date.now()
        });
      }
      
      if (__DEV__) {
        console.log('✏️ [useChat] Registered edit in local registry:', { messageId, text: newText?.substring(0, 20) });
      }
    }
    
    setMessages(prev => prev.map(msg => {
      const msgId = String(msg._id || msg.id || '').trim();
      const updateId = String(messageId).trim();
      
      if (msgId === updateId) {
        const editTimestamp = isEditUpdate ? Date.now() : (msg._editTimestamp || null);
        
        // If updating with IsDeleted flag, mark as locally deleted
        const isDeleteUpdate = updates.IsDeleted || updates.isDeleted;
        const deleteTimestamp = isDeleteUpdate ? Date.now() : (msg._deleteTimestamp || null);
        
        return {
          ...msg,
          ...updates,
          _locallyEdited: isEditUpdate ? true : (msg._locallyEdited || false),
          _editTimestamp: editTimestamp,
          _locallyDeleted: isDeleteUpdate ? true : (msg._locallyDeleted || false),
          _deleteTimestamp: deleteTimestamp,
        };
      }
      return msg;
    }));
  }, []);

  return {
    chat,
    messages,
    isLoadingChat,
    messagesLoading,
    chatError: chatError || messagesError,
    isTyping,
    typingUser, // { userId, name, email } - User who is currently typing
    isUploading,
    nextCursor,
    isLoadingMore,
    hasMore: nextCursor !== null && nextCursor !== undefined,
    sendMessage,
    sendMedia,
    sendTyping,
    refetchChat: fetchChat,
    refetchMessages,
    loadMoreMessages,
    updateMessage,
  };
};