import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  ImageBackground,
  StyleSheet,
  View,
  Text,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  TouchableOpacity,
  Modal,
  FlatList,
  Image,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Video from 'react-native-video';
import secureStorage from '../../utils/secureStorage';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { FILE_BASE_URL, API_BASE_URL } from '../../config/apiConfig';
import Icon from '../common/Icon';
import BrandedAlert from '../common/BrandedAlert';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import {
  useGetUsersQuery,
  useGetStatusesQuery,
  useGetRolesQuery,
  useGetEnquiryByIdQuery,
  useApproveDesignVersionMutation,
  useRejectDesignVersionMutation,
  useUpdateEnquiryMutation,
} from '../../store/api';
import { actionsFor, resolveRoleCode, ACTION, SUBSTATUS, STATUS, ROLE } from '../../constants/enquiry';
import { useEnquiryActions } from '../../hooks/useEnquiryActions';

const { width: screenWidth } = Dimensions.get('window');

function ModalVideoItem({ uri }) {
  const [paused, setPaused] = useState(true);
  return (
    <TouchableOpacity activeOpacity={1} onPress={() => setPaused(p => !p)} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Video
        source={{ uri }}
        style={styles.fullscreenImage}
        resizeMode="contain"
        paused={paused}
        controls={false}
        repeat={false}
      />
      {paused && (
        <View style={styles.modalVideoPlayOverlay}>
          <Icon name="play-circle-filled" size={64} color="rgba(255,255,255,0.9)" />
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function NewEnquiryCard({
  item,
  navigation,
  onViewQuotation,
  onPress,
  currentTab,
  onUpdateEnquiry,
  onDeleteEnquiry,
  isExpandedAll = false,
  onFinalLook,
  onSummary,
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  
  const { data: users, isLoading } = useGetUsersQuery();
  const { data: statusesData, isLoading: isStatusesLoading } = useGetStatusesQuery();
  const { data: rolesData } = useGetRolesQuery();

  const [imagesData, setImagesData] = useState([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isImageModalVisible, setImageModalVisible] = useState(false);
  const [modalCurrentIndex, setModalCurrentIndex] = useState(0);
  const [zoomedImageIndex, setZoomedImageIndex] = useState(null);
  const modalFlatListRef = useRef(null);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [isRemarkExpanded, setIsRemarkExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Assign modal state ────────────────────────────────────────────────────
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assignType, setAssignType] = useState(null);
  const [selectedAssignee, setSelectedAssignee] = useState(null);
  const [isAssigning, setIsAssigning] = useState(false);

  const [showQuotationActions, setShowQuotationActions] = useState(false);
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [showCadPicker, setShowCadPicker] = useState(false);
  const [isRejectingQuotation, setIsRejectingQuotation] = useState(false);
  const [isRejectingApproval, setIsRejectingApproval] = useState(false);
  const [selectedCadDesigner, setSelectedCadDesigner] = useState(null);
  const [updateReason, setUpdateReason] = useState('');
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [alertCfg, setAlertCfg] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  
  const [activeDesignType, setActiveDesignType] = useState(null);
  
  const showAlert = useCallback((title, message, type = 'info', buttons = []) =>
    setAlertCfg({ visible: true, title, message, type, buttons }), []);
  const hideAlert = useCallback(() => setAlertCfg(p => ({ ...p, visible: false })), []);

  const coralDesigners = useMemo(
    () => (users || []).filter(u => u.role === 2 || u.roleId === 2 || u.roleNumber === 2),
    [users],
  );
  const cadDesigners = useMemo(
    () => (users || []).filter(u => u.role === 3 || u.roleId === 3 || u.roleNumber === 3),
    [users],
  );

  const [approveDesignVersion] = useApproveDesignVersionMutation();
  const [rejectDesignVersion] = useRejectDesignVersionMutation();
  const [updateEnquiryDirect] = useUpdateEnquiryMutation();
  const { handleAcceptApproval, handleUploadFinalCad, handleMoveToOrderPlacement, isLoading: isHookLoading } = useEnquiryActions({ onAlert: showAlert });

  const getVersionFromLast = useCallback((designType) => {
    const src = fullEnquiryData?._originalData || fullEnquiryData || item;
    const rawObj = designType === 'cad'
      ? (src?.lastCad || item?.lastCad)
      : (src?.lastCoral || item?.lastCoral);
    return parseInt(rawObj?.Version || rawObj?.version || '1', 10);
  }, [fullEnquiryData, item]);

  const priority = (item?.Priority || 'medium').toLowerCase();

  const roleCode = useMemo(() => {
    const raw = resolveRoleCode(user);
    if (raw) return raw;
    const r = String(user?.role || '').toLowerCase();
    if (r === 'admin' || r === 'ad') return ROLE.AD;
    if (r === 'coral' || r === 'co') return ROLE.CO;
    if (r === 'cad' || r === 'cd') return ROLE.CD;
    if (r === 'client_handler' || r === 'ch') return ROLE.CH;
    if (r === 'client' || r === 'cl') return ROLE.CL;
    return null;
  }, [user]);

  const isAdminCh = roleCode === ROLE.AD || roleCode === ROLE.CH;

  const enquiryId = item?.Id || item?._id || item?.id;
  const { data: enquiryResult, isFetching: isFetchingEnquiry } = useGetEnquiryByIdQuery(
    enquiryId,
    { skip: !enquiryId },
  );
  const fullEnquiryData = enquiryResult || null;
  const fullSrc = fullEnquiryData;
  const status = (fullEnquiryData?.CurrentStatus || item?.CurrentStatus || 'pending').toLowerCase();
  const subStatus = fullEnquiryData?.CurrentSubStatus || item?.CurrentSubStatus || '';
  const latestCoralVersion = fullEnquiryData?.lastCoral || item?.lastCoral || '';
  const LatestCadVersion = fullEnquiryData?.lastCad || item?.lastCad || '';

  const source = useMemo(() => {
    const base = fullEnquiryData || item;
    if (!base) return base;
    const itemRaw = item?._originalData || item;
    const baseRaw = base?._originalData || base;
    return {
      ...base,
      finalCad: base?.finalCad || baseRaw?.finalCad || itemRaw?.finalCad || item?.finalCad || null,
      approvedCoral: base?.approvedCoral || baseRaw?.approvedCoral || itemRaw?.approvedCoral || item?.approvedCoral || null,
      approvedCad: base?.approvedCad || baseRaw?.approvedCad || itemRaw?.approvedCad || item?.approvedCad || null,
    };
  }, [fullEnquiryData, item]);
  const cardActions = useMemo(() => actionsFor(source, roleCode), [source, roleCode]);
  const actionButtons = cardActions?.buttons || [];
  const has = (a) => actionButtons.includes(a);

  const isCoralPending = status === 'coral';
  const isCadPending = status === 'cad';
  const isProduction = status === 'production';
  const isApprovalPending = status === 'design approval pending';
  const isApprovedCad = status === 'approved cad';
  const isQuotation = status === 'quotation';
  const isPlacementStage = status === 'order placement';
  const isJustCreated = status === 'enquiry created' || status === 'created' || status === 'new' || status === 'pending';

  const isCostMissing = subStatus === SUBSTATUS.CM;
  const isQuotationReview = subStatus === SUBSTATUS.QR;
  const isAssignPending = subStatus === SUBSTATUS.AP;

  const referenceImages = item?.ReferenceImages || [];

  const currentInferredDesignType = useMemo(() => {
    const rawData = fullSrc || item;
    const cadData = rawData?.Cad || [];
    const lastCadObj = rawData?._originalData?.lastCad || rawData?.lastCad;
    const lastCoralObj = rawData?._originalData?.lastCoral || rawData?.lastCoral;
    if (cadData.length > 0) return 'cad';
    if (lastCadObj && !lastCoralObj) return 'cad';
    if (lastCoralObj && !lastCadObj) return 'coral';
    if (lastCadObj && lastCoralObj) {
      const cadVer = parseInt(lastCadObj.Version || '0', 10);
      const coralVer = parseInt(lastCoralObj.Version || '0', 10);
      return cadVer >= coralVer ? 'cad' : 'coral';
    }
    return 'coral';
  }, [fullSrc, item]);

  useEffect(() => {
    if (!isExpandedAll || !referenceImages.length) return;
    let cancelled = false;
    const loadAllImages = async () => {
      setImageLoading(true);
      try {
        const token = await AsyncStorage.getItem('token');
        const results = await Promise.all(referenceImages.map(async img => {
          const imageKey = img?.Key;
          if (!imageKey) return null;
          const isVideo = typeof img?.MimeType === 'string' && img.MimeType.toLowerCase().startsWith('video/');
          try {
            const res = await fetch(`${FILE_BASE_URL}/api/enquiries/files/${encodeURIComponent(imageKey)}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return null;
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              const j = await res.json();
              const uri = j.url || j.imageUrl || null;
              return uri ? { uri, isVideo } : null;
            }
            const buf = await res.arrayBuffer();
            const b64 = btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ''));
            return { uri: `data:${ct};base64,${b64}`, isVideo: ct.startsWith('video/') };
          } catch { return null; }
        }));
        if (!cancelled) setImagesData(results.filter(Boolean));
      } catch { }
      finally { if (!cancelled) setImageLoading(false); }
    };
    loadAllImages();
    return () => { cancelled = true; };
  }, [isExpandedAll]);

  const createdDate = item?.CreatedDate || item?.createdAt;
  const daysSinceCreation = createdDate
    ? Math.floor((new Date() - new Date(createdDate)) / (1000 * 60 * 60 * 24))
    : 0;
  const isPendingStatus = isCoralPending || isCadPending;
  const ageShadeIndex = Math.min(Math.max(daysSinceCreation, 0), 4);
  const shadeColors = ['transparent', '#FFE4E2', '#FFB8B0', '#FF7A70', '#EF4444'];
  const pendingShadeColor = isPendingStatus ? shadeColors[ageShadeIndex] : 'transparent';

  const raw = item._originalData || item;
  const assignedVal = item.AssignedTo || item.assignedTo || raw.AssignedTo || raw.assignedTo || fullSrc?.AssignedTo || fullSrc?.assignedTo;

  const assignedIdStr = useMemo(() => {
    if (!assignedVal) return '';
    if (typeof assignedVal === 'object') {
      return String(assignedVal.id || assignedVal.Id || assignedVal._id || assignedVal.userId || '').trim();
    }
    const s = String(assignedVal).trim();
    if (!s || s === 'null' || s === 'undefined' || s === '0' || s === 'false') return '';
    return s;
  }, [assignedVal]);

  const hasAssignedUser = assignedIdStr.length > 0;

  const resolveAssignedId = (val) => {
    if (!val) return null;
    if (typeof val === 'object') {
      return String(val.id || val.Id || val._id || val.userId || '').trim() || null;
    }
    const s = String(val).trim();
    if (!s || s === 'null' || s === 'undefined' || s === '0' || s === 'false') return null;
    return s;
  };

  const assignedUserName = useMemo(() => {
    if (!assignedIdStr) return null;
    if (typeof assignedVal === 'object') {
      const name = assignedVal.name || assignedVal.Name || assignedVal.username || assignedVal.email;
      if (name) return name;
    }
    if (users) {
      const found = users.find(u => String(u.id || u._id || '').trim() === assignedIdStr);
      return found?.name || found?.Name || found?.username || found?.email || null;
    }
    return null;
  }, [assignedIdStr, assignedVal, users]);

  const shouldShowAdminCoralUpload = has(ACTION.UPLOAD_CORAL);
  const shouldShowAdminCadUpload = has(ACTION.UPLOAD_CAD);
  const shouldShowAdminApprovedCad = has(ACTION.UPLOAD_FINAL_CAD);
  const isFinalVersion = !!(fullEnquiryData?.finalCad?.Version || item?._originalData?.finalCad?.Version || item?.finalCad?.Version);
  const shouldShowFinalLookAndPlacement = isFinalVersion && has(ACTION.FINAL_LOOK) && has(ACTION.MOVE_TO_ORDER_PLACEMENT);
  const shouldShowAdminPlacement = false;
  const shouldShowAdminProduction = has(ACTION.CHAT) && isProduction;
  const shouldShowCoralDesignerButtons = has(ACTION.UPLOAD_CORAL);
  const shouldShowCadDesignerButtons = has(ACTION.UPLOAD_CAD) || has(ACTION.UPLOAD_FINAL_CAD);
  const shouldShowQuotationButtons = has(ACTION.VIEW_QUOTATION) || has(ACTION.MOVE_TO_APPROVAL) || has(ACTION.UPDATE_QUOTATION);
  const shouldShowAssignCoral = has(ACTION.ASSIGN) && !hasAssignedUser && (cardActions?.assignType === 'coral' || isJustCreated || (isCoralPending && isAssignPending));
  const shouldShowAssignCad = has(ACTION.ASSIGN) && !hasAssignedUser && (cardActions?.assignType === 'cad' || (isCadPending && isAssignPending));
  const shouldShowApprovalButtons = has(ACTION.ACCEPT_APPROVAL) || has(ACTION.REJECT_APPROVAL);

  const handleScroll = e => setCurrentIndex(Math.round(e.nativeEvent.contentOffset.x / screenWidth));
  const handleImagePress = useCallback(index => { setModalCurrentIndex(index); setImageModalVisible(true); }, []);
  const closeImageModal = useCallback(() => { setImageModalVisible(false); setZoomedImageIndex(null); }, []);
  const handleDoubleTap = useCallback(index => {
    setZoomedImageIndex(prev => prev === index ? null : index);
  }, []);

  const updateEnquiryStatus = async (updateData) => {
    if (!onUpdateEnquiry) {
      console.error('onUpdateEnquiry prop not provided');
      return false;
    }
    const payload = {
      id: item?.Id || item?._id || item?.id,
      ...updateData,
    };
    const result = await onUpdateEnquiry(payload);
    return result;
  };

  const handleDeleteEnquiry = async () => {
    if (!onDeleteEnquiry) {
      console.error('onDeleteEnquiry prop not provided');
      return;
    }
    setIsDeleting(true);
    try {
      const enquiryId = item?.Id || item?._id || item?.id;
      await onDeleteEnquiry(enquiryId);
      setShowMoreOptions(false);
    } catch (error) {
      console.error('Failed to delete:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleApprove = () => {
    setShowCadPicker(true);
  };

  const handleApproveWithDesigner = async (designer) => {
    const clientId = item?.ClientId || item?.clientId;
    setIsActionLoading(true);
    try {
      if (isApprovedCad) {
        await updateEnquiryDirect({
          id: enquiryId,
          Status: 'Production',
          ApprovedDate: new Date().toISOString(),
          AssignedTo: designer ? designer.id : null,
          ClientId: clientId,
        }).unwrap();
      } else {
        await updateEnquiryDirect({
          id: enquiryId,
          Status: 'Approved Cad',
          AssignedTo: designer ? designer.id : null,
          ClientId: clientId,
        }).unwrap();
      }

      setShowQuotationActions(false);
      const msg = isApprovedCad
        ? 'CAD approved. Enquiry moved to Production.'
        : 'Design approved and assigned to CAD designer.';
      showAlert('Approved', msg, 'success', [{ text: 'OK' }]);
    } catch (e) {
      showAlert('Failed', e?.data?.message || 'Could not approve the design. Please try again.', 'error', [{ text: 'OK' }]);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRequestUpdate = async () => {
    if (!updateReason.trim() || !activeDesignType) return;
    setIsActionLoading(true);
    try {
      const numericVersion = getVersionFromLast(activeDesignType);
      await rejectDesignVersion({
        enquiryId,
        designType: activeDesignType,
        version: String(numericVersion),
        reason: updateReason.trim(),
      }).unwrap();
      
      if (activeDesignType === 'cad') {
        const currentAssignedTo = resolveAssignedId(item?.AssignedTo || item?.assignedTo || fullSrc?.AssignedTo || fullSrc?.assignedTo);
        await updateEnquiryDirect({
          id: enquiryId,
          Status: 'CAD',
          CurrentStatus: 'CAD',
          ClientId: item?.ClientId || item?.clientId,
          ...(currentAssignedTo ? { AssignedTo: currentAssignedTo } : {}),
        }).unwrap();
      }
      closeQuotationActions();
      showAlert('Update Requested', 'Your revision request has been sent. The design will be updated.', 'success', [{ text: 'OK' }]);
    } catch (e) {
      showAlert('Failed', e?.data?.message || 'Could not send the update request. Please try again.', 'error', [{ text: 'OK' }]);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRejectApproval = async () => {
    if (!updateReason.trim() || !activeDesignType) return;
    setIsActionLoading(true);
    try {
      const numericVersion = getVersionFromLast(activeDesignType);
      await rejectDesignVersion({
        enquiryId,
        designType: activeDesignType,
        version: String(numericVersion),
        reason: updateReason.trim(),
      }).unwrap();
      
      const currentAssignedTo = resolveAssignedId(item?.AssignedTo || item?.assignedTo || fullSrc?.AssignedTo || fullSrc?.assignedTo);
      const rejectStatus = activeDesignType === 'cad' ? STATUS.CAD : STATUS.CORAL;
      await updateEnquiryDirect({
        id: enquiryId,
        Status: rejectStatus,
        CurrentStatus: rejectStatus,
        CurrentSubStatus: SUBSTATUS.RR,
        ClientId: item?.ClientId || item?.clientId,
        ...(currentAssignedTo ? { AssignedTo: currentAssignedTo } : {}),
      }).unwrap();
      closeQuotationActions();
      setIsRejectingApproval(false);
      showAlert('Rejected', 'Design rejected. Sent back for redo.', 'success', [{ text: 'OK' }]);
    } catch (e) {
      showAlert('Failed', e?.data?.message || 'Could not reject. Please try again.', 'error', [{ text: 'OK' }]);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRejectQuotation = async () => {
    if (!updateReason.trim() || !activeDesignType) return;
    setIsActionLoading(true);
    try {
      const numericVersion = getVersionFromLast(activeDesignType);
      await rejectDesignVersion({
        enquiryId,
        designType: activeDesignType,
        version: String(numericVersion),
        reason: updateReason.trim(),
      }).unwrap();
      
      const currentStatus = item?.CurrentStatus || item?.currentStatus || '';
      const currentAssignedTo = resolveAssignedId(item?.AssignedTo || item?.assignedTo || fullSrc?.AssignedTo || fullSrc?.assignedTo);
      await updateEnquiryDirect({
        id: enquiryId,
        Status: currentStatus,
        CurrentStatus: currentStatus,
        CurrentSubStatus: SUBSTATUS.RR,
        ClientId: item?.ClientId || item?.clientId,
        ...(currentAssignedTo ? { AssignedTo: currentAssignedTo } : {}),
      }).unwrap();
      closeQuotationActions();
      showAlert('Rejected', 'Quotation rejected. Enquiry moved back for redo.', 'success', [{ text: 'OK' }]);
    } catch (e) {
      showAlert('Failed', e?.data?.message || 'Could not reject.', 'error', [{ text: 'OK' }]);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleConfirmAssign = async () => {
    if (!selectedAssignee || !enquiryId) return;
    setIsAssigning(true);
    try {
      const targetStatus = assignType === 'coral' ? STATUS.CORAL : STATUS.CAD;
      const designerLabel = assignType === 'coral' ? 'Coral' : 'CAD';
      const res = await onUpdateEnquiry({
        id: enquiryId,
        Status: targetStatus,
        CurrentStatus: targetStatus,
        CurrentSubStatus: SUBSTATUS.AS,
        AssignedTo: selectedAssignee.id,
        ClientId: item?.ClientId || item?.clientId,
      });
      if (!res) throw new Error('Update failed');
      setAssignModalVisible(false);
      setSelectedAssignee(null);
      showAlert('Assigned', `${designerLabel} designer assigned successfully.`, 'success', [{ text: 'OK' }]);
    } catch (e) {
      showAlert('Failed', 'Could not assign designer.', 'error', [{ text: 'OK' }]);
    } finally {
      setIsAssigning(false);
    }
  };

  const closeQuotationActions = () => {
    setShowQuotationActions(false);
    setShowReasonInput(false);
    setShowCadPicker(false);
    setSelectedCadDesigner(null);
    setUpdateReason('');
    setIsRejectingQuotation(false);
    setActiveDesignType(null);
  };

  return (
    <View style={[styles.mainContainer, { borderLeftWidth: isPendingStatus ? 4 : 0, borderLeftColor: pendingShadeColor }]}>

      {isExpandedAll && (
        <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
          <View style={styles.ImageContainer}>
            {imageLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : imagesData.length > 0 ? (
              <View style={styles.carouselContainer}>
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={handleScroll} scrollEventThrottle={16}>
                  {imagesData.map((media, index) => (
                    <TouchableOpacity key={`media-${index}`} activeOpacity={0.9} onPress={() => handleImagePress(index)}>
                      <View style={styles.carouselImage}>
                        {media.isVideo ? (
                          <Video
                            source={{ uri: media.uri }}
                            style={StyleSheet.absoluteFill}
                            resizeMode="cover"
                            paused
                            muted
                            repeat={false}
                          />
                        ) : (
                          <ImageBackground source={{ uri: media.uri }} style={StyleSheet.absoluteFill} />
                        )}
                        {media.isVideo && (
                          <View style={styles.carouselPlayOverlay}>
                            <Icon name="play-circle-filled" size={44} color="rgba(255,255,255,0.9)" />
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {imagesData.length > 1 && (
                  <View style={styles.paginationContainer}>
                    <Text style={styles.paginationText}>{currentIndex + 1} / {imagesData.length}</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.placeholderContainer}>
                <Text style={styles.placeholderText}>No Image</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <View style={styles.titleRow}>
          <Text style={styles.Heading} numberOfLines={1}>{item?.Name || 'Untitled Enquiry'}</Text>
          <View style={styles.badgesRow}>
            <View style={[styles.badge, { backgroundColor: getPriorityColor(priority) }]}>
              <Text style={styles.badgeText}>{priority.toUpperCase()}</Text>
            </View>
            
            <View style={[styles.badge, { backgroundColor: getStatusColor(status) }]}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {status.toUpperCase()}
                {isFinalVersion ? ' · Final Version' : ` · ${subStatus}` }
              </Text>
            </View>
            {isAdmin && (
              <TouchableOpacity style={styles.moreOptionsButton} onPress={() => setShowMoreOptions(true)}>
                <Icon name="more-vert" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        {(fullEnquiryData?.lastCad?.ReasonForRejection || fullEnquiryData?.lastCoral?.ReasonForRejection || item?.lastCad?.ReasonForRejection || item?.lastCoral?.ReasonForRejection) ? (
          <View style={{ backgroundColor: '#FEF2F2', padding: 8, borderRadius: 6, marginTop: 4, borderLeftWidth: 3, borderLeftColor: '#DC2626' , marginBottom:10}}>
            <Text style={{ fontSize: 12, fontFamily: fonts.medium, color: '#DC2626', marginBottom: 2 }}>Rejection Message</Text>
            <Text style={{ fontSize: 12, fontFamily: fonts.regular, color: '#7F1D1D' }}>
              {fullEnquiryData?.lastCad?.ReasonForRejection || fullEnquiryData?.lastCoral?.ReasonForRejection || item?.lastCad?.ReasonForRejection || item?.lastCoral?.ReasonForRejection}
            </Text>
          </View>
        ) : null}
        <View style={styles.metaRow}>
          <Icon name="person" size={12} color={colors.textSecondary} />
          <Text style={styles.metaText}>{item?.clientName || 'Unknown'}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Icon name="schedule" size={12} color={colors.textSecondary} />
          <Text style={styles.metaText}>{formatDate(item?.CreatedDate) || '—'}</Text>
          {onSummary && (
            <TouchableOpacity style={styles.summaryBtn} onPress={() => onSummary(item)} activeOpacity={0.7}>
              <Icon name="description" size={12} color={colors.primary} />
              <Text style={styles.summaryBtnText}>Summary</Text>
            </TouchableOpacity>
          )}
        </View>
        {hasAssignedUser && (
          <View style={styles.AssignedRow}>
            <Icon name="person-add" size={13} color={colors.background} />
            <Text style={styles.AssignedName} numberOfLines={1}>
              Assigned: {assignedUserName || 'User assigned'}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {isExpandedAll && (
        <View style={styles.ButtonContainer}>
          <View style={styles.remarkContainer}>
            <Text style={styles.placeholderText2} numberOfLines={isRemarkExpanded ? undefined : 2}>
              {item?.Remarks || 'No description available.'}
            </Text>
            {item?.Remarks && (item.Remarks.length > 60 || item.Remarks.includes('\n')) && (
              <TouchableOpacity
                style={styles.expandButton}
                onPress={() => setIsRemarkExpanded(v => !v)}
              >
                <Icon
                  name={isRemarkExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                  size={22}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            )}
          </View>

        {shouldShowAssignCoral ? (
          <View style={styles.QuickButtonContainer}>
            <TouchableOpacity style={styles.ChatButton} onPress={() => navigation.navigate('ChatDetail', { enquiryId: item?.id || item?._id })}>
              <Icon name="chat" size={16} color={colors.primaryDark} />
              <Text style={styles.ChatButtonText}>Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.QuickActionButton, { backgroundColor: colors.primary }]} onPress={() => { setAssignType('coral'); setSelectedAssignee(null); setAssignModalVisible(true); }}>
              <Icon name="person-add" size={16} color={colors.textWhite} />
              <View style={{ width: 4 }} />
              <Text style={styles.QuickActionButtonText}>Assign Coral</Text>
            </TouchableOpacity>
          </View>
        ) : shouldShowAssignCad ? (
          <View style={styles.QuickButtonContainer}>
            <TouchableOpacity style={styles.ChatButton} onPress={() => navigation.navigate('ChatDetail', { enquiryId: item?.id || item?._id })}>
              <Icon name="chat" size={16} color={colors.primaryDark} />
              <Text style={styles.ChatButtonText}>Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.QuickActionButton, { backgroundColor: colors.primary }]} onPress={() => { setAssignType('cad'); setSelectedAssignee(null); setAssignModalVisible(true); }}>
              <Icon name="person-add" size={16} color={colors.textWhite} />
              <View style={{ width: 4 }} />
              <Text style={styles.QuickActionButtonText}>Assign CAD</Text>
            </TouchableOpacity>
          </View>
        ) : shouldShowAdminCoralUpload ? (
          <View style={styles.QuickButtonContainer}>
            <TouchableOpacity style={styles.ChatButton} onPress={() => navigation.navigate('ChatDetail', { enquiryId: item?.id || item?._id })}>
              <Icon name="chat" size={16} color={colors.primaryDark} />
              <Text style={styles.ChatButtonText}>Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.QuickActionButton} onPress={() => navigation.navigate('UploadDesign', { enquiryId: item?.id || item?._id, designType: 'coral', enquiry: item })}>
              <Icon name="cloud-upload" size={16} color={colors.textWhite} />
              <View style={{ width: 4 }} />
              <Text style={styles.QuickActionButtonText}>Upload Coral</Text>
            </TouchableOpacity>
          </View>
        ) : shouldShowAdminCadUpload ? (
          <View style={styles.QuickButtonContainer}>
            <TouchableOpacity style={styles.ChatButton} onPress={() => navigation.navigate('ChatDetail', { enquiryId: item?.id || item?._id })}>
              <Icon name="chat" size={16} color={colors.primaryDark} />
              <Text style={styles.ChatButtonText}>Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.QuickActionButton} onPress={() => navigation.navigate('UploadDesign', { enquiryId: item?.id || item?._id, designType: 'cad', enquiry: item })}>
              <Icon name="cloud-upload" size={16} color={colors.textWhite} />
              <View style={{ width: 4 }} />
              <Text style={styles.QuickActionButtonText}>Upload CAD</Text>
            </TouchableOpacity>
          </View>
        ) : shouldShowCoralDesignerButtons ? (
          <View style={styles.QuickButtonContainer}>
            <TouchableOpacity style={styles.ChatButton} onPress={() => navigation.navigate('ChatDetail', { enquiryId: item?.id || item?._id })}>
              <Icon name="chat" size={16} color={colors.primaryDark} />
              <Text style={styles.ChatButtonText}>Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.QuickActionButton} onPress={() => navigation.navigate('UploadDesign', { enquiryId: item?.id || item?._id, designType: 'coral', enquiry: item })}>
              <Icon name="cloud-upload" size={16} color={colors.textWhite} />
              <View style={{ width: 4 }} />
              <Text style={styles.QuickActionButtonText}>Upload Coral</Text>
            </TouchableOpacity>
          </View>
        ) : shouldShowCadDesignerButtons ? (
          <View style={styles.QuickButtonContainer}>
            <TouchableOpacity style={styles.ChatButton} onPress={() => navigation.navigate('ChatDetail', { enquiryId: item?.id || item?._id })}>
              <Icon name="chat" size={16} color={colors.primaryDark} />
              <Text style={styles.ChatButtonText}>Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.QuickActionButton} onPress={async () => {
              if (has(ACTION.UPLOAD_FINAL_CAD)) {
                setIsActionLoading(true);
                try {
                  await handleUploadFinalCad(fullEnquiryData || item);
                } catch (e) {
                  console.log('[UploadFinalCAD] error setting IsFinalVersion:', e?.data?.message || e?.message);
                } finally {
                  setIsActionLoading(false);
                }
              }
              navigation.navigate('UploadDesign', { enquiryId: item?.id || item?._id, designType: 'cad', enquiry: item, isFinalVersion: has(ACTION.UPLOAD_FINAL_CAD) });
            }}>
              <Icon name="cloud-upload" size={16} color={colors.textWhite} />
              <View style={{ width: 4 }} />
              <Text style={styles.QuickActionButtonText}>{has(ACTION.UPLOAD_FINAL_CAD) ? 'Upload Final CAD' : 'Upload CAD'}</Text>
            </TouchableOpacity>
          </View>
        ) : has(ACTION.UPDATE_QUOTATION) ? (
          <View style={styles.QuickButtonContainer}>
            <TouchableOpacity style={styles.QuickActionButton} onPress={() => onViewQuotation && onViewQuotation(item)}>
              <Icon name="edit" size={16} color={colors.textWhite} />
              <View style={{ width: 4 }} />
              <Text style={styles.QuickActionButtonText}>Update Quotation</Text>
            </TouchableOpacity>
            
            {has(ACTION.REJECT_QUOTATION) && (
              <TouchableOpacity
                style={[styles.QuickActionButton, { backgroundColor: '#DC2626' }]}
                disabled={isActionLoading}
                onPress={() => { 
                  setIsRejectingQuotation(true); 
                  setActiveDesignType(currentInferredDesignType);
                  setShowQuotationActions(true); 
                  setShowReasonInput(true); 
                  setUpdateReason(''); 
                }}
              >
                <Icon name="close" size={16} color={colors.textWhite} />
                <View style={{ width: 4 }} />
                <Text style={styles.QuickActionButtonText}>Reject</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : has(ACTION.VIEW_QUOTATION) && has(ACTION.MOVE_TO_APPROVAL) ? (
          <View style={styles.QuickButtonContainer}>
            <TouchableOpacity style={styles.ChatButton} onPress={() => onViewQuotation && onViewQuotation(item)}>
              <Icon name="picture-as-pdf" size={16} color={colors.primaryDark} />
              <Text style={styles.ChatButtonText}>View Quotation</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.QuickActionButton, { backgroundColor: '#059669' }]}
              disabled={isActionLoading}
              onPress={() => {
                const targetType = (fullSrc?.CurrentStatus || item?.CurrentStatus) === STATUS.CORAL ? 'coral' : 'cad';
                showAlert(
                  'Confirm Move to Approval',
                  'Are you sure you want to move this enquiry to Approval Pending?',
                  'info',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Confirm', onPress: async () => {
                      hideAlert();
                      setIsActionLoading(true);
                      try {
                        const numericVersion = getVersionFromLast(targetType);
                        await approveDesignVersion({
                          enquiryId,
                          designType: targetType,
                          version: String(numericVersion),
                          intent: 'forApproval',
                        }).unwrap();
                        showAlert('Success', 'Enquiry moved to Approval Pending.', 'success', [{ text: 'OK' }]);
                      } catch (e) {
                        showAlert('Failed', e?.data?.message || 'Could not move to approval.', 'error', [{ text: 'OK' }]);
                      } finally {
                        setIsActionLoading(false);
                      }
                    }},
                  ]
                );
              }}
            >
              {isActionLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <><Icon name="check-circle" size={16} color={colors.textWhite} /><View style={{ width: 4 }} /><Text style={styles.QuickActionButtonText}>Move to Approval</Text></>}
            </TouchableOpacity>
          </View>
        ) : shouldShowApprovalButtons ? (
          <View style={styles.QuickButtonContainer}>
            <TouchableOpacity style={styles.ChatButton} onPress={() => onFinalLook && onFinalLook(item)}>
              <Icon name="visibility" size={16} color={colors.primaryDark} />
              <Text style={styles.ChatButtonText}>Final Look</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.QuickActionButton, { backgroundColor: '#059669' }]}
              disabled={isActionLoading}
              onPress={() => {
                const acceptData = fullEnquiryData || item;
                const src = acceptData?._originalData || acceptData;
                const itemSrc = item?._originalData || item;
                const rawCoral = src?.lastCoral || acceptData?.lastCoral || itemSrc?.lastCoral || item?.lastCoral;
                const rawCad = src?.lastCad || acceptData?.lastCad || itemSrc?.lastCad || item?.lastCad;
                const coralVersion = rawCoral && typeof rawCoral === 'object' ? String(rawCoral.Version || rawCoral.version || '') : String(rawCoral || '');
                const cadVersion = rawCad && typeof rawCad === 'object' ? String(rawCad.Version || rawCad.version || '') : String(rawCad || '');
                const versionLabel = cadVersion
                  ? `CAD Version ${cadVersion}`
                  : coralVersion
                    ? `Coral Version ${coralVersion}`
                    : '';
                const acceptMessage = versionLabel
                  ? `Accept and approve this design? (${versionLabel})`
                  : 'Accept and approve this design?';
                showAlert(
                'Confirm Accept',
                acceptMessage,
                'info',
                [
                  { text: 'Cancel', style: 'cancel' },
                   { text: 'Confirm', onPress: async () => {
                    hideAlert();
                    setIsActionLoading(true);
                    try {
                      const approvedCoral = source?.approvedCoral || src?.approvedCoral || null;
                      const approvedCad = source?.approvedCad || src?.approvedCad || null;

                      console.log('[NewCard Accept] approvedCoral:', approvedCoral, 'approvedCad:', approvedCad, 'coralVersion:', coralVersion, 'cadVersion:', cadVersion);
                      if (!approvedCoral && !approvedCad && !coralVersion && !cadVersion) {
                        showAlert('Missing Data', 'No design versions found to approve.', 'error', [{ text: 'OK' }]);
                        setIsActionLoading(false);
                        return;
                      }

                      await handleAcceptApproval(acceptData, coralVersion, cadVersion, approvedCoral, approvedCad);
                      showAlert('Accepted', 'Design accepted successfully.', 'success', [{ text: 'OK' }]);
                    } catch (e) {
                      const errDetail = e?.data
                        ? JSON.stringify(e.data)
                        : e?.message || String(e);
                      console.log('[NewCard Accept] FAILED:', errDetail);
                      showAlert('Failed', `Accept failed: ${errDetail}`, 'error', [{ text: 'OK' }]);
                    } finally {
                      setIsActionLoading(false);
                    }
                  }},
                ]
              );
              }}
            >
              {isActionLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <><Icon name="check" size={16} color={colors.textWhite} /><View style={{ width: 4 }} /><Text style={styles.QuickActionButtonText}>Accept</Text></>}
            </TouchableOpacity>
            {has(ACTION.REJECT_APPROVAL) && (
              <TouchableOpacity
                style={[styles.QuickActionButton, { backgroundColor: '#DC2626' }]}
                disabled={isActionLoading}
                onPress={() => { 
                  setActiveDesignType(currentInferredDesignType);
                  setShowQuotationActions(true); 
                  setShowReasonInput(true); 
                  setIsRejectingApproval(true); 
                  setUpdateReason(''); 
                }}
              >
                <Icon name="close" size={16} color={colors.textWhite} />
                <View style={{ width: 4 }} />
                <Text style={styles.QuickActionButtonText}>Reject</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : shouldShowFinalLookAndPlacement ? (
          <View style={styles.QuickButtonContainer}>
            <TouchableOpacity style={styles.ChatButton} onPress={() => onFinalLook && onFinalLook(item)}>
              <Icon name="visibility" size={16} color={colors.primaryDark} />
              <Text style={styles.ChatButtonText}>Final Look</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.QuickActionButton, { backgroundColor: '#059669' }]} onPress={() => {
              showAlert('Move to Order Placement', 'Move this enquiry to Order Placement?', 'info', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Confirm', onPress: async () => {
                  hideAlert();
                  setIsActionLoading(true);
                  try {
                    const enquiryData = fullEnquiryData || item;
                    console.log('[MoveToOrderPlacement] calling with enquiry id:', enquiryData?.id || enquiryData?._id, 'data:', JSON.stringify(enquiryData?._originalData?.CurrentStatus, null, 2));
                    await handleMoveToOrderPlacement(enquiryData);
                    console.log('[MoveToOrderPlacement] success');
                  } catch (e) {
                    console.log('[MoveToOrderPlacement] error:', JSON.stringify(e, null, 2));
                  } finally {
                    setIsActionLoading(false);
                  }
                }},
              ]);
            }}>
              <Icon name="shopping-cart" size={16} color={colors.textWhite} />
              <View style={{ width: 4 }} />
              <Text style={styles.QuickActionButtonText}>Move to Order</Text>
            </TouchableOpacity>
          </View>
        ) : shouldShowAdminApprovedCad ? (
          <View style={styles.QuickButtonContainer}>
            <TouchableOpacity style={styles.ChatButton} onPress={() => navigation.navigate('ChatDetail', { enquiryId: item?.id || item?._id })}>
              <Icon name="chat" size={16} color={colors.primaryDark} />
              <Text style={styles.ChatButtonText}>Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.QuickActionButton} onPress={async () => {
              setIsActionLoading(true);
              try {
                await handleUploadFinalCad(fullEnquiryData || item);
              } catch (e) {
                console.log('[UploadFinalCAD] error setting IsFinalVersion:', e?.data?.message || e?.message);
              } finally {
                setIsActionLoading(false);
              }
              navigation.navigate('UploadDesign', { enquiryId: item?.id || item?._id, designType: 'cad', enquiry: item, isFinalVersion: true });
            }}>
              <Icon name="cloud-upload" size={16} color={colors.textWhite} />
              <View style={{ width: 4 }} />
              <Text style={styles.QuickActionButtonText}>Upload Final CAD</Text>
            </TouchableOpacity>
          </View>
        ) : shouldShowAdminProduction ? (
          <View style={styles.QuickButtonContainer}>
            <TouchableOpacity style={styles.ChatButton} onPress={() => navigation.navigate('ChatDetail', { enquiryId: item?.id || item?._id })}>
              <Icon name="chat" size={16} color={colors.primaryDark} />
              <Text style={styles.ChatButtonText}>Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.QuickActionButton}
              onPress={() => showAlert(
                'Move to Shipped',
                'Are you sure you want to mark this enquiry as Shipped?',
                'warning',
                [
                  { text: 'Cancel', onPress: hideAlert },
                  { text: 'Confirm', onPress: async () => { hideAlert(); await updateEnquiryStatus({ Status: 'Shipped' }); showAlert('Shipped', 'Enquiry marked as Shipped.', 'success', [{ text: 'OK' }]); } },
                ]
              )}
            >
              <Icon name="local-shipping" size={16} color={colors.textWhite} />
              <View style={{ width: 4 }} />
              <Text style={styles.QuickActionButtonText}>Mark as Shipped</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        </View>
      )}

      <Modal
        visible={showQuotationActions}
        transparent
        animationType="slide"
        onRequestClose={closeQuotationActions}
      >
        <TouchableOpacity
          style={styles.qaOverlay}
          activeOpacity={1}
          onPress={closeQuotationActions}
        >
          <TouchableOpacity activeOpacity={1} style={styles.qaSheet}>
            <View style={styles.qaHeader}>
              <View style={styles.qaDragHandle} />
              <Text style={styles.qaTitle}>
                {showReasonInput ? 'Request a Design Update' : showCadPicker ? 'Assign CAD Designer' : 'Quotation Actions'}
              </Text>
              <Text style={styles.qaSubtitle} numberOfLines={1}>
                {item?.Name || ''}
              </Text>
            </View>

            {showCadPicker ? (
              <View style={styles.qaOptions}>
                {cadDesigners.length === 0 ? (
                  <Text style={[styles.qaOptionDesc, { textAlign: 'center', paddingVertical: 16 }]}>
                    No CAD designers found.
                  </Text>
                ) : (
                  cadDesigners.map(designer => (
                    <TouchableOpacity
                      key={designer.id}
                      style={[styles.qaOption, selectedCadDesigner?.id === designer.id && { borderColor: colors.primary, backgroundColor: colors.primaryLight || colors.background }]}
                      onPress={() => setSelectedCadDesigner(designer)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.qaIconWrap}>
                        <Icon name="person" size={20} color={selectedCadDesigner?.id === designer.id ? colors.background : colors.textSecondary} />
                      </View>
                      <View style={styles.qaOptionText}>
                        <Text style={[styles.qaOptionTitle, selectedCadDesigner?.id === designer.id && { color: colors.background }]}>
                          {designer.name}
                        </Text>
                        {!!designer.email && designer.email !== 'N/A' && (
                          <Text style={styles.qaOptionDesc}>{designer.email}</Text>
                        )}
                      </View>
                      {selectedCadDesigner?.id === designer.id && (
                        <Icon name="check-circle" size={18} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  ))
                )}
                <TouchableOpacity
                  style={[styles.QuickActionButton, { marginTop: 8, justifyContent: 'center', opacity: (!selectedCadDesigner || isActionLoading) ? 0.4 : 1 }]}
                  onPress={() => handleApproveWithDesigner(selectedCadDesigner)}
                  disabled={!selectedCadDesigner || isActionLoading}
                  activeOpacity={0.8}
                >
                  {isActionLoading
                    ? <ActivityIndicator size="small" color={colors.textWhite} />
                    : <Text style={styles.QuickActionButtonText}>Confirm & Approve</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.qaOption, { marginTop: 4, justifyContent: 'center' }]}
                  onPress={() => { setShowCadPicker(false); setSelectedCadDesigner(null); }}
                  disabled={isActionLoading}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.qaOptionTitle, { textAlign: 'center' }]}>Back</Text>
                </TouchableOpacity>
              </View>
            ) : !showReasonInput ? (
              <View style={styles.qaOptions}>
                {isFetchingEnquiry && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingBottom: 4 }}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.textSecondary }}>Loading design info...</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.qaOption}
                  onPress={isApprovalPending
                    ? async () => {
                        setIsActionLoading(true);
                        try {
                          await updateEnquiryStatus({ Status: 'Order Placement' });
                          setShowQuotationActions(false);
                        } catch (e) {
                          showAlert('Failed', e?.data?.message || 'Could not move to Order Placement.', 'error', [{ text: 'OK' }]);
                        } finally {
                          setIsActionLoading(false);
                        }
                      }
                    : handleApprove}
                  disabled={isActionLoading}
                  activeOpacity={0.8}
                >
                  {isActionLoading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <View style={styles.qaIconWrap}>
                        <Icon name="check-circle" size={20} color={colors.primary} />
                      </View>
                      <View style={styles.qaOptionText}>
                        <Text style={styles.qaOptionTitle}>
                          {isApprovalPending ? 'Move to Order Placement' : 'Approve'}
                        </Text>
                        <Text style={styles.qaOptionDesc}>
                          {isApprovalPending
                            ? 'Client has approved — proceed to Order Placement'
                            : 'Mark this version as approved and move to next stage'}
                        </Text>
                      </View>
                      <Icon name="chevron-right" size={18} color={colors.textSecondary} />
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.qaOption}
                  onPress={() => {
                    setActiveDesignType(currentInferredDesignType);
                    setShowReasonInput(true);
                  }}
                  disabled={isActionLoading}
                  activeOpacity={0.8}
                >
                  <>
                    <View style={styles.qaIconWrap}>
                      <Icon name="edit" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.qaOptionText}>
                      <Text style={styles.qaOptionTitle}>Update</Text>
                      <Text style={styles.qaOptionDesc}>Request a new version with changes — provide a reason</Text>
                    </View>
                    <Icon name="chevron-right" size={18} color={colors.textSecondary} />
                  </>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.qaOption, { opacity: 0.35 }]}
                  disabled
                  activeOpacity={0.8}
                >
                  <>
                    <View style={styles.qaIconWrap}>
                      <Icon name="cancel" size={20} color={colors.textSecondary} />
                    </View>
                    <View style={styles.qaOptionText}>
                      <Text style={styles.qaOptionTitle}>Cancel Order</Text>
                      <Text style={styles.qaOptionDesc}>Cancel this enquiry order</Text>
                    </View>
                    <Text style={styles.qaBadge}>Soon</Text>
                  </>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.qaReasonWrap}>
                <Text style={styles.qaReasonLabel}>
                  What changes are needed?
                </Text>
                <TextInput
                  style={styles.qaReasonInput}
                  value={updateReason}
                  onChangeText={setUpdateReason}
                  placeholder="Add a reason to update the version..."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  numberOfLines={4}
                  autoFocus
                />
                <View style={styles.qaReasonActions}>
                  <TouchableOpacity
                    style={styles.qaReasonBack}
                    onPress={() => { setShowReasonInput(false); setUpdateReason(''); setIsRejectingQuotation(false); setIsRejectingApproval(false); }}
                    onPress={() => { setShowReasonInput(false); setUpdateReason(''); setIsRejectingQuotation(false); setIsRejectingApproval(false); }}
                    disabled={isActionLoading}
                    activeOpacity={0.8}
                  >
                    <Icon name="arrow-back" size={16} color="#6B7280" />
                    <Text style={styles.qaReasonBackText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.qaReasonSubmit,
                      (!updateReason.trim() || isActionLoading) && { opacity: 0.4 },
                    ]}
                    onPress={isRejectingQuotation ? handleRejectQuotation : isRejectingApproval ? handleRejectApproval : handleRequestUpdate}
                    onPress={isRejectingQuotation ? handleRejectQuotation : isRejectingApproval ? handleRejectApproval : handleRequestUpdate}
                    disabled={!updateReason.trim() || isActionLoading}
                    activeOpacity={0.8}
                  >
                    {isActionLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Icon name="send" size={15} color="#fff" />
                        <View style={{ width: 4 }} />
                        <Text style={styles.qaReasonSubmitText}>Send Request</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity style={styles.qaDismiss} onPress={closeQuotationActions} activeOpacity={0.7}>
              <Text style={styles.qaDismissText}>Dismiss</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showMoreOptions}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMoreOptions(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowMoreOptions(false)}
        >
          <View style={styles.dropdownModalContent}>
            <Text style={styles.dropdownModalTitle}>Options</Text>
            {onSummary && (
              <TouchableOpacity
                style={styles.dropdownModalItem}
                onPress={() => { setShowMoreOptions(false); onSummary(item); }}
              >
                <Text style={styles.dropdownModalItemText}>View Summary</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.dropdownModalItem}
              onPress={handleDeleteEnquiry}
              disabled={isDeleting}
            >
              <Text style={[styles.dropdownModalItemText, { color: colors.error }]}>
                {isDeleting ? 'Deleting...' : 'Delete Enquiry'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={isImageModalVisible} transparent animationType="fade" onRequestClose={closeImageModal}>
        <View style={styles.fullscreenImageBackdrop}>
          <TouchableOpacity style={styles.fullscreenImageCloseButton} onPress={closeImageModal} activeOpacity={0.7}>
            <Icon name="close" size={24} color={colors.textWhite} />
          </TouchableOpacity>
          {imagesData.length > 1 && (
            <View style={styles.modalImageCounter}>
              <Text style={styles.modalImageCounterText}>{modalCurrentIndex + 1} / {imagesData.length}</Text>
            </View>
          )}
          <FlatList
            ref={modalFlatListRef}
            data={imagesData}
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            initialScrollIndex={modalCurrentIndex}
            getItemLayout={(_, index) => ({ length: screenWidth, offset: screenWidth * index, index })}
            onMomentumScrollEnd={e => {
              const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
              setModalCurrentIndex(index);
              setZoomedImageIndex(null);
            }}
            scrollEventThrottle={16}
            scrollEnabled={zoomedImageIndex === null}
            keyExtractor={(_, index) => `modal-img-${index}`}
            renderItem={({ item: media, index }) => (
              <View style={styles.modalImageContainer}>
                {media.isVideo ? (
                  <ModalVideoItem uri={media.uri} />
                ) : (
                  <TouchableOpacity activeOpacity={1} onPress={() => handleDoubleTap(index)} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <Image source={{ uri: media.uri }} style={[styles.fullscreenImage, zoomedImageIndex === index && styles.fullscreenImageZoomed]} resizeMode="contain" />
                  </TouchableOpacity>
                )}
                {!media.isVideo && zoomedImageIndex === index && (
                  <View style={styles.zoomHintContainer}>
                    <Text style={styles.zoomHintText}>Tap again to zoom out</Text>
                  </View>
                )}
              </View>
            )}
          />
        </View>
      </Modal>

      <Modal
        visible={assignModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAssignModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.qaOverlay}
          activeOpacity={1}
          onPress={() => setAssignModalVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.qaSheet}>
            <View style={styles.qaHeader}>
              <View style={styles.qaDragHandle} />
              <TouchableOpacity
                style={{ position: 'absolute', top: 12, right: 16, zIndex: 10, padding: 4 }}
                onPress={() => setAssignModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={styles.qaTitle}>
                {assignType === 'coral' ? 'Assign Coral Designer' : 'Assign CAD Designer'}
              </Text>
              <Text style={styles.qaSubtitle} numberOfLines={1}>
                {item?.Name || ''}
              </Text>
            </View>

            <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={styles.qaOptions}>
              {(assignType === 'coral' ? coralDesigners : cadDesigners).length === 0 ? (
                <Text style={[styles.qaOptionDesc, { textAlign: 'center', paddingVertical: 16 }]}>
                  No {assignType === 'coral' ? 'Coral' : 'CAD'} designers found.
                </Text>
              ) : (
                (assignType === 'coral' ? coralDesigners : cadDesigners).map(designer => (
                  <TouchableOpacity
                    key={designer.id}
                    style={[styles.qaOption, selectedAssignee?.id === designer.id && { borderColor: colors.primary, backgroundColor: colors.primaryExtraLight }]}
                    onPress={() => setSelectedAssignee(designer)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.qaIconWrap}>
                      <Icon name="person" size={20} color={selectedAssignee?.id === designer.id ? colors.primary : colors.textSecondary} />
                    </View>
                    <View style={styles.qaOptionText}>
                      <Text style={[styles.qaOptionTitle, selectedAssignee?.id === designer.id && { color: colors.primary }]}>
                        {designer.name}
                      </Text>
                      {!!designer.email && designer.email !== 'N/A' && (
                        <Text style={styles.qaOptionDesc}>{designer.email}</Text>
                      )}
                    </View>
                    {selectedAssignee?.id === designer.id && (
                      <Icon name="check-circle" size={18} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                ))
              )}
              <TouchableOpacity
                style={[styles.QuickActionButton, { justifyContent: 'center', opacity: (!selectedAssignee || isAssigning) ? 0.4 : 1 }]}
                onPress={handleConfirmAssign}
                disabled={!selectedAssignee || isAssigning}
                activeOpacity={0.8}
              >
                {isAssigning
                  ? <ActivityIndicator size="small" color={colors.textWhite} />
                  : <Text style={styles.QuickActionButtonText}>Confirm & Assign</Text>
                }
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <BrandedAlert
        visible={alertCfg.visible}
        title={alertCfg.title}
        message={alertCfg.message}
        type={alertCfg.type}
        buttons={alertCfg.buttons}
        onClose={hideAlert}
      />
    </View>
  );
}

const getStatusColor = status => {
  const statusColors = {
    'enquiry created': '#F59E0B',
    'coral': '#8B5CF6',
    'cad': '#3B82F6',
    'approved cad': '#10B981',
    'quotation': '#0EA5E9',
    'design approval pending': '#F97316',
    'order placement': '#6366F1',
    'production': '#D97706',
    'shipped': '#059669',
    'completed': '#10B981',
    'rejected': '#EF4444',
    pending: '#F59E0B',
    approval_pending: '#F97316',
    approved_cad: '#10B981',
    cad: '#3B82F6',
    coral: '#8B5CF6',
    order_placement: '#6366F1',
    production: '#D97706',
    shipped: '#059669',
    in_progress: '#6B7280',
  };
  return statusColors[status] || '#6B7280';
};

const getPriorityColor = priority => {
  const priorityColors = {
    high: '#EF4444',
    medium: '#F59E0B',
    low: '#10B981',
  };
  return priorityColors[priority] || '#6B7280';
};

const formatDate = dateString => {
  const date = new Date(dateString);
  const now = new Date();
  const diffInMs = now - date;
  const diffInMins = Math.floor(diffInMs / (1000 * 60));
  const diffInHrs = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInMins < 60) {
    return `${diffInMins} mins ago`;
  } else if (diffInHrs < 24) {
    return `${diffInHrs} hrs ago`;
  } else {
    return `${diffInDays} days ago`;
  }
};

const styles = StyleSheet.create({
  mainContainer: {
    backgroundColor: colors.cardBackground,
    borderRadius: 10,
    marginHorizontal: 10,
    marginBottom: 8,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    color: colors.textWhite,
    fontFamily: fonts.medium,
  },
  Heading: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
    marginRight: 6,
  },
  remarkText: {
    fontSize: 12,
    color: colors.textLight,
    fontFamily: fonts.regular,
    marginBottom: 6,
    lineHeight: 16,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  metaText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
  },
  metaDot: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  summaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  summaryBtnText: {
    fontSize: 10,
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  summaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  summaryBtnText: {
    fontSize: 10,
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  assignedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  assignedChipText: {
    fontSize: 10,
    color: colors.background,
    fontFamily: fonts.medium,
  },
  moreOptionsButton: {
    padding: 2,
    marginLeft: 5,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 5,
    paddingHorizontal: 4,
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  toggleTrack: { width: 36, height: 20, borderRadius: 10, backgroundColor: colors.border, justifyContent: 'center', paddingHorizontal: 2 },
  toggleTrackOn: { backgroundColor: colors.primary },
  toggleThumb: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', elevation: 2, alignSelf: 'flex-start' },
  toggleThumbOn: { alignSelf: 'flex-end' },
  ImageContainer: { width: '100%', padding: 10 },
  StatusContainerStart: { marginTop: 5, flexDirection: 'row', justifyContent: 'space-between', marginLeft: 5 },
  PriortyContainer: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, flexShrink: 1, maxWidth: '45%' },
  PriorityText: { fontSize: 12, color: colors.textWhite, fontFamily: fonts.regular },
  statusContainer: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, flexShrink: 1, maxWidth: 120 },
  StatusText: { fontSize: 12, color: colors.textWhite, fontFamily: fonts.regular },
  StatusContainerEnd: { marginRight: 5, flexDirection: 'row', alignItems: 'center', flexShrink: 1, maxWidth: '55%' },
  loadingContainer: { width: '100%', height: 200, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.backgroundSecondary },
  placeholderContainer: { width: '100%', height: 200, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.backgroundSecondary },
  placeholderText: { fontSize: 14, color: colors.textLight, fontFamily: fonts.regular, paddingHorizontal: 10 },
  carouselContainer: { width: '100%', height: 200, position: 'relative' },
  carouselImage: { width: Dimensions.get('window').width - 60, height: 200, marginRight: 3, overflow: 'hidden', backgroundColor: '#000' },
  carouselPlayOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  paginationContainer: { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  paginationText: { fontSize: 12, color: colors.textWhite, fontFamily: fonts.medium },
  ButtonContainer: { borderTopColor: colors.border, borderTopWidth: 1, marginTop: 10, paddingTop: 8, flexDirection: 'column' },
  remarkContainer: {
    marginBottom: 8,
  },
  placeholderText2: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  expandButton: {
    alignSelf: 'flex-end',
    marginTop: 2,
    padding: 2,
  },
  ClientTimeContainer: { flexDirection: 'row', marginBottom: 5, justifyContent: 'space-between' },
  ClientRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  TimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ClientName: { fontFamily: fonts.medium, fontSize: 14, color: colors.textSecondary },
  ClientTime: { fontFamily: fonts.regular, fontSize: 12, color: colors.textSecondary },
  AssignedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: colors.primary, borderRadius: 6, alignSelf: 'flex-start', marginBottom: 9 },
  AssignedName: { fontFamily: fonts.medium, fontSize: 12, color: colors.textWhite, flexShrink: 1 },
  QuickButtonContainer: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  ChatButton: { flex: 1, backgroundColor: colors.background, borderColor: colors.primaryDark, borderWidth: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, borderRadius: 5, paddingVertical: 8, paddingHorizontal: 12 },
  ChatButtonText: { fontFamily: fonts.medium, fontSize: 14, color: colors.primaryDark },
  QuickActionButton: { flex: 1, backgroundColor: colors.primaryDark, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, borderRadius: 5, paddingVertical: 8, paddingHorizontal: 12 },
  QuickActionButtonText: { fontFamily: fonts.medium, fontSize: 14, color: colors.textWhite, textAlign: 'center' },
  DropdownButton: { flex: 1, backgroundColor: colors.background, borderColor: colors.primaryDark, borderWidth: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, borderRadius: 5, paddingVertical: 8, paddingHorizontal: 8 },
  DropdownButtonText: { fontFamily: fonts.medium, fontSize: 13, color: colors.primaryDark },
  ActionButton: { flex: 1, backgroundColor: colors.primaryDark, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, borderRadius: 5, paddingVertical: 8, paddingHorizontal: 8 },
  ActionButtonText: { fontFamily: fonts.medium, fontSize: 13, color: colors.textWhite },
  fullscreenImageBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  fullscreenImageCloseButton: { position: 'absolute', top: 40, right: 20, padding: 12, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1000 },
  modalImageCounter: { position: 'absolute', top: 50, left: 20, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, zIndex: 10 },
  modalImageCounterText: { color: colors.textWhite, fontSize: 14, fontFamily: fonts.medium },
  modalImageContainer: { width: Dimensions.get('window').width, height: Dimensions.get('window').height, justifyContent: 'center', alignItems: 'center' },
  fullscreenImage: { width: Dimensions.get('window').width, height: Dimensions.get('window').height * 0.8 },
  fullscreenImageZoomed: { width: Dimensions.get('window').width * 2.5, height: Dimensions.get('window').height * 2.5 },
  zoomHintContainer: { position: 'absolute', bottom: 100, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  zoomHintText: { color: colors.textWhite, fontSize: 12, fontFamily: fonts.medium },
  modalVideoPlayOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownModalContent: {
    backgroundColor: colors.cardBackground,
    borderRadius: 10,
    padding: 20,
    width: '80%',
    maxWidth: 300,
  },
  dropdownModalTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 12,
    textAlign: 'center',
  },
  dropdownModalItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 5,
    backgroundColor: colors.background,
    marginBottom: 8,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  dropdownModalItemText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  qaOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  qaSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  qaHeader: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  qaDragHandle: {
    width: 36, height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginBottom: 10,
  },
  qaTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  qaSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  qaOptions: {
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 10,
  },
  qaOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  qaIconWrap: {
    width: 36, height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qaOptionText: {
    flex: 1,
  },
  qaOptionTitle: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  qaOptionDesc: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 15,
  },
  qaBadge: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: colors.textSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  qaReasonWrap: {
    padding: 20,
    gap: 12,
  },
  qaReasonLabel: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  qaReasonInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    minHeight: 110,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  qaReasonActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  qaReasonBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qaReasonBackText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.textSecondary,
  },
  qaReasonSubmit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  qaReasonSubmitText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.textWhite,
  },
  qaDismiss: {
    alignSelf: 'center',
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  qaDismissText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.textSecondary,
  },
});