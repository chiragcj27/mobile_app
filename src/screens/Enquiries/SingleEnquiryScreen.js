import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Text,
  Platform,
  Modal,
  FlatList,
  Dimensions,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import ImageZoom from 'react-native-image-pan-zoom';
import Video from 'react-native-video';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import {
  useGetEnquiryByIdQuery,
  useDeleteEnquiryMutation,
  useApproveDesignVersionMutation,
  useRejectDesignVersionMutation,
  useUploadReferenceImagesMutation,
} from '../../store/api';
import { useClients } from '../../features/clients/clientsHooks';
import { Card } from '../../components/cards/Cards';
import {
  Button,
  Input,
  EnquiryImage,
  OptimizedImage,
} from '../../components/common';
import { AnimatedLogoLoader } from '../../components/common';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import Icon from '../../components/common/Icon';
import BrandedAlert from '../../components/common/BrandedAlert';
import {
  formatCurrency,
  formatDate,
  getStatusColor,
  getPriorityColor,
  imageSizes,
  spacing,
} from '../../utils';
import { EnquiryHistoryModal } from '../../components/modals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../../config/apiConfig';
import { useUsers } from '../../features/users/usersHooks';
import { getUserName, useUserName } from '../../utils/userUtils';

const SingleEnquiryScreen = ({ route, navigation }) => {
  const { user } = useAuth();
  const {
    enquiry: initialEnquiry,
    enquiryId: routeEnquiryId,
    shouldRefresh,
  } = route.params || {};

  // Store initial AssignedTo as fallback (in case refetch loses it)
  const initialAssignedToRef = useRef(null);

  // Capture initial AssignedTo from initialEnquiry if available
  useEffect(() => {
    if (initialEnquiry && !initialAssignedToRef.current) {
      const initialId =
        initialEnquiry?._originalData?.AssignedTo ||
        initialEnquiry?.AssignedTo ||
        initialEnquiry?.assignedTo;
      if (initialId) {
        initialAssignedToRef.current = initialId;
        console.log(
          '[SingleEnquiry] 💾 Stored initial AssignedTo as fallback:',
          initialId,
        );
      }
    }
  }, [initialEnquiry]);

  // Log route params when screen loads or params change
  useEffect(() => {}, [
    route.params,
    initialEnquiry,
    routeEnquiryId,
    shouldRefresh,
  ]);

  // Fetch and cache users for name resolution
  const { users: usersList, isLoading: usersLoading } = useUsers();

  // Debug: Log users loading status
  useEffect(() => {
    console.log('[SingleEnquiry] 👥 Users Debug:', {
      usersLoading: usersLoading,
      'usersList length': usersList?.length || 0,
      'sample users': usersList?.slice(0, 3).map(u => ({
        id: u.id || u._id,
        name: u.name || u.Name,
        email: u.email || u.Email,
      })),
    });
  }, [usersLoading, usersList]);

  // Automatic cache cleanup on screen mount (runs once per app session)
  useEffect(() => {
    let cleanupTimer;
    const performCleanup = async () => {
      try {
        // Clean up expired entries and old cache on screen load
        const allKeys = await AsyncStorage.getAllKeys();
        const cacheKeys = allKeys.filter(key => key.startsWith('image_cache_'));

        if (cacheKeys.length > 0) {
          const now = Date.now();
          const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
          const cacheEntries = await AsyncStorage.multiGet(cacheKeys);

          const expiredKeys = cacheEntries
            .map(([key, value]) => {
              try {
                const data = JSON.parse(value);
                const age = now - (data.timestamp || 0);
                return age > maxAge ? key : null;
              } catch {
                return key; // Remove invalid entries
              }
            })
            .filter(Boolean);

          if (expiredKeys.length > 0) {
            await AsyncStorage.multiRemove(expiredKeys);
          }

          // If we still have more than 100 cached images, remove oldest 30%
          const remainingKeys = cacheKeys.filter(k => !expiredKeys.includes(k));
          if (remainingKeys.length > 100) {
            const remainingEntries = cacheEntries
              .filter(([key]) => !expiredKeys.includes(key))
              .map(([key, value]) => {
                try {
                  const data = JSON.parse(value);
                  return { key, timestamp: data.timestamp || 0 };
                } catch {
                  return { key, timestamp: 0 };
                }
              })
              .sort((a, b) => a.timestamp - b.timestamp);

            const toRemove = Math.floor(remainingEntries.length * 0.3);
            const oldestKeys = remainingEntries
              .slice(0, toRemove)
              .map(e => e.key);

            if (oldestKeys.length > 0) {
              await AsyncStorage.multiRemove(oldestKeys);
            }
          }
        }
      } catch (error) {
        // Silently handle cache cleanup errors
      }
    };

    // Run cleanup after a short delay to not block initial render
    cleanupTimer = setTimeout(performCleanup, 2000);

    return () => {
      if (cleanupTimer) clearTimeout(cleanupTimer);
    };
  }, []); // Run once on mount

  // Use route enquiryId or initialEnquiry id
  const enquiryId = routeEnquiryId || initialEnquiry?.id || initialEnquiry?._id;

  // Log enquiryId
  useEffect(() => {}, [enquiryId]);

  // Redux hooks - refetch when screen comes into focus to get latest pricing updates
  const {
    data: enquiryData,
    isLoading: loading,
    error: queryError,
    refetch,
  } = useGetEnquiryByIdQuery(enquiryId, {
    skip: !enquiryId,
    refetchOnFocus: true, // Refetch when screen comes into focus to get latest data (including pricing)
    refetchOnMountOrArgChange: true, // Refetch when enquiryId changes
  });

  // Auto-retry logic for notification navigation (handles timing issues)
  const retryCountRef = useRef(0);
  const maxRetries = 3;
  useEffect(() => {
    // If we have an error and enquiryId, and haven't retried too many times, auto-retry
    if (
      queryError &&
      enquiryId &&
      retryCountRef.current < maxRetries &&
      !loading
    ) {
      const isServerError =
        queryError?.status === 500 || queryError?.originalStatus === 500;
      const isNotFound =
        queryError?.status === 404 || queryError?.originalStatus === 404;

      // Only auto-retry for server errors (might be timing issue) or not found (might be newly created)
      if (isServerError || isNotFound) {
        retryCountRef.current += 1;
        const delay = retryCountRef.current * 1000; // 1s, 2s, 3s delays
        console.log(
          `[SingleEnquiry] 🔄 Auto-retry ${retryCountRef.current}/${maxRetries} in ${delay}ms for enquiry:`,
          enquiryId,
        );

        const retryTimer = setTimeout(() => {
          refetch();
        }, delay);

        return () => clearTimeout(retryTimer);
      }
    }
  }, [queryError, enquiryId, loading, refetch]);

  // Reset retry count when enquiryId changes
  useEffect(() => {
    retryCountRef.current = 0;
  }, [enquiryId]);

  // Watch for status changes and log them
  useEffect(() => {
    if (enquiryData && enquiryId) {
      const currentStatus =
        enquiryData?.status ||
        enquiryData?.Status ||
        enquiryData?._originalData?.Status;
    }
  }, [enquiryData, enquiryId]);

  // Log enquiryData changes - reduced logging to prevent performance issues
  useEffect(() => {}, [
    enquiryData?.id,
    enquiryData?.StoneType,
    enquiryData?.StyleNumber,
    enquiryData?.GatiOrderNumber,
    shouldRefresh,
  ]);

  const [deleteEnquiry, { isLoading: isDeleting }] = useDeleteEnquiryMutation();

  // Fetch clients for name lookup (using cached hook)
  const { clients: clientsData = [], isLoading: clientsLoading } = useClients({
    skip: false,
  });

  const clients = Array.isArray(clientsData) ? clientsData : [];

  // Create client ID to name lookup map - handle all possible ID formats
  const clientNameMap = useMemo(() => {
    const map = new Map();
    if (clients && clients.length > 0) {
      clients.forEach(client => {
        // Get ID from multiple possible fields
        const clientId = client.id || client._id || client.Id;
        const clientName = client.name || client.Name;

        if (clientId && clientName) {
          // Normalize ID to string and create multiple lookup keys
          const idStr = String(clientId).trim();

          // Store with original format
          map.set(idStr, clientName);

          // Remove spaces
          const noSpaces = idStr.replace(/\s/g, '');
          map.set(noSpaces, clientName);

          // Handle MongoDB ObjectId format variations
          const cleanId = idStr
            .replace(/^ObjectId\(/, '')
            .replace(/\)$/, '')
            .trim();
          if (cleanId !== idStr) {
            map.set(cleanId, clientName);
            map.set(cleanId.replace(/\s/g, ''), clientName);
          }

          // Also try lowercase version (in case of case sensitivity issues)
          map.set(idStr.toLowerCase(), clientName);
          map.set(noSpaces.toLowerCase(), clientName);
        }
      });
    } else {
    }
    return map;
  }, [clients]);

  // Helper to get client name from ID - try multiple matching strategies
  const getClientName = clientId => {
    if (!clientId) {
      return 'Unknown Client';
    }

    const idStr = String(clientId).trim();

    // Try exact match first
    if (clientNameMap.has(idStr)) {
      return clientNameMap.get(idStr);
    }

    // Try without spaces
    const noSpaces = idStr.replace(/\s/g, '');
    if (clientNameMap.has(noSpaces)) {
      return clientNameMap.get(noSpaces);
    }

    // Try cleaned ObjectId format
    const cleanId = idStr
      .replace(/^ObjectId\(/, '')
      .replace(/\)$/, '')
      .trim();
    if (cleanId !== idStr && clientNameMap.has(cleanId)) {
      return clientNameMap.get(cleanId);
    }

    const cleanNoSpaces = cleanId.replace(/\s/g, '');
    if (clientNameMap.has(cleanNoSpaces)) {
      return clientNameMap.get(cleanNoSpaces);
    }

    // Try lowercase
    if (clientNameMap.has(idStr.toLowerCase())) {
      return clientNameMap.get(idStr.toLowerCase());
    }

    // Fallback: Direct search in clients array (more flexible matching)
    if (clients && clients.length > 0) {
      const foundClient = clients.find(c => {
        const cId = String(c.id || c._id || c.Id || '').trim();
        const cIdNoSpaces = cId.replace(/\s/g, '');
        const enquiryIdNoSpaces = idStr.replace(/\s/g, '');

        return (
          cId === idStr ||
          cIdNoSpaces === enquiryIdNoSpaces ||
          cId.toLowerCase() === idStr.toLowerCase() ||
          cIdNoSpaces.toLowerCase() === enquiryIdNoSpaces.toLowerCase()
        );
      });

      if (foundClient) {
        const name = foundClient.name || foundClient.Name;
        if (name && name !== 'Unknown Client') {
          return name;
        }
      }
    }

    // Removed console.warn from render - it causes performance issues
    // Logging moved to useEffect to avoid blocking render

    return 'Unknown Client';
  };

  // Local UI state
  const [approvalMessage, setApprovalMessage] = useState('');
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showVersionSelector, setShowVersionSelector] = useState(false);
  const [selectedDesignType, setSelectedDesignType] = useState(null); // 'coral' or 'cad'
  const [selectedVersionIndex, setSelectedVersionIndex] = useState(null);
  const [selectedImageUri, setSelectedImageUri] = useState(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isImageModalVisible, setImageModalVisible] = useState(false);
  const [modalImages, setModalImages] = useState([]); // Store image objects for modal
  const modalFlatListRef = useRef(null);
  const [modalCurrentIndex, setModalCurrentIndex] = useState(0);
  const [isModalZoomed, setIsModalZoomed] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  const showAlert = (title, message, type = 'info', buttons = []) =>
    setAlertConfig({ visible: true, title, message, type, buttons });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));
  const [descExpanded, setDescExpanded] = useState(false);
  const [specialRemarksExpanded, setSpecialRemarksExpanded] = useState(false);
  const [coralExpanded, setCoralExpanded] = useState(true);

  // Handle sharing to WhatsApp
  const handleShareToWhatsApp = useCallback(async () => {
    if (isSharing) return;

    setIsSharing(true);
    try {
      const currentMedia = modalImages[modalCurrentIndex] || modalImages[0];
      if (!currentMedia) {
        showAlert('Error', 'No media to share', 'error');
        setIsSharing(false);
        return;
      }

      const isVideo = currentMedia.isVideo;
      const mediaKey = currentMedia.imageKey || currentMedia.imageId;
      const mediaUri =
        currentMedia.imageUri || currentMedia.cachedUri || selectedImageUri;

      if (!mediaKey && !mediaUri) {
        showAlert('Error', 'Media URL not available', 'error');
        setIsSharing(false);
        return;
      }

      const token = await AsyncStorage.getItem('token');
      if (!token) {
        showAlert('Error', 'Authentication required', 'error');
        setIsSharing(false);
        return;
      }

      let fileUrl = mediaUri;

      // If we don't have a direct URL, fetch presigned URL
      if (
        !fileUrl ||
        (!fileUrl.startsWith('http') && !fileUrl.startsWith('file://'))
      ) {
        try {
          const encodedKey = encodeURIComponent(mediaKey);
          const response = await fetch(
            `${API_BASE_URL}/api/enquiries/files/${encodedKey}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          );

          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const jsonData = await response.json();
              fileUrl =
                jsonData.url ||
                jsonData.videoUrl ||
                jsonData.src ||
                jsonData.location;
            } else {
              // Direct file response - download to temp file
              const arrayBuffer = await response.arrayBuffer();
              const tempDir = RNFS.CachesDirectoryPath;
              const fileName =
                mediaKey.split('/').pop() ||
                `media_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`;
              const tempFilePath = `${tempDir}/${fileName}`;

              // Convert to base64
              const bytes = new Uint8Array(arrayBuffer);
              let binary = '';
              const chunkSize = 8192;
              for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.subarray(i, i + chunkSize);
                binary += String.fromCharCode.apply(null, chunk);
              }

              let base64;
              try {
                base64 = btoa(binary);
              } catch (e) {
                if (typeof Buffer !== 'undefined') {
                  base64 = Buffer.from(binary, 'binary').toString('base64');
                } else {
                  throw new Error('Unable to convert to base64');
                }
              }

              await RNFS.writeFile(tempFilePath, base64, 'base64');
              fileUrl = `file://${tempFilePath}`;
            }
          }
        } catch (error) {
          showAlert('Error', 'Failed to prepare media for sharing', 'error');
          setIsSharing(false);
          return;
        }
      }

      // If fileUrl is a remote URL, download it first
      if (fileUrl.startsWith('http') && !fileUrl.startsWith('file://')) {
        try {
          const response = await fetch(fileUrl, {
            headers: fileUrl.includes('amazonaws.com')
              ? {}
              : {
                  Authorization: `Bearer ${token}`,
                },
          });

          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const tempDir = RNFS.CachesDirectoryPath;
            const fileName = mediaKey
              ? mediaKey.split('/').pop()
              : `media_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`;
            const tempFilePath = `${tempDir}/${fileName}`;

            // Convert to base64
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const chunk = bytes.subarray(i, i + chunkSize);
              binary += String.fromCharCode.apply(null, chunk);
            }

            let base64;
            try {
              base64 = btoa(binary);
            } catch (e) {
              if (typeof Buffer !== 'undefined') {
                base64 = Buffer.from(binary, 'binary').toString('base64');
              } else {
                throw new Error('Unable to convert to base64');
              }
            }

            await RNFS.writeFile(tempFilePath, base64, 'base64');
            fileUrl = `file://${tempFilePath}`;
          }
        } catch (error) {
          showAlert('Error', 'Failed to download media for sharing', 'error');
          setIsSharing(false);
          return;
        }
      }

      // Share via WhatsApp
      const shareMessage = `Reference ${
        isVideo ? 'Video' : 'Image'
      } from Enquiry`;

      try {
        await Share.open({
          message: shareMessage,
          url: fileUrl,
          type: isVideo ? 'video/mp4' : 'image/jpeg',
          social: Share.Social.WHATSAPP,
        });
      } catch (shareError) {
        // If WhatsApp sharing fails, try general share
        if (shareError.message !== 'User did not share') {
          await Share.open({
            message: `${shareMessage}\n\n${
              isVideo ? 'Video' : 'Image'
            }: ${fileUrl}`,
            url: fileUrl,
            type: isVideo ? 'video/mp4' : 'image/jpeg',
          });
        }
      }
    } catch (error) {
      showAlert('Error', error.message || 'Failed to share media', 'error');
    } finally {
      setIsSharing(false);
    }
  }, [isSharing, modalImages, modalCurrentIndex, selectedImageUri]);

  const handleImagePress = (uri, index, allImages) => {
    if (!uri) {
      return;
    }
    if (__DEV__) {
    }
    const imagesForModal = allImages || [];
    setSelectedImageIndex(index);
    setModalImages(imagesForModal);
    setIsModalZoomed(false);
    setSelectedImageUri(uri);
    setModalCurrentIndex(index);
    setImageModalVisible(true);
  };

  const closeImageModal = () => {
    setImageModalVisible(false);
    setSelectedImageUri(null);
    setModalImages([]);
    setModalCurrentIndex(0);
    setIsModalZoomed(false);
  };

  // Scroll to selected image when modal opens
  useEffect(() => {
    if (isImageModalVisible && modalImages.length > 1) {
      // Ensure selected index image URI is set (prevents flicker)
      const targetImage = modalImages[modalCurrentIndex];
      if (targetImage) {
        // For videos, we need to fetch the URL if not available
        if (targetImage.isVideo) {
          // Video URL will be fetched by Video component in modal
          setSelectedImageUri(
            targetImage.imageUri || targetImage.cachedUri || null,
          );
        } else {
          setSelectedImageUri(
            targetImage.cachedUri || targetImage.imageUri || null,
          );
        }
      }

      if (modalFlatListRef.current) {
        requestAnimationFrame(() => {
          modalFlatListRef.current?.scrollToIndex({
            index: modalCurrentIndex,
            animated: false,
          });
        });
      }
    }
  }, [isImageModalVisible, modalCurrentIndex, modalImages]);

  // State for image modal slider - must be at top level of component
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;

  useEffect(() => {
    if (!isImageModalVisible) {
      setIsModalZoomed(false);
    }
  }, [isImageModalVisible]);
  const ZOOM_ON_THRESHOLD = 1.05;
  const ZOOM_OFF_THRESHOLD = 1.02;

  const handleZoomMove = useCallback(
    event => {
      const scale = event?.scale ?? 1;
      setIsModalZoomed(prev => {
        if (!prev && scale >= ZOOM_ON_THRESHOLD) {
          return true;
        }
        if (prev && scale <= ZOOM_OFF_THRESHOLD) {
          return false;
        }
        return prev;
      });
    },
    [ZOOM_ON_THRESHOLD, ZOOM_OFF_THRESHOLD],
  );

  // Viewability config for modal FlatList - must be at component level
  const updateModalIndex = useCallback(
    (index, scrollList = true) => {
      const boundedIndex = Math.max(
        0,
        Math.min((modalImages?.length || 1) - 1, index),
      );
      if (modalFlatListRef.current && scrollList && modalImages.length > 1) {
        modalFlatListRef.current.scrollToIndex({
          index: boundedIndex,
          animated: true,
        });
      }

      requestAnimationFrame(() => {
        setModalCurrentIndex(prev =>
          prev === boundedIndex ? prev : boundedIndex,
        );
        const targetImage = modalImages?.[boundedIndex];
        if (targetImage) {
          // For videos, use imageUri or cachedUri
          if (targetImage.isVideo) {
            setSelectedImageUri(
              targetImage.imageUri || targetImage.cachedUri || null,
            );
          } else {
            setSelectedImageUri(
              targetImage.cachedUri || targetImage.imageUri || null,
            );
          }
        }
        setIsModalZoomed(false);
      });
    },
    [modalImages],
  );

  const getModalImageKey = useCallback((item, index) => {
    return (
      item?.imageKey ||
      item?.imageId ||
      item?.imageUri ||
      `modal-image-${index}`
    );
  }, []);

  const handleModalPrev = useCallback(() => {
    if (!modalImages || modalImages.length <= 1) return;
    updateModalIndex(modalCurrentIndex - 1);
  }, [modalImages, modalCurrentIndex, updateModalIndex]);

  const handleModalNext = useCallback(() => {
    if (!modalImages || modalImages.length <= 1) return;
    updateModalIndex(modalCurrentIndex + 1);
  }, [modalImages, modalCurrentIndex, updateModalIndex]);

  const modalOnViewableItemsChanged = useCallback(
    ({ viewableItems }) => {
      if (viewableItems.length > 0) {
        const nextIndex = viewableItems[0].index || 0;
        if (nextIndex !== modalCurrentIndex) {
          updateModalIndex(nextIndex, false);
        }
      }
    },
    [modalCurrentIndex, updateModalIndex],
  );

  const modalViewabilityConfig = useMemo(
    () => ({
      itemVisiblePercentThreshold: 50,
    }),
    [],
  );

  // API mutations
  const [approveDesignVersion, { isLoading: isApproving }] =
    useApproveDesignVersionMutation();
  const [rejectDesignVersion, { isLoading: isRejecting }] =
    useRejectDesignVersionMutation();
  const [uploadReferenceImages, { isLoading: isUploadingReference }] =
    useUploadReferenceImagesMutation();

  // Use enquiry from query if available, otherwise use initialEnquiry
  const enquiry = enquiryData || initialEnquiry || {};

  // Log which enquiry source is being used
  useEffect(() => {}, [enquiryData, initialEnquiry, enquiry]);

  // Get original data for accessing raw API fields
  const originalData = enquiry?._originalData || enquiry;

  console.log('originalData-------gatiOrderNumber-->', enquiry);
  // Extract AssignedTo ID using useMemo to reactively update when enquiry data changes
  // IMPORTANT: Check StatusHistory first (most accurate), then _originalData, then normalized enquiry
  const assignedToId = useMemo(() => {
    let id = null;

    // Priority 1: Check StatusHistory (most accurate source - latest assignment)
    const statusHistory =
      enquiry?._originalData?.StatusHistory ||
      originalData?.StatusHistory ||
      enquiry?.StatusHistory ||
      [];

    if (Array.isArray(statusHistory) && statusHistory.length > 0) {
      // Sort by timestamp (latest first)
      const sortedHistory = [...statusHistory].sort((a, b) => {
        const dateA = new Date(a.Timestamp || a.timestamp || 0);
        const dateB = new Date(b.Timestamp || b.timestamp || 0);
        return dateB - dateA; // Descending order (latest first)
      });

      // Find the latest entry that has AssignedTo
      for (const entry of sortedHistory) {
        if (entry.AssignedTo || entry.assignedTo) {
          id = entry.AssignedTo || entry.assignedTo;
          console.log(
            '[SingleEnquiry] ✅ Found AssignedTo in StatusHistory:',
            id,
          );
          break;
        }
      }
    }

    // Priority 2: Check _originalData (raw API response) - this is most reliable if StatusHistory doesn't have it
    if (!id) {
      id =
        enquiry?._originalData?.AssignedTo ||
        originalData?.AssignedTo ||
        originalData?.assignedTo;
      if (id) {
        console.log(
          '[SingleEnquiry] ✅ Found AssignedTo in _originalData:',
          id,
        );
      }
    }

    // Priority 3: Check normalized enquiry fields
    if (!id) {
      id = enquiry?.AssignedTo || enquiry?.assignedTo;
      if (id) {
        console.log('[SingleEnquiry] ✅ Found AssignedTo in enquiry:', id);
      }
    }

    // Priority 4: Use stored fallback if current data doesn't have it
    if (!id) {
      id = initialAssignedToRef.current;
      if (id) {
        console.log('[SingleEnquiry] ⚠️ Using fallback AssignedTo:', id);
      }
    }

    // Update fallback if we found a new value
    if (id && id !== initialAssignedToRef.current) {
      initialAssignedToRef.current = id;
    }

    // Handle case where id might be an object (shouldn't happen, but just in case)
    if (id && typeof id === 'object') {
      console.warn(
        '[SingleEnquiry] ⚠️ AssignedTo is an object, extracting ID:',
        id,
      );
      id = id.id || id._id || id.toString();
    }

    // Debug: Log assignedToId extraction with detailed info
    console.log('[SingleEnquiry] 🔍 AssignedTo ID extracted (useMemo):', {
      'StatusHistory length': statusHistory?.length || 0,
      'enquiry?._originalData?.AssignedTo': enquiry?._originalData?.AssignedTo,
      'originalData?.AssignedTo': originalData?.AssignedTo,
      'originalData?.assignedTo': originalData?.assignedTo,
      'enquiry?.AssignedTo': enquiry?.AssignedTo,
      'enquiry?.assignedTo': enquiry?.assignedTo,
      'Final assignedToId': id,
      'assignedToId type': typeof id,
      'originalData exists': !!originalData,
      'enquiry exists': !!enquiry,
      'enquiry._originalData exists': !!enquiry?._originalData,
    });

    return id || null;
  }, [
    enquiry?._originalData?.StatusHistory, // Check StatusHistory
    originalData?.StatusHistory,
    enquiry?.StatusHistory,
    enquiry?._originalData?.AssignedTo, // Check _originalData.AssignedTo specifically
    originalData?.AssignedTo,
    originalData?.assignedTo,
    enquiry?.AssignedTo,
    enquiry?.assignedTo,
    enquiry?._originalData, // Also watch entire _originalData object
    enquiry, // Watch entire enquiry object
  ]);

  // Use reactive hook to get assigned user name
  const assignedToName = useUserName(assignedToId);

  // Debug: Log assignedToName from hook
  useEffect(() => {
    console.log('[SingleEnquiry] 👤 AssignedToName from hook:', {
      assignedToId: assignedToId,
      assignedToName: assignedToName,
      'assignedToName type': typeof assignedToName,
    });
  }, [assignedToId, assignedToName]);

  // Log originalData for debugging - Enhanced to show all fields
  useEffect(() => {}, [enquiry, originalData]);

  // Debug: Log enquiry structure to understand data format
  useEffect(() => {}, [enquiry]);

  // Get priority from API (show as badge)
  const priority =
    originalData?.Priority ||
    enquiry?.Priority ||
    enquiry?.priority ||
    'Normal';

  // Get status from API - use original value, not normalized
  // Resolution order:
  // 1. Extract from StatusHistory (latest status entry) - most accurate source
  // 2. CurrentStatus from originalData (if API provides it)
  // 3. Status from originalData (direct Status field)
  // 4. Fallback to normalized status fields
  // This ensures we display the full status like "Design Approval Pending" instead of just "pending"
  let status = null;

  // First, try to get status from StatusHistory (most accurate source)
  const statusHistory =
    originalData?.StatusHistory || enquiry?.StatusHistory || [];
  if (Array.isArray(statusHistory) && statusHistory.length > 0) {
    // Sort by timestamp (newest first) and get the latest status
    const sortedHistory = [...statusHistory].sort((a, b) => {
      const dateA = new Date(a.Timestamp || a.timestamp || 0);
      const dateB = new Date(b.Timestamp || b.timestamp || 0);
      return dateB - dateA;
    });
    const latestStatus = sortedHistory[0];
    status = latestStatus?.Status || latestStatus?.status || null;
  }

  // If not found in StatusHistory, check other fields
  if (!status) {
    status =
      originalData?.CurrentStatus ||
      originalData?.Status ||
      enquiry?.CurrentStatus ||
      enquiry?.Status;
  }

  // Final fallback to normalized status
  if (!status) {
    status = enquiry?.status || 'pending';
  }

  // Get client name from ClientId - prioritize already resolved name, then lookup
  const clientId =
    originalData?.ClientId || enquiry?.ClientId || enquiry?.clientId;

  // First check if enquiry already has a valid client name (not "Unknown Client")
  let clientName = enquiry?.clientName || enquiry?.client;
  if (!clientName || clientName === 'Unknown Client') {
    // Only lookup if clients are loaded and we have a ClientId
    if (!clientsLoading && clientId && clients.length > 0) {
      clientName = getClientName(clientId);
    } else if (clientId && (clientsLoading || clients.length === 0)) {
      // If clients are still loading, keep "Unknown Client" for now
      // It will update when clients finish loading due to useMemo dependency
      clientName = 'Unknown Client';
    } else {
      clientName = 'Unknown Client';
    }
  }

  // Debug logging for client name resolution - moved to useEffect to avoid blocking render
  useEffect(() => {}, [
    clientId,
    clientName,
    clientsLoading,
    clients.length,
    clientNameMap,
  ]);

  // Get dates - check multiple possible fields
  const createdAt =
    enquiry?.createdAt || originalData?.createdAt || new Date().toISOString();
  const updatedAt =
    enquiry?.updatedAt ||
    originalData?.updatedAt ||
    enquiry?.createdAt ||
    createdAt;

  // Use ref to track last shouldRefresh value to prevent duplicate refetches
  const lastShouldRefreshRef = useRef(shouldRefresh);

  // Refresh enquiry data when screen comes into focus (if needed)
  useFocusEffect(
    useCallback(() => {
      // Always refetch when screen comes into focus to get latest updates
      // This ensures client sees status changes made by admin AND fields added during editing
      if (enquiryId && refetch) {
        // Use a small delay to ensure navigation is complete
        const timeoutId = setTimeout(() => {
          refetch()
            .then(result => {
              if (__DEV__) {
                const data = result?.data;
              }
            })
            .catch(error => {});
        }, 100);

        return () => clearTimeout(timeoutId);
      } else {
        // Update ref even if not refetching
        lastShouldRefreshRef.current = shouldRefresh;
      }
    }, [shouldRefresh, enquiryId, refetch]),
  );

  const showAllDetails = user?.role === 'admin';

  const handleOpenChat = useCallback(() => {
    const currentEnquiry = enquiry || initialEnquiry || {};
    const currentEnquiryId =
      enquiryId || currentEnquiry?.id || currentEnquiry?._id;

    if (!currentEnquiryId) {
      showAlert('Error', 'Cannot open chat: Enquiry ID is missing', 'error');
      return;
    }

    navigation.navigate('ChatGroups', {
      enquiry: currentEnquiry,
      enquiryId: currentEnquiryId,
    });
  }, [enquiry, initialEnquiry, enquiryId, navigation]);

  const canShowChatFab =
    user?.role === 'client' ||
    user?.role === 'admin' ||
    user?.role === 'coral' ||
    user?.role === 'cad';

  // In-memory cache as fallback when AsyncStorage is full
  const memoryCacheRef = useRef(new Map());
  const storageFullRef = useRef(false);
  const MAX_MEMORY_CACHE_SIZE = 20; // Keep max 20 images in memory

  // Image cache utility functions - MUST be defined before any conditional returns
  const getImageCacheKey = useCallback((imageKey, imageId, imageUri) => {
    // Create a unique cache key from image identifier
    if (imageKey) return `image_cache_${imageKey}`;
    if (imageId) return `image_cache_${imageId}`;
    if (imageUri) {
      // Use a hash of the URI for cache key
      const uriHash = imageUri.split('/').pop().split('?')[0];
      return `image_cache_${uriHash}`;
    }
    return null;
  }, []);

  const getCachedImage = useCallback(async cacheKey => {
    if (!cacheKey) return null;

    // First check in-memory cache (works even when storage is full)
    if (memoryCacheRef.current.has(cacheKey)) {
      const cached = memoryCacheRef.current.get(cacheKey);
      const cacheAge = Date.now() - (cached.timestamp || 0);
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      if (cacheAge < maxAge) {
        return cached.dataUri;
      } else {
        memoryCacheRef.current.delete(cacheKey);
      }
    }

    // If storage is known to be full, skip AsyncStorage check
    if (storageFullRef.current) {
      return null;
    }

    // Try AsyncStorage cache
    try {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const cacheData = JSON.parse(cached);
        // Check if cache is still valid (7 days)
        const cacheAge = Date.now() - (cacheData.timestamp || 0);
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
        if (cacheAge < maxAge) {
          // Also store in memory cache for faster access
          memoryCacheRef.current.set(cacheKey, cacheData);
          // Limit memory cache size
          if (memoryCacheRef.current.size > MAX_MEMORY_CACHE_SIZE) {
            const firstKey = memoryCacheRef.current.keys().next().value;
            memoryCacheRef.current.delete(firstKey);
          }
          return cacheData.dataUri;
        } else {
          // Cache expired, remove it
          await AsyncStorage.removeItem(cacheKey);
        }
      }
    } catch (error) {
      // Silently handle cache read errors
    }
    return null;
  }, []);

  // Automatic cache cleanup function - removes old entries
  const cleanupImageCache = useCallback(async (aggressive = false) => {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter(key => key.startsWith('image_cache_'));

      if (cacheKeys.length === 0) {
        return { removed: 0, remaining: 0 };
      }

      // Get all cache entries with timestamps
      const cacheEntries = await AsyncStorage.multiGet(cacheKeys);
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

      const entriesWithTimestamps = cacheEntries
        .map(([key, value]) => {
          try {
            const data = JSON.parse(value);
            const age = now - (data.timestamp || 0);
            return {
              key,
              timestamp: data.timestamp || 0,
              age,
              expired: age > maxAge,
            };
          } catch {
            return { key, timestamp: 0, age: Infinity, expired: true };
          }
        })
        .sort((a, b) => a.timestamp - b.timestamp); // Oldest first

      // Determine what to remove
      let keysToRemove = [];

      if (aggressive) {
        // Aggressive cleanup: Remove 50% of oldest entries + all expired
        const expiredKeys = entriesWithTimestamps
          .filter(e => e.expired)
          .map(e => e.key);
        const toRemove = Math.max(
          1,
          Math.floor(entriesWithTimestamps.length * 0.5),
        );
        const oldestKeys = entriesWithTimestamps
          .slice(0, toRemove)
          .map(e => e.key);
        keysToRemove = [...new Set([...expiredKeys, ...oldestKeys])];
      } else {
        // Normal cleanup: Remove expired entries + 30% of oldest
        const expiredKeys = entriesWithTimestamps
          .filter(e => e.expired)
          .map(e => e.key);
        const toRemove = Math.max(
          1,
          Math.floor(entriesWithTimestamps.length * 0.3),
        );
        const oldestKeys = entriesWithTimestamps
          .slice(0, toRemove)
          .map(e => e.key);
        keysToRemove = [...new Set([...expiredKeys, ...oldestKeys])];
      }

      if (keysToRemove.length > 0) {
        await AsyncStorage.multiRemove(keysToRemove);
        const remaining = cacheKeys.length - keysToRemove.length;
        return { removed: keysToRemove.length, remaining };
      }

      return { removed: 0, remaining: cacheKeys.length };
    } catch (error) {
      return { removed: 0, remaining: 0 };
    }
  }, []);

  const saveImageToCache = useCallback(
    async (cacheKey, dataUri) => {
      if (!cacheKey || !dataUri) return false;
      try {
        const cacheData = {
          dataUri,
          timestamp: Date.now(),
        };
        await AsyncStorage.setItem(cacheKey, JSON.stringify(cacheData));
        return true; // Success
      } catch (error) {
        // Storage is full - try to clean up old cache entries
        if (error?.code === '13' || error?.message?.includes('SQLITE_FULL')) {
          if (__DEV__) {
            console.warn(
              '⚠️ Storage full, attempting aggressive cache cleanup...',
            );
          }

          // Get all cache keys first to check how many we have
          const allKeys = await AsyncStorage.getAllKeys();
          const cacheKeys = allKeys.filter(key =>
            key.startsWith('image_cache_'),
          );

          // If we have very few cache entries but storage is full, clear ALL cache
          // This suggests other data is filling storage, not image cache
          if (cacheKeys.length <= 5) {
            if (__DEV__) {
              console.warn(
                `⚠️ Storage full but only ${cacheKeys.length} cache entries - clearing ALL image cache`,
              );
            }
            if (cacheKeys.length > 0) {
              await AsyncStorage.multiRemove(cacheKeys);
              if (__DEV__) {
                console.log(
                  `🧹 Cleared all ${cacheKeys.length} image cache entries`,
                );
              }
            }

            // Try saving after clearing all cache
            try {
              await AsyncStorage.setItem(
                cacheKey,
                JSON.stringify({
                  dataUri,
                  timestamp: Date.now(),
                }),
              );
              if (__DEV__) {
                console.log('✅ Cache saved after clearing all image cache');
              }
              return true;
            } catch (clearAllError) {
              // Storage is consistently full - disable AsyncStorage caching and use memory cache only
              storageFullRef.current = true;
              if (__DEV__) {
                console.warn(
                  '⚠️ Storage STILL full after clearing all image cache - switching to memory-only cache',
                );
                console.warn(
                  '💡 Consider clearing other AsyncStorage data (tokens, user data, etc.)',
                );
              }

              // Store in memory cache as fallback
              memoryCacheRef.current.set(cacheKey, {
                dataUri,
                timestamp: Date.now(),
              });
              // Limit memory cache size
              if (memoryCacheRef.current.size > MAX_MEMORY_CACHE_SIZE) {
                const firstKey = memoryCacheRef.current.keys().next().value;
                memoryCacheRef.current.delete(firstKey);
              }
              if (__DEV__) {
                console.log(
                  '💾 Stored in memory cache (AsyncStorage full):',
                  cacheKey,
                );
              }
              return true; // Consider it "saved" in memory cache
            }
          }

          // Try normal cleanup first
          let cleanupResult = await cleanupImageCache(false);

          // If still full after normal cleanup, try aggressive cleanup
          if (cleanupResult.remaining > 0) {
            try {
              await AsyncStorage.setItem(
                cacheKey,
                JSON.stringify({
                  dataUri,
                  timestamp: Date.now(),
                }),
              );
              if (__DEV__) {
                console.log('✅ Cache saved after normal cleanup');
              }
              return true; // Success after normal cleanup
            } catch (retryError) {
              if (__DEV__) {
                console.warn(
                  '⚠️ Still full after normal cleanup, trying aggressive cleanup...',
                );
              }
              // Try aggressive cleanup (removes 50%)
              cleanupResult = await cleanupImageCache(true);

              // Try saving again after aggressive cleanup
              try {
                await AsyncStorage.setItem(
                  cacheKey,
                  JSON.stringify({
                    dataUri,
                    timestamp: Date.now(),
                  }),
                );
                if (__DEV__) {
                  console.log('✅ Cache saved after aggressive cleanup');
                }
                return true; // Success after aggressive cleanup
              } catch (finalError) {
                // Last resort: clear ALL remaining cache
                const remainingCacheKeys = allKeys.filter(key =>
                  key.startsWith('image_cache_'),
                );
                if (remainingCacheKeys.length > 0) {
                  if (__DEV__) {
                    console.warn(
                      `⚠️ Last resort: clearing ALL ${remainingCacheKeys.length} remaining cache entries`,
                    );
                  }
                  await AsyncStorage.multiRemove(remainingCacheKeys);
                  try {
                    await AsyncStorage.setItem(
                      cacheKey,
                      JSON.stringify({
                        dataUri,
                        timestamp: Date.now(),
                      }),
                    );
                    if (__DEV__) {
                      console.log(
                        '✅ Cache saved after clearing all remaining cache',
                      );
                    }
                    return true;
                  } catch (lastError) {
                    // Storage is consistently full - use memory cache
                    storageFullRef.current = true;
                    if (__DEV__) {
                      console.warn(
                        '⚠️ Storage still full after clearing ALL cache - switching to memory-only cache',
                      );
                    }

                    // Store in memory cache as fallback
                    memoryCacheRef.current.set(cacheKey, {
                      dataUri,
                      timestamp: Date.now(),
                    });
                    // Limit memory cache size
                    if (memoryCacheRef.current.size > MAX_MEMORY_CACHE_SIZE) {
                      const firstKey = memoryCacheRef.current
                        .keys()
                        .next().value;
                      memoryCacheRef.current.delete(firstKey);
                    }
                    if (__DEV__) {
                      console.log(
                        '💾 Stored in memory cache (all cleanup failed):',
                        cacheKey,
                      );
                    }
                    return true; // Consider it "saved" in memory cache
                  }
                }
              }
            }
          }
        } else if (__DEV__) {
          console.warn('⚠️ Error saving image cache:', error);
        }

        // If storage is known to be full, use memory cache as fallback
        if (storageFullRef.current) {
          memoryCacheRef.current.set(cacheKey, {
            dataUri,
            timestamp: Date.now(),
          });
          // Limit memory cache size
          if (memoryCacheRef.current.size > MAX_MEMORY_CACHE_SIZE) {
            const firstKey = memoryCacheRef.current.keys().next().value;
            memoryCacheRef.current.delete(firstKey);
          }
          if (__DEV__) {
            console.log(
              '💾 Stored in memory cache (AsyncStorage disabled):',
              cacheKey,
            );
          }
          return true;
        }

        return false; // Failed
      }
    },
    [cleanupImageCache],
  );

  // Handle error state with better error messages
  const error = queryError
    ? queryError.data?.error ||
      queryError.data?.message ||
      queryError.message ||
      'Failed to load enquiry'
    : null;
  const errorStatus = queryError?.status || queryError?.originalStatus;

  // Log error details for debugging
  useEffect(() => {
    if (queryError && enquiryId) {
      console.error('[SingleEnquiry] ❌ Error fetching enquiry:', {
        enquiryId,
        error: queryError.data?.error || queryError.message,
        status: errorStatus,
        fullError: JSON.stringify(queryError, null, 2),
      });
    }
  }, [queryError, enquiryId, errorStatus]);

  // Show loading state
  if (loading) {
    return (
      <View style={styles.container}>
        <AnimatedLogoLoader size={80} />
      </View>
    );
  }

  // Safety check - don't render if enquiry is not available
  if (error || !enquiry || !enquiry.id) {
    // Check if it's a 500 error (Internal Server Error)
    const isServerError =
      errorStatus === 500 ||
      error?.toLowerCase().includes('internal server error');
    const isNotFound =
      errorStatus === 404 || error?.toLowerCase().includes('not found');

    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Icon name="error-outline" size={48} color={colors.error} />
          <Text
            style={[
              styles.errorText,
              { color: colors.textPrimary, fontSize: fonts.lg, marginTop: 16 },
            ]}
          >
            {isServerError
              ? 'Server Error'
              : isNotFound
              ? 'Enquiry Not Found'
              : error || 'Failed to load enquiry'}
          </Text>
          {isServerError && (
            <Text
              style={[
                styles.errorSubtext,
                {
                  color: colors.textSecondary,
                  fontSize: fonts.sm,
                  marginTop: 8,
                  textAlign: 'center',
                  paddingHorizontal: 20,
                },
              ]}
            >
              The enquiry might still be saving. Please try again in a moment.
            </Text>
          )}
          {enquiryId && (
            <Text
              style={[
                styles.errorSubtext,
                { color: colors.textLight, fontSize: fonts.xs, marginTop: 8 },
              ]}
            >
              Enquiry ID: {enquiryId}
            </Text>
          )}
        </View>
        <View style={styles.errorActions}>
          <Button
            title="Retry"
            onPress={() => {
              console.log(
                '[SingleEnquiry] 🔄 Retrying fetch for enquiry:',
                enquiryId,
              );
              refetch();
            }}
            variant="primary"
            style={styles.retryButton}
          />
          <Button
            title="Go Back"
            onPress={() => navigation.goBack()}
            variant="secondary"
            style={styles.backButton}
          />
        </View>
      </View>
    );
  }

  const handleApprove = () => {
    const src = enquiry?._originalData || enquiry;
    const cadVersions   = src?.Cad   || [];
    const coralVersions = src?.Coral || [];

    console.log('[handleApprove] cadVersions:', cadVersions.length, 'coralVersions:', coralVersions.length, 'status:', status);

    let designType, versions;
    if (cadVersions.length > 0) {
      designType = 'cad';
      versions   = cadVersions;
    } else if (coralVersions.length > 0) {
      designType = 'coral';
      versions   = coralVersions;
    } else {
      showAlert('Error', 'No design versions available to approve', 'error');
      return;
    }

    const versionIndex = versions.length - 1;
    const version = versions[versionIndex]?.Version || `Version ${versionIndex + 1}`;
    const currentStatus = (status || '').toLowerCase();
    const isApprovedCadStatus = currentStatus === 'approved cad';

    console.log('[handleApprove] designType:', designType, 'version:', version, 'isApprovedCadStatus:', isApprovedCadStatus);

    showAlert(
      'Approve Design Version',
      `Approve ${designType.toUpperCase()} ${version}?`,
      'warning',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => {} },
        {
          text: 'Approve',
          onPress: async () => {
            try {
              const eid = enquiry.id || enquiry._id;

              if (isApprovedCadStatus) {
                // Quotation approved → Final Cad Upload
                console.log('[handleApprove] CAD approved status → intent: approveDesign');
                await approveDesignVersion({
                  enquiryId: eid,
                  designType,
                  version,
                  intent: 'approveDesign',
                }).unwrap();
              } else {
                // First approval — send for approval (Quotation → Approved Cad)
                const intent = designType === 'cad' ? 'forApproval' : 'approveDesign';
                console.log('[handleApprove] First approval → intent:', intent, 'designType:', designType);
                await approveDesignVersion({
                  enquiryId: eid,
                  designType,
                  version,
                  intent,
                }).unwrap();
              }

              showAlert('Success', `${designType.toUpperCase()} ${version} approved successfully`, 'success');
              refetch();
            } catch (error) {
              showAlert(
                'Error',
                error?.data?.error || error?.message || 'Failed to approve design version.',
                'error',
              );
            }
          },
        },
      ],
    );
  };

  const handleReject = () => {
    // Get available design versions
    const originalData = enquiry?._originalData || enquiry;
    const coralVersions = originalData?.Coral || enquiry?.Coral || [];
    const cadVersions = originalData?.Cad || enquiry?.Cad || [];

    // Determine which design type and version to reject
    let designType = 'coral';
    let versionIndex =
      coralVersions.length > 0
        ? coralVersions.length - 1
        : cadVersions.length > 0
        ? cadVersions.length - 1
        : null;

    if (coralVersions.length === 0 && cadVersions.length > 0) {
      designType = 'cad';
    }

    if (versionIndex === null) {
      showAlert('Error', 'No design versions available to reject', 'error');
      return;
    }

    // Store design type and version for rejection
    setSelectedDesignType(designType);
    setSelectedVersionIndex(versionIndex);
    setShowApprovalModal(true);
  };

  const confirmReject = async () => {
    if (!approvalMessage.trim()) {
      showAlert('Error', 'Please provide a reason for rejection', 'error');
      return;
    }

    if (!selectedDesignType || selectedVersionIndex === null) {
      showAlert('Error', 'Design version information is missing', 'error');
      return;
    }

    try {
      const originalData = enquiry?._originalData || enquiry;
      const versions =
        selectedDesignType === 'coral'
          ? originalData?.Coral || enquiry?.Coral || []
          : originalData?.Cad || enquiry?.Cad || [];

      if (selectedVersionIndex >= versions.length) {
        showAlert('Error', 'Selected version not found', 'error');
        return;
      }

      const version =
        versions[selectedVersionIndex]?.Version ||
        `Version ${selectedVersionIndex + 1}`;
      const enquiryId = enquiry.id || enquiry._id;

      await rejectDesignVersion({
        enquiryId,
        designType: selectedDesignType,
        version,
        reason: approvalMessage.trim(),
      }).unwrap();

      showAlert(
        'Success',
        `${selectedDesignType.toUpperCase()} ${version} rejected successfully`,
        'success',
      );

      // Reset state
      setShowApprovalModal(false);
      setApprovalMessage('');
      setSelectedDesignType(null);
      setSelectedVersionIndex(null);

      // Refetch enquiry data to get updated rejection status
      refetch();
    } catch (error) {
      showAlert(
        'Error',
        error?.data?.error ||
          error?.message ||
          'Failed to reject design version. Please try again.',
        'error',
      );
    }
  };

  const getReturnRoute = () => {
    const state = navigation.getState();
    if (!state?.routes) return 'MainTabs';
    const prevRoute = state.routes[state.routes.length - 2];
    if (prevRoute?.name === 'ClientHandlerEnquiries') return 'ClientHandlerEnquiries';
    return 'MainTabs';
  };

  const handleUploadCoral = () => {
    navigation.navigate('UploadDesign', {
      designType: 'coral',
      enquiry: enquiry,
      enquiryId: enquiryId,
      returnRoute: getReturnRoute(),
    });
  };

  const handleUploadCAD = () => {
    const src = enquiry._originalData || enquiry;
    const statusHistory = Array.isArray(src?.StatusHistory) ? src.StatusHistory : [];
    const lastHistory = statusHistory.length > 0 ? statusHistory[statusHistory.length - 1] : null;
    const isFinalVersion = lastHistory?.SubStatus === 'Final Cad Upload';
    navigation.navigate('UploadDesign', {
      designType: 'cad',
      enquiry: enquiry,
      enquiryId: enquiryId,
      returnRoute: getReturnRoute(),
      isFinalVersion,
    });
  };

  const handleUploadReferenceImages = () => {
    const currentEnquiryId = enquiry.id || enquiry._id;
    if (!currentEnquiryId) {
      showAlert(
        'Error',
        'Unable to find this enquiry. Please refresh and try again.',
        'error',
      );
      return;
    }

    const pickerOptions = {
      mediaType: 'mixed', // Allow both images and videos
      selectionLimit: 10,
      includeBase64: false,
    };

    launchImageLibrary(pickerOptions, async response => {
      if (response.didCancel) {
        return;
      }

      if (response.errorCode) {
        showAlert(
          'Media Picker Error',
          response.errorMessage || 'Failed to open gallery. Please try again.',
          'error',
        );
        return;
      }

      const assets = response.assets?.filter(asset => asset?.uri) || [];
      if (assets.length === 0) {
        showAlert(
          'No Media Selected',
          'Please choose at least one reference image or video to upload.',
          'info',
        );
        return;
      }

      const imagesPayload = assets.map((asset, index) => {
        // Determine file extension based on type or file name
        const isVideo =
          asset.type?.startsWith('video/') ||
          /\.(mp4|mov|avi|mkv|webm|wmv|flv|3gp)$/i.test(asset.fileName || '');
        const defaultExtension = isVideo ? 'mp4' : 'jpg';
        const defaultName =
          asset.fileName ||
          `reference_${Date.now()}_${index}.${defaultExtension}`;

        return {
          uri: asset.uri,
          type: asset.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
          name: defaultName,
        };
      });

      try {
        await uploadReferenceImages({
          enquiryId: currentEnquiryId,
          images: imagesPayload,
        }).unwrap();

        showAlert(
          'Success',
          'Reference images/videos uploaded successfully.',
          'success',
        );
        refetch();
      } catch (error) {
        const message =
          error?.data?.message ||
          error?.data?.error ||
          error?.data ||
          error?.error ||
          'Failed to upload reference images. Please try again.';
        showAlert('Upload Failed', message, 'error');
      }
    });
  };

  const hasDetailValue = cell => {
    if (!cell) return false;
    const value = cell.value;
    const result =
      value !== null && value !== undefined && String(value).trim() !== '';

    // Debug: Log hasDetailValue check for Assigned To
    if (cell.label === 'Assigned To') {
      console.log('[SingleEnquiry] ✅ hasDetailValue check for Assigned To:', {
        cell: cell,
        value: value,
        'value type': typeof value,
        'String(value).trim()': String(value).trim(),
        result: result,
      });
    }

    return result;
  };

  const renderDetailCell = cell => {
    if (!cell) {
      return <View style={styles.detailCellPlaceholder} />;
    }

    const valueExists = hasDetailValue(cell);

    // Debug: Log renderDetailCell for Assigned To
    if (cell.label === 'Assigned To') {
      console.log('[SingleEnquiry] 🎨 renderDetailCell for Assigned To:', {
        cell: cell,
        valueExists: valueExists,
        'cell.showIfEmpty': cell.showIfEmpty,
        showAllDetails: showAllDetails,
        'will render': valueExists || cell.showIfEmpty || showAllDetails,
        'value to display': valueExists
          ? cell.value
          : cell.placeholder ?? 'N/A',
      });
    }

    if (!valueExists && !cell.showIfEmpty && !showAllDetails) {
      return <View style={styles.detailCellPlaceholder} />;
    }

    return (
      <View style={styles.detailCell}>
        <View style={styles.detailCellLabelRow}>
          {cell.icon && (
            <Icon
              name={cell.icon}
              size={14}
              color={colors.primary}
              style={styles.detailCellIcon}
            />
          )}
          <Text style={styles.detailCellLabel}>{cell.label}</Text>
        </View>
        <Text style={styles.detailCellValue}>
          {valueExists ? cell.value : cell.placeholder ?? 'N/A'}
        </Text>
      </View>
    );
  };

  const renderDetailRow = (leftCell, rightCell, options = {}) => {
    const shouldRender =
      hasDetailValue(leftCell) ||
      hasDetailValue(rightCell) ||
      leftCell?.showIfEmpty ||
      rightCell?.showIfEmpty ||
      showAllDetails ||
      options.showIfEmpty;

    if (!shouldRender) {
      return null;
    }

    return (
      <View style={styles.detailRowTwoColumn}>
        {renderDetailCell(leftCell)}
        {renderDetailCell(rightCell)}
      </View>
    );
  };

  const renderEnquiryDetails = () => {
    // Extract metal details - check ALL possible locations (originalData, enquiry normalized, enquiry raw)
    const metal = originalData?.Metal || enquiry?.Metal || enquiry?.metal || {};
    const metalColor = metal.Color || metal.color || null;
    const metalQuality = metal.Quality || metal.quality || null;

    // Extract weights - check ALL possible locations with comprehensive fallback
    const metalWeight =
      originalData?.MetalWeight ||
      enquiry?.MetalWeight ||
      enquiry?.metalWeight ||
      originalData?.metalWeight ||
      {};
    const diamondWeight =
      originalData?.DiamondWeight ||
      enquiry?.DiamondWeight ||
      enquiry?.diamondWeight ||
      originalData?.diamondWeight ||
      {};

    // Extract other fields - comprehensive fallback chain
    const styleNumber =
      originalData?.StyleNumber ||
      enquiry?.StyleNumber ||
      enquiry?.styleNumber ||
      originalData?.styleNumber ||
      null;
    // Extract Gati Order Number - check ALL possible locations and variations
    console.log('originalData-------gatiOrderNumber-->', originalData);
    const gatiOrderNumber =
      originalData?.GatiOrderNumber ||
      originalData?.gatiOrderNumber ||
      originalData?.Gati_Order_Number ||
      originalData?.gati_order_number ||
      enquiry?._originalData?.GatiOrderNumber ||
      enquiry?._originalData?.gatiOrderNumber ||
      enquiry?.GatiOrderNumber ||
      enquiry?.gatiOrderNumber ||
      enquiry?.Gati_Order_Number ||
      enquiry?.gati_order_number ||
      null;

    const stamping =
      originalData?.Stamping ||
      enquiry?.Stamping ||
      enquiry?.stamping ||
      originalData?.stamping ||
      null;
    const category =
      originalData?.Category ||
      enquiry?.Category ||
      enquiry?.category ||
      originalData?.category ||
      null;
    const stoneType =
      originalData?.StoneType ||
      enquiry?.StoneType ||
      enquiry?.stoneType ||
      originalData?.stoneType ||
      null;
    const quantity =
      originalData?.Quantity ||
      enquiry?.Quantity ||
      enquiry?.quantity ||
      originalData?.quantity ||
      null;
    const budget =
      originalData?.Budget ||
      enquiry?.Budget ||
      enquiry?.budget ||
      originalData?.budget ||
      null;
    const specialRemarks =
      originalData?.SpecialRemarks ||
      enquiry?.SpecialRemarks ||
      enquiry?.specialRemarks ||
      originalData?.specialRemarks ||
      null;
    const approvedDate =
      originalData?.ApprovedDate ||
      enquiry?.ApprovedDate ||
      enquiry?.approvedDate ||
      originalData?.approvedDate ||
      null;
    const shippingDate =
      originalData?.ShippingDate ||
      enquiry?.ShippingDate ||
      enquiry?.deadline ||
      originalData?.deadline ||
      null;
    // Use assignedToName from hook (extracted at component level with useMemo)
    // If useUserName returns '-' or the userId (fallback), try to get name from usersList directly
    let assignedTo = assignedToName;

    // Check if we need to look up the user manually
    const needsLookup =
      !assignedTo ||
      assignedTo === '-' ||
      assignedTo === assignedToId ||
      (assignedTo && assignedTo.startsWith('User ') && assignedToId);

    // If user not found in map, try to find in usersList directly
    if (needsLookup && assignedToId && usersList && usersList.length > 0) {
      const assignedToIdStr = String(assignedToId || '').trim();
      const foundUser = usersList.find(u => {
        const userId = String(u.id || u._id || '').trim();
        const userIdNoSpaces = userId.replace(/\s/g, '');
        const assignedToIdNoSpaces = assignedToIdStr.replace(/\s/g, '');
        return (
          userId === assignedToIdStr ||
          userIdNoSpaces === assignedToIdNoSpaces ||
          String(userId).toLowerCase() === assignedToIdStr.toLowerCase()
        );
      });

      if (foundUser) {
        assignedTo =
          foundUser.name ||
          foundUser.Name ||
          foundUser.email ||
          foundUser.Email ||
          assignedTo;
        console.log('[SingleEnquiry] ✅ Found user in usersList:', {
          userId: foundUser.id || foundUser._id,
          name: assignedTo,
        });
      }
    }

    // Final fallback - if still no name found but we have an ID
    if (
      (!assignedTo || assignedTo === '-' || assignedTo === assignedToId) &&
      assignedToId
    ) {
      // If we have an assignedToId but no name, show a truncated ID instead of just '-'
      const idStr = String(assignedToId).trim();
      if (idStr.length > 8) {
        assignedTo = `User ${idStr.substring(0, 8)}...`;
        console.log(
          '[SingleEnquiry] ⚠️ Using truncated ID as fallback:',
          assignedTo,
        );
      } else {
        assignedTo = `User ${idStr}`;
        console.log('[SingleEnquiry] ⚠️ Using ID as fallback:', assignedTo);
      }
    } else if (!assignedTo || assignedTo === '-') {
      assignedTo = '-';
    }

    // Debug: Log final assignedTo value being used for display
    console.log('[SingleEnquiry] 📋 Final AssignedTo for display:', {
      assignedToId: assignedToId,
      'assignedToName (from hook)': assignedToName,
      'assignedTo (final)': assignedTo,
      'will display': assignedTo !== '-',
      'usersList length': usersList?.length || 0,
      'renderEnquiryDetails called': true,
    });

    // Format metal weight - only return value if exists, otherwise null (so field won't display)
    let metalWeightText = null;
    if (metalWeight.Exact || metalWeight.exact) {
      metalWeightText = `Exact: ${metalWeight.Exact || metalWeight.exact} gms`;
    } else if (metalWeight.From || metalWeight.from) {
      const from = metalWeight.From || metalWeight.from || '';
      const to = metalWeight.To || metalWeight.to || '';
      if (from) {
        metalWeightText = `From: ${from}${to ? ` To: ${to}` : ''} gms`;
      }
    }

    // Format diamond weight - only return value if exists, otherwise null (so field won't display)
    let diamondWeightText = null;
    if (diamondWeight.Exact || diamondWeight.exact) {
      diamondWeightText = `Exact: ${
        diamondWeight.Exact || diamondWeight.exact
      } ct`;
    } else if (diamondWeight.From || diamondWeight.from) {
      const from = diamondWeight.From || diamondWeight.from || '';
      const to = diamondWeight.To || diamondWeight.to || '';
      if (from) {
        diamondWeightText = `From: ${from}${to ? ` To: ${to}` : ''} ct`;
      }
    }

    // Get Coral and CAD codes for Assignment & Codes section
    // Priority: Enquiry-level code > Latest version's Code > Any version's Code
    // Check both originalData and enquiry for versions (data might be in either location)
    const coralVersions = originalData?.Coral || enquiry?.Coral || [];
    const cadVersions = originalData?.Cad || enquiry?.Cad || [];

    // Debug: Log version structure
    if (__DEV__ && (coralVersions.length > 0 || cadVersions.length > 0)) {
      console.log('[SingleEnquiry] Version structure check:', {
        coralVersionsCount: coralVersions.length,
        cadVersionsCount: cadVersions.length,
        latestCoralVersion:
          coralVersions.length > 0
            ? coralVersions[coralVersions.length - 1]
            : null,
        latestCadVersion:
          cadVersions.length > 0 ? cadVersions[cadVersions.length - 1] : null,
        enquiryCoralCode: enquiry?.CoralCode,
        originalDataCoralCode: originalData?.CoralCode,
        enquiryCadCode: enquiry?.CadCode,
        originalDataCadCode: originalData?.CadCode,
      });
    }

    // Helper function to extract code from a version object
    const getCodeFromVersion = version => {
      if (!version) return null;

      // Check all possible field names for code
      const code =
        version.Code ||
        version.code ||
        version.DesignCode ||
        version.designCode ||
        version.CoralCode ||
        version.coralCode ||
        version.CadCode ||
        version.cadCode ||
        null;

      // Debug logging in development
      if (__DEV__ && version && !code) {
        console.log(
          '[SingleEnquiry] Version object keys:',
          Object.keys(version),
        );
        console.log(
          '[SingleEnquiry] Version object:',
          JSON.stringify(version, null, 2).substring(0, 500),
        );
      }

      return code;
    };

    // Get code from latest version (most recent)
    const latestCoralVersion =
      coralVersions.length > 0 ? coralVersions[coralVersions.length - 1] : null;
    const latestCadVersion =
      cadVersions.length > 0 ? cadVersions[cadVersions.length - 1] : null;

    // Also check all versions to find any code (fallback if latest doesn't have one)
    let anyCoralCode = null;
    let anyCadCode = null;

    // Check all versions in reverse order (latest first) to find first available code
    for (let i = coralVersions.length - 1; i >= 0; i--) {
      const code = getCodeFromVersion(coralVersions[i]);
      if (code) {
        anyCoralCode = code;
        break; // Use the latest version that has a code
      }
    }

    for (let i = cadVersions.length - 1; i >= 0; i--) {
      const code = getCodeFromVersion(cadVersions[i]);
      if (code) {
        anyCadCode = code;
        break; // Use the latest version that has a code
      }
    }

    // Debug logging
    if (__DEV__) {
      console.log('[SingleEnquiry] Code extraction:', {
        coralVersionsCount: coralVersions.length,
        cadVersionsCount: cadVersions.length,
        latestCoralCode: getCodeFromVersion(latestCoralVersion),
        anyCoralCode,
        latestCadCode: getCodeFromVersion(latestCadVersion),
        anyCadCode,
        enquiryCoralCode: enquiry?.CoralCode,
        originalDataCoralCode: originalData?.CoralCode,
      });
    }

    // Priority: Enquiry-level > Latest version > Any version
    const coralCode =
      enquiry?.CoralCode ||
      originalData?.CoralCode ||
      enquiry?.coralCode ||
      originalData?.coralCode ||
      enquiry?.coralVersion ||
      originalData?.coralVersion ||
      getCodeFromVersion(latestCoralVersion) ||
      anyCoralCode ||
      'N/A';

    const cadCode =
      enquiry?.CadCode ||
      originalData?.CadCode ||
      enquiry?.cadCode ||
      originalData?.cadCode ||
      enquiry?.cadVersion ||
      originalData?.cadVersion ||
      getCodeFromVersion(latestCadVersion) ||
      anyCadCode ||
      'N/A';

    return (
      <>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <View style={styles.heroImageWrap}>
            {(() => {
              const allImgs = enquiry?.images || enquiry?.ReferenceImages || enquiry?.Images || originalData?.ReferenceImages || originalData?.Images || [];
              const firstImg = Array.isArray(allImgs) && allImgs.length > 0 ? allImgs[0] : null;
              let imgUri = null;
              if (firstImg) {
                if (typeof firstImg === 'object') {
                  imgUri = firstImg.Url || firstImg.url || firstImg.URI || firstImg.uri || firstImg.Location || firstImg.location || null;
                } else if (typeof firstImg === 'string') {
                  if (firstImg.startsWith('http') || firstImg.startsWith('https')) {
                    imgUri = firstImg;
                  }
                }
              }
              return imgUri ? (
                <Image source={{ uri: imgUri }} style={styles.heroImage} resizeMode="contain" />
              ) : (
                <View style={styles.heroImagePlaceholder}>
                  <Icon name="diamond" size={28} color={colors.primary} />
                </View>
              );
            })()}
          </View>
          <View style={styles.heroContent}>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {originalData?.Name || enquiry?.Name || enquiry?.title || 'Untitled Enquiry'}
            </Text>
            <Text style={styles.heroCode}>{styleNumber || 'N/A'}</Text>
            <View style={styles.heroBadgeRow}>
              <View style={[styles.heroBadge, { backgroundColor: getStatusColor(status) }]}>
                <Text style={styles.heroBadgeText}>
                  {status ? status.toUpperCase() : 'PENDING'}
                </Text>
              </View>
              <View style={[styles.heroBadge, { backgroundColor: getPriorityColor(priority) }]}>
                <Text style={styles.heroBadgeText}>
                  {priority ? priority.toUpperCase() : 'NORMAL'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Data Grid */}
        <View style={styles.dataGrid}>
          <View style={styles.dataCell}>
            <Text style={styles.dataCellLabel}>BUDGET RANGE</Text>
            <Text style={styles.dataCellValue}>{budget ? `₹${budget}` : '-'}</Text>
          </View>
          <View style={styles.dataCell}>
            <Text style={styles.dataCellLabel}>METAL QUALITY</Text>
            <Text style={styles.dataCellValue}>{metalQuality || '-'}</Text>
          </View>
          <View style={styles.dataCell}>
            <Text style={styles.dataCellLabel}>GOLD WEIGHT</Text>
            <Text style={styles.dataCellValue}>{metalWeightText || '-'}</Text>
          </View>
          <View style={styles.dataCell}>
            <Text style={styles.dataCellLabel}>DIAMONDS</Text>
            <Text style={styles.dataCellValue}>{diamondWeightText || '-'}</Text>
          </View>
          <View style={styles.dataCell}>
            <Text style={styles.dataCellLabel}>ASSIGNED TO</Text>
            <View style={styles.assignedRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {assignedTo ? assignedTo.charAt(0).toUpperCase() : '?'}
                </Text>
              </View>
              <Text style={styles.dataCellValue} numberOfLines={1}>{assignedTo || '-'}</Text>
            </View>
          </View>
          <View style={styles.dataCell}>
            <Text style={styles.dataCellLabel}>CLIENT CODE</Text>
            <Text style={styles.dataCellValue}>{clientName || '-'}</Text>
          </View>
          <View style={styles.dataCell}>
            <Text style={styles.dataCellLabel}>QUANTITY</Text>
            <Text style={styles.dataCellValue}>{quantity ? `${quantity}` : '-'}</Text>
          </View>
          <View style={styles.dataCell}>
            <Text style={styles.dataCellLabel}>STONE TYPE</Text>
            <Text style={styles.dataCellValue}>{stoneType || '-'}</Text>
          </View>
          <View style={[styles.dataCell, styles.dataCellAccent]}>
            <Text style={[styles.dataCellLabel, { color: colors.primary }]}>CURRENT STATUS</Text>
            <View style={styles.statusRow}>
              <Icon name="check-circle" size={14} color={colors.textPrimary} />
              <Text style={[styles.dataCellValue, { color: colors.textPrimary }]}>{status || '-'}</Text>
            </View>
          </View>
          {stamping ? (
            <View style={styles.dataCell}>
              <Text style={styles.dataCellLabel}>STAMPING</Text>
              <Text style={styles.dataCellValue}>{stamping}</Text>
            </View>
          ) : null}
          {gatiOrderNumber ? (
            <View style={styles.dataCell}>
              <Text style={styles.dataCellLabel}>GATI ORDER NO.</Text>
              <Text style={styles.dataCellValue}>{gatiOrderNumber}</Text>
            </View>
          ) : null}
        </View>

        {/* Timeline Section */}
        <Text style={styles.sectionLabel}>TIMELINE</Text>
        <View style={styles.dataGrid}>
          <View style={styles.dataCell}>
            <Text style={styles.dataCellLabel}>CREATED</Text>
            <Text style={styles.dataCellValue}>{formatDate(createdAt)}</Text>
          </View>
          <View style={styles.dataCell}>
            <Text style={styles.dataCellLabel}>LAST UPDATED</Text>
            <Text style={styles.dataCellValue}>{formatDate(updatedAt)}</Text>
          </View>
          {shippingDate ? (
            <View style={styles.dataCell}>
              <Text style={styles.dataCellLabel}>SHIPPING DATE</Text>
              <Text style={styles.dataCellValue}>{formatDate(shippingDate)}</Text>
            </View>
          ) : null}
          {approvedDate && user?.role?.toLowerCase() !== 'client' && user?.roleId !== 4 && user?.roleNumber !== 4 ? (
            <View style={styles.dataCell}>
              <Text style={styles.dataCellLabel}>APPROVED DATE</Text>
              <Text style={styles.dataCellValue}>{formatDate(approvedDate)}</Text>
            </View>
          ) : null}
        </View>

        {/* Description - Accordion */}
        {(originalData?.Remarks || enquiry?.Remarks || enquiry?.description) ? (
          <TouchableOpacity
            style={styles.sectionCard}
            activeOpacity={0.8}
            onPress={() => setDescExpanded(prev => !prev)}
          >
            <View style={styles.accordionHeader}>
              <Text style={styles.sectionLabel}>DESCRIPTION</Text>
              <Icon
                name={descExpanded ? 'expand-less' : 'expand-more'}
                size={18}
                color={colors.textSecondary}
              />
            </View>
            <Text
              style={styles.descriptionText}
              numberOfLines={descExpanded ? undefined : 2}
            >
              {originalData?.Remarks || enquiry?.Remarks || enquiry?.description || ''}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Special Remarks - Accordion, hidden for clients */}
        {specialRemarks && user?.role?.toLowerCase() !== 'client' && user?.roleId !== 4 && user?.roleNumber !== 4 ? (
          <TouchableOpacity
            style={styles.sectionCard}
            activeOpacity={0.8}
            onPress={() => setSpecialRemarksExpanded(prev => !prev)}
          >
            <View style={styles.accordionHeader}>
              <Text style={styles.sectionLabel}>SPECIAL REMARKS</Text>
              <Icon
                name={specialRemarksExpanded ? 'expand-less' : 'expand-more'}
                size={18}
                color={colors.textSecondary}
              />
            </View>
            <Text
              style={styles.descriptionText}
              numberOfLines={specialRemarksExpanded ? undefined : 2}
            >
              {specialRemarks}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Metal Color & Category */}
        <View style={styles.dataGrid}>
          {metalColor ? (
            <View style={styles.dataCell}>
              <Text style={styles.dataCellLabel}>METAL COLOR</Text>
              <Text style={styles.dataCellValue}>{metalColor}</Text>
            </View>
          ) : null}
          {category ? (
            <View style={styles.dataCell}>
              <Text style={styles.dataCellLabel}>CATEGORY</Text>
              <Text style={styles.dataCellValue}>{category}</Text>
            </View>
          ) : null}
        </View>

        {/* Assignment & Codes - inline */}
   
      </>
    );
  };

  // Utility function to detect if a file is a video based on key/name/URI
  // This is a regular function, not a hook, so it can be called conditionally
  const isVideoFile = (imageKey, imageUri, image) => {
    // First check for explicit video flag (set when merging ReferenceVideos)
    if (
      image &&
      typeof image === 'object' &&
      (image._isVideo === true || image.isVideo === true)
    ) {
      return true;
    }

    // Check file extension from key
    if (imageKey && typeof imageKey === 'string') {
      const videoExtensions = /\.(mp4|mov|avi|mkv|webm|wmv|flv|3gp|m4v)$/i;
      if (videoExtensions.test(imageKey)) {
        return true;
      }
    }

    // Check file extension from URI
    if (imageUri && typeof imageUri === 'string') {
      const videoExtensions = /\.(mp4|mov|avi|mkv|webm|wmv|flv|3gp|m4v)$/i;
      if (videoExtensions.test(imageUri)) {
        return true;
      }
    }

    // Check mime type from image object
    if (image && typeof image === 'object') {
      const contentType =
        image.ContentType ||
        image.contentType ||
        image.Type ||
        image.type ||
        image.MimeType ||
        image.mimeType;
      if (
        contentType &&
        typeof contentType === 'string' &&
        contentType.startsWith('video/')
      ) {
        return true;
      }

      // Check if it's from ReferenceVideos field (backend might mark it)
      if (
        image.FileType === 'video' ||
        image.fileType === 'video' ||
        image.MediaType === 'video' ||
        image.mediaType === 'video'
      ) {
        return true;
      }
    }

    return false;
  };

  // Component to render video with fetch authentication
  const VideoWithFallback = React.memo(
    ({ image, imageKey, imageId, imageUri, index, onPress }) => {
      const [videoUrl, setVideoUrl] = useState(null);
      const [videoLoading, setVideoLoading] = useState(false);
      const [videoError, setVideoError] = useState(false);
      const videoRef = useRef(null);
      const mountedRef = useRef(true);

      useEffect(() => {
        mountedRef.current = true;
        return () => {
          mountedRef.current = false;
        };
      }, []);

      // Fetch video URL with authentication
      const fetchVideoUrl = useCallback(async () => {
        if (!mountedRef.current) return;

        let videoUrlToUse = null;

        // If we have a direct URI, use it
        if (
          imageUri &&
          (imageUri.startsWith('http') || imageUri.startsWith('https'))
        ) {
          videoUrlToUse = imageUri;
        } else if (imageKey) {
          // Fetch presigned URL from API
          try {
            setVideoLoading(true);
            setVideoError(false);

            const token = await AsyncStorage.getItem('token');
            if (!token) {
              setVideoError(true);
              setVideoLoading(false);
              return;
            }

            const encodedKey = encodeURIComponent(imageKey);
            const response = await fetch(
              `${API_BASE_URL}/api/enquiries/files/${encodedKey}`,
              {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              },
            );

            if (response.ok) {
              const contentType = response.headers.get('content-type') || '';

              // Check if response is JSON (presigned URL)
              if (contentType.includes('application/json')) {
                const jsonData = await response.json();
                videoUrlToUse =
                  jsonData.url ||
                  jsonData.videoUrl ||
                  jsonData.src ||
                  jsonData.location;
              } else {
                // Direct video response - create blob URL
                const blob = await response.blob();
                videoUrlToUse = URL.createObjectURL(blob);
              }
            } else {
              setVideoError(true);
              setVideoLoading(false);
              return;
            }
          } catch (error) {
            setVideoError(true);
            setVideoLoading(false);
            return;
          }
        } else if (imageId) {
          try {
            setVideoLoading(true);
            setVideoError(false);

            const token = await AsyncStorage.getItem('token');
            if (!token) {
              setVideoError(true);
              setVideoLoading(false);
              return;
            }

            const response = await fetch(
              `${API_BASE_URL}/api/enquiries/files/${imageId}`,
              {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              },
            );

            if (response.ok) {
              const contentType = response.headers.get('content-type') || '';
              if (contentType.includes('application/json')) {
                const jsonData = await response.json();
                videoUrlToUse =
                  jsonData.url ||
                  jsonData.videoUrl ||
                  jsonData.src ||
                  jsonData.location;
              }
            } else {
              setVideoError(true);
              setVideoLoading(false);
              return;
            }
          } catch (error) {
            setVideoError(true);
            setVideoLoading(false);
            return;
          }
        }

        if (videoUrlToUse && mountedRef.current) {
          setVideoUrl(videoUrlToUse);
          setVideoLoading(false);
          setVideoError(false);
        } else if (mountedRef.current) {
          setVideoError(true);
          setVideoLoading(false);
        }
      }, [imageKey, imageId, imageUri]);

      useEffect(() => {
        fetchVideoUrl();
      }, [fetchVideoUrl]);

      if (videoError) {
        return (
          <View style={styles.videoContainer}>
            <View style={styles.videoPlaceholder}>
              <Icon
                name="videocam-off"
                size={24}
                color={colors.textSecondary}
              />
              <Text style={styles.videoErrorText}>Video unavailable</Text>
            </View>
          </View>
        );
      }

      if (videoLoading || !videoUrl) {
        return (
          <View style={styles.videoContainer}>
            <View style={styles.videoPlaceholder}>
              <AnimatedLogoLoader size="small" />
              <Text style={styles.videoLoadingText}>Loading video...</Text>
            </View>
          </View>
        );
      }

      return (
        <TouchableOpacity
          style={styles.videoContainer}
          activeOpacity={0.9}
          onPress={() => {
            if (onPress && videoUrl) {
              onPress(videoUrl);
            }
          }}
        >
          <Video
            ref={videoRef}
            source={{ uri: videoUrl }}
            style={styles.referenceVideo}
            controls={false}
            resizeMode="cover"
            paused={true}
            onError={error => {
              setVideoError(true);
            }}
          />
          <View style={styles.videoPlayOverlay}>
            <Icon
              name="play-circle-filled"
              size={48}
              color={colors.textWhite}
            />
          </View>
        </TouchableOpacity>
      );
    },
    (prevProps, nextProps) => {
      return (
        prevProps.imageKey === nextProps.imageKey &&
        prevProps.imageId === nextProps.imageId &&
        prevProps.imageUri === nextProps.imageUri &&
        prevProps.index === nextProps.index
      );
    },
  );

  // Component to render image with fetch authentication and caching
  const ImageWithFallback = React.memo(
    ({
      image,
      imageKey,
      imageId,
      imageUri,
      index,
      onPress,
      initialDataUri,
    }) => {
      const [imageDataUri, setImageDataUri] = useState(initialDataUri || null);
      const [imageLoading, setImageLoading] = useState(false);
      const [imageError, setImageError] = useState(false);

      const lastImageKeyRef = useRef(null);
      const isFetchingRef = useRef(false);
      const mountedRef = useRef(true);

      // Reset mounted flag on mount
      useEffect(() => {
        mountedRef.current = true;
        return () => {
          mountedRef.current = false;
        };
      }, []);

      useEffect(() => {
        if (initialDataUri && initialDataUri !== imageDataUri) {
          setImageDataUri(initialDataUri);
          setImageLoading(false);
          setImageError(false);
        }
      }, [initialDataUri, imageDataUri, index]);

      // Fetch image with authentication and caching
      const fetchImageWithAuth = useCallback(
        async (imageUrl, cacheKey) => {
          if (!imageUrl) {
            return;
          }

          // Don't fetch if we already have the data URI
          if (imageDataUri) {
            return;
          }

          // Don't fetch if already fetching (prevent duplicate requests)
          if (isFetchingRef.current) {
            return;
          }

          isFetchingRef.current = true;

          try {
            setImageLoading(true);
            setImageError(false);

            const token = await AsyncStorage.getItem('token');
            if (!token) {
              setImageError(true);
              setImageLoading(false);
              return;
            }

            const response = await fetch(imageUrl, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });

            if (response.ok) {
              const contentType = response.headers.get('content-type') || '';

              // Check if response is JSON (API returns a URL object)
              if (contentType.includes('application/json')) {
                const jsonData = await response.json();

                // Extract the actual image URL from JSON
                const actualImageUrl =
                  jsonData.url ||
                  jsonData.imageUrl ||
                  jsonData.src ||
                  jsonData.location;

                if (!actualImageUrl) {
                  setImageError(true);
                  setImageLoading(false);
                  return;
                }

                // Fetch the actual image from the URL (likely S3)
                const imageResponse = await fetch(actualImageUrl, {
                  method: 'GET',
                  headers: actualImageUrl.includes('amazonaws.com')
                    ? {}
                    : {
                        Authorization: `Bearer ${token}`,
                      },
                });

                if (!imageResponse.ok) {
                  setImageError(true);
                  setImageLoading(false);
                  return;
                }

                const arrayBuffer = await imageResponse.arrayBuffer();

                // Convert arrayBuffer to base64
                const bytes = new Uint8Array(arrayBuffer);
                let binary = '';
                const chunkSize = 8192;

                for (let i = 0; i < bytes.length; i += chunkSize) {
                  const chunk = bytes.subarray(i, i + chunkSize);
                  binary += String.fromCharCode.apply(null, chunk);
                }

                let base64;
                try {
                  base64 = btoa(binary);
                } catch (e) {
                  if (typeof Buffer !== 'undefined') {
                    base64 = Buffer.from(binary, 'binary').toString('base64');
                  } else {
                    throw new Error('Unable to convert to base64');
                  }
                }

                const imageContentType =
                  imageResponse.headers.get('content-type') || 'image/jpeg';
                const dataUri = `data:${imageContentType};base64,${base64}`;

                // Save to cache (fire-and-forget, don't block on storage errors)
                if (cacheKey) {
                  memoryCacheRef.current.set(cacheKey, {
                    dataUri,
                    timestamp: Date.now(),
                  });
                  if (memoryCacheRef.current.size > MAX_MEMORY_CACHE_SIZE) {
                    const firstKey = memoryCacheRef.current.keys().next().value;
                    memoryCacheRef.current.delete(firstKey);
                  }
                  saveImageToCache(cacheKey, dataUri).catch(() => {
                    // Silently fail - cache is optional
                  });
                }

                setImageDataUri(dataUri);
                setImageLoading(false);
                setImageError(false);
              } else {
                // Direct image response

                const arrayBuffer = await response.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                let binary = '';
                const chunkSize = 8192;

                for (let i = 0; i < bytes.length; i += chunkSize) {
                  const chunk = bytes.subarray(i, i + chunkSize);
                  binary += String.fromCharCode.apply(null, chunk);
                }

                let base64;
                try {
                  base64 = btoa(binary);
                } catch (e) {
                  if (typeof Buffer !== 'undefined') {
                    base64 = Buffer.from(binary, 'binary').toString('base64');
                  } else {
                    throw new Error('Unable to convert to base64');
                  }
                }

                const imageContentType = contentType || 'image/jpeg';
                const dataUri = `data:${imageContentType};base64,${base64}`;

                // Save to cache (fire-and-forget, don't block on storage errors)
                if (cacheKey) {
                  memoryCacheRef.current.set(cacheKey, {
                    dataUri,
                    timestamp: Date.now(),
                  });
                  if (memoryCacheRef.current.size > MAX_MEMORY_CACHE_SIZE) {
                    const firstKey = memoryCacheRef.current.keys().next().value;
                    memoryCacheRef.current.delete(firstKey);
                  }
                  saveImageToCache(cacheKey, dataUri).catch(() => {
                    // Silently fail - cache is optional
                  });
                }

                setImageDataUri(dataUri);
                setImageLoading(false);
                setImageError(false);
              }
            } else {
              setImageError(true);
              setImageLoading(false);
            }
          } catch (error) {
            if (__DEV__) {
              console.error(`[ImageWithFallback] Fetch error:`, error.message);
            }
            setImageError(true);
            setImageLoading(false);
          } finally {
            isFetchingRef.current = false;
          }
        },
        [imageDataUri, getCachedImage, saveImageToCache],
      );

      useEffect(() => {
        // Generate unique key for this image
        const currentImageKey =
          imageKey || imageId || imageUri || `image_${index}`;

        // If a preloaded URI is provided, use it immediately and skip further work
        if (initialDataUri) {
          lastImageKeyRef.current = currentImageKey;
          setImageDataUri(initialDataUri);
          setImageLoading(false);
          setImageError(false);
          return;
        }

        // Generate image URL and cache key first
        let imageUrl = null;
        const cacheKey = getImageCacheKey(imageKey, imageId, imageUri);

        if (
          imageUri &&
          (imageUri.startsWith('http') || imageUri.startsWith('https'))
        ) {
          imageUrl = imageUri;
        } else if (imageKey) {
          const encodedKey = encodeURIComponent(imageKey);
          imageUrl = `${API_BASE_URL}/api/enquiries/files/${encodedKey}`;
        } else if (imageId) {
          imageUrl = `${API_BASE_URL}/api/enquiries/files/${imageId}`;
        }

        if (!imageUrl) {
          setImageError(true);
          return;
        }

        // Check if this is the same image we already loaded
        if (lastImageKeyRef.current === currentImageKey && imageDataUri) {
          return;
        }

        // Check memory cache FIRST (synchronously, before any async operations)
        if (cacheKey && memoryCacheRef.current.has(cacheKey)) {
          const cached = memoryCacheRef.current.get(cacheKey);
          const cacheAge = Date.now() - (cached.timestamp || 0);
          const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
          if (cacheAge < maxAge) {
            lastImageKeyRef.current = currentImageKey;
            setImageDataUri(cached.dataUri);
            setImageLoading(false);
            setImageError(false);
            return; // Exit early - found in memory cache
          } else {
            memoryCacheRef.current.delete(cacheKey);
          }
        }

        // Check cache (AsyncStorage) and fetch if needed
        const loadImage = async () => {
          if (!mountedRef.current) return;

          // Try AsyncStorage cache (if not in memory-only mode)
          if (cacheKey && !storageFullRef.current) {
            try {
              const cached = await getCachedImage(cacheKey);
              if (cached && mountedRef.current) {
                // Store in memory cache for faster access next time
                memoryCacheRef.current.set(cacheKey, {
                  dataUri: cached,
                  timestamp: Date.now(),
                });
                // Cache hit - set directly without loading state
                lastImageKeyRef.current = currentImageKey;
                setImageDataUri(cached);
                setImageLoading(false);
                setImageError(false);
                return;
              }
            } catch (error) {
              // Cache read failed, continue with fetch
              if (__DEV__) {
                console.error(
                  `[ImageWithFallback] Cache read error:`,
                  error.message,
                );
              }
            }
          }

          // Cache miss - reset state and fetch
          if (!mountedRef.current) {
            return;
          }

          lastImageKeyRef.current = currentImageKey;
          // Don't reset imageDataUri immediately - keep previous image visible until new one loads
          // This prevents flicker when navigating between images
          setImageError(false);
          isFetchingRef.current = false;
          setImageLoading(true);

          fetchImageWithAuth(imageUrl, cacheKey);
        };

        loadImage();
      }, [
        imageKey,
        imageId,
        imageUri,
        index,
        onPress,
        initialDataUri,
        getImageCacheKey,
        getCachedImage,
        fetchImageWithAuth,
      ]);

      // Use modal styles if onPress is null (modal context)
      const containerStyle =
        onPress === null ? styles.modalImageWrapper : styles.imageContainer;
      const placeholderStyle =
        onPress === null
          ? styles.modalImagePlaceholder
          : styles.imagePlaceholder;

      if (imageError) {
        return (
          <View style={containerStyle}>
            <View style={placeholderStyle}>
              <Icon
                name="image"
                size={onPress === null ? 48 : 24}
                color={
                  onPress === null ? colors.textWhite : colors.textSecondary
                }
              />
            </View>
          </View>
        );
      }

      // Show loading state only if we don't have imageDataUri yet
      if (!imageDataUri) {
        return (
          <View style={containerStyle}>
            <View style={placeholderStyle}>
              {imageLoading && (
                <View style={{ marginBottom: 12 }}>
                  <AnimatedLogoLoader size="small" />
                </View>
              )}
              <Icon
                name="image"
                size={onPress === null ? 48 : 24}
                color={
                  onPress === null ? colors.textWhite : colors.textSecondary
                }
              />
              {imageLoading && onPress === null && (
                <Text
                  style={{
                    color: colors.textWhite,
                    marginTop: 8,
                    fontSize: fonts.sm,
                  }}
                >
                  Loading image...
                </Text>
              )}
            </View>
          </View>
        );
      }

      // If onPress is null, render without TouchableOpacity (for modal - zoom handled by parent ScrollView)
      if (onPress === null) {
        return (
          <View style={styles.modalImageWrapper}>
            <OptimizedImage
              source={{ uri: imageDataUri }}
              style={styles.fullscreenImage}
              resizeMode="contain"
              showLoader={false}
              cacheEnabled={false}
              onError={() => {
                setImageError(true);
              }}
              onLoad={() => {
                // Image loaded successfully
              }}
            />
          </View>
        );
      }

      return (
        <TouchableOpacity
          style={styles.imageContainer}
          activeOpacity={0.9}
          onPress={() => {
            if (onPress) {
              onPress(imageDataUri);
            } else {
              handleImagePress(imageDataUri, index, [imageDataUri]);
            }
          }}
        >
          <EnquiryImage
            source={{ uri: imageDataUri }}
            onError={() => {
              setImageError(true);
            }}
            onLoad={() => {
              // Image loaded successfully
            }}
          />
        </TouchableOpacity>
      );
    },
    (prevProps, nextProps) => {
      // Custom comparison to prevent unnecessary re-renders
      return (
        prevProps.imageKey === nextProps.imageKey &&
        prevProps.imageId === nextProps.imageId &&
        prevProps.imageUri === nextProps.imageUri &&
        prevProps.index === nextProps.index &&
        prevProps.onPress === nextProps.onPress
      );
    },
  );

  const renderImages = () => {
    // Safety check for images array - prioritize enquiry.images since it's the normalized data
    // Check multiple possible locations for images, but prioritize arrays with actual content
    let images = [];

    // Check enquiry.images first (normalized data from API)
    if (
      enquiry?.images &&
      Array.isArray(enquiry.images) &&
      enquiry.images.length > 0
    ) {
      images = enquiry.images;
    } else if (
      enquiry?.ReferenceImages &&
      Array.isArray(enquiry.ReferenceImages) &&
      enquiry.ReferenceImages.length > 0
    ) {
      images = enquiry.ReferenceImages;
    } else if (
      enquiry?.Images &&
      Array.isArray(enquiry.Images) &&
      enquiry.Images.length > 0
    ) {
      images = enquiry.Images;
    } else if (
      originalData?.ReferenceImages &&
      Array.isArray(originalData.ReferenceImages) &&
      originalData.ReferenceImages.length > 0
    ) {
      images = originalData.ReferenceImages;
    } else if (
      originalData?.Images &&
      Array.isArray(originalData.Images) &&
      originalData.Images.length > 0
    ) {
      images = originalData.Images;
    }

    // Also check for ReferenceVideos field (videos might be stored separately)
    let videos = [];
    if (
      enquiry?.ReferenceVideos &&
      Array.isArray(enquiry.ReferenceVideos) &&
      enquiry.ReferenceVideos.length > 0
    ) {
      videos = enquiry.ReferenceVideos;
    } else if (
      enquiry?.Videos &&
      Array.isArray(enquiry.Videos) &&
      enquiry.Videos.length > 0
    ) {
      videos = enquiry.Videos;
    } else if (
      originalData?.ReferenceVideos &&
      Array.isArray(originalData.ReferenceVideos) &&
      originalData.ReferenceVideos.length > 0
    ) {
      videos = originalData.ReferenceVideos;
    } else if (
      originalData?.Videos &&
      Array.isArray(originalData.Videos) &&
      originalData.Videos.length > 0
    ) {
      videos = originalData.Videos;
    }

    // Also get videos from CAD/Coral versions
    const coralVersions = originalData?.Coral || enquiry?.Coral || [];
    const cadVersions = originalData?.Cad || enquiry?.Cad || [];

    // Extract videos from all Coral versions
    coralVersions.forEach((version, index) => {
      if (
        version?.Videos &&
        Array.isArray(version.Videos) &&
        version.Videos.length > 0
      ) {
        videos = [...videos, ...version.Videos];
      } else if (
        version?.videos &&
        Array.isArray(version.videos) &&
        version.videos.length > 0
      ) {
        videos = [...videos, ...version.videos];
      }
    });

    // Extract videos from all CAD versions
    cadVersions.forEach((version, index) => {
      if (
        version?.Videos &&
        Array.isArray(version.Videos) &&
        version.Videos.length > 0
      ) {
        videos = [...videos, ...version.Videos];
      } else if (
        version?.videos &&
        Array.isArray(version.videos) &&
        version.videos.length > 0
      ) {
        videos = [...videos, ...version.videos];
      }
    });

    // Merge images and videos into a single array for display
    // Mark videos explicitly so they're rendered correctly
    if (videos.length > 0) {
      const videosWithFlag = videos.map(video => ({
        ...video,
        _isVideo: true, // Explicit flag to identify videos
      }));
      images = [...(images || []), ...videosWithFlag];
    }

    if (!Array.isArray(images) || images.length === 0) {
      return (
        <Card style={styles.imagesCard}>
          <Text
            style={[
              styles.sectionTitle,
              { fontSize: 16, fontWeight: 'bold', color: colors.textPrimary },
            ]}
          >
            Reference Images/Videos
          </Text>
          <View style={styles.noImagesContainer}>
            <Icon name="photo-library" size={40} color={colors.primary} />
            <Text
              style={[
                styles.noImagesText,
                { color: colors.textSecondary, fontSize: fonts.base },
              ]}
            >
              No reference images or videos available
            </Text>
          </View>
        </Card>
      );
    }

    const buildImageMeta = image => {
      let imageKey = null;
      let imageId = null;
      let imageUri = null;

      if (typeof image === 'object' && image !== null) {
        imageKey =
          image.Key || image.key || image.KeyName || image.keyName || '';
        imageId =
          image.Id ||
          image.id ||
          image._id ||
          image.FileId ||
          image.fileId ||
          '';
        imageUri =
          image.Url ||
          image.url ||
          image.URI ||
          image.uri ||
          image.Location ||
          image.location ||
          image.UrlPath ||
          image.urlPath ||
          '';
      } else if (typeof image === 'string') {
        if (image.startsWith('http') || image.startsWith('https')) {
          imageUri = image;
        } else {
          imageKey = image;
        }
      }

      const cacheKey = getImageCacheKey(imageKey, imageId, imageUri);
      let cachedUri = null;
      if (cacheKey && memoryCacheRef.current.has(cacheKey)) {
        cachedUri = memoryCacheRef.current.get(cacheKey)?.dataUri || null;
      }

      // Detect if this is a video
      const isVideo = isVideoFile(imageKey, imageUri, image);

      return {
        image,
        imageKey,
        imageId,
        imageUri,
        cacheKey,
        cachedUri,
        isVideo,
      };
    };

    // Debug logging to see what we have (after buildImageMeta is defined)
    if (__DEV__ && (images.length > 0 || videos.length > 0)) {
      const coralVideoCount = coralVersions.reduce(
        (count, v) => count + (v?.Videos?.length || v?.videos?.length || 0),
        0,
      );
      const cadVideoCount = cadVersions.reduce(
        (count, v) => count + (v?.Videos?.length || v?.videos?.length || 0),
        0,
      );
      const sampleMeta = images[0] ? buildImageMeta(images[0]) : null;
      console.log('🔍 [SingleEnquiryScreen] Media data:', {
        imagesCount: images.length - videos.length,
        videosCount: videos.length,
        totalMedia: images.length,
        hasReferenceImages: !!(
          enquiry?.ReferenceImages || originalData?.ReferenceImages
        ),
        hasReferenceVideos: !!(
          enquiry?.ReferenceVideos || originalData?.ReferenceVideos
        ),
        coralVideoCount: coralVideoCount,
        cadVideoCount: cadVideoCount,
        sampleImage: sampleMeta
          ? {
              type: typeof sampleMeta.image,
              keys:
                typeof sampleMeta.image === 'object'
                  ? Object.keys(sampleMeta.image)
                  : [],
              isVideo: sampleMeta.isVideo,
            }
          : null,
      });
    }

    // If only one media item, show it without slider
    if (images.length === 1) {
      const meta = buildImageMeta(images[0]);

      return (
        <Card style={styles.imagesCard}>
          <Text
            style={[
              styles.sectionTitle,
              { fontSize: 16, fontWeight: 'bold', color: colors.textPrimary },
            ]}
          >
            Reference Images/Videos
          </Text>
          {meta.isVideo ? (
            <VideoWithFallback
              image={meta.image}
              imageKey={meta.imageKey}
              imageId={meta.imageId}
              imageUri={meta.imageUri}
              index={0}
              onPress={uri => handleImagePress(uri, 0, [meta])}
            />
          ) : (
            <ImageWithFallback
              image={meta.image}
              imageKey={meta.imageKey}
              imageId={meta.imageId}
              imageUri={meta.imageUri}
              index={0}
              initialDataUri={meta.cachedUri}
              onPress={uri => handleImagePress(uri, 0, [meta])}
            />
          )}
        </Card>
      );
    }

    // Build array of media data for the modal slider
    const imageDataForModal = images.map(buildImageMeta);

    return (
      <Card style={styles.imagesCard}>
        <Text
          style={[
            styles.sectionTitle,
            { fontSize: 16, fontWeight: 'bold', color: colors.textPrimary },
          ]}
        >
          Reference Images/Videos{' '}
          {images.length > 1 ? `(${images.length})` : ''}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {images.map((image, index) => {
            const meta = imageDataForModal[index] || buildImageMeta(image);
            return (
              <React.Fragment key={index}>
                {meta.isVideo ? (
                  <VideoWithFallback
                    image={meta.image}
                    imageKey={meta.imageKey}
                    imageId={meta.imageId}
                    imageUri={meta.imageUri}
                    index={index}
                    onPress={uri => {
                      // Pass all media data to modal for slider
                      handleImagePress(uri, index, imageDataForModal);
                    }}
                  />
                ) : (
                  <ImageWithFallback
                    image={meta.image}
                    imageKey={meta.imageKey}
                    imageId={meta.imageId}
                    imageUri={meta.imageUri}
                    index={index}
                    initialDataUri={meta.cachedUri}
                    onPress={uri => {
                      // Pass all media data to modal for slider
                      handleImagePress(uri, index, imageDataForModal);
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </ScrollView>
      </Card>
    );
  };

  const renderVersions = () => {
    // Get Coral and CAD codes from original data
    const coralCode =
      originalData?.CoralCode ||
      enquiry?.CoralCode ||
      enquiry?.coralCode ||
      enquiry?.coralVersion;
    const cadCode =
      originalData?.CadCode ||
      enquiry?.CadCode ||
      enquiry?.cadCode ||
      enquiry?.cadVersion;

    // Get all versions
    const coralVersions = originalData?.Coral || enquiry?.Coral || [];
    const cadVersions = originalData?.Cad || enquiry?.Cad || [];

    // Check if Coral/CAD data exists
    const hasCoral = coralCode || coralVersions.length > 0;
    const hasCAD = cadCode || cadVersions.length > 0;
    console.log('🔍 [SingleEnquiryScreen] coralVersions:', coralVersions);
    return (
      <View style={styles.versionsSection}>
        <Text style={styles.sectionLabel}>DESIGN VERSIONS</Text>

        {/* Coral Design */}
        <View style={styles.versionBlock}>
          <View style={styles.versionBlockHeader}>
            <Icon name="brush" size={16} color={colors.textSecondary} />
            <Text style={styles.versionBlockTitle}>
              Coral Design{coralVersions.length > 0 ? ` (${coralVersions.length})` : ''}
            </Text>
          </View>
          {hasCoral ? (
            <View style={styles.versionBlockBody}>
              {coralVersions.map((version, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.versionBlockItem,
                    index < coralVersions.length - 1 && styles.versionBlockItemBorder,
                    version.IsApprovedVersion === true && styles.versionBlockItemActive,
                  ]}
                  onPress={() => handleVersionSelect(index, 'coral')}
                  activeOpacity={0.7}
                >
                  <View style={styles.versionBlockItemLeft}>
                    <Text style={[
                      styles.versionBlockItemText,
                      version.IsApprovedVersion === true && styles.versionBlockItemTextActive,
                    ]}>
Coral - {version.Version || `Version ${index + 1}`} -{' '}
                    {version.CoralCode || ''}
                    </Text>
                    {version.IsApprovedVersion === true && (
                      <View style={styles.versionApprovedBadge}>
                        <Text style={styles.versionApprovedBadgeText}>APPROVED</Text>
                      </View>
                    )}
                  </View>
                  <Icon name="visibility" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.versionBlockBody}>
              <Text style={styles.versionEmptyText}>No coral design uploaded yet</Text>
            </View>
          )}
        </View>

        {/* CAD Design */}
        <View style={styles.versionBlock}>
          <View style={styles.versionBlockHeader}>
            <Icon name="view-in-ar" size={16} color={colors.textSecondary} />
            <Text style={styles.versionBlockTitle}>
              CAD Design{cadVersions.length > 0 ? ` (${cadVersions.length})` : ''}
            </Text>
          </View>
          {hasCAD ? (
            <View style={styles.versionBlockBody}>
              {cadVersions.map((version, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.versionBlockItem,
                    index < cadVersions.length - 1 && styles.versionBlockItemBorder,
                    version.IsApprovedVersion === true && styles.versionBlockItemActive,
                  ]}
                  onPress={() => handleVersionSelect(index, 'cad')}
                  activeOpacity={0.7}
                >
                  <View style={styles.versionBlockItemLeft}>
                    <Text style={[
                      styles.versionBlockItemText,
                      version.IsApprovedVersion === true && styles.versionBlockItemTextActive,
                    ]}>
CAD - {version.Version || `Version ${index + 1}`} -{' '}
                    {version.CadCode || ''}
                    </Text>
                    {version.IsApprovedVersion === true && (
                      <View style={styles.versionApprovedBadge}>
                        <Text style={styles.versionApprovedBadgeText}>APPROVED</Text>
                      </View>
                    )}
                  </View>
                  <Icon name="visibility" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.versionBlockBody}>
              <Text style={styles.versionEmptyText}>No CAD design uploaded yet</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const handleVersionSelect = (versionIndex, designType) => {
    navigation.navigate('DesignViewer', {
      designType: designType,
      enquiry: enquiry,
      versionIndex: versionIndex,
    });
  };

  const handleEditEnquiry = async () => {
    // Refetch the full enquiry data to ensure we have all fields
    try {
      if (enquiryId && enquiryData) {
        // Refetch to get latest data
        const result = await refetch();
        const fullEnquiry = result?.data || enquiryData || enquiry;

        navigation.navigate('EditEnquiryStep1', {
          enquiry: fullEnquiry,
          enquiryId: enquiryId, // Pass ID as fallback
        });
      } else {
        // Fallback if refetch fails
        navigation.navigate('EditEnquiryStep1', {
          enquiry: enquiry,
          enquiryId: enquiryId,
        });
      }
    } catch (error) {
      // Navigate with what we have
      navigation.navigate('EditEnquiryStep1', {
        enquiry: enquiry,
        enquiryId: enquiryId,
      });
    }
  };

  const handleDeleteEnquiry = () => {
    showAlert(
      'Delete Enquiry',
      `Are you sure you want to delete "${
        enquiry?.title || 'this enquiry'
      }"? This action cannot be undone.`,
      'warning',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Navigate back immediately for better UX (optimistic update handles cache removal)
              navigation.navigate('MainTabs', {
                screen: 'Enquiries',
                params: { refreshTimestamp: Date.now() },
              });

              // Delete enquiry (optimistic update removes it from cache immediately)
              await deleteEnquiry(enquiryId || enquiry?.id).unwrap();

              // Success - no need for alert since user already navigated
            } catch (error) {
              // Show error alert
              showAlert(
                'Error',
                error.data?.error ||
                  error.message ||
                  'Failed to delete enquiry. Please try again.',
                'error',
              );
            }
          },
        },
      ],
    );
  };

  const renderClientActions = () => (
    <Card style={styles.actionsCard}>
      <Text
        style={[
          styles.sectionTitle,
          { fontSize: 16, fontWeight: 'bold', color: colors.textPrimary },
        ]}
      >
        Actions
      </Text>

      {/* Edit / update enquiry is staff-only — clients use reference upload below */}

      {/* Reference upload for clients */}
      <View style={styles.adminActionsRow}>
        <TouchableOpacity
          style={[styles.adminActionButton, styles.adminActionButtonSecondary]}
          activeOpacity={0.85}
          onPress={handleUploadReferenceImages}
          disabled={isUploadingReference}
        >
          <Icon name="cloud-upload" size={18} color={colors.textWhite} />
          <Text style={styles.adminActionText}>
            {isUploadingReference ? 'Uploading...' : 'Upload Reference Image'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Hide enquiry history for clients (role 4) */}
      {user?.roleId !== 4 &&
        user?.roleNumber !== 4 &&
        user?.role !== 'client' && (
          <Button
            title="Enquiry History"
            onPress={() => setShowHistoryModal(true)}
            style={[styles.actionButton, styles.historyButton]}
          />
        )}

      {/* Approve and Reject buttons removed for clients - clients don't have permission for these actions */}
    </Card>
  );

  const renderDesignerActions = role => (
    <Card style={styles.actionsCard}>
      <Text
        style={[
          styles.sectionTitle,
          { fontSize: 16, fontWeight: 'bold', color: colors.textPrimary },
        ]}
      >
        Designer Actions
      </Text>
      <View style={styles.adminActionsRow}>
        <TouchableOpacity
          onPress={role === 'coral' ? handleUploadCoral : handleUploadCAD}
          style={[styles.adminActionButton, styles.adminActionButtonPrimary]}
          activeOpacity={0.85}
        >
          <Icon name="cloud-upload" size={18} color={colors.textWhite} />
          <Text style={styles.adminActionText}>
            Upload {role === 'coral' ? 'Coral' : 'CAD'} Design
          </Text>
        </TouchableOpacity>
      </View>
    </Card>
  );

  const handleViewCAD = () => {
    // Get all CAD versions
    const cadVersions = originalData?.Cad || enquiry?.Cad || [];

    if (cadVersions.length === 0) {
      showAlert('No Versions', 'No CAD versions available', 'info');
      return;
    }

    // If only one version, go directly
    if (cadVersions.length === 1) {
      navigation.navigate('DesignViewer', {
        designType: 'cad',
        enquiry: enquiry,
        versionIndex: 0,
      });
      return;
    }

    // Show version selector for multiple versions
    setSelectedDesignType('cad');
    setShowVersionSelector(true);
  };

  const renderAdminActions = () => {
    const hasCAD =
      originalData?.CadCode ||
      enquiry?.CadCode ||
      enquiry?.cadCode ||
      (originalData?.Cad &&
        Array.isArray(originalData.Cad) &&
        originalData.Cad.length > 0) ||
      (enquiry?.Cad && Array.isArray(enquiry.Cad) && enquiry.Cad.length > 0);

    return (
      <Card style={[styles.actionsCard, styles.adminActionsCard]}>
        <View style={styles.adminActionsHeader}>
          <Icon name="admin-panel-settings" size={18} color={colors.primary} />
          <Text style={styles.adminActionsTitle}>Admin Controls</Text>
        </View>

        <View style={styles.adminActionsRow}>
          <TouchableOpacity
            style={[styles.adminActionButton, styles.adminActionButtonPrimary]}
            activeOpacity={0.85}
            onPress={handleEditEnquiry}
          >
            <Icon name="edit" size={18} color={colors.textWhite} />
            <Text style={styles.adminActionText}>Edit Enquiry</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.adminActionButton,
              styles.adminActionButtonSecondary,
            ]}
            activeOpacity={0.85}
            onPress={() => setShowHistoryModal(true)}
          >
            <Icon name="history" size={18} color={colors.textWhite} />
            <Text style={styles.adminActionText}>Enquiry History</Text>
          </TouchableOpacity>
        </View>

        {/* Upload Buttons for Admin */}
        <View style={styles.adminActionsRow}>
          <TouchableOpacity
            style={[
              styles.adminActionButton,
              styles.adminActionButtonSecondary,
            ]}
            activeOpacity={0.85}
            onPress={handleUploadCoral}
          >
            <Icon name="cloud-upload" size={18} color={colors.textWhite} />
            <Text style={styles.adminActionText}>Upload Coral</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.adminActionButton,
              styles.adminActionButtonSecondary,
            ]}
            activeOpacity={0.85}
            onPress={handleUploadCAD}
          >
            <Icon name="cloud-upload" size={18} color={colors.textWhite} />
            <Text style={styles.adminActionText}>Upload CAD</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.adminActionsRow}>
          <TouchableOpacity
            style={[
              styles.adminActionButton,
              styles.adminActionButtonSecondary,
            ]}
            activeOpacity={0.85}
            onPress={handleUploadReferenceImages}
            disabled={isUploadingReference}
          >
            <Icon name="photo-library" size={18} color={colors.textWhite} />
            <Text style={styles.adminActionText}>
              {isUploadingReference ? 'Uploading...' : 'Upload Reference Image'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.adminActionsRow}>
          <TouchableOpacity
            style={[styles.adminActionButton, styles.adminActionButtonDanger]}
            activeOpacity={0.85}
            onPress={handleDeleteEnquiry}
          >
            <Icon name="delete-outline" size={18} color={colors.textWhite} />
            <Text style={styles.adminActionText}>Delete Enquiry</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  const renderApprovalModal = () => {
    // Get version info for display
    const originalData = enquiry?._originalData || enquiry;
    const versions =
      selectedDesignType === 'coral'
        ? originalData?.Coral || enquiry?.Coral || []
        : originalData?.Cad || enquiry?.Cad || [];
    const version =
      selectedVersionIndex !== null && selectedVersionIndex < versions.length
        ? versions[selectedVersionIndex]?.Version ||
          `Version ${selectedVersionIndex + 1}`
        : 'this version';

    return (
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: 'bold',
              color: colors.textPrimary,
            }}
          >
            Reject Design Version
          </Text>
          <Text
            style={{ color: colors.textSecondary, fontSize: 13, marginTop: 8 }}
          >
            {selectedDesignType
              ? `${selectedDesignType.toUpperCase()} ${version}`
              : 'Design version'}
          </Text>
          <Text
            style={{ color: colors.textSecondary, fontSize: 13, marginTop: 8 }}
          >
            Please provide a reason for rejection:
          </Text>

          <Input
            placeholder="Enter rejection reason..."
            value={approvalMessage}
            onChangeText={setApprovalMessage}
            multiline
            numberOfLines={3}
            style={styles.modalInput}
          />

          <View style={styles.modalButtons}>
            <Button
              title="Cancel"
              variant="outline"
              onPress={() => setShowApprovalModal(false)}
              style={styles.modalButton}
            />
            <Button
              title="Reject"
              onPress={confirmReject}
              style={[styles.modalButton, styles.rejectButton]}
            />
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {renderEnquiryDetails()}
        {renderVersions()}
        {renderImages()}

        {user?.role === 'admin' && renderAdminActions()}
     
        {user?.role === 'client' && renderClientActions()}
        {(user?.role === 'coral' || user?.role === 'cad') &&
          renderDesignerActions(user?.role)}
      </ScrollView>

      {isImageModalVisible && (
        <Modal
          visible={isImageModalVisible}
          transparent
          animationType="fade"
          onRequestClose={closeImageModal}
        >
          <View style={styles.fullscreenImageBackdrop}>
            {/* Close button - positioned with high z-index */}
            <TouchableOpacity
              style={styles.fullscreenImageCloseButton}
              onPress={closeImageModal}
              activeOpacity={0.7}
            >
              <Icon name="close" size={24} color={colors.textWhite} />
            </TouchableOpacity>

            {/* Share button - positioned with high z-index */}
            <TouchableOpacity
              style={styles.fullscreenImageShareButton}
              onPress={handleShareToWhatsApp}
              activeOpacity={0.7}
              disabled={isSharing}
            >
              {isSharing ? (
                <AnimatedLogoLoader size="small" />
              ) : (
                <Icon name="share" size={24} color={colors.textWhite} />
              )}
            </TouchableOpacity>

            {modalImages.length > 1 ? (
              <>
                {/* Image Counter */}
                <View style={styles.modalImageCounter}>
                  <Text style={styles.modalImageCounterText}>
                    {modalCurrentIndex + 1} / {modalImages.length}
                  </Text>
                </View>

                {/* Slider for multiple images/videos with zoom */}
                <FlatList
                  ref={modalFlatListRef}
                  data={modalImages}
                  renderItem={({ item, index }) => {
                    // For videos, we need to fetch the URL if not available
                    const videoUrl = item.isVideo
                      ? item.imageUri || item.cachedUri || selectedImageUri
                      : null;

                    return (
                      <View style={styles.modalImageContainer}>
                        {item.isVideo ? (
                          videoUrl ? (
                            <Video
                              source={{ uri: videoUrl }}
                              style={styles.fullscreenVideo}
                              controls={true}
                              resizeMode="contain"
                              paused={false}
                            />
                          ) : (
                            <View style={styles.videoPlaceholder}>
                              <AnimatedLogoLoader size="small" />
                              <Text style={styles.videoLoadingText}>
                                Loading video...
                              </Text>
                            </View>
                          )
                        ) : (
                          <ImageZoom
                            cropWidth={screenWidth}
                            cropHeight={screenHeight}
                            imageWidth={screenWidth}
                            imageHeight={screenHeight}
                            enableCenterFocus
                            useNativeDriver
                            enableSwipeDown={false}
                            pinchToZoom
                            panToMove={isModalZoomed}
                            onMove={handleZoomMove}
                          >
                            <ImageWithFallback
                              image={item.image}
                              imageKey={item.imageKey}
                              imageId={item.imageId}
                              imageUri={item.imageUri}
                              index={index}
                              initialDataUri={item.cachedUri}
                              onPress={null} // No click handler in modal
                            />
                          </ImageZoom>
                        )}
                      </View>
                    );
                  }}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  initialScrollIndex={modalCurrentIndex}
                  onViewableItemsChanged={modalOnViewableItemsChanged}
                  viewabilityConfig={modalViewabilityConfig}
                  getItemLayout={(data, index) => ({
                    length: screenWidth,
                    offset: screenWidth * index,
                    index,
                  })}
                  scrollEnabled={!isModalZoomed}
                  onMomentumScrollEnd={() => setIsModalZoomed(false)}
                  onScrollBeginDrag={() => setIsModalZoomed(false)}
                  keyExtractor={getModalImageKey}
                  removeClippedSubviews={false}
                  windowSize={3}
                  initialNumToRender={3}
                  maxToRenderPerBatch={3}
                />

                {modalImages.length > 1 && (
                  <>
                    <TouchableOpacity
                      style={[
                        styles.modalNavButton,
                        styles.modalNavButtonLeft,
                        modalCurrentIndex === 0 &&
                          styles.modalNavButtonDisabled,
                      ]}
                      onPress={handleModalPrev}
                      disabled={modalCurrentIndex === 0}
                      activeOpacity={0.8}
                    >
                      <Icon
                        name="chevron-left"
                        size={28}
                        color={colors.textWhite}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.modalNavButton,
                        styles.modalNavButtonRight,
                        modalCurrentIndex === modalImages.length - 1 &&
                          styles.modalNavButtonDisabled,
                      ]}
                      onPress={handleModalNext}
                      disabled={modalCurrentIndex === modalImages.length - 1}
                      activeOpacity={0.8}
                    >
                      <Icon
                        name="chevron-right"
                        size={28}
                        color={colors.textWhite}
                      />
                    </TouchableOpacity>
                  </>
                )}

                {/* Pagination Dots */}
                <View style={styles.modalPaginationContainer}>
                  {modalImages.map((_, index) => (
                    <View
                      key={index}
                      style={[
                        styles.modalPaginationDot,
                        index === modalCurrentIndex &&
                          styles.modalPaginationDotActive,
                      ]}
                    />
                  ))}
                </View>
              </>
            ) : (
              /* Single image/video with zoom */
              <View style={styles.modalImageContainer}>
                {modalImages[0]?.isVideo ? (
                  <Video
                    source={{ uri: selectedImageUri }}
                    style={styles.fullscreenVideo}
                    controls={true}
                    resizeMode="contain"
                    paused={false}
                  />
                ) : (
                  <ImageZoom
                    cropWidth={screenWidth}
                    cropHeight={screenHeight}
                    imageWidth={screenWidth}
                    imageHeight={screenHeight}
                    enableCenterFocus
                    useNativeDriver
                    enableSwipeDown={false}
                    pinchToZoom
                    panToMove={isModalZoomed}
                    onMove={handleZoomMove}
                  >
                    <OptimizedImage
                      source={{ uri: selectedImageUri }}
                      style={styles.fullscreenImage}
                      resizeMode="contain"
                      showLoader={false}
                      cacheEnabled={false}
                    />
                  </ImageZoom>
                )}
              </View>
            )}
          </View>
        </Modal>
      )}

      {showApprovalModal && renderApprovalModal()}

      <EnquiryHistoryModal
        visible={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        enquiry={enquiry}
      />

      {canShowChatFab && (
        <TouchableOpacity
          style={styles.chatFab}
          onPress={handleOpenChat}
          activeOpacity={0.85}
        >
          <Icon name="chat" size={20} color={colors.textWhite} />
          <Text style={styles.chatFabText}>Open Chat</Text>
        </TouchableOpacity>
      )}

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
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  // Hero Section
  heroSection: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(192, 200, 201, 0.2)',
    marginBottom: 16,
  },
  heroImageWrap: {
    width: 96,
    height: 96,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(192, 200, 201, 0.3)',
    overflow: 'hidden',
    flexShrink: 0,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroImagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroContent: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.primary,
    marginBottom: 4,
  },
  heroCode: {
    fontSize: 10,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    letterSpacing: 0.05,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  heroBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 2,
  },
  heroBadgeText: {
    fontSize: 9,
    fontFamily: fonts.medium,
    color: colors.textWhite,
    letterSpacing: 0.05,
    textTransform: 'uppercase',
  },
  // Data Grid (2-column compact)
  dataGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  dataCell: {
    width: '48.5%',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(192, 200, 201, 0.3)',
    padding: 12,
    borderRadius: 8,
  },
  dataCellAccent: {
    backgroundColor: 'rgba(0, 41, 46, 0.05)',
    borderColor: 'rgba(0, 41, 46, 0.2)',
  },
  dataCellLabel: {
    fontSize: 9,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    letterSpacing: 0.05,
    textTransform: 'uppercase',
    marginBottom: 4,
    opacity: 0.7,
  },
  dataCellValue: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  assignedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  avatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFDEA3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 8,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  // Section labels
  sectionLabel: {
    fontSize: 10,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    letterSpacing: 0.05,
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionCard: {
    marginBottom: 16,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codesRow: {
    gap: 4,
  },
  codeText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontFamily: fonts.medium,
  },
  // Version blocks (HTML-inspired)
  versionsSection: {
    marginBottom: 16,
  },
  versionBlock: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(192, 200, 201, 0.3)',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 8,
  },
  versionBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#F3F4F3',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(192, 200, 201, 0.2)',
  },
  versionBlockTitle: {
    fontSize: 10,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  versionBlockBody: {
    paddingVertical: 4,
  },
  versionBlockItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  versionBlockItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(192, 200, 201, 0.1)',
  },
  versionBlockItemActive: {
    backgroundColor: 'rgba(39, 62, 49, 0.05)',
  },
  versionBlockItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  versionBlockItemText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
  },
  versionBlockItemTextActive: {
    fontSize: 13,
    color: colors.primary,
    fontFamily: fonts.bold,
  },
  versionApprovedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(39, 62, 49, 0.1)',
    borderRadius: 2,
  },
  versionApprovedBadgeText: {
    fontSize: 8,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  versionEmptyText: {
    fontSize: 13,
    color: colors.textLight,
    fontFamily: fonts.regular,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  // Bottom action buttons (HTML-inspired)
  bottomActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    marginBottom: 16,
  },
  bottomActionPrimary: {
    flex: 1,
    height: 48,
    backgroundColor: colors.primary,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomActionPrimaryText: {
    fontSize: 11,
    fontFamily: fonts.medium,
    color: colors.textWhite,
    letterSpacing: 0.05,
    textTransform: 'uppercase',
  },
  bottomActionIcon: {
    width: 48,
    height: 48,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.textSecondary,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomActionDelete: {
    width: 48,
    height: 48,
    backgroundColor: 'rgba(186, 26, 26, 0.2)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailsCard: {
    marginBottom: spacing.lg,
  },
  detailsHeader: {
    flexDirection: 'column',
    marginBottom: 16,
  },
  statusContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    minWidth: 120,
    maxWidth: '90%',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
  },
  priorityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    minWidth: 100,
    maxWidth: '100%',
    alignItems: 'center',
    flexShrink: 1,
  },
  detailsGrid: {
    gap: 12,
  },
  detailRowTwoColumn: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  detailCell: {
    flex: 1,
    paddingVertical: 4,
  },
  detailCellPlaceholder: {
    flex: 1,
    paddingVertical: 4,
  },
  detailCellLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 4,
  },
  detailCellIcon: {
    marginRight: 4,
  },
  detailCellLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },
  detailCellValue: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  descriptionText: {
    textAlign: 'left',
  },
  imagesCard: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  imageContainer: {
    marginRight: 12,
  },
  sliderImageContainer: {
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePlaceholder: {
    width: 150,
    height: 150,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noImagesContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noImagesText: {
    marginTop: 12,
    textAlign: 'center',
  },
  paginationContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border || '#E0E0E0',
    marginHorizontal: 4,
  },
  paginationDotActive: {
    backgroundColor: colors.primary || '#2196F3',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  errorText: {
    textAlign: 'center',
    marginBottom: 20,
    fontFamily: fonts.bold,
  },
  errorSubtext: {
    textAlign: 'center',
    lineHeight: 20,
  },
  errorActions: {
    width: '100%',
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  retryButton: {
    marginBottom: 8,
  },
  backButton: {
    marginTop: 20,
  },
  versionsCard: {
    marginBottom: spacing.lg,
  },
  versionItem: {
    marginBottom: 16,
  },
  versionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  versionTitle: {
    marginLeft: 8,
    fontWeight: fonts.medium,
  },
  versionFile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    padding: 12,
    borderRadius: 8,
  },
  fileName: {
    flex: 1,
    marginLeft: 8,
  },
  actionsCard: {
    marginBottom: spacing.lg,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
  },
  approveButton: {
    backgroundColor: colors.success,
  },
  rejectButton: {
    borderColor: colors.error,
  },
  deleteButton: {
    backgroundColor: colors.error,
  },
  downloadButton: {
    backgroundColor: colors.info || '#2196F3',
  },
  coralButton: {
    backgroundColor: colors.warning || '#F59E0B',
  },
  cadButton: {
    backgroundColor: colors.info || '#2196F3',
  },
  uploadButton: {
    marginBottom: 16,
  },
  editButton: {
    marginBottom: 16,
  },
  historyButton: {
    backgroundColor: colors.info || '#2196F3',
    marginBottom: 16,
  },
  chatFab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  chatFabText: {
    color: colors.textWhite,
    marginLeft: 8,
    fontFamily: fonts.medium,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.modalOverlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: colors.modalBackground,
    borderRadius: 12,
    padding: 20,
    width: '100%',
  },
  modalText: {
    marginBottom: 16,
  },
  modalInput: {
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
  },
  fullscreenImageBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
  },
  modalImageContainer: {
    width: Dimensions.get('window').width,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImageWrapper: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomScrollView: {
    flex: 1,
    width: Dimensions.get('window').width,
  },
  zoomScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalNavButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -28,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 12,
    borderRadius: 28,
    zIndex: 15,
  },
  modalNavButtonLeft: {
    left: 12,
  },
  modalNavButtonRight: {
    right: 12,
  },
  modalNavButtonDisabled: {
    opacity: 0.35,
  },
  modalImageCounter: {
    position: 'absolute',
    top: 60,
    left: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    zIndex: 10,
  },
  modalImageCounterText: {
    color: colors.textWhite,
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
  },
  modalPaginationContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  modalPaginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    marginHorizontal: 4,
  },
  modalPaginationDotActive: {
    backgroundColor: colors.textWhite,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  fullscreenImageCloseButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    padding: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 1000,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  fullscreenImageShareButton: {
    position: 'absolute',
    top: 40,
    right: 80,
    padding: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 1000,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  videoContainer: {
    marginRight: 12,
    width: 150,
    height: 150,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.backgroundSecondary,
    position: 'relative',
  },
  referenceVideo: {
    width: '100%',
    height: '100%',
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
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
  videoLoadingText: {
    marginTop: 8,
    fontSize: fonts.sm,
    color: colors.textSecondary,
  },
  videoErrorText: {
    marginTop: 8,
    fontSize: fonts.sm,
    color: colors.error,
  },
  fullscreenVideo: {
    width: '100%',
    height: '100%',
  },
  adminActionsCard: {
    borderWidth: 1,
    borderColor: 'rgba(16, 53, 52, 0.1)',
    backgroundColor: '#F2F5F4',
    padding: 20,
    borderRadius: 16,
  },
  adminActionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  adminActionsTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  adminActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 12,
  },
  adminActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
  },
  adminActionButtonPrimary: {
    backgroundColor: colors.primary,
  },
  adminActionButtonSecondary: {
    backgroundColor: colors.primaryLight,
  },
  adminActionButtonDanger: {
    backgroundColor: colors.error,
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
  UploadCoralCadd: {
    flexDirection: 'row',
    alignItems: 'center',
    // marginTop: 8,
    gap: 12,
    marginBottom: 16,
  },
});

export default SingleEnquiryScreen;
