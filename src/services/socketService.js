import { io } from 'socket.io-client';
import secureStorage from '../utils/secureStorage';
import { SOCKET_BASE_URL } from '../config/apiConfig';

const SOCKET_URL = SOCKET_BASE_URL;

class SocketService {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.isConnecting = false;
    this.currentUserId = null; // Store userId for reconnection
    this.listeners = {
      newMessage: [],
      messagesRead: [],
      userTyping: [],
      messageEdited: [],
      messageDeleted: [],
      error: [],
      connect: [],
      disconnect: [],
    };
  }

  /**
   * Connect to WebSocket server
   * @param {string} userId - Current user ID
   */
  async connect(userId, forceReconnect = false) {
    // Store userId for reconnection
    if (userId) {
      this.currentUserId = userId;
    }

    // If force reconnect, disconnect existing socket first
    if (forceReconnect && this.socket) {
      console.log('🔄 [SocketService] Force reconnecting - disconnecting existing socket');
      try {
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
        this.connected = false;
      } catch (error) {
        console.error('❌ [SocketService] Error disconnecting for force reconnect:', error);
      }
    }

    // Prevent multiple connection attempts
    if (this.socket?.connected && !forceReconnect) {
      if (__DEV__) {
        console.log('✅ [SocketService] Socket already connected, skipping');
      }
      return;
    }

    if (this.isConnecting && !forceReconnect) {
      if (__DEV__) {
        console.log('⏳ [SocketService] Connection already in progress, skipping');
      }
      return;
    }

    // Clean up any existing socket before creating a new one
    if (this.socket && !this.socket.connected) {
      if (__DEV__) {
        console.log('🧹 [SocketService] Cleaning up disconnected socket');
      }
      try {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      } catch (error) {
        if (__DEV__) {
          console.warn('⚠️ [SocketService] Error cleaning up socket:', error);
        }
      }
      this.socket = null;
    }

    // Get auth token from secure storage (same as API uses) - outside try block for error handler access
    let token;
    try {
      token = await secureStorage.getItem('token');
    } catch (tokenError) {
      if (__DEV__) {
        console.error('❌ [SocketService] Failed to get token from secure storage:', tokenError);
      }
      this.isConnecting = false;
      return;
    }
    
    if (!token) {
      if (__DEV__) {
        console.error('❌ [SocketService] No token found in secure storage');
      }
      this.isConnecting = false;
      return;
    }

    if (__DEV__) {
      console.log('🔐 [SocketService] Connecting with token:', token.substring(0, 20) + '...');
    }

    try {
      this.isConnecting = true;

      // Socket.io servers typically expect just the raw token (without "Bearer " prefix)
      // The backend will add "Bearer " prefix when validating if needed
      this.socket = io(SOCKET_URL, {
        transports: ['websocket'], // Use only websocket to avoid polling overhead
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000, // Max 10 seconds between attempts
        reconnectionAttempts: Infinity, // Keep trying to reconnect indefinitely (for background/foreground)
        timeout: 20000,
        auth: {
          token: token, // Send raw token (backend will handle Bearer prefix if needed)
        },
        // Also include in headers as some servers expect it there
        extraHeaders: {
          Authorization: `Bearer ${token}`,
        },
      });

      // Connection events
      this.socket.on('connect', () => {
        console.log('✅ [SocketService] Socket connected successfully!', {
          socketId: this.socket?.id,
          userId: userId,
          timestamp: new Date().toISOString(),
        });
        
        this.connected = true;
        this.isConnecting = false;
        
        // Join notification room for offline push notifications
        if (userId) {
          console.log('🔔 [SocketService] Joining notification room for userId:', userId);
          this.socket.emit('joinNotificationRoom', userId);
        }
        
        // Notify listeners
        this.listeners.connect.forEach(callback => {
          try {
            callback();
          } catch (error) {
            console.error('❌ [SocketService] Error in connect callback:', error);
          }
        });
      });

      // Reconnection events
      this.socket.on('reconnect_attempt', (attemptNumber) => {
        
      });

      this.socket.on('reconnect', (attemptNumber) => {
        console.log('✅ [SocketService] Socket reconnected automatically!', {
          attemptNumber,
          socketId: this.socket?.id,
          userId: userId,
          timestamp: new Date().toISOString(),
        });
        
        this.connected = true;
        this.isConnecting = false;
        
        // Rejoin notification room after reconnection
        if (userId) {
          console.log('🔔 [SocketService] Rejoining notification room after reconnect:', userId);
          this.socket.emit('joinNotificationRoom', userId);
        }
      });

      this.socket.on('reconnect_error', (error) => {
        if (__DEV__) {
          console.warn('⚠️ Reconnection error (will keep trying):', error.message);
        }
      });

      this.socket.on('reconnect_failed', () => {
        
        this.connected = false;
        this.isConnecting = false;
      });

      this.socket.on('disconnect', (reason) => {
        // Transport errors are often temporary network issues
        const isTransportError = reason === 'transport error' || reason === 'transport close';
        const isServerDisconnect = reason === 'io server disconnect';
        const isClientDisconnect = reason === 'io client disconnect';
        
        console.log('🔌 [SocketService] Socket disconnected:', {
          reason,
          isTransportError,
          isServerDisconnect,
          isClientDisconnect,
          willAutoReconnect: !isServerDisconnect && !isClientDisconnect,
          timestamp: new Date().toISOString(),
        });
        
        if (isTransportError) {
          console.warn('⚠️ WebSocket transport error (network issue, will auto-reconnect):', reason);
        } else if (isServerDisconnect) {
          console.warn('⚠️ Server disconnected socket (may need manual reconnect):', reason);
        } else if (isClientDisconnect) {
          console.log('ℹ️ Client disconnected socket (manual disconnect)');
        } else {
          console.log('ℹ️ Socket disconnected:', reason);
        }
        
        // Reset connection state
        this.connected = false;
        this.isConnecting = false;
        
        // Notify listeners
        this.listeners.disconnect.forEach(callback => {
          try {
            callback(reason);
          } catch (error) {
            console.error('❌ [SocketService] Error in disconnect callback:', error);
          }
        });
        
        // For transport errors, socket.io will automatically attempt to reconnect
        // No need to manually reconnect unless it's a server disconnect
        if (isServerDisconnect) {
          // Server disconnected - don't auto-reconnect
          // User will need to manually reconnect or refresh
          console.warn('⚠️ [SocketService] Server disconnected - auto-reconnect disabled');
        }
      });

      this.socket.on('connect_error', (error) => {
        const errorMessage = error?.message || error?.toString() || '';
        const isAuthError = errorMessage.includes('Authentication error') || 
                           errorMessage.includes('Invalid or expired token') ||
                           errorMessage.includes('Unauthorized') ||
                           errorMessage.toLowerCase().includes('authentication');
        
        if (__DEV__) {
          if (isAuthError) {
            console.error('❌ [SocketService] Authentication error:', errorMessage);
            if (token) {
              console.error('   Token preview:', token.substring(0, 30) + '...');
              console.error('   Token length:', token.length);
            }
            console.error('   Possible causes:');
            console.error('   1. Token is expired - try logging out and back in');
            console.error('   2. Token format mismatch - backend might expect different format');
            console.error('   3. Backend authentication middleware issue');
            console.error('   Current auth format: raw token (without Bearer prefix)');
          } else {
            console.warn('⚠️ Socket connection error (this is OK if WebSocket server is not running):', errorMessage);
          }
        }
        
        // Don't throw error, just log it - chat can work without WebSocket
        this.isConnecting = false;
        
        // Notify listeners
        this.listeners.error.forEach(callback => {
          try {
            callback(error);
          } catch (err) {
          }
        });
      });

      // Chat events
      this.socket.on('newMessage', (message) => {
        
        
        this.listeners.newMessage.forEach(callback => {
          try {
            callback(message);
          } catch (error) {
          }
        });
      });

      this.socket.on('messagesRead', (data) => {
        
        
        this.listeners.messagesRead.forEach(callback => {
          try {
            callback(data);
          } catch (error) {
          }
        });
      });

      this.socket.on('userTyping', (data) => {
        
        
        this.listeners.userTyping.forEach(callback => {
          try {
            callback(data);
          } catch (error) {
          }
        });
      });

      this.socket.on('messageEdited', (message) => {
        if (__DEV__) {
          console.log('✏️ [SocketService] Message edited:', message);
        }
        this.listeners.messageEdited.forEach(callback => {
          try {
            callback(message);
          } catch (error) {
            if (__DEV__) {
              console.error('❌ [SocketService] Error in messageEdited callback:', error);
            }
          }
        });
      });

      this.socket.on('messageDeleted', (data) => {
        if (__DEV__) {
          console.log('🗑️ [SocketService] Message deleted:', data);
        }
        this.listeners.messageDeleted.forEach(callback => {
          try {
            callback(data);
          } catch (error) {
            if (__DEV__) {
              console.error('❌ [SocketService] Error in messageDeleted callback:', error);
            }
          }
        });
      });

      this.socket.on('error', (error) => {
        // Only log if it's a real error, not a "Failed to send message" when message actually worked
        const errorMessage = error?.message || error?.toString() || '';
        if (errorMessage.includes('Failed to send message')) {
          // This might be a false error - message could have been sent successfully
          // Check if we're actually connected and receiving messages
          if (this.socket?.connected) {
            
          } else {
            if (__DEV__) {
              console.error('Socket error: Failed to send message (socket not connected)');
            }
          }
        } else {
          
        }
        
        this.listeners.error.forEach(callback => {
          try {
            callback(error);
          } catch (err) {
          }
        });
      });

      this.isConnecting = false;
    } catch (error) {
      this.isConnecting = false;
      if (__DEV__) {
        console.warn('⚠️ Socket connection failed (chat will work without real-time):', error.message);
      }
      // Don't throw - allow app to continue without WebSocket
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    if (this.socket) {
      
      this.socket.disconnect();
      this.socket = null;
      this.isConnecting = false;
    }
    this.currentUserId = null;
  }

  /**
   * Reconnect to WebSocket server (uses stored userId)
   */
  async reconnect() {
    if (this.currentUserId && !this.isConnecting && !this.socket?.connected) {
      console.log('🔄 [SocketService] Reconnecting with stored userId:', this.currentUserId);
      return await this.connect(this.currentUserId);
    }
  }

  /**
   * Get current user ID
   */
  getCurrentUserId() {
    return this.currentUserId;
  }

  /**
   * Join a chat room
   * @param {string} chatId - Chat ID (enquiryId)
   * @param {string} userId - User ID
   */
  joinChat(chatId, userId) {
    if (!this.socket?.connected) {
      
      return;
    }

    

    this.socket.emit('joinChat', { chatId, userId });
  }

  /**
   * Leave a chat room
   * @param {string} chatId - Chat ID (enquiryId)
   * @param {string} userId - User ID
   */
  leaveChat(chatId, userId) {
    if (!this.socket?.connected) {
      return;
    }

    

    this.socket.emit('leaveChat', { chatId, userId });
  }

  /**
   * Send a message
   * @param {object} data - Message data
   * @param {string} data.chatId - Chat ID (enquiryId)
   * @param {string} data.userId - User ID
   * @param {string} data.message - Message text
   * @param {string} data.messageType - 'text' | 'image' | 'video' | 'file' | 'audio'
   * @param {string} [data.parentMessageId] - Parent message ID for replies
   * @param {string} [data.mediaKey] - Media key from upload
   * @param {string} [data.mediaName] - Media file name
   * @param {string} [data.mediaUrl] - Media URL
   * @param {number} [data.mediaSize] - Media file size
   * @param {string} [data.audioDuration] - Audio duration in MM:SS format
   */
  sendMessage(data) {
    if (!this.socket?.connected) {
      if (__DEV__) {
        console.error('❌ [SocketService] Cannot send message: Socket not connected', {
          hasSocket: !!this.socket,
          isConnected: this.socket?.connected,
          connected: this.connected,
          isConnecting: this.isConnecting,
          socketId: this.socket?.id,
          data: {
            chatId: data?.chatId,
            userId: data?.userId,
            messageLength: data?.message?.length,
          },
        });
      }
      return false;
    }

    if (__DEV__) {
      console.log('📤 [SocketService] Sending message via WebSocket', {
        chatId: data?.chatId,
        userId: data?.userId,
        messageLength: data?.message?.length,
        messageType: data?.messageType,
        hasParentMessage: !!data?.parentMessageId,
      });
    }

    this.socket.emit('sendMessage', data);
    return true;
  }

  /**
   * Send typing indicator
   * @param {string} chatId - Chat ID
   * @param {string} userId - User ID
   * @param {boolean} isTyping - Whether user is typing
   */
  sendTyping(chatId, userId, isTyping) {
    if (!this.socket?.connected) {
      return;
    }

    this.socket.emit('typing', { chatId, userId, isTyping });
  }

  /**
   * Edit a message
   * @param {string} messageId - Message ID
   * @param {string} userId - User ID
   * @param {string} newMessage - New message text
   * Note: Backend API expects { messageId, userId, newMessage } - no chatId needed
   */
  editMessage(messageId, userId, newMessage) {
    if (!this.socket?.connected) {
      if (__DEV__) {
        console.error('❌ [SocketService] Cannot edit message: Socket not connected');
      }
      return false;
    }

    if (__DEV__) {
      console.log('✏️ [SocketService] Editing message via WebSocket', {
        messageId,
        userId,
        newMessageLength: newMessage?.length,
        newMessage: newMessage,
      });
    }

    // Send edit message event - backend expects: { messageId, userId, newMessage }
    this.socket.emit('editMessage', { 
      messageId, 
      userId, 
      newMessage 
    });
    
    if (__DEV__) {
      console.log('✅ [SocketService] Edit message event emitted successfully', {
        messageId,
        userId,
        newMessage: newMessage.substring(0, 50) + '...',
      });
    }
    
    return true;
  }

  /**
   * Delete a message (soft delete)
   * @param {string} messageId - Message ID
   * @param {string} userId - User ID
   * Note: Backend API expects { messageId, userId } - no chatId needed
   */
  deleteMessage(messageId, userId) {
    if (!this.socket?.connected) {
      if (__DEV__) {
        console.error('❌ [SocketService] Cannot delete message: Socket not connected');
      }
      return false;
    }

    if (__DEV__) {
      console.log('🗑️ [SocketService] Deleting message via WebSocket', {
        messageId,
        userId,
      });
    }

    // Send delete message event - backend expects: { messageId, userId }
    this.socket.emit('deleteMessage', { messageId, userId });
    
    if (__DEV__) {
      console.log('✅ [SocketService] Delete message event emitted successfully');
    }
    
    return true;
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event name ('newMessage', 'messagesRead', 'userTyping', 'error', 'connect', 'disconnect')
   * @param {function} callback - Callback function
   * @returns {function} Unsubscribe function
   */
  on(event, callback) {
    if (!this.listeners[event]) {
      return () => {};
    }

    this.listeners[event].push(callback);

    // Return unsubscribe function
    return () => {
      this.off(event, callback);
    };
  }

  /**
   * Unsubscribe from an event
   * @param {string} event - Event name
   * @param {function} callback - Callback function to remove
   */
  off(event, callback) {
    if (!this.listeners[event]) {
      return;
    }

    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  /**
   * Check if socket is connected
   * @returns {boolean}
   */
  isConnected() {
    return this.socket?.connected || false;
  }

  /**
   * Get socket instance (for advanced usage)
   * @returns {Socket|null}
   */
  getSocket() {
    return this.socket;
  }
}

// Export singleton instance
export default new SocketService();

