import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Text,
  Image,
  Dimensions,
  Platform,
  Modal,
  StatusBar,
  TextInput,
  Switch,
} from 'react-native';
import Video from 'react-native-video';
import { Card } from '../../components/cards/Cards';
import { Button, Input, AnimatedLogoLoader, OptimizedImage } from '../../components/common';
import Icon from '../../components/common/Icon';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { CustomText } from '../../components/common/Text';
import { useAuth } from '../../context/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUpdateAssetDescriptionMutation, useGetEnquiryByIdQuery, useApproveDesignVersionMutation, useRejectDesignVersionMutation, useUpdateShowToClientMutation, useDeleteDesignVersionMutation } from '../../store/api';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { API_BASE_URL } from '../../config/apiConfig';
import { getCachedImage, cacheImage } from '../../utils/imageCache';
import BrandedAlert from '../../components/common/BrandedAlert';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IMAGE_CONTAINER_HEIGHT = SCREEN_HEIGHT * 0.5;

const DesignViewerScreen = ({ route, navigation }) => {
  const { designType, enquiry: routeEnquiry, versionIndex } = route.params || {}; // designType: 'coral' or 'cad', versionIndex: optional index
  const enquiry = routeEnquiry;
  const { user } = useAuth();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [comment, setComment] = useState('');
  const [imageHeaders, setImageHeaders] = useState({});
  const [imageDataUri, setImageDataUri] = useState(null);
  const [imageLoadingError, setImageLoadingError] = useState(false);
  
  // Memory cache for images - prevents re-fetching and multiple renders
  const imageCacheRef = useRef(new Map()); // URL -> dataUri cache
  const fetchingRef = useRef(false); // Track if currently fetching
  const currentFetchUrlRef = useRef(null); // Track current fetch URL
  
  // Log imageDataUri state changes (only in dev mode, and only on significant changes)
  useEffect(() => {
    if (__DEV__ && imageDataUri) {
      // Only log when imageDataUri is actually set (not on every state change)
      console.log(`🎨 [DesignViewer] Image loaded for #${currentImageIndex}`);
    }
  }, [imageDataUri, currentImageIndex]);
  
  // Both platforms: load via fetch + Bearer token → data URI. iOS RN Image ignores auth headers on remote URLs,
  // and OptimizedImage only forwards uri (not headers) to Image — so coral/CAD previews failed on iOS.
  const [useFetchDirectly, setUseFetchDirectly] = useState(true);
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);
  const [isDownloadingImage, setIsDownloadingImage] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date()); // For periodic delete button state updates
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  const showAlert = (title, message, type = 'info', buttons = []) =>
    setAlertConfig({ visible: true, title, message, type, buttons });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));
  
  // API mutation for updating asset description
  const [updateAssetDescription, { isLoading: isUpdatingDescription }] = useUpdateAssetDescriptionMutation();
  
  // Approve/Reject mutations
  const [approveDesignVersion, { isLoading: isApproving }] = useApproveDesignVersionMutation();
  const [rejectDesignVersion, { isLoading: isRejecting }] = useRejectDesignVersionMutation();
  const [updateShowToClient, { isLoading: isUpdatingShowToClient }] = useUpdateShowToClientMutation();
  const [deleteDesignVersion, { isLoading: isDeletingVersion }] = useDeleteDesignVersionMutation();
  
  // Check if user is Coral or CAD designer (hide admin features)
  const isDesigner = user?.role === 'coral' || user?.role === 'cad';
  const isAdmin = user?.role === 'admin';
  const isClient = user?.roleId === 4 || user?.roleNumber === 4 || user?.role === 'client';

  // Load auth token for image headers
  useEffect(() => {
    const loadAuthToken = async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        if (token) {
          setImageHeaders({
            'Authorization': `Bearer ${token}`,
          });
        } else {
        }
      } catch (error) {
      }
    };
    loadAuthToken();
  }, []);

  // Timer to update delete button state every 30 seconds (to check if 10 minutes passed)
  useEffect(() => {
    if (!isDesigner || !selectedDesign) return;

    const interval = setInterval(() => {
      setCurrentTime(new Date());
      
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [isDesigner, selectedDesign]);

  // Fetch image with authentication as fallback (for Android compatibility)
  const fetchImageWithAuth = useCallback(async (imageUrl) => {
    const urlToFetch = imageUrl || currentImageUrl;
    
    // Guard: Skip if no URL
    if (!urlToFetch) {
      return;
    }
    
    // Guard: Skip if already fetching this URL
    if (fetchingRef.current && currentFetchUrlRef.current === urlToFetch) {
      return;
    }
    
    // Guard: Check memory cache first (fastest)
    if (imageCacheRef.current.has(urlToFetch)) {
      const cachedDataUri = imageCacheRef.current.get(urlToFetch);
      setImageDataUri(cachedDataUri);
      setImageLoadingError(false);
      return;
    }
    
    // Set fetching flag
    fetchingRef.current = true;
    currentFetchUrlRef.current = urlToFetch;
    
    try {
      // Note: Cache check removed here - already checked in effect
      // This prevents redundant AsyncStorage reads

      const token = await AsyncStorage.getItem('token');
      if (!token) {
        fetchingRef.current = false;
        currentFetchUrlRef.current = null;
        return;
      }
      
      const response = await fetch(urlToFetch, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        
        // Check if response is JSON (API returns a URL object)
        if (contentType.includes('application/json')) {
          const jsonData = await response.json();
          
          // Extract the actual image URL from JSON (could be 'url', 'imageUrl', 'src', etc.)
          const actualImageUrl = jsonData.url || jsonData.imageUrl || jsonData.src || jsonData.location;
          
          if (!actualImageUrl) {
            if (currentFetchUrlRef.current === urlToFetch) {
              setImageLoadingError(true);
            }
            fetchingRef.current = false;
            currentFetchUrlRef.current = null;
            return;
          }
          
          // Check cache for actual image URL as well
          const cachedActualImageUri = await getCachedImage(actualImageUrl);
          if (cachedActualImageUri) {
            // Store in memory cache
            imageCacheRef.current.set(actualImageUrl, cachedActualImageUri);
            imageCacheRef.current.set(urlToFetch, cachedActualImageUri);
            if (currentFetchUrlRef.current === urlToFetch) {
              setImageDataUri(cachedActualImageUri);
              setImageLoadingError(false);
            }
            // Also cache the original URL pointing to the data URI
            await cacheImage(urlToFetch, cachedActualImageUri);
            fetchingRef.current = false;
            currentFetchUrlRef.current = null;
            return;
          }
          
          // Fetch the actual image from the URL (likely S3, may not need auth)
          const imageResponse = await fetch(actualImageUrl, {
            method: 'GET',
            // Some S3 URLs might need headers, but usually public URLs don't
            headers: actualImageUrl.includes('amazonaws.com') ? {} : {
              'Authorization': `Bearer ${token}`,
            },
          });
          
          if (!imageResponse.ok) {
            if (currentFetchUrlRef.current === urlToFetch) {
              setImageLoadingError(true);
            }
            fetchingRef.current = false;
            currentFetchUrlRef.current = null;
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
              throw new Error('Neither btoa nor Buffer available');
            }
          }
          
          const imageContentType = imageResponse.headers.get('content-type') || 'image/jpeg';
          const dataUri = `data:${imageContentType};base64,${base64}`;
          
          // Cache the image (both URLs) - memory cache + AsyncStorage
          imageCacheRef.current.set(actualImageUrl, dataUri);
          imageCacheRef.current.set(urlToFetch, dataUri);
          await cacheImage(actualImageUrl, dataUri);
          await cacheImage(urlToFetch, dataUri);
          
          // Only update if this is still the current URL
          if (currentFetchUrlRef.current === urlToFetch) {
            setImageDataUri(dataUri);
            setImageLoadingError(false);
          }
        } else {
          // Direct image response
          
          const arrayBuffer = await response.arrayBuffer();
          
          // Convert arrayBuffer to base64 - chunked for large images
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
              throw new Error('Neither btoa nor Buffer available');
            }
          }
          
          const imageContentType = contentType || 'image/jpeg';
          const dataUri = `data:${imageContentType};base64,${base64}`;
          
          // Cache the image - memory cache + AsyncStorage
          imageCacheRef.current.set(urlToFetch, dataUri);
          await cacheImage(urlToFetch, dataUri);
          
          // Only update if this is still the current URL
          if (currentFetchUrlRef.current === urlToFetch) {
            setImageDataUri(dataUri);
            setImageLoadingError(false);
          }
        }
      } else {
        if (currentFetchUrlRef.current === urlToFetch) {
          setImageLoadingError(true);
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error(`[DesignViewer] Fetch error:`, error.message);
      }
      if (currentFetchUrlRef.current === urlToFetch) {
        setImageLoadingError(true);
      }
    } finally {
      // Reset fetching flag only if this was the current fetch
      if (currentFetchUrlRef.current === urlToFetch) {
        fetchingRef.current = false;
        currentFetchUrlRef.current = null;
      }
    }
  }, [currentImageIndex, currentImageUrl, imageDataUri]);


  // Get enquiry ID for refetching
  const enquiryId = enquiry?.id || enquiry?._id;
  
  // Refetch enquiry data when screen comes into focus (to get updated descriptions and pricing)
  const { data: fetchedEnquiryData, refetch: refetchEnquiry } = useGetEnquiryByIdQuery(enquiryId, {
    skip: !enquiryId,
    refetchOnFocus: true, // Refetch when screen comes into focus to get latest data (including pricing)
    refetchOnMountOrArgChange: true, // Refetch when enquiryId changes
  });
  
  // Use fetched enquiry data if available, otherwise use route params
  const currentEnquiry = fetchedEnquiryData || enquiry;
  
  // Get design data based on type
  const originalData = currentEnquiry?._originalData || currentEnquiry;
  const initialDesignData = designType === 'coral' 
    ? (originalData?.Coral || currentEnquiry?.Coral || [])
    : (originalData?.Cad || currentEnquiry?.Cad || []);
  
  // Filter versions for clients - show versions with ShowToClient: true OR versions uploaded by the client
  const designData = useMemo(() => {
    if (!isClient || !Array.isArray(initialDesignData)) {
      return initialDesignData;
    }
    
    const currentUserId = user?.id || user?._id || user?.userId;
    const clientId = user?.clientId || user?.ClientId;
    
    // Get StatusHistory to check who uploaded each version
    const statusHistory = originalData?.StatusHistory || currentEnquiry?.StatusHistory || [];
    
    return initialDesignData.filter(version => {
      // Show if marked as visible to client
      const isVisibleToClient = version?.ShowToClient === true || 
                                version?.showToClient === true || 
                                version?.IsVisibleToClient === true || 
                                version?.isVisibleToClient === true;
      
      // Check if this version was uploaded by the client
      // Match version by CreatedDate and check StatusHistory for "AddedBy"
      const versionCreatedDate = version?.CreatedDate || version?.createdDate;
      const versionNumber = version?.Version || version?.version;
      
      let isUploadedByClient = false;
      
      if (versionCreatedDate && statusHistory.length > 0) {
        // Find StatusHistory entry that matches this version upload
        const uploadEntry = statusHistory.find(entry => {
          const entryDate = entry?.Timestamp || entry?.timestamp;
          const entryDetails = entry?.Details || entry?.details || '';
          const matchesVersion = entryDetails.includes(`${designType === 'coral' ? 'Coral' : 'CAD'} Version ${versionNumber}`) ||
                                entryDetails.includes(`${designType === 'coral' ? 'Coral' : 'CAD'} version ${versionNumber}`);
          
          // Check if dates are close (within a few seconds) or if details match
          if (matchesVersion || (entryDate && versionCreatedDate)) {
            const entryAddedBy = entry?.AddedBy || entry?.addedBy;
            if (entryAddedBy) {
              return String(entryAddedBy) === String(currentUserId) ||
                     String(entryAddedBy) === String(clientId) ||
                     String(entryAddedBy) === String(user?.id) ||
                     String(entryAddedBy) === String(user?._id);
            }
          }
          return false;
        });
        
        isUploadedByClient = !!uploadEntry;
      }
      
      // Also check if version has AddedBy field directly
      const versionAddedBy = version?.AddedBy || version?.addedBy;
      if (versionAddedBy && !isUploadedByClient) {
        isUploadedByClient = String(versionAddedBy) === String(currentUserId) ||
                            String(versionAddedBy) === String(clientId) ||
                            String(versionAddedBy) === String(user?.id) ||
                            String(versionAddedBy) === String(user?._id);
      }
      
      return isVisibleToClient || isUploadedByClient;
    });
  }, [isClient, initialDesignData, user, currentEnquiry, originalData, designType]);

  // Get selected design version (use versionIndex if provided, otherwise use latest)
  const selectedDesign = versionIndex !== undefined && versionIndex >= 0 && versionIndex < designData.length
    ? designData[versionIndex]
    : (designData && designData.length > 0 ? designData[designData.length - 1] : null);
    
  // Get current version number for display
  const currentVersionNumber = versionIndex !== undefined && versionIndex >= 0
    ? versionIndex + 1
    : (designData && designData.length > 0 ? designData.length : null);

  // Get images and videos from selected design
  const designImages = selectedDesign?.Images || selectedDesign?.images || [];
  const designVideos = selectedDesign?.Videos || selectedDesign?.videos || [];
  
  // Merge images and videos, marking videos explicitly
  const images = useMemo(() => {
    const imageArray = Array.isArray(designImages) ? designImages : [];
    const videoArray = Array.isArray(designVideos) ? designVideos : [];
    
    // Mark videos with _isVideo flag for detection
    const videosWithFlag = videoArray.map(video => ({
      ...video,
      _isVideo: true,
    }));
    
    return [...imageArray, ...videosWithFlag];
  }, [designImages, designVideos]);
  
  // Utility function to detect if a file is a video
  const isVideoFile = useCallback((imageKey, imageUri, image) => {
    // First check for explicit video flag
    if (image && typeof image === 'object' && (image._isVideo === true || image.isVideo === true)) {
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
      const contentType = image.ContentType || image.contentType || image.Type || image.type || image.MimeType || image.mimeType;
      if (contentType && typeof contentType === 'string' && contentType.startsWith('video/')) {
        return true;
      }
      
      // Check if it's marked as video type
      if (image.FileType === 'video' || image.fileType === 'video' || image.MediaType === 'video' || image.mediaType === 'video') {
        return true;
      }
    }
    
    return false;
  }, []);
  
  // Helper function to check if version can be deleted (within 10 minutes)
  const canDeleteVersion = (version) => {
    if (!version) {
      
      return false;
    }
    
    // Only designers can delete versions
    if (!isDesigner) {
      
      return false;
    }
    
    // Get upload timestamp from version
    // Backend returns: CreatedDate (actual field name)
    const uploadTime = version?.CreatedDate ||  // ← Backend uses this field
                       version?.createdDate ||
                       version?.UploadDate || 
                       version?.CreatedAt || 
                       version?.UploadedAt || 
                       version?.Timestamp ||
                       version?.uploadDate ||
                       version?.createdAt ||
                       version?.uploadedAt ||
                       version?.timestamp ||
                       version?.UploadedDate ||
                       version?.uploadedDate;
    
    
    if (!uploadTime) {
      // If no timestamp, assume it's old (can't delete)
      
      return false;
    }
    
    // Calculate time difference
    // Use currentTime state to trigger re-renders when time passes
    const now = currentTime || new Date();
    let upload;
    try {
      upload = new Date(uploadTime);
      
      // Check if date is valid
      if (isNaN(upload.getTime())) {
        
        return false;
      }
    } catch (error) {
      
      return false;
    }
    
    const diffMinutes = (now - upload) / (1000 * 60); // Convert to minutes
    
    // Can delete if less than or equal to 10 minutes
    const canDelete = diffMinutes <= 10;
    
    return canDelete;
  };
  
  
  // Get code for Excel filename
  const designCode = designType === 'coral'
    ? (originalData?.CoralCode || currentEnquiry?.CoralCode || currentEnquiry?.coralCode || '')
    : (originalData?.CadCode || currentEnquiry?.CadCode || currentEnquiry?.cadCode || '');
  
  // Refetch enquiry when screen comes into focus to get updated data
  useFocusEffect(
    React.useCallback(() => {
      if (enquiryId) {
        refetchEnquiry();
      }
    }, [enquiryId, refetchEnquiry])
  );

  // Initialize comment with current image description or filename and reset image data URI
  useEffect(() => {
    if (images.length > 0 && currentImageIndex < images.length) {
      const currentImage = images[currentImageIndex];
      let imageName = '';
      
      if (typeof currentImage === 'object' && currentImage !== null) {
        // Use Description first (user-edited name), then fall back to Key (filename)
        imageName = currentImage.Description || 
                    currentImage.description || 
                    currentImage.Key || 
                    currentImage.key || 
                    currentImage.Name || 
                    currentImage.name || 
                    '';
      } else if (typeof currentImage === 'string') {
        // Extract filename from URL or key
        imageName = currentImage.split('/').pop() || currentImage;
      }
      
      setComment(imageName);
      // Don't reset imageDataUri immediately - let the cache check useEffect handle it
      // This prevents blinking by keeping the previous image visible while loading the new one
      setImageLoadingError(false);
    }
  }, [currentImageIndex, images]);

  // Navigate to previous image
  const handlePreviousImage = () => {
    if (currentImageIndex > 0) {
      setCurrentImageIndex(currentImageIndex - 1);
    }
  };

  // Navigate to next image
  const handleNextImage = () => {
    if (currentImageIndex < images.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1);
    }
  };

  // Get current image/video URL - try multiple endpoint patterns
  const getCurrentImageUrl = () => {
    
    if (images.length === 0 || currentImageIndex >= images.length) {
      return null;
    }
    
    const currentImage = images[currentImageIndex];
    
    // Use centralized API base URL

    if (typeof currentImage === 'object' && currentImage !== null) {
      const imageKey = currentImage.Key || currentImage.key || '';
      const imageId = currentImage.Id || currentImage.id || currentImage._id || '';
      const imageUrl = currentImage.Url || currentImage.url || currentImage.URI || currentImage.uri || '';
      
      // If full URL is provided, use it directly
      if (imageUrl && (imageUrl.startsWith('http') || imageUrl.startsWith('https'))) {
        return imageUrl;
      }
      
      // Try Key-based endpoints first (more reliable for filenames)
      if (imageKey) {
        const encodedKey = encodeURIComponent(imageKey);
        
        // Try multiple endpoint patterns
        const possibleUrls = [
          `${API_BASE_URL}/api/enquiries/files/${encodedKey}`,
          `${API_BASE_URL}/api/files/${encodedKey}`,
          `${API_BASE_URL}/api/images/${encodedKey}`,
          `${API_BASE_URL}/api/enquiries/${enquiry?.id || enquiry?._id}/files/${encodedKey}`,
        ];
        
        // Return first URL (most likely)
        return possibleUrls[0];
      }
      
      // Try ID-based endpoints
      if (imageId) {
        const possibleUrls = [
          `${API_BASE_URL}/api/files/${imageId}`,
          `${API_BASE_URL}/api/images/${imageId}`,
          `${API_BASE_URL}/api/enquiries/files/${imageId}`,
        ];
        
        return possibleUrls[0];
      }
    } else if (typeof currentImage === 'string') {
      
      if (currentImage.startsWith('http') || currentImage.startsWith('https')) {
        return currentImage;
      }
      
      // Try enquiries/files endpoint for string keys
      const encodedKey = encodeURIComponent(currentImage);
      return `${API_BASE_URL}/api/enquiries/files/${encodedKey}`;
    }
    
    return null;
  };
  
  // Component to render video with fetch authentication
  const VideoWithFallback = React.memo(({ image, imageKey, imageId, imageUri, onPress }) => {
    const [videoUrl, setVideoUrl] = useState(null);
    const [videoLoading, setVideoLoading] = useState(false);
    const [videoError, setVideoError] = useState(false);
    const videoRef = useRef(null);
    const mountedRef = useRef(true);
    const fetchingRef = useRef(false);
    const lastFetchedKeyRef = useRef(null);
    const blobUrlRef = useRef(null); // Track blob URLs for cleanup
    
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        // Cleanup blob URL to prevent memory leaks
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
    }, []);
    
    // Fetch video URL with authentication
    const fetchVideoUrl = useCallback(async () => {
      if (!mountedRef.current || fetchingRef.current) return;
      
      // Create a unique key for this video to prevent re-fetching the same video
      const uniqueKey = `${imageKey || ''}_${imageId || ''}_${imageUri || ''}`;
      
      // If we already have the URL for this key, don't re-fetch
      if (videoUrl && lastFetchedKeyRef.current === uniqueKey) {
        return;
      }
      
      // If we're already fetching this key, don't start another fetch
      if (lastFetchedKeyRef.current === uniqueKey && fetchingRef.current) {
        return;
      }
      
      fetchingRef.current = true;
      lastFetchedKeyRef.current = uniqueKey;
      
      let videoUrlToUse = null;
      
      // If we have a direct URI, use it
      if (imageUri && (imageUri.startsWith('http') || imageUri.startsWith('https'))) {
        videoUrlToUse = imageUri;
        if (mountedRef.current) {
          setVideoUrl(videoUrlToUse);
          setVideoLoading(false);
          setVideoError(false);
          fetchingRef.current = false;
        }
        return;
      } else if (imageKey) {
        // Fetch presigned URL from API
        try {
          setVideoLoading(true);
          setVideoError(false);
          
          const token = await AsyncStorage.getItem('token');
          if (!token) {
            setVideoError(true);
            setVideoLoading(false);
            fetchingRef.current = false;
            return;
          }
          
          const encodedKey = encodeURIComponent(imageKey);
          const response = await fetch(`${API_BASE_URL}/api/enquiries/files/${encodedKey}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          
          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';
            
            // Check if response is JSON (presigned URL)
            if (contentType.includes('application/json')) {
              const jsonData = await response.json();
              videoUrlToUse = jsonData.url || jsonData.videoUrl || jsonData.src || jsonData.location;
            } else {
              // Direct video response - create blob URL
              const blob = await response.blob();
              videoUrlToUse = URL.createObjectURL(blob);
            }
          } else {
            setVideoError(true);
            setVideoLoading(false);
            fetchingRef.current = false;
            return;
          }
        } catch (error) {
          setVideoError(true);
          setVideoLoading(false);
          fetchingRef.current = false;
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
            fetchingRef.current = false;
            return;
          }
          
          const response = await fetch(`${API_BASE_URL}/api/enquiries/files/${imageId}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          
          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const jsonData = await response.json();
              videoUrlToUse = jsonData.url || jsonData.videoUrl || jsonData.src || jsonData.location;
            }
          } else {
            setVideoError(true);
            setVideoLoading(false);
            fetchingRef.current = false;
            return;
          }
        } catch (error) {
          setVideoError(true);
          setVideoLoading(false);
          fetchingRef.current = false;
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
      fetchingRef.current = false;
    }, [imageKey, imageId, imageUri]); // Removed videoUrl to prevent infinite loops
    
    useEffect(() => {
      // Reset state when props change
      const uniqueKey = `${imageKey || ''}_${imageId || ''}_${imageUri || ''}`;
      if (lastFetchedKeyRef.current !== uniqueKey) {
        // Cleanup previous blob URL if exists
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
        setVideoUrl(null);
        setVideoError(false);
        fetchingRef.current = false;
      }
      fetchVideoUrl();
      
      // Cleanup function
      return () => {
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
    }, [imageKey, imageId, imageUri, fetchVideoUrl]);
    
    if (videoError) {
      return (
        <View style={styles.videoContainer}>
          <View style={styles.videoPlaceholder}>
            <Icon name="videocam-off" size={24} color={colors.textSecondary} />
            <CustomText variant="caption" style={styles.placeholderText}>
              Video unavailable
            </CustomText>
          </View>
        </View>
      );
    }
    
    if (videoLoading || !videoUrl) {
      return (
        <View style={styles.videoContainer}>
          <View style={styles.videoPlaceholder}>
            <AnimatedLogoLoader size={60} />
            <CustomText variant="caption" style={styles.placeholderText}>
              Loading video...
            </CustomText>
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
          style={styles.video}
          resizeMode="cover"
          paused={true}
          controls={false}
          muted={true}
          repeat={false}
          onLoad={() => {
            // Ensure first frame is displayed
            if (videoRef.current) {
              videoRef.current.seek(0);
            }
          }}
          onError={(error) => {
            if (__DEV__) {
              console.error('Video playback error:', error);
            }
            setVideoError(true);
          }}
        />
        <View style={styles.videoPlayOverlay}>
          <Icon name="play-arrow" size={50} color={colors.textWhite} />
        </View>
        {/* Share button */}
        <TouchableOpacity
          style={styles.shareImageButton}
          onPress={handleShare}
          disabled={isSharing}
          activeOpacity={0.8}
        >
          <Icon name="share" size={24} color={colors.textWhite} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  });

  // Component to render video in full-screen modal
  const FullScreenVideo = React.memo(({ image, imageKey, imageId, imageUri, onClose }) => {
    const [videoUrl, setVideoUrl] = useState(null);
    const [videoLoading, setVideoLoading] = useState(false);
    const [videoError, setVideoError] = useState(false);
    const videoRef = useRef(null);
    const mountedRef = useRef(true);
    const blobUrlRef = useRef(null); // Track blob URLs for cleanup
    
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        // Cleanup blob URL to prevent memory leaks
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
    }, []);
    
    // Fetch video URL with authentication
    const fetchVideoUrl = useCallback(async () => {
      if (!mountedRef.current) return;
      
      let videoUrlToUse = null;
      
      // If we have a direct URI, use it
      if (imageUri && (imageUri.startsWith('http') || imageUri.startsWith('https'))) {
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
          const response = await fetch(`${API_BASE_URL}/api/enquiries/files/${encodedKey}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          
          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';
            
            // Check if response is JSON (presigned URL)
            if (contentType.includes('application/json')) {
              const jsonData = await response.json();
              videoUrlToUse = jsonData.url || jsonData.videoUrl || jsonData.src || jsonData.location;
            } else {
              // Direct video response - create blob URL
              // Cleanup previous blob URL if exists
              if (blobUrlRef.current) {
                URL.revokeObjectURL(blobUrlRef.current);
              }
              const blob = await response.blob();
              videoUrlToUse = URL.createObjectURL(blob);
              blobUrlRef.current = videoUrlToUse; // Track for cleanup
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
          
          const response = await fetch(`${API_BASE_URL}/api/enquiries/files/${imageId}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          
          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const jsonData = await response.json();
              videoUrlToUse = jsonData.url || jsonData.videoUrl || jsonData.src || jsonData.location;
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
        <View style={styles.fullScreenVideoContainer}>
          <View style={styles.fullScreenVideoPlaceholder}>
            <Icon name="videocam-off" size={60} color={colors.textSecondary} />
            <CustomText variant="body" style={styles.placeholderText}>
              Video unavailable
            </CustomText>
            <TouchableOpacity
              style={styles.fullScreenVideoRetryButton}
              onPress={fetchVideoUrl}
              activeOpacity={0.8}
            >
              <Text style={styles.fullScreenVideoRetryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    
    if (videoLoading || !videoUrl) {
      return (
        <View style={styles.fullScreenVideoContainer}>
          <View style={styles.fullScreenVideoPlaceholder}>
            <AnimatedLogoLoader size={60} />
            <CustomText variant="body" style={styles.placeholderText}>
              Loading video...
            </CustomText>
          </View>
        </View>
      );
    }
    
    return (
      <View style={styles.fullScreenVideoContainer}>
        <Video
          ref={videoRef}
          source={{ uri: videoUrl }}
          style={styles.fullScreenVideo}
          resizeMode="contain"
          controls={true}
          paused={false}
          onError={(error) => {
            if (__DEV__) {
              console.error('Full-screen video playback error:', error);
            }
            setVideoError(true);
          }}
        />
      </View>
    );
  });

  // Get Excel download URL - use backend endpoint directly (more reliable)
  const getExcelDownloadUrl = () => {
    if (!designCode) return null;
    
    const excelFilename = designCode.includes('.xlsx') 
      ? designCode 
      : `${designCode}.xlsx`;
    
    return `${API_BASE_URL}/api/enquiries/files/${excelFilename}?download=true`;
  };

  const handleDownloadImage = async () => {
    if (isDownloadingImage) {
      return; // Prevent multiple simultaneous downloads
    }

    if (images.length === 0 || currentImageIndex >= images.length) {
      showAlert('Error', 'No image available to download', 'error');
      return;
    }

    const currentImage = images[currentImageIndex];
    if (!currentImage) {
      showAlert('Error', 'Current image not found', 'error');
      return;
    }

    // Extract image key
    let imageKey = '';
    if (typeof currentImage === 'object' && currentImage !== null) {
      imageKey = currentImage.Key || currentImage.key || '';
    } else if (typeof currentImage === 'string') {
      // Extract filename from URL or key
      imageKey = currentImage.split('/').pop() || currentImage;
    }

    if (!imageKey) {
      showAlert('Error', 'Image key not available', 'error');
      return;
    }

    setIsDownloadingImage(true);

    try {
      // Get auth token
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        throw new Error('Authentication token not found');
      }

      // Build download URL with ?download=true parameter
      const encodedKey = encodeURIComponent(imageKey);
      const downloadUrl = `${API_BASE_URL}/api/enquiries/files/${encodedKey}?download=true`;

      

      // Get image filename (use Description if available, otherwise use Key)
      const imageName = currentImage.Description || 
                       currentImage.description || 
                       imageKey;
      
      // Determine file extension from image key or default to jpeg
      let fileExtension = 'jpeg';
      if (imageKey.includes('.')) {
        const ext = imageKey.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) {
          fileExtension = ext || 'jpeg';
        }
      }
      
      const imageFilename = imageName.includes('.') 
        ? imageName 
        : `${imageName}.${fileExtension}`;
      
      // Determine download path
      const downloadPath = `${RNFS.DownloadDirectoryPath}/${imageFilename}`;

      

      // Fetch the image from backend
      const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get download URL: HTTP ${response.status}`);
      }

      // Check if response is JSON (signed URL) or image file stream
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        // Backend returned signed URL - need to download from S3
        const jsonData = await response.json();
        if (!jsonData.url) {
          throw new Error('Backend did not return a valid download URL');
        }

        
        
        // Download from S3 using fetch
        const s3Response = await fetch(jsonData.url, {
          method: 'GET',
          // No headers for S3 signed URLs
        });

        if (!s3Response.ok) {
          throw new Error(`S3 download failed: HTTP ${s3Response.status} ${s3Response.statusText}`);
        }

        // Get the file as array buffer (binary data)
        const arrayBuffer = await s3Response.arrayBuffer();
        
        if (arrayBuffer.byteLength === 0) {
          throw new Error('Downloaded image is empty');
        }

        // Convert to base64 for React Native file system
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

        // Write binary file to device
        await RNFS.writeFile(downloadPath, base64, 'base64');

        // Verify the file was written correctly
        const fileExists = await RNFS.exists(downloadPath);
        if (!fileExists) {
          throw new Error('Failed to save downloaded image');
        }

        const fileStats = await RNFS.stat(downloadPath);
        if (fileStats.size === 0) {
          throw new Error('Downloaded image file is empty');
        }

        

        // Share/open the file
        try {
          // Determine MIME type based on extension
          let mimeType = 'image/jpeg';
          if (fileExtension === 'png') mimeType = 'image/png';
          else if (fileExtension === 'gif') mimeType = 'image/gif';
          else if (fileExtension === 'webp') mimeType = 'image/webp';

          await Share.open({
            url: `file://${downloadPath}`,
            type: mimeType,
            filename: imageFilename,
            title: 'Open Image',
            message: `Downloaded: ${imageFilename}`,
          });
        } catch (shareError) {
          if (shareError.message !== 'User did not share') {
            console.warn('Share dialog error (non-critical):', shareError);
          }
          showAlert(
            'Success',
            `Image downloaded successfully!\n\nSaved to: Downloads/${imageFilename}`,
            'success',
            [{ text: 'OK' }]
          );
        }
        return; // Success
      } else {
        // Backend is streaming the image directly - save it
        const arrayBuffer = await response.arrayBuffer();
        
        if (arrayBuffer.byteLength === 0) {
          throw new Error('Downloaded image is empty');
        }

        // Convert array buffer to base64 for React Native
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

        // Write binary file to device
        await RNFS.writeFile(downloadPath, base64, 'base64');

        // Verify the file was written correctly
        const fileExists = await RNFS.exists(downloadPath);
        if (!fileExists) {
          throw new Error('Failed to save downloaded image');
        }

        const fileStats = await RNFS.stat(downloadPath);
        if (fileStats.size === 0) {
          throw new Error('Downloaded image file is empty');
        }

        

        // Share/open the file
        try {
          // Determine MIME type based on extension
          let mimeType = 'image/jpeg';
          if (fileExtension === 'png') mimeType = 'image/png';
          else if (fileExtension === 'gif') mimeType = 'image/gif';
          else if (fileExtension === 'webp') mimeType = 'image/webp';

          await Share.open({
            url: `file://${downloadPath}`,
            type: mimeType,
            filename: imageFilename,
            title: 'Open Image',
            message: `Downloaded: ${imageFilename}`,
          });
        } catch (shareError) {
          if (shareError.message !== 'User did not share') {
            console.warn('Share dialog error (non-critical):', shareError);
          }
          showAlert(
            'Success',
            `Image downloaded successfully!\n\nSaved to: Downloads/${imageFilename}`,
            'success',
            [{ text: 'OK' }]
          );
        }
      }
    } catch (error) {
      showAlert(
        'Download Failed',
        error?.message || 'Failed to download image. Please try again.',
        'error'
      );
    } finally {
      setIsDownloadingImage(false);
    }
  };

  const handleDeleteImage = () => {
    showAlert(
      'Delete Image',
      'Are you sure you want to delete this image?',
      'warning',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // TODO: Implement delete functionality
            showAlert('Info', 'Delete functionality will be implemented', 'info');
          },
        },
      ]
    );
  };

  const handleShare = async () => {
    if (isSharing) {
      return; // Prevent multiple simultaneous shares
    }

    if (images.length === 0) {
      showAlert('Error', 'No images available to share', 'error');
      return;
    }

    setIsSharing(true);

    try {
      // Get auth token
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        throw new Error('Authentication token not found');
      }

      // Get client pricing message from selected design
      const pricing = selectedDesign?.Pricing || selectedDesign?.pricing || {};
      const clientPricingMessage = pricing?.ClientPricingMessage || selectedDesign?.ClientPricingMessage || '';
      
      // Get design code and version info for the message
      const versionText = currentVersionNumber 
        ? `Version ${currentVersionNumber}` 
        : 'Latest Version';
      const designTypeText = designType === 'coral' ? 'Coral' : 'CAD';
      
      // Prepare share message
      let shareMessage = `*${designTypeText} Design - ${versionText}*\n`;
      shareMessage += `Design Code: ${designCode || 'N/A'}\n\n`;
      
      if (clientPricingMessage) {
        shareMessage += `*Pricing Details:*\n${clientPricingMessage}\n\n`;
      }
      
      const videoCount = images.filter(img => {
        const imgKey = typeof img === 'object' && img !== null ? (img.Key || img.key || '') : (typeof img === 'string' ? img.split('/').pop() || img : '');
        const imgUri = typeof img === 'object' && img !== null ? (img.Url || img.url || img.URI || img.uri || '') : (typeof img === 'string' && (img.startsWith('http') || img.startsWith('https')) ? img : '');
        return isVideoFile(imgKey, imgUri, img);
      }).length;
      const imageCount = images.length - videoCount;
      shareMessage += `Total: ${images.length} (${imageCount} image${imageCount !== 1 ? 's' : ''}, ${videoCount} video${videoCount !== 1 ? 's' : ''})`;

      // Download all images to temporary files for sharing
      const imageFiles = [];
      
      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        let imageKey = '';
        
        if (typeof image === 'object' && image !== null) {
          imageKey = image.Key || image.key || '';
        } else if (typeof image === 'string') {
          imageKey = image.split('/').pop() || image;
        }

        if (!imageKey) {
          continue;
        }

        try {
          // Build download URL
          const encodedKey = encodeURIComponent(imageKey);
          const downloadUrl = `${API_BASE_URL}/api/enquiries/files/${encodedKey}?download=true`;

          // Fetch the image
          const response = await fetch(downloadUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (!response.ok) {
            continue;
          }

          // Check if response is JSON (signed URL) or image file stream
          const contentType = response.headers.get('content-type') || '';
          
          let actualImageUrl = downloadUrl;
          
          if (contentType.includes('application/json')) {
            // Backend returned signed URL - download from S3
            const jsonData = await response.json();
            if (jsonData.url) {
              actualImageUrl = jsonData.url;
            }
          }

          // Download image to temporary file
          const s3Response = await fetch(actualImageUrl, {
            method: 'GET',
          });

          if (!s3Response.ok) {
            continue;
          }

          // Get file extension
          const fileExtension = imageKey.includes('.') 
            ? imageKey.split('.').pop()?.toLowerCase() || 'jpg'
            : 'jpg';
          
          // Create temporary file path
          const tempFilePath = `${RNFS.CachesDirectoryPath}/share_image_${i}_${Date.now()}.${fileExtension}`;
          
          // Get image as array buffer
          const arrayBuffer = await s3Response.arrayBuffer();
          
          // Convert to base64
          const bytes = new Uint8Array(arrayBuffer);
          const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
          let base64 = '';
          let j = 0;
          
          while (j < bytes.length) {
            const a = bytes[j++];
            const b = j < bytes.length ? bytes[j++] : 0;
            const c = j < bytes.length ? bytes[j++] : 0;
            
            const bitmap = (a << 16) | (b << 8) | c;
            
            base64 += base64Chars.charAt((bitmap >> 18) & 63);
            base64 += base64Chars.charAt((bitmap >> 12) & 63);
            base64 += j - 2 < bytes.length ? base64Chars.charAt((bitmap >> 6) & 63) : '=';
            base64 += j - 1 < bytes.length ? base64Chars.charAt(bitmap & 63) : '=';
          }

          // Write to temporary file
          await RNFS.writeFile(tempFilePath, base64, 'base64');
          
          // Verify file exists
          const fileExists = await RNFS.exists(tempFilePath);
          if (fileExists) {
            imageFiles.push(`file://${tempFilePath}`);
          }
        } catch (error) {
        }
      }

      if (imageFiles.length === 0) {
        throw new Error('No images could be prepared for sharing');
      }

      // Share via WhatsApp
      // Share first image with message (WhatsApp typically supports one image at a time)
      try {
        await Share.open({
          message: shareMessage,
          url: imageFiles[0],
          type: 'image/jpeg',
          social: Share.Social.WHATSAPP,
        });
      } catch (shareError) {
        // If WhatsApp sharing fails, try general share
        if (shareError.message !== 'User did not share') {
          await Share.open({
            message: `${shareMessage}\n\nImage: ${imageFiles[0]}`,
            url: imageFiles[0],
            type: 'image/jpeg',
          });
        }
      }
      
      // Clean up temporary files after a delay
      setTimeout(async () => {
        for (const filePath of imageFiles) {
          try {
            const localPath = filePath.replace('file://', '');
            if (await RNFS.exists(localPath)) {
              await RNFS.unlink(localPath);
            }
          } catch (error) {
          }
        }
      }, 5000);
      
      // Inform user if there are more images
      if (imageFiles.length > 1) {
        setTimeout(() => {
          showAlert(
            'Share Complete',
            `Shared first image with pricing details. ${imageFiles.length - 1} more image(s) available. You can share them individually if needed.`,
            'success',
            [{ text: 'OK' }]
          );
        }, 1000);
      }
    } catch (error) {
      showAlert(
        'Share Failed',
        error?.message || 'Failed to share images. Please try again.',
        'error'
      );
    } finally {
      setIsSharing(false);
    }
  };

  const handleDownloadExcel = async () => {
    if (!designCode) {
      showAlert('Error', 'Excel file not available - design code missing', 'error');
      return;
    }

    if (isDownloadingExcel) {
      return; // Prevent multiple simultaneous downloads
    }

    setIsDownloadingExcel(true);

    try {
      // Get download URL from backend endpoint (more reliable than S3 direct)
      const downloadUrl = getExcelDownloadUrl();
      if (!downloadUrl) {
        throw new Error('Failed to get Excel file URL');
      }

      // Get auth token
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        throw new Error('Authentication token not found');
      }

      // Create filename
      const excelFilename = designCode.includes('.xlsx') 
        ? designCode 
        : `${designCode}.xlsx`;
      
      // Determine download path
      const downloadPath = `${RNFS.DownloadDirectoryPath}/${excelFilename}`;

      

      // First, check what the backend returns (JSON with URL or file stream)
      const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get download URL: HTTP ${response.status}`);
      }

      // Check if response is JSON (signed URL) or file stream
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        // Backend returned signed URL - need to download from S3
        const jsonData = await response.json();
        if (!jsonData.url) {
          throw new Error('Backend did not return a valid download URL');
        }

        
        
        // Download from S3 using fetch (more reliable than RNFS.downloadFile for S3)
        // RNFS.downloadFile sometimes saves the URL as text instead of downloading the file
        const s3Response = await fetch(jsonData.url, {
          method: 'GET',
          // No headers for S3 signed URLs
        });

        if (!s3Response.ok) {
          throw new Error(`S3 download failed: HTTP ${s3Response.status} ${s3Response.statusText}`);
        }

        // Get the file as array buffer (binary data)
        const arrayBuffer = await s3Response.arrayBuffer();
        
        if (arrayBuffer.byteLength === 0) {
          throw new Error('Downloaded file is empty');
        }

        // Convert to base64 for React Native file system
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

        // Write binary file to device
        await RNFS.writeFile(downloadPath, base64, 'base64');

        // Verify the file was written correctly
        const fileExists = await RNFS.exists(downloadPath);
        if (!fileExists) {
          throw new Error('Failed to save downloaded file');
        }

        const fileStats = await RNFS.stat(downloadPath);
        if (fileStats.size < 1000) {
          // File is suspiciously small - check if it's text
          const fileContent = await RNFS.readFile(downloadPath, 'utf8');
          if (fileContent.includes('http') || fileContent.includes('amazonaws') || fileContent.includes('X-Amz-')) {
            throw new Error('Downloaded file appears to contain a URL instead of Excel data. The file may not exist on S3 or the URL may be invalid.');
          }
        }

        

        // Share/open the file
        try {
          await Share.open({
            url: `file://${downloadPath}`,
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            filename: excelFilename,
            title: 'Open Excel File',
            message: `Downloaded: ${excelFilename}`,
          });
        } catch (shareError) {
          if (shareError.message !== 'User did not share') {
            console.warn('Share dialog error (non-critical):', shareError);
          }
          showAlert(
            'Success',
            `Excel file downloaded successfully!\n\nSaved to: Downloads/${excelFilename}`,
            'success',
            [{ text: 'OK' }]
          );
        }
        return; // Success
      } else {
        // Backend is streaming the file directly - save it
        const arrayBuffer = await response.arrayBuffer();
      
        // Convert array buffer to base64 for React Native
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

        // Write file to device
        await RNFS.writeFile(downloadPath, base64, 'base64');

        

        // Share/open the file
        try {
          await Share.open({
            url: `file://${downloadPath}`,
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            filename: excelFilename,
            title: 'Open Excel File',
            message: `Downloaded: ${excelFilename}`,
          });
        } catch (shareError) {
          if (shareError.message !== 'User did not share') {
            console.warn('Share dialog error (non-critical):', shareError);
          }
          showAlert(
            'Success',
            `Excel file downloaded successfully!\n\nSaved to: Downloads/${excelFilename}`,
            'success',
            [{ text: 'OK' }]
          );
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Error details:', error);
      }
      
      // Provide more helpful error message
      let errorMessage = 'Failed to download Excel file.';
      if (error.statusCode === 400) {
        errorMessage = 'Invalid download URL. The file link may have expired. Please try again.';
      } else if (error.statusCode === 403) {
        errorMessage = 'Access denied. You may not have permission to download this file.';
      } else if (error.statusCode === 404) {
        errorMessage = 'File not found. The Excel file may have been deleted.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      showAlert(
        'Download Failed',
        errorMessage,
        'error'
      );
    } finally {
      setIsDownloadingExcel(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedDesign) {
      showAlert('Error', 'No design version found to approve', 'error');
      return;
    }

    const version = selectedDesign?.Version || selectedDesign?.version || `Version ${currentVersionNumber}`;
    const enquiryId = enquiry?.id || enquiry?._id;
    
    if (!enquiryId) {
      showAlert('Error', 'Enquiry ID not found', 'error');
      return;
    }

    showAlert(
      'Approve Design Version',
      `Are you sure you want to approve ${designType.toUpperCase()} ${version}?`,
      'warning',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            try {
              

              await approveDesignVersion({
                enquiryId,
                designType,
                version,
                intent: 'forApproval' ,
              }).unwrap();

              showAlert('Success', `${designType.toUpperCase()} ${version} approved successfully`, 'success');
              
              // Refetch enquiry data to get updated approval status
              if (enquiryId) {
                refetchEnquiry();
              }
            } catch (error) {
              showAlert(
                'Error',
                error?.data?.error || error?.message || 'Failed to approve design version. Please try again.',
                'error'
              );
            }
          },
        },
      ]
    );
  };

  const handleReject = () => {
    if (!selectedDesign) {
      showAlert('Error', 'No design version found to reject', 'error');
      return;
    }
    setShowRejectModal(true);
  };

  const confirmReject = async () => {
    if (!rejectionReason.trim()) {
      showAlert('Error', 'Please provide a reason for rejection', 'error');
      return;
    }

    if (!selectedDesign) {
      showAlert('Error', 'No design version found to reject', 'error');
      return;
    }

    const version = selectedDesign?.Version || selectedDesign?.version || `Version ${currentVersionNumber}`;
    const enquiryId = enquiry?.id || enquiry?._id;
    
    if (!enquiryId) {
      showAlert('Error', 'Enquiry ID not found', 'error');
      return;
    }

    try {
      
      
      await rejectDesignVersion({
        enquiryId,
        designType,
        version,
        reason: rejectionReason.trim(),
      }).unwrap();

      showAlert('Success', `${designType.toUpperCase()} ${version} rejected successfully`, 'success');
      setShowRejectModal(false);
      setRejectionReason('');
      
      // Refetch enquiry data to get updated rejection status
      if (enquiryId) {
        refetchEnquiry();
      }
    } catch (error) {
      showAlert(
        'Error',
        error?.data?.error || error?.message || 'Failed to reject design version. Please try again.',
        'error'
      );
    }
  };

  const handleDeleteVersion = async () => {
    if (!selectedDesign) {
      showAlert('Error', 'No design version selected', 'error');
      return;
    }
    
    const version = selectedDesign?.Version || selectedDesign?.version || `Version ${currentVersionNumber}`;
    const enquiryId = enquiry?.id || enquiry?._id;
    
    if (!enquiryId) {
      showAlert('Error', 'Enquiry ID not found', 'error');
      return;
    }
    
    // Check if can delete (within 10 minutes)
    if (!canDeleteVersion(selectedDesign)) {
      showAlert(
        'Cannot Delete',
        'This version can only be deleted within 10 minutes of upload. The time limit has expired.',
        'warning',
        [{ text: 'OK' }]
      );
      return;
    }
    
    showAlert(
      'Delete Version',
      `Are you sure you want to delete ${designType.toUpperCase()} ${version}? This action cannot be undone.`,
      'warning',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              
              
              await deleteDesignVersion({
                enquiryId,
                designType,
                version,
              }).unwrap();
              
              showAlert('Success', 'Version deleted successfully', 'success');
              
              // Refetch enquiry data
              if (enquiryId) {
                refetchEnquiry();
              }
              
              // Navigate back if no versions left
              const remainingVersions = designData.filter(v => v !== selectedDesign);
              if (remainingVersions.length === 0) {
                navigation.goBack();
              }
            } catch (error) {
              showAlert(
                'Error',
                error?.data?.error || error?.message || 'Failed to delete version. Please try again.',
                'error'
              );
            }
          },
        },
      ]
    );
  };

  const handleShowToClient = async (newValue) => {
    if (!selectedDesign) {
      showAlert('Error', 'No design version found', 'error');
      return;
    }

    const version = selectedDesign?.Version || selectedDesign?.version || `Version ${currentVersionNumber}`;
    const enquiryId = enquiry?.id || enquiry?._id;
    
    if (!enquiryId) {
      showAlert('Error', 'Enquiry ID not found', 'error');
      return;
    }

    // Get current ShowToClient status
    const currentShowToClient = selectedDesign?.ShowToClient || selectedDesign?.showToClient || false;
    const newShowToClient = newValue !== undefined ? newValue : !currentShowToClient;

    try {
      

      await updateShowToClient({
        enquiryId,
        designType,
        version,
        showToClient: newShowToClient,
      }).unwrap();

      // Refetch enquiry data to get updated ShowToClient status
      if (enquiryId) {
        refetchEnquiry();
      }
    } catch (error) {
      showAlert(
        'Error',
        error?.data?.error || error?.message || 'Failed to update ShowToClient. Please try again.',
        'error'
      );
    }
  };

  const handleSaveComment = async () => {
    if (!comment || comment.trim() === '') {
      showAlert('Error', 'Please enter a description', 'error');
      return;
    }

    if (!enquiry?.id && !enquiry?._id) {
      showAlert('Error', 'Enquiry ID is missing', 'error');
      return;
    }

    // Get current image to extract asset ID
    if (images.length === 0 || currentImageIndex >= images.length) {
      showAlert('Error', 'No image selected', 'error');
      return;
    }

    const currentImage = images[currentImageIndex];
    const assetId = currentImage?.Id || currentImage?.id || currentImage?._id || currentImage?.Key || currentImage?.key;
    
    if (!assetId) {
      showAlert('Error', 'Image ID not found', 'error');
      return;
    }

    // Get version from selected design
    const selectedDesignIndex = versionIndex !== undefined && versionIndex >= 0 && versionIndex < designData.length
      ? versionIndex
      : (designData && designData.length > 0 ? designData.length - 1 : 0);
    const version = selectedDesign?.version || selectedDesign?.Version || `Version ${selectedDesignIndex + 1}`;

    try {
      const enquiryId = enquiry.id || enquiry._id;
      
      

      await updateAssetDescription({
        enquiryId,
        designType, // 'coral' or 'cad'
        version,
        assetId,
        description: comment.trim(),
      }).unwrap();

      // Update the local image object with the new description
      // This ensures the UI reflects the change immediately
      if (images[currentImageIndex]) {
        const updatedImages = [...images];
        updatedImages[currentImageIndex] = {
          ...updatedImages[currentImageIndex],
          Description: comment.trim(),
        };
        // Note: We can't directly update images state as it comes from props
        // But we can update the comment state to reflect the saved value
        // The invalidatesTags will trigger a refetch when navigating back
      }

      showAlert('Success', 'Image description updated successfully', 'success');
    } catch (error) {
      const errorMessage = error?.data?.error || error?.data?.message || error?.message || 'Failed to update description. Please try again.';
      showAlert('Error', errorMessage, 'error');
    }
  };

  if (images.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Icon name="image" size={60} color={colors.textSecondary} />
          <CustomText variant="body" style={styles.emptyText}>
            No {designType === 'coral' ? 'Coral' : 'CAD'} images/videos available
          </CustomText>
          <Button
            title="Go Back"
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          />
        </View>
      </View>
    );
  }

  const currentImageUrl = getCurrentImageUrl();
  const showNavigation = images.length > 1;
  
  // Check if current media is a video
  const currentMedia = images[currentImageIndex];
  const currentImageKey = typeof currentMedia === 'object' && currentMedia !== null
    ? (currentMedia.Key || currentMedia.key || '')
    : (typeof currentMedia === 'string' ? currentMedia.split('/').pop() || currentMedia : '');
  const currentImageUri = typeof currentMedia === 'object' && currentMedia !== null
    ? (currentMedia.Url || currentMedia.url || currentMedia.URI || currentMedia.uri || '')
    : (typeof currentMedia === 'string' && (currentMedia.startsWith('http') || currentMedia.startsWith('https')) ? currentMedia : '');
  const isCurrentVideo = isVideoFile(currentImageKey, currentImageUri, currentMedia);

  // Single unified effect: Check cache and fetch when image changes
  // This replaces the previous 3 effects to prevent duplicate calls
  useEffect(() => {
    if (!currentImageUrl) {
      setImageDataUri(null);
      setImageLoadingError(false);
      return;
    }

    const loadImage = async () => {
      // 1. Check memory cache first (fastest, synchronous)
      if (imageCacheRef.current.has(currentImageUrl)) {
        const cachedDataUri = imageCacheRef.current.get(currentImageUrl);
        setImageDataUri(cachedDataUri);
        setImageLoadingError(false);
        return;
      }

      // 2. Check AsyncStorage cache (async)
      const cachedDataUri = await getCachedImage(currentImageUrl);
      if (cachedDataUri) {
        // Store in memory cache for faster access next time
        imageCacheRef.current.set(currentImageUrl, cachedDataUri);
        setImageDataUri(cachedDataUri);
        setImageLoadingError(false);
        return;
      }

      // 3. Cache miss - fetch image
      // On Android or if fetch directly is enabled, use fetch
      if (useFetchDirectly) {
        fetchImageWithAuth(currentImageUrl);
      }
      // On iOS, OptimizedImage component will handle loading with headers
      // Don't reset imageDataUri here - keep previous image visible until new one loads
    };

    loadImage();
  }, [currentImageIndex, currentImageUrl, useFetchDirectly, fetchImageWithAuth]);

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Image/Video Slider Section */}
        <View style={styles.imageSection}>
          <View style={styles.imageContainer}>
            {currentImageUrl ? (
              <>
                {/* Render video if current media is a video */}
                {isCurrentVideo ? (
                  <VideoWithFallback
                    key={`video-${currentImageKey || currentImageIndex}`}
                    image={currentMedia}
                    imageKey={currentImageKey}
                    imageId={typeof currentMedia === 'object' && currentMedia !== null
                      ? (currentMedia.Id || currentMedia.id || currentMedia._id || '')
                      : ''}
                    imageUri={currentImageUri}
                    onPress={(uri) => setIsFullScreen(true)}
                  />
                ) : (
              <>
                {/* Single conditional render - prevents double rendering */}
                {imageDataUri ? (
                  // Render with cached data URI (fastest, works on all platforms)
                  <View style={styles.imageWrapper}>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setIsFullScreen(true)}
                      style={styles.imageTouchable}
                    >
                      <OptimizedImage
                        source={{ uri: imageDataUri }}
                        style={styles.image}
                        resizeMode="contain"
                        showLoader={false}
                        cacheEnabled={false}
                        onLoad={() => {
                          setImageLoadingError(false);
                        }}
                        onError={(error) => {
                          const errorObj = error.nativeEvent?.error || {};
                          if (__DEV__) {
                            console.error('❌ Data URI image load ERROR:', errorObj);
                          }
                          setImageLoadingError(true);
                        }}
                      />
                    </TouchableOpacity>
                    {/* Share button - enabled for all users including clients */}
                    <TouchableOpacity
                      style={styles.shareImageButton}
                      onPress={handleShare}
                      disabled={isSharing}
                      activeOpacity={0.8}
                    >
                      <Icon name="share" size={24} color={colors.textWhite} />
                    </TouchableOpacity>
                  </View>
                ) : !useFetchDirectly ? (
                  // iOS: Try OptimizedImage with headers (will fallback to fetch on error)
                  <View style={styles.imageWrapper}>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setIsFullScreen(true)}
                      style={styles.imageTouchable}
                    >
                      <OptimizedImage
                        source={{
                          uri: currentImageUrl,
                          headers: imageHeaders,
                        }}
                        style={styles.image}
                        resizeMode="contain"
                        showLoader={false}
                        cacheEnabled={true}
                        onLoad={() => {
                          setImageLoadingError(false);
                        }}
                        onError={(error) => {
                          const errorObj = error.nativeEvent?.error || {};
                          const is401 = errorObj.code === 401 || 
                                       errorObj.message?.includes('401') ||
                                       String(errorObj).includes('401');
                          
                          if (__DEV__) {
                            console.error('❌ Image component load ERROR:', errorObj);
                          }
                          
                          // If 401, trigger fetch fallback immediately
                          if (is401) {
                            setImageLoadingError(true);
                            fetchImageWithAuth(currentImageUrl);
                          }
                        }}
                      />
                    </TouchableOpacity>
                    {/* Share button */}
                    <TouchableOpacity
                      style={styles.shareImageButton}
                      onPress={handleShare}
                      disabled={isSharing}
                      activeOpacity={0.8}
                    >
                      <Icon name="share" size={24} color={colors.textWhite} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  // Android: Show loading placeholder while fetching
                  <View style={styles.imagePlaceholder}>
                    {imageLoadingError ? (
                      <>
                        <Icon name="image" size={60} color={colors.textSecondary} />
                        <CustomText variant="caption" style={styles.placeholderText}>
                          Failed to load image
                        </CustomText>
                      </>
                    ) : (
                      <AnimatedLogoLoader size={60} />
                    )}
                  </View>
                )}
                  </>
                )}
              </>
            ) : (
              <View style={styles.imagePlaceholder}>
                <Icon name={isCurrentVideo ? "videocam-off" : "image"} size={60} color={colors.textSecondary} />
                <CustomText variant="caption" style={styles.placeholderText}>
                  {isCurrentVideo ? 'Video' : 'Image'} not available
                </CustomText>
                {__DEV__ && (
                  <CustomText variant="caption" style={[styles.placeholderText, { marginTop: 8, fontSize: 10 }]}>
                    URL: {currentImageUrl || 'null'}
                  </CustomText>
                )}
              </View>
            )}
            
            {/* Navigation Arrows */}
            {showNavigation && (
              <>
                {currentImageIndex > 0 && (
                  <TouchableOpacity
                    style={[styles.navButton, styles.prevButton]}
                    onPress={handlePreviousImage}
                  >
                    <Icon name="chevron-left" size={30} color={colors.textWhite} />
                  </TouchableOpacity>
                )}
                {currentImageIndex < images.length - 1 && (
                  <TouchableOpacity
                    style={[styles.navButton, styles.nextButton]}
                    onPress={handleNextImage}
                  >
                    <Icon name="chevron-right" size={30} color={colors.textWhite} />
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          {/* Image/Video Counter */}
          <View style={styles.imageCounter}>
            <CustomText style={styles.counterText}>
              Total {isCurrentVideo ? 'Videos' : 'Images'}: {images.length} | Current {isCurrentVideo ? 'Video' : 'Image'}: {currentImageIndex + 1}
            </CustomText>
          </View>
        </View>

        {/* Design Code Display */}
        {designCode && (
          <Card style={styles.codeCard}>
            <CustomText variant="heading" style={styles.codeText}>
              {designCode}
            </CustomText>
          </Card>
        )}

        {/* Actions Section */}
        <Card style={styles.actionsCard}>
          {/* Comment Field - Show for all users */}
          <View style={styles.commentSection}>
            {/* {isDesigner || isClient ? (
              // Designer/Client view: Read-only comment display
              <>
                <View style={styles.commentHeader}>
                  <View style={styles.commentHeaderLeft}>
                    <Icon name="comment" size={20} color={colors.primary} />
                    <CustomText variant="label" style={styles.commentLabel}>
                      Comments
                    </CustomText>
                  </View>
                </View>
                <View style={styles.commentDisplayBox}>
                  <CustomText variant="body" style={styles.commentText}>
                    {comment || designCode || 'No comments available'}
                  </CustomText>
                </View>
              </>
            ) : (
              // Admin view: Editable comment input
              <>
                <View style={styles.commentHeader}>
                  <View style={styles.commentHeaderLeft}>
                    <Icon name="comment" size={20} color={colors.primary} />
                    <CustomText variant="label" style={styles.commentLabel}>
                      Comments
                    </CustomText>
                  </View>
                </View>
                <View style={styles.commentInputContainer}>
                  <Input
                    value={comment}
                    onChangeText={setComment}
                    placeholder="Enter image comment..."
                    multiline
                    numberOfLines={3}
                    style={styles.commentInput}
                  />
                </View>
                <TouchableOpacity
                  onPress={handleSaveComment}
                  disabled={isUpdatingDescription}
                  style={[styles.adminActionButton, styles.adminActionButtonPrimary, isUpdatingDescription && styles.btnDisabled]}
                  activeOpacity={0.85}
                >
                  <Icon name="save" size={18} color={colors.textWhite} />
                  <Text style={styles.adminActionText}>
                    {isUpdatingDescription ? "Saving..." : "Save Comment"}
                  </Text>
                </TouchableOpacity>
              </>
            )} */}
          </View>

          {/* Client Pricing Message - Read-only for clients */}
          {isClient && (
            <View style={styles.commentSection}>
              <View style={styles.commentHeader}>
                <View style={styles.commentHeaderLeft}>
                  <Icon name="attach-money" size={20} color={colors.primary} />
                  <CustomText variant="label" style={styles.commentLabel}>
                    Client Pricing Message
                  </CustomText>
                </View>
              </View>
              <View style={styles.commentDisplayBox}>
                <CustomText variant="body" style={styles.commentText}>
                  {(() => {
                    const pricing = selectedDesign?.Pricing || selectedDesign?.pricing || {};
                    const clientPricingMessage = pricing?.ClientPricingMessage || selectedDesign?.ClientPricingMessage || '';
                    return clientPricingMessage || 'No pricing message available';
                  })()}
                </CustomText>
              </View>
            </View>
          )}

          {/* Action Buttons - Different for designers vs admin vs client */}
          {!isClient && <View style={styles.actionsDivider} />}
          
          {isClient ? (
            // Client view: No action buttons - view only
            null
          ) : isDesigner ? (
            // Designer view: Download buttons + Delete Version (within 10 mins)
            <View style={styles.designerActions}>
              <View style={styles.adminActionsRow}>
                <TouchableOpacity
                  onPress={handleDownloadImage}
                  disabled={isDownloadingImage}
                  style={[styles.adminActionButton, styles.adminActionButtonPrimary, isDownloadingImage && styles.btnDisabled]}
                  activeOpacity={0.85}
                >
                  <Icon name="file-download" size={18} color={colors.textWhite} />
                  <Text style={styles.adminActionText}>
                    {isDownloadingImage ? "Downloading..." : "Download Image"}
                  </Text>
                </TouchableOpacity>
                
                {/* Delete Version Button - Only if within 10 minutes */}
                {(() => {
                  const canDelete = canDeleteVersion(selectedDesign);
                  
                  
                  return canDelete ? (
                    <TouchableOpacity
                      onPress={handleDeleteVersion}
                      disabled={isDeletingVersion}
                      style={[
                        styles.adminActionButton, 
                        styles.adminActionButtonDanger,
                        isDeletingVersion && styles.btnDisabled
                      ]}
                      activeOpacity={0.85}
                    >
                      <Icon name="delete-outline" size={18} color={colors.textWhite} />
                      <Text style={styles.adminActionText}>
                        {isDeletingVersion ? "Deleting..." : "Delete Version"}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={[styles.adminActionButton, styles.adminActionButtonSecondary, { opacity: 0.5 }]}>
                      <Icon name="delete-outline" size={18} color={colors.textSecondary} />
                      <Text style={[styles.adminActionText, { color: colors.textSecondary }]}>
                        Delete Expired
                      </Text>
                    </View>
                  );
                })()}
              </View>
              
              <View style={styles.adminActionsRow}>
                <TouchableOpacity
                  onPress={handleDownloadExcel}
                  disabled={isDownloadingExcel}
                  style={[styles.adminActionButton, styles.adminActionButtonSecondary, isDownloadingExcel && styles.btnDisabled]}
                  activeOpacity={0.85}
                >
                  <Icon name="insert-drive-file" size={18} color={colors.textWhite} />
                  <Text style={styles.adminActionText}>
                    {isDownloadingExcel ? "Downloading..." : `Download Excel - ${designCode || 'N/A'}`}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // Admin view: All buttons including Delete and Pricing
            <View style={styles.adminActions}>
              <View style={styles.adminActionsRow}>
                <TouchableOpacity
                  onPress={handleDownloadImage}
                  disabled={isDownloadingImage}
                  style={[styles.adminActionButton, styles.adminActionButtonPrimary, isDownloadingImage && styles.btnDisabled]}
                  activeOpacity={0.85}
                >
                  <Icon name="file-download" size={18} color={colors.textWhite} />
                  <Text style={styles.adminActionText}>
                    {isDownloadingImage ? "Downloading..." : "Download Image"}
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  onPress={handleDeleteImage}
                  style={[styles.adminActionButton, styles.adminActionButtonDanger]}
                  activeOpacity={0.85}
                >
                  <Icon name="delete-outline" size={18} color={colors.textWhite} />
                  <Text style={styles.adminActionText}>Delete</Text>
                </TouchableOpacity>
              </View>

              {/* Download Excel Button */}
              <View style={styles.adminActionsRow}>
                <TouchableOpacity
                  onPress={handleDownloadExcel}
                  disabled={isDownloadingExcel}
                  style={[styles.adminActionButton, styles.adminActionButtonSecondary, isDownloadingExcel && styles.btnDisabled]}
                  activeOpacity={0.85}
                >
                  <Icon name="insert-drive-file" size={18} color={colors.textWhite} />
                  <Text style={styles.adminActionText}>
                    {isDownloadingExcel ? "Downloading..." : `Download Excel - ${designCode || 'N/A'}`}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Pricing Button - Admin only */}
              {isAdmin && (
                <View style={styles.adminActionsRow}>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('Pricing', {
                      enquiry: enquiry,
                      designType: designType,
                    })}
                    style={[styles.adminActionButton, styles.adminActionButtonSecondary]}
                    activeOpacity={0.85}
                  >
                    <Icon name="attach-money" size={18} color={colors.textWhite} />
                    <Text style={styles.adminActionText}>Pricing</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Approve and Reject Buttons - Admin only */}
              {isAdmin && (
                <View style={styles.adminActionsRow}>
                  <TouchableOpacity
                    onPress={handleApprove}
                    disabled={isApproving || isRejecting}
                    style={[styles.adminActionButton, styles.adminActionButtonPrimary, (isApproving || isRejecting) && styles.btnDisabled]}
                    activeOpacity={0.85}
                  >
                    <Icon name="check-circle" size={18} color={colors.textWhite} />
                    <Text style={styles.adminActionText}>
                      {isApproving ? "Approving..." : "Approve"}
                    </Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    onPress={handleReject}
                    disabled={isApproving || isRejecting}
                    style={[styles.adminActionButton, styles.adminActionButtonDanger, (isApproving || isRejecting) && styles.btnDisabled]}
                    activeOpacity={0.85}
                  >
                    <Icon name="cancel" size={18} color={colors.textWhite} />
                    <Text style={styles.adminActionText}>
                      {isRejecting ? "Rejecting..." : "Reject"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Show to Client Toggle - Admin only */}
              {isAdmin && (
                <View style={styles.toggleContainer}>
                  <View style={styles.toggleContent}>
                    <View style={styles.toggleLabelContainer}>
                      <Icon 
                        name={(selectedDesign?.ShowToClient || selectedDesign?.showToClient) ? "visibility" : "visibility-off"} 
                        size={20} 
                        color={colors.primary} 
                      />
                      <Text style={styles.toggleLabel}>
                        {isUpdatingShowToClient 
                          ? "Updating..." 
                          : (selectedDesign?.ShowToClient || selectedDesign?.showToClient) 
                            ? "Visible to Client" 
                            : "Show to Client"}
                      </Text>
                    </View>
                    <Switch
                      value={selectedDesign?.ShowToClient || selectedDesign?.showToClient || false}
                      onValueChange={handleShowToClient}
                      disabled={isUpdatingShowToClient}
                      trackColor={{
                        false: colors.border,
                        true: colors.primaryLight,
                      }}
                      thumbColor={
                        (selectedDesign?.ShowToClient || selectedDesign?.showToClient)
                          ? colors.primary
                          : colors.textSecondary
                      }
                      ios_backgroundColor={colors.border}
                      style={styles.toggleSwitch}
                    />
                  </View>
                </View>
              )}
            </View>
          )}
        </Card>
      </ScrollView>

      {/* Reject Modal */}
      <Modal
        visible={showRejectModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowRejectModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Reject Design Version</Text>
            <Text style={styles.modalSubtitle}>
              {designType.toUpperCase()} {selectedDesign?.Version || selectedDesign?.version || `Version ${currentVersionNumber}`}
            </Text>
            <Text style={styles.modalLabel}>
              Please provide a reason for rejection:
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter rejection reason..."
              value={rejectionReason}
              onChangeText={setRejectionReason}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => {
                  setShowRejectModal(false);
                  setRejectionReason('');
                }}
                style={[styles.modalButton, styles.modalCancelBtn]}
                activeOpacity={0.85}
              >
                <Icon name="close" size={18} color={colors.textWhite} />
                <Text style={styles.adminActionText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmReject}
                disabled={isRejecting}
                style={[styles.modalButton, styles.modalRejectBtn, isRejecting && styles.btnDisabled]}
                activeOpacity={0.85}
              >
                <Icon name="cancel" size={18} color={colors.textWhite} />
                <Text style={styles.adminActionText}>
                  {isRejecting ? "Rejecting..." : "Reject"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Full Screen Image/Video Modal */}
      <Modal
        visible={isFullScreen}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsFullScreen(false)}
      >
        <StatusBar hidden={isFullScreen} />
        <View style={styles.fullScreenContainer}>
          <TouchableOpacity
            style={styles.fullScreenCloseButton}
            onPress={() => setIsFullScreen(false)}
            activeOpacity={0.8}
          >
            <Icon name="close" size={30} color={colors.textWhite} />
          </TouchableOpacity>
          
          {currentImageUrl && (
            <View style={styles.fullScreenImageContainer}>
              {isCurrentVideo ? (
                // Render video in full screen
                <FullScreenVideo
                  image={currentMedia}
                  imageKey={currentImageKey}
                  imageId={typeof currentMedia === 'object' && currentMedia !== null
                    ? (currentMedia.Id || currentMedia.id || currentMedia._id || '')
                    : ''}
                  imageUri={currentImageUri}
                  onClose={() => setIsFullScreen(false)}
                />
              ) : (
                // Render image in full screen
            <TouchableOpacity
                  style={styles.fullScreenImageTouchable}
              activeOpacity={1}
              onPress={() => setIsFullScreen(false)}
            >
              {!imageDataUri && !useFetchDirectly ? (
                <OptimizedImage
                  source={{
                    uri: currentImageUrl,
                    headers: imageHeaders,
                  }}
                  style={styles.fullScreenImage}
                  resizeMode="contain"
                  showLoader={false}
                  cacheEnabled={true}
                />
              ) : imageDataUri ? (
                <OptimizedImage
                  source={{ uri: imageDataUri }}
                  style={styles.fullScreenImage}
                  resizeMode="contain"
                  showLoader={false}
                  cacheEnabled={true}
                />
              ) : null}
            </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </Modal>
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
    paddingBottom: 20,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    marginTop: 16,
    marginBottom: 24,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  backButton: {
    marginTop: 20,
  },
  imageSection: {
    width: '100%',
    backgroundColor: colors.background,
    marginBottom: 16,
  },
  imageContainer: {
    width: '100%',
    height: IMAGE_CONTAINER_HEIGHT,
    backgroundColor: colors.backgroundSecondary,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
  },
  placeholderText: {
    marginTop: 12,
    color: colors.textSecondary,
  },
  navButton: {
    position: 'absolute',
    top: '50%',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  prevButton: {
    left: 16,
  },
  nextButton: {
    right: 16,
  },
  imageCounter: {
    padding: 12,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  counterText: {
    color: colors.textPrimary,
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
  },
  codeCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 20,
    alignItems: 'center',
  },
  codeText: {
    fontSize: fonts.xl,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  actionsCard: {
    marginHorizontal: 16,
    padding: 20,
  },
  commentSection: {
    marginBottom: 20,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  commentHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commentLabel: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    letterSpacing: 0.3,
  },
  commentDisplayBox: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 60,
    justifyContent: 'center',
  },
  commentText: {
    color: colors.textPrimary,
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    lineHeight: 22,
  },
  commentInputContainer: {
    marginBottom: 16,
  },
  commentInput: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignSelf: 'flex-start',
  },
  saveButtonText: {
    color: colors.textWhite,
    fontFamily: fonts.bold,
    fontSize: fonts.base,
  },
  buttonText: {
    color: colors.textWhite,
    fontFamily: fonts.bold,
    fontSize: fonts.base,
  },
  actionsDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 20,
  },
  designerActions: {
    gap: 0,
  },
  adminActions: {
    gap: 0,
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
  adminActionText: {
    color: colors.textWhite,
    fontFamily: fonts.medium,
    fontSize: 14,
    marginLeft: 8,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  videoContainer: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.backgroundSecondary,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.backgroundSecondary,
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
  imageWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  imageTouchable: {
    width: '100%',
    height: '100%',
  },
  shareImageButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: colors.primary, // WhatsApp green with transparency
    borderRadius: 25,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: colors.textPrimary,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImageContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImageTouchable: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  fullScreenVideoContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  fullScreenVideo: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  fullScreenVideoPlaceholder: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenVideoRetryButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  fullScreenVideoRetryText: {
    color: colors.textWhite,
    fontSize: 16,
    fontWeight: '600',
  },
  fullScreenCloseButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    right: 20,
    zIndex: 1000,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleContainer: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 16,
  },
  toggleContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  toggleLabel: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    letterSpacing: 0.2,
  },
  toggleSwitch: {
    transform: [{ scaleX: 1.1 }, { scaleY: 1.1 }],
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: colors.modalBackground || colors.background,
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    marginHorizontal: 20,
  },
  modalTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  modalLabel: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    backgroundColor: colors.backgroundSecondary,
    minHeight: 100,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  modalCancelBtn: {
    backgroundColor: colors.primaryLight,
  },
  modalRejectBtn: {
    backgroundColor: colors.primaryDark,
  },
});

export default DesignViewerScreen;


