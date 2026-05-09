import { store } from '../store';
import { api } from '../store/api';

/**
 * RTK list rows use string ids; API/hooks may still have Mongo { $oid }, nested _id, or BSON ObjectId.
 * String(object) === "[object Object]" breaks cache matching — this fixes sender-side list updates.
 */
export function normalizeEntityId(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number') {
    const s = String(value).trim();
    return s === '[object Object]' ? '' : s;
  }
  if (typeof value === 'object') {
    const oid = value.$oid ?? value.oid;
    if (oid != null) return String(oid).trim();
    if (typeof value.toString === 'function' && value._bsontype === 'ObjectID') {
      try {
        return String(value.toString()).trim();
      } catch {
        /* ignore */
      }
    }
    const nested = value._id ?? value.id ?? value.Id;
    if (nested != null && nested !== value) return normalizeEntityId(nested);
  }
  try {
    const s = String(value).trim();
    return s === '[object Object]' ? '' : s;
  } catch {
    return '';
  }
}

/**
 * Walk all fulfilled RTK Query caches for an endpoint and invoke callback with queryArgs.
 */
function forEachFulfilledGetChatsQuery(endpointPrefix, callback) {
  const queries = store.getState().api?.queries;
  if (!queries) return;
  for (const cacheKey of Object.keys(queries)) {
    if (!cacheKey.startsWith(`${endpointPrefix}(`)) continue;
    const inner = cacheKey.slice(endpointPrefix.length + 1, -1);
    let queryArgs;
    try {
      queryArgs = JSON.parse(inner);
    } catch {
      continue;
    }
    const entry = queries[cacheKey];
    if (!entry || entry.status !== 'fulfilled') continue;
    if (!Array.isArray(entry.data)) continue;
    callback(queryArgs);
  }
}

function findChatIndexInDraft(draft, messageChatId, messageEnquiryId) {
  const msgCid = normalizeEntityId(messageChatId);
  const msgEid = normalizeEntityId(messageEnquiryId);
  return draft.findIndex((c) => {
    const rowCid = normalizeEntityId(c.id || c._id || c.chatId || c.ChatId);
    const rowEid = normalizeEntityId(c.enquiryId || c.EnquiryId);
    if (msgCid && rowCid && msgCid === rowCid) return true;
    if (msgEid && rowEid && msgEid === rowEid) return true;
    return false;
  });
}

function hasChatIdInDraft(draft, messageChatId) {
  if (!messageChatId || !Array.isArray(draft)) return false;
  const id = normalizeEntityId(messageChatId);
  if (!id) return false;
  return draft.some((c) => {
    const cid = normalizeEntityId(c.id || c._id || c.chatId || c.ChatId);
    return cid && cid === id;
  });
}

/** Backend may omit type on socket payload; only filter when both sides present */
function messageMatchesQueryType(message, queryArgs) {
  const qType = (queryArgs?.type || '').toString().toLowerCase().trim();
  if (!qType) return true;
  const mType = (
    message?.ChatType ||
    message?.chatType ||
    message?.Type ||
    message?.type ||
    ''
  )
    .toString()
    .toLowerCase()
    .trim();
  // If backend didn't send a type, don't block list updates.
  if (!mType) return true;
  return qType === mType;
}

function previewTextFromMessage(message) {
  const raw =
    message?.Message || message?.message || message?.Text || message?.text || '';
  if (raw != null && String(raw).trim() !== '') return String(raw);

  const t = (message?.MessageType || message?.messageType || '')
    .toString()
    .toLowerCase()
    .trim();
  if (!t || t === 'text') return '';
  if (t === 'image') return '📷 Photo';
  if (t === 'video') return '🎥 Video';
  if (t === 'audio') return '🎤 Voice note';
  if (t === 'file') return '📎 File';
  return '';
}

function buildMinimalGetChatsRow(message, userId) {
  const messageChatId = normalizeEntityId(
    message?.ChatId || message?.chatId || message?.Chat?._id || message?.Chat?.id
  );
  const messageEnquiryId = normalizeEntityId(
    message?.EnquiryId || message?.enquiryId || message?.Enquiry?.id || message?.Enquiry?._id
  );
  if (!messageChatId) return null;

  const senderId = normalizeEntityId(message?.SenderId || message?.senderId);
  const uid = normalizeEntityId(userId);
  const isMyMessage = uid && senderId && senderId === uid;
  const messageText = previewTextFromMessage(message);
  const messageTimestamp =
    message?.Timestamp ||
    message?.timestamp ||
    message?.CreatedAt ||
    message?.createdAt ||
    new Date().toISOString();

  const unread = isMyMessage ? 0 : 1;
  const chatType =
    message.ChatType || message.chatType || message.Type || message.type || null;

  const idStr = messageChatId;

  return {
    id: idStr,
    _id: idStr,
    enquiryId: messageEnquiryId || undefined,
    enquiryTitle:
      message.EnquiryName ||
      message.enquiryTitle ||
      message.EnquiryTitle ||
      'Chat',
    clientName: '',
    lastMessage: messageText,
    lastMessageTime: messageTimestamp,
    unreadCount: unread,
    UnreadCount: unread,
    lastMessageSenderId: senderId,
    lastSenderId: senderId,
    lastMessageSenderName: '',
    type: chatType,
    Type: chatType,
    _originalData: {
      _id: idStr,
      EnquiryId: messageEnquiryId,
      EnquiryName: message.EnquiryName || message.enquiryTitle,
      Type: chatType,
      UnreadCount: unread,
      unreadCount: unread,
      LastMessage: {
        Message: messageText,
        Timestamp: messageTimestamp,
        SenderId: senderId,
      },
    },
  };
}

function buildMinimalEnquiryV2Row(message, userId) {
  const row = buildMinimalGetChatsRow(message, userId);
  if (!row) return null;
  return {
    ...row,
    EnquiryName: row.enquiryTitle,
    LastMessage: row._originalData.LastMessage,
  };
}

/**
 * Call right after the current user successfully sends a message (socket send queued/ok).
 * Updates main Chats list + enquiry chat-group list without waiting for server `newMessage` echo,
 * so going back to the list shows the new preview and order immediately.
 */
export function patchChatListsForLocalOutgoingMessage(dispatch, payload) {
  if (!dispatch || !payload) return;
  const {
    userId,
    chatId,
    enquiryId,
    messageBody,
    messageType = 'text',
    chatType,
    enquiryName,
    chat,
  } = payload;

  const uid = normalizeEntityId(userId);
  const cid = normalizeEntityId(chatId);
  if (!uid || !cid) return;

  const eidRaw =
    enquiryId != null
      ? enquiryId
      : chat?.EnquiryId ?? chat?.enquiryId ?? null;
  const eid = normalizeEntityId(eidRaw);

  const channelType = chatType || chat?.Type || chat?.type || undefined;
  const ename =
    enquiryName ||
    chat?.EnquiryName ||
    chat?.enquiryTitle ||
    chat?.enquiryName ||
    undefined;

  const ts = new Date().toISOString();
  const body =
    messageBody != null && String(messageBody).trim() !== ''
      ? String(messageBody).trim()
      : messageType === 'image'
        ? 'Photo'
        : messageType === 'video'
          ? 'Video'
          : messageType === 'audio'
            ? 'Audio'
            : 'Message';

  const synthetic = {
    ChatId: cid,
    chatId: cid,
    ...(eid ? { EnquiryId: eid, enquiryId: eid } : {}),
    SenderId: uid,
    senderId: uid,
    Message: body,
    message: body,
    MessageType: messageType,
    Timestamp: ts,
    CreatedAt: ts,
    ...(channelType ? { Type: channelType, ChatType: channelType } : {}),
    ...(ename ? { EnquiryName: ename } : {}),
  };

  const patchedMain = patchAllGetChatsCachesForNewMessage(dispatch, synthetic, uid);
  const patchedEnq = patchGetChatsByEnquiryV2ForNewMessage(dispatch, synthetic, uid);
  if (!patchedMain && !patchedEnq) {
    dispatch(api.util.invalidateTags(['Chat']));
  }
}

/**
 * Apply newMessage: update existing row, or prepend minimal row on page 1 and trim to limit.
 */
export function patchAllGetChatsCachesForNewMessage(dispatch, message, userId) {
  const messageChatId = normalizeEntityId(
    message?.ChatId || message?.chatId || message?.Chat?._id || message?.Chat?.id
  );
  const messageEnquiryId = normalizeEntityId(
    message?.EnquiryId || message?.enquiryId || message?.Enquiry?.id || message?.Enquiry?._id
  );
  if (!messageChatId && !messageEnquiryId) return false;

  const senderId = normalizeEntityId(message?.SenderId || message?.senderId);
  const uid = normalizeEntityId(userId);
  const isMyMessage = uid && senderId && senderId === uid;
  const messageText = previewTextFromMessage(message);
  const messageTimestamp =
    message?.Timestamp ||
    message?.timestamp ||
    message?.CreatedAt ||
    message?.createdAt ||
    new Date().toISOString();

  let anyPatched = false;

  const updateExisting = (draft) => {
    const chatIndex = findChatIndexInDraft(draft, messageChatId, messageEnquiryId);
    if (chatIndex === -1) return false;

    const chat = draft[chatIndex];
    const oldUnreadCount = Number(chat.unreadCount || chat.UnreadCount || 0);

    chat.lastMessage = messageText;
    chat.LastMessage = messageText;
    chat.lastMessageTime = messageTimestamp;
    chat.LastMessageTime = messageTimestamp;
    chat.lastMessageSenderId = senderId;
    chat.lastSenderId = senderId;

    if (!isMyMessage) {
      const newUnreadCount = oldUnreadCount + 1;
      chat.unreadCount = newUnreadCount;
      chat.UnreadCount = newUnreadCount;
      if (chat._originalData) {
        chat._originalData.UnreadCount = newUnreadCount;
        chat._originalData.unreadCount = newUnreadCount;
      }
    }

    if (chat._originalData) {
      if (chat._originalData.LastMessage) {
        chat._originalData.LastMessage.Message = messageText;
        chat._originalData.LastMessage.Timestamp = messageTimestamp;
        chat._originalData.LastMessage.SenderId = senderId;
      } else {
        chat._originalData.LastMessage = {
          Message: messageText,
          Timestamp: messageTimestamp,
          SenderId: senderId,
        };
      }
      chat._originalData.LastMessageTime = messageTimestamp;
    }

    draft.splice(chatIndex, 1);
    draft.unshift(chat);
    draft.sort((a, b) => {
      try {
        const timeA = new Date(a.lastMessageTime || a.LastMessageTime || 0);
        const timeB = new Date(b.lastMessageTime || b.LastMessageTime || 0);
        return timeB - timeA;
      } catch {
        return 0;
      }
    });
    return true;
  };

  const prependIfMissing = (draft, queryArgs) => {
    const page = queryArgs.page != null ? Number(queryArgs.page) : 1;
    const limit = queryArgs.limit != null ? Number(queryArgs.limit) : 25;
    const search = (queryArgs.search || '').toString().trim();

    if (page !== 1) return false;
    if (search) return false;
    if (!messageChatId) return false;
    if (hasChatIdInDraft(draft, messageChatId)) return false;
    if (!messageMatchesQueryType(message, queryArgs)) return false;

    const row = buildMinimalGetChatsRow(
      { ...message, ChatId: messageChatId, EnquiryId: messageEnquiryId || undefined },
      uid
    );
    if (!row) return false;

    draft.unshift(row);
    while (draft.length > limit) {
      draft.pop();
    }
    return true;
  };

  forEachFulfilledGetChatsQuery('getChats', (queryArgs) => {
    try {
      dispatch(
        api.util.updateQueryData('getChats', queryArgs, (draft) => {
          if (!Array.isArray(draft)) return;
          if (updateExisting(draft)) {
            anyPatched = true;
            return;
          }
          if (prependIfMissing(draft, queryArgs)) {
            anyPatched = true;
          }
        })
      );
    } catch {
      // no cache
    }
  });

  return anyPatched;
}

/**
 * ChatGroups — update existing, or prepend + trim when chat was not in loaded list.
 */
export function patchGetChatsByEnquiryV2ForNewMessage(dispatch, message, userId) {
  const messageChatId = normalizeEntityId(
    message?.ChatId || message?.chatId || message?.Chat?._id || message?.Chat?.id
  );
  const messageEnquiryId = normalizeEntityId(
    message?.EnquiryId || message?.enquiryId || message?.Enquiry?.id || message?.Enquiry?._id
  );
  if (!messageEnquiryId) return false;

  const senderId = normalizeEntityId(message?.SenderId || message?.senderId);
  const uid = normalizeEntityId(userId);
  const isMyMessage = uid && senderId && senderId === uid;
  const messageText = previewTextFromMessage(message);
  const messageTimestamp =
    message?.Timestamp ||
    message?.timestamp ||
    message?.CreatedAt ||
    message?.createdAt ||
    new Date().toISOString();

  const enquiryStr = messageEnquiryId;
  let anyPatched = false;

  const updateExisting = (immerDraft) => {
    const chatIndex = findChatIndexInDraft(immerDraft, messageChatId, messageEnquiryId);
    if (chatIndex === -1) return false;

    const chat = immerDraft[chatIndex];
    const oldUnread = Number(chat.unreadCount || chat.UnreadCount || 0);

    chat.lastMessage = messageText;
    chat.lastMessageTime = messageTimestamp;
    chat.UnreadCount = isMyMessage ? oldUnread : oldUnread + 1;
    chat.unreadCount = chat.UnreadCount;
    // ChatGroupsScreen prefers `chat.LastMessage` object (not `lastMessage` string).
    // Keep it in sync for enquiry chat lists.
    chat.LastMessage = {
      Message: messageText,
      MessageType: message?.MessageType || message?.messageType || 'text',
      Timestamp: messageTimestamp,
      SenderId: senderId,
      Sender: message?.Sender || message?.sender || null,
    };

    if (chat._originalData) {
      chat._originalData.UnreadCount = chat.UnreadCount;
      chat._originalData.unreadCount = chat.UnreadCount;
      if (chat._originalData.LastMessage && typeof chat._originalData.LastMessage === 'object') {
        chat._originalData.LastMessage.Message = messageText;
        chat._originalData.LastMessage.MessageType =
          message?.MessageType || message?.messageType || chat._originalData.LastMessage.MessageType || 'text';
        chat._originalData.LastMessage.Timestamp = messageTimestamp;
        chat._originalData.LastMessage.SenderId = senderId;
      } else {
        chat._originalData.LastMessage = {
          Message: messageText,
          MessageType: message?.MessageType || message?.messageType || 'text',
          Timestamp: messageTimestamp,
          SenderId: senderId,
          Sender: message?.Sender || message?.sender || null,
        };
      }
    }

    immerDraft.splice(chatIndex, 1);
    immerDraft.unshift(chat);
    immerDraft.sort((a, b) => {
      try {
        const ta = new Date(a.lastMessageTime || a.LastMessage?.Timestamp || 0);
        const tb = new Date(b.lastMessageTime || b.LastMessage?.Timestamp || 0);
        return tb - ta;
      } catch {
        return 0;
      }
    });
    return true;
  };

  const prependIfMissing = (immerDraft, queryArgs) => {
    const limit = queryArgs.limit != null ? Number(queryArgs.limit) : 100;
    if (!messageChatId) return false;
    if (hasChatIdInDraft(immerDraft, messageChatId)) return false;

    const row = buildMinimalEnquiryV2Row(
      { ...message, ChatId: messageChatId, EnquiryId: messageEnquiryId },
      uid
    );
    if (!row) return false;

    immerDraft.unshift(row);
    while (immerDraft.length > limit) {
      immerDraft.pop();
    }
    return true;
  };

  forEachFulfilledGetChatsQuery('getChatsByEnquiryV2', (queryArgs) => {
    const paramEnquiry = normalizeEntityId(queryArgs?.enquiryId);
    if (paramEnquiry !== enquiryStr) return;

    try {
      dispatch(
        api.util.updateQueryData('getChatsByEnquiryV2', queryArgs, (immerDraft) => {
          if (!Array.isArray(immerDraft)) return;
          if (updateExisting(immerDraft)) {
            anyPatched = true;
            return;
          }
          if (prependIfMissing(immerDraft, queryArgs)) {
            anyPatched = true;
          }
        })
      );
    } catch {
      // ignore
    }
  });

  return anyPatched;
}

/**
 * Apply messagesRead payload to getChats + getChatsByEnquiryV2 caches.
 */
export function patchAllCachesForMessagesRead(dispatch, data, userId) {
  if (!data?.chatId) return false;
  const chatId = normalizeEntityId(data.chatId);
  if (!chatId) return false;
  const newUnread =
    data.unreadCount !== undefined && data.unreadCount !== null ? Number(data.unreadCount) : 0;

  const me = normalizeEntityId(userId);
  const eventUserId = data.userId != null ? normalizeEntityId(data.userId) : null;
  const isForMe =
    (eventUserId === me && data.unreadCount !== undefined) ||
    (Array.isArray(data.userIds) && data.userIds.some((id) => normalizeEntityId(id) === me));

  if (!isForMe) return false;

  let anyPatched = false;

  const patchDraft = (draft) => {
    if (!Array.isArray(draft)) return;
    const chat = draft.find((c) => {
      const cId = normalizeEntityId(c.id || c._id);
      return cId && cId === chatId;
    });
    if (chat) {
      chat.unreadCount = newUnread;
      chat.UnreadCount = newUnread;
      if (chat._originalData) {
        chat._originalData.UnreadCount = newUnread;
        chat._originalData.unreadCount = newUnread;
      }
      return true;
    }
    return false;
  };

  forEachFulfilledGetChatsQuery('getChats', (queryArgs) => {
    try {
      dispatch(
        api.util.updateQueryData('getChats', queryArgs, (draft) => {
          if (patchDraft(draft)) anyPatched = true;
        })
      );
    } catch {
      // ignore
    }
  });

  forEachFulfilledGetChatsQuery('getChatsByEnquiryV2', (queryArgs) => {
    try {
      dispatch(
        api.util.updateQueryData('getChatsByEnquiryV2', queryArgs, (draft) => {
          if (patchDraft(draft)) anyPatched = true;
        })
      );
    } catch {
      // ignore
    }
  });

  return anyPatched;
}

/**
 * Fallback when nothing could be merged (missing ids / type mismatch / empty caches).
 */
export function invalidateAllChatListQueries(dispatch) {
  dispatch(api.util.invalidateTags(['Chat']));
}