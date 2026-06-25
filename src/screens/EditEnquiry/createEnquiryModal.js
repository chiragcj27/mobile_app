import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Text,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView, Platform,
  TextInput,
} from 'react-native';
import { Input, Button } from '../../components/common';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import IconComponent from '../../components/common/Icon';
import {
  useGetUsersQuery,
  useGetRolesQuery,
  useGetStoneTypesQuery,
  useParseEnquiryMutation,
  useSubmitEnquiryMutation,
} from '../../store/api';
import { useClients } from '../../features/clients/clientsHooks';
import { useAuth } from '../../context/AuthContext';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import BrandedAlert from '../../components/common/BrandedAlert';
import { useSelector } from 'react-redux';


export default function CreateEnquiryModal({ visible, onClose, onEnquiryCreated, onUpdate, route }) {
  const { user } = useAuth();
  const [parseEnquiry, { isLoading: isParsing }] = useParseEnquiryMutation();
  const [submitEnquiry, { isLoading: isSubmitting }] = useSubmitEnquiryMutation();
  const { clients: clientsData = [] } = useClients({ skip: false });
  const clients = Array.isArray(clientsData) ? clientsData : [];
  const { data: stoneTypesData = [] } = useGetStoneTypesQuery();
  const { data: usersData = [] } = useGetUsersQuery();
  const { data: rolesData = [] } = useGetRolesQuery();

  const roleLower = user?.role?.toLowerCase();
  const isClient = roleLower === 'client' || roleLower === 'cl' || user?.roleId === 4 || user?.roleNumber === 4;

  const reduxFilters = useSelector(state => state.enquiries?.filters);
  const reduxSelectedClient = useSelector(state => state.enquiries?.selectedClient);
  const preSelectedClientId = route?.params?.clientId || reduxFilters?.clientId || null;
  const preSelectedClientIdResolved = preSelectedClientId && preSelectedClientId !== 'all' ? preSelectedClientId : null;
  const preSelectedClientName = route?.params?.clientName || route?.params?.filter || (reduxSelectedClient && reduxSelectedClient !== 'All' ? reduxSelectedClient : null) || (preSelectedClientIdResolved ? clients.find(c => (c.id || c._id) === preSelectedClientIdResolved)?.name : null) || null;

  const [projectType, setProjectType] = useState('coral');
  const [assignedTo, setAssignedTo] = useState(null); // { id, name }
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [enquiryDescription, setEnquiryDescription] = useState('');
  const [referenceImages, setReferenceImages] = useState([]);
  const [textSubmitted, setTextSubmitted] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [dynamicMissingFields, setDynamicMissingFields] = useState([]);
  const [missingFieldsData, setMissingFieldsData] = useState({});
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [createdEnquiryData, setCreatedEnquiryData] = useState(null);
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  const showAlert = (title, message, type = 'info', buttons = []) =>
    setAlertConfig({ visible: true, title, message, type, buttons });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));

  // Auto-derive status from parsed data
  const autoStatus = String(parsedData?.Status || 'Enquiry Created');

  // Dynamically filter users based on the status returned by AI parsing.
  // 1. Match the status name against the roles API to get the target role.
  // 2. Filter users whose role matches that role code/name.
  // 3. Fallback: show all non-client users when no role match is found.
  const filteredUsers = useMemo(() => {
    const allUsers = Array.isArray(usersData) ? usersData : (usersData?.users || usersData?.data || []);
    if (!allUsers.length) return [];

    const statusLower = String(autoStatus).toLowerCase().trim();
    console.log('🎯 [CreateEnquiry] Auto Status from parsed data:', autoStatus);
    console.log('🔍 [CreateEnquiry] Roles from API:', rolesData);

    // Try to find a role in the roles API that matches the status name
    const matchedRole = Array.isArray(rolesData)
      ? rolesData.find(r => {
          const rName = String(r.name || '').toLowerCase().trim();
          const rCode = String(r.code || '').toLowerCase().trim();
          return rName === statusLower ||
            rCode === statusLower ||
            statusLower.includes(rName) ||
            rName.includes(statusLower.replace(/\s+/g, ''));
        })
      : null;

    const filtered = allUsers.filter(u => {
      const uRoleRaw  = u.role || u.Role || u.roleId || u.RoleId || '';
      const uRoleStr  = String(uRoleRaw).toLowerCase().trim();

      // Exclude client-role users from assignment (by name, code, or id)
      if (uRoleStr === 'client' || uRoleStr === 'cl' || uRoleStr === '4') return false;

      if (matchedRole) {
        const mName = String(matchedRole.name || '').toLowerCase().trim();
        const mCode = String(matchedRole.code || '').toLowerCase().trim();
        const mId   = String(matchedRole.id   || '').trim();
        // Match by role name, code, or numeric id — covers all API storage formats
        return uRoleStr === mName || uRoleStr === mCode || uRoleStr === mId;
      }

      // No role match → show all non-client users
      return true;
    });

    console.log('👥 [CreateEnquiry] Matched role:', matchedRole || 'none (showing all)');
    console.log('👤 [CreateEnquiry] Filtered members for assign:', filtered.map(u => ({
      id: u.id || u._id,
      name: String(u.name || u.Name || '?'),
      role: String(u.role || u.Role || ''),
    })));
    console.log('🔎 [CreateEnquiry] Raw user roles (first 5):', allUsers.slice(0, 5).map(u => ({
      name: String(u.name || u.Name || '?'),
      role: u.role, Role: u.Role, roleId: u.roleId, RoleId: u.RoleId,
    })));
    return filtered;
  }, [usersData, rolesData, autoStatus]);

  useEffect(() => {
    if (visible) {
      console.log('CreateEnquiryModal - clientId:', preSelectedClientIdResolved, 'clientName:', preSelectedClientName);
    }
    if (!visible) {
      setProjectType('coral');
      setAssignedTo(null);
      setShowAssignModal(false);
      setEnquiryDescription('');
      setReferenceImages([]);
      setTextSubmitted(false);
      setParsedData(null);
      setDynamicMissingFields([]);
      setMissingFieldsData({});
      setShowConfirmModal(false);
      setShowPreviewModal(false);
      setCreatedEnquiryData(null);
    }
  }, [visible]);

  const handleImagePicker = async () => {
    const result = await launchImageLibrary({ mediaType: 'mixed', selectionLimit: 10 });
    if (result.assets) {
      setReferenceImages(prev => [
        ...prev,
        ...result.assets.map(a => ({ uri: a.uri, name: a.fileName, type: a.type })),
      ]);
    }
  };

  const handleCamera = async () => {
    const result = await launchCamera({ mediaType: 'photo', quality: 0.8, saveToPhotos: true });
    if (result.assets?.length > 0) {
      const a = result.assets[0];
      setReferenceImages(prev => [
        ...prev,
        { uri: a.uri, type: a.type || 'image/jpeg', name: a.fileName || `camera_${Date.now()}.jpg` },
      ]);
    }
  };

  const handleTextSubmit = async () => {
    try {
      const result = await parseEnquiry({
        message: enquiryDescription,
        mediaType: projectType,
      }).unwrap();
      setParsedData(result.parsed);
      const missing = (result.missingFields || []).filter(f => f.field !== 'ClientId');
      setDynamicMissingFields(missing);
      if (preSelectedClientIdResolved) {
        setMissingFieldsData(prev => ({ ...prev, ClientId: preSelectedClientIdResolved }));
      }
      setTextSubmitted(true);
    } catch (error) {
      showAlert(
        'Parsing Failed',
        'AI parsing failed. Would you like to fill the form manually?',
        'warning',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Fill Manually',
            onPress: () => {
              setTextSubmitted(true);
              setParsedData(null);
              setDynamicMissingFields([]);
              if (preSelectedClientIdResolved) {
                setMissingFieldsData(prev => ({ ...prev, ClientId: preSelectedClientIdResolved }));
              }
            },
          },
        ]
      );
    }
  };

  const handleSubmit = async () => {
    if (!user?.id) {
      showAlert('Error', 'User not found. Please login again.', 'error');
      return;
    }

    // Validation: check all required fields are filled
    const isAIParsingFlow = textSubmitted && parsedData !== null;
    const name = isAIParsingFlow ? (missingFieldsData.Name || parsedData?.Name || '').trim() : '';

    // Check if name is filled
    if (isAIParsingFlow && !name) {
      showAlert('Missing Field', 'Please enter a name for the enquiry.', 'warning');
      return;
    }

    // Check if all dynamic missing fields are filled
    if (isAIParsingFlow && dynamicMissingFields.length > 0) {
      const unfilled = dynamicMissingFields.find(field => {
        const value = missingFieldsData[field.field];
        return value === undefined || value === null || value === '';
      });
      if (unfilled) {
        showAlert('Missing Field', `Please fill in: ${unfilled.label}`, 'warning');
        return;
      }
    }

    try {
      const isAIParsingFlow = textSubmitted && parsedData !== null;
      let finalData;

      if (isAIParsingFlow) {
        finalData = {
          Name: missingFieldsData.Name || parsedData?.Name || '',
          ClientId: preSelectedClientIdResolved || missingFieldsData.ClientId || parsedData?.ClientId || (isClient ? user.clientId || user.id : user.id),
          AssignedTo: assignedTo?.id || missingFieldsData.AssignedTo || parsedData?.AssignedTo || null,
          Status: missingFieldsData.Status || parsedData?.Status || 'Enquiry Created',
          Priority: missingFieldsData.Priority || parsedData?.Priority || 'Normal',
          Quantity: missingFieldsData.Quantity || parsedData?.Quantity || 1,
          Metal: {
            Color: missingFieldsData.MetalColor || parsedData?.Metal?.Color || null,
            Quality: missingFieldsData.MetalQuality || parsedData?.Metal?.Quality || '10K',
          },
          StoneType: missingFieldsData.StoneType || parsedData?.StoneType || null,
          Stamping: missingFieldsData.Stamping || parsedData?.Stamping || null,
          Remarks: missingFieldsData.Remarks || parsedData?.Remarks || '',
          Category: missingFieldsData.Category || parsedData?.Category || 'Ring',
          Budget: missingFieldsData.Budget || parsedData?.Budget || null,
          SpecialRemarks: missingFieldsData.SpecialRemarks || parsedData?.SpecialRemarks || null,
          StyleNumber: missingFieldsData.StyleNumber || parsedData?.StyleNumber || null,
          GatiOrderNumber: missingFieldsData.GatiOrderNumber || parsedData?.GatiOrderNumber || null,
          ShippingDate: missingFieldsData.ShippingDate || parsedData?.ShippingDate || null,
          CoralCode: missingFieldsData.CoralCode || parsedData?.CoralCode || null,
          CadCode: missingFieldsData.CadCode || parsedData?.CadCode || null,
          ApprovedDate: missingFieldsData.ApprovedDate || parsedData?.ApprovedDate || null,
        };

        if (missingFieldsData.MetalWeightFrom || missingFieldsData.MetalWeightTo || missingFieldsData.MetalWeightExact) {
          finalData.MetalWeight = {
            From: missingFieldsData.MetalWeightFrom || null,
            To: missingFieldsData.MetalWeightTo || null,
            Exact: missingFieldsData.MetalWeightExact || null,
          };
        }
        if (missingFieldsData.DiamondWeightFrom || missingFieldsData.DiamondWeightTo || missingFieldsData.DiamondWeightExact) {
          finalData.DiamondWeight = {
            From: missingFieldsData.DiamondWeightFrom || null,
            To: missingFieldsData.DiamondWeightTo || null,
            Exact: missingFieldsData.DiamondWeightExact || null,
          };
        }
      } else {
        finalData = {
          Name: '',
          ClientId: preSelectedClientIdResolved || user.clientId || user.id,
          AssignedTo: assignedTo?.id || null,
          Status: 'Enquiry Created',
          Priority: 'Normal',
          Quantity: 1,
          Metal: { Color: null, Quality: '10K' },
          StoneType: null,
          Stamping: null,
          Remarks: '',
          Category: 'Ring',
          Budget: null,
          SpecialRemarks: null,
          StyleNumber: null,
          GatiOrderNumber: null,
          ShippingDate: null,
          CoralCode: null,
          CadCode: null,
          ApprovedDate: null,
        };
      }

      // If a designer was assigned, override status and set substatus so the
      // backend creates the enquiry in the correct state (Coral/Cad + Assigned).
      if (finalData.AssignedTo) {
        const isCoralAssign = projectType === 'coral';
        finalData.Status = isCoralAssign ? 'Coral' : 'Cad';
        finalData.CurrentSubStatus = 'Assigned';
        finalData.SubStatus = 'Assigned';
      }

      // Preview shows BEFORE submission so the user can review and Cancel without
      // creating anything on the server. Continue → handleConfirmCreate fires the API.
      setCreatedEnquiryData({ id: null, data: finalData });
      setShowPreviewModal(true);
    } catch (error) {
      showAlert('Error', 'Failed to prepare enquiry. Please try again.', 'error');
    }
  };

  const handleConfirmCreate = async () => {
    const finalData = createdEnquiryData?.data;
    if (!finalData) return;
    try {
      const result = await submitEnquiry({
        data: finalData,
        referenceImages: referenceImages,
      }).unwrap();
      const enquiryId = result?.id || result?._id || result?.data?.id || result?.data?._id || result?.enquiry?.id || result?.enquiry?._id || result?.insertedId;
      setShowPreviewModal(false);
      onClose();
      if (onEnquiryCreated) onEnquiryCreated(enquiryId, finalData);
    } catch (error) {
      showAlert('Error', 'Failed to create enquiry. Please try again.', 'error');
    }
  };

  const renderPreviewDetails = (data, s) => {
    const clientName = clients.find(c => (c.id || c._id) === data.ClientId)?.name || data.ClientId;
    const rows = [
      { label: 'Name', value: data.Name },
      { label: 'Client', value: clientName },
      { label: 'Status', value: data.Status },
      { label: 'Priority', value: data.Priority },
      { label: 'Category', value: data.Category },
      { label: 'Quantity', value: data.Quantity },
      { label: 'Metal Color', value: data.Metal?.Color },
      { label: 'Metal Quality', value: data.Metal?.Quality },
      { label: 'Stone Type', value: data.StoneType },
      { label: 'Stamping', value: data.Stamping },
      { label: 'Budget', value: data.Budget },
      { label: 'Remarks', value: data.Remarks },
      { label: 'Special Remarks', value: data.SpecialRemarks },
      { label: 'Style Number', value: data.StyleNumber },
      { label: 'Gati Order No', value: data.GatiOrderNumber },
      { label: 'Shipping Date', value: data.ShippingDate },
      { label: 'Coral Code', value: data.CoralCode },
      { label: 'Cad Code', value: data.CadCode },
      { label: 'Approved Date', value: data.ApprovedDate },
    ];
    if (data.MetalWeight) {
      rows.push({ label: 'Metal Weight', value: [data.MetalWeight.From, data.MetalWeight.To, data.MetalWeight.Exact].filter(Boolean).join(' / ') });
    }
    if (data.DiamondWeight) {
      rows.push({ label: 'Diamond Weight', value: [data.DiamondWeight.From, data.DiamondWeight.To, data.DiamondWeight.Exact].filter(Boolean).join(' / ') });
    }
    return rows.filter(r => r.value).map((r, i) => (
      <View key={i} style={s.previewDetailRow}>
        <Text style={s.previewDetailLabel}>{r.label}</Text>
        <Text style={s.previewDetailValue}>{String(r.value)}</Text>
      </View>
    ));
  };

  const renderMissingFields = () => {
    if (dynamicMissingFields.length === 0) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Complete Missing Details</Text>
        {dynamicMissingFields.map((item, index) => {
          if (item.field === 'ClientId' && item.options.length > 0) {
            return (
              <View key={index} style={styles.tileGroup}>
                <Text style={styles.dropdownLabel}>{item.label}</Text>
                <View style={styles.chipRowWrap}>
                  {item.options.map(option => {
                    const selected = missingFieldsData[item.field] === option.value;
                    const clientName = clients.find(c => (c.id || c._id) === option.value)?.name || option.label;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[styles.choiceChip, selected && styles.choiceChipActive]}
                        activeOpacity={0.85}
                        onPress={() => setMissingFieldsData(prev => ({ ...prev, [item.field]: option.value }))}
                      >
                        <Text style={[styles.choiceChipLabel, selected && styles.choiceChipLabelActive]}>{clientName}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          } else if (item.options.length > 0) {
            return (
              <View key={index} style={styles.tileGroup}>
                <Text style={styles.dropdownLabel}>{item.label}</Text>
                <View style={styles.chipRowWrap}>
                  {item.options.map(option => {
                    const selected = missingFieldsData[item.field] === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[styles.choiceChip, selected && styles.choiceChipActive]}
                        activeOpacity={0.85}
                        onPress={() => setMissingFieldsData(prev => ({ ...prev, [item.field]: option.value }))}
                      >
                        <Text style={[styles.choiceChipLabel, selected && styles.choiceChipLabelActive]}>{option.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          } else {
            return (
              <View key={index} style={styles.formRow}>
                <View style={[styles.formField, styles.fullWidthField]}>
                  <Input
                    label={item.label}
                    placeholder={`Enter ${item.label.toLowerCase()}`}
                    value={missingFieldsData[item.field] || ''}
                    onChangeText={value => setMissingFieldsData(prev => ({ ...prev, [item.field]: value }))}
                  />
                </View>
              </View>
            );
          }
        })}
      </View>
    );
  };

  const renderParsedPreview = () => {
    if (!parsedData) return null;
    const displayClientName = preSelectedClientName;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Extracted Details</Text>
        <View style={styles.parsedDataCard}>
          <Text style={styles.parsedDataLabel}>Name:</Text>
          <TextInput style={[styles.parsedDataLabel, styles.editableField]} value={missingFieldsData.Name !== undefined ? missingFieldsData.Name : (parsedData.Name || '')} onChangeText={value => setMissingFieldsData(prev => ({ ...prev, Name: value }))} placeholder="Name" />
          {!isClient && <Text style={styles.parsedDataLabel}>Client: <Text style={styles.parsedDataValue}>{displayClientName}</Text></Text>}
          <Text style={styles.parsedDataLabel}>Category: <Text style={styles.parsedDataValue}>{parsedData.Category || 'Not specified'}</Text></Text>
          <Text style={styles.parsedDataLabel}>Metal: <Text style={styles.parsedDataValue}>{parsedData.Metal?.Quality || ''} {parsedData.Metal?.Color || ''}</Text></Text>
          <Text style={styles.parsedDataLabel}>Stone Type: <Text style={styles.parsedDataValue}>{parsedData.StoneType || 'Not specified'}</Text></Text>
          <Text style={styles.parsedDataLabel}>Priority: <Text style={styles.parsedDataValue}>{parsedData.Priority || 'Normal'}</Text></Text>
          <Text style={styles.parsedDataLabel}>Status: <Text style={styles.parsedDataValue}>{parsedData.Status || 'Not specified'}</Text></Text>
        </View>
        {renderMissingFields()}
      </View>
    );
  };

  const renderInitialInput = () => {
    const isSubmitReady = enquiryDescription.trim().length > 0;
    return (
      <View>
        <View style={styles.uploadArea}>
          <TouchableOpacity onPress={handleImagePicker} activeOpacity={0.7}>
            <IconComponent name="cloud-upload" size={32} color={colors.primary} />
            <Text style={styles.uploadText}>Tap to add images / videos</Text>
            <Text style={styles.uploadSubtext}>Camera or Gallery</Text>
          </TouchableOpacity>
        </View>
        {referenceImages.length > 0 && (
          <View style={styles.previewRow}>
            {referenceImages.map((img, i) => (
              <View key={i} style={styles.previewItem}>
                <Image source={{ uri: img.uri }} style={styles.previewThumb} />
                <TouchableOpacity onPress={() => setReferenceImages(prev => prev.filter((_, idx) => idx !== i))}>
                  <IconComponent name="close" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        <Input
          placeholder="Describe your custom jewelry piece"
          multiline
          numberOfLines={6}
          value={enquiryDescription}
          onChangeText={setEnquiryDescription}
          style={{ minHeight: 120, textAlignVertical: 'top' }}
        />
        <TouchableOpacity onPress={() => setShowConfirmModal(true)} disabled={!isSubmitReady || isParsing}>
          <View style={[styles.submitBtn, (!isSubmitReady || isParsing) && styles.submitBtnDisabled]}>
            {isParsing ? (
              <ActivityIndicator size="small" color={colors.textWhite} />
            ) : (
              <Text style={styles.submitBtnText}>{isParsing ? 'Parsing...' : 'Parse with AI'}</Text>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={styles.overlayTop} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalBox}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.headerTitle}>New Enquiry</Text>
            <TouchableOpacity onPress={onClose}>
              <IconComponent name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {preSelectedClientName && (
            <View style={styles.clientBadge}>
              <IconComponent name="person" size={16} color={colors.primary} />
              <Text style={styles.clientBadgeText}>{preSelectedClientName}</Text>
            </View>
          )}

          <View style={styles.designTypeRow}>
            {['coral', 'cad'].map(type => (
              <TouchableOpacity
                key={type}
                activeOpacity={textSubmitted ? 1 : 0.85}
                style={[styles.designTile, projectType === type && styles.designTileActive, textSubmitted && styles.designTileDisabled]}
                onPress={textSubmitted ? undefined : () => setProjectType(type)}
              >
                <IconComponent
                  name={type === 'coral' ? 'waves' : 'architecture'}
                  size={20}
                  color={textSubmitted ? colors.textLight : (projectType === type ? colors.textWhite : colors.primary)}
                />
                <Text style={[styles.designTileLabel, projectType === type && styles.designTileLabelActive, textSubmitted && { color: colors.textLight }]}>
                  {type.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {!textSubmitted ? renderInitialInput() : (
              <View>
                {renderParsedPreview()}

                {/* Assign To — shown only after AI parsing, users filtered by parsed status */}
                <View style={styles.assignRow}>
                  <IconComponent name="person-add" size={16} color={assignedTo ? colors.primary : colors.error} />
                  {assignedTo ? (
                    <View style={styles.assignedBadge}>
                      <Text style={styles.assignedBadgeText}>{assignedTo.name}</Text>
                      <TouchableOpacity onPress={() => setAssignedTo(null)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <IconComponent name="close" size={14} color={colors.textWhite} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.assignBtn} onPress={() => setShowAssignModal(true)} activeOpacity={0.8}>
                      <Text style={styles.assignBtnText}>Assign To (optional)</Text>
                      <IconComponent name="arrow-drop-down" size={16} color={colors.primary} />
                    </TouchableOpacity>
                  )}
                </View>

                <TouchableOpacity onPress={handleSubmit} disabled={isSubmitting}>
                  <View style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}>
                    {isSubmitting ? (
                      <ActivityIndicator size="small" color={colors.textWhite} />
                    ) : (
                      <Text style={styles.submitBtnText}>Create Enquiry</Text>
                    )}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={styles.backBtn} onPress={() => { setTextSubmitted(false); setParsedData(null); setDynamicMissingFields([]); setMissingFieldsData({}); }}>
                  <Text style={styles.backBtnText}>Edit Description</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
        <BrandedAlert
          visible={alertConfig.visible}
          title={alertConfig.title}
          message={alertConfig.message}
          type={alertConfig.type}
          buttons={alertConfig.buttons}
          onClose={hideAlert}
        />

        {/* Assign To User Picker Modal */}
        <Modal visible={showAssignModal} transparent animationType="slide" onRequestClose={() => setShowAssignModal(false)}>
          <TouchableOpacity style={styles.assignModalOverlay} activeOpacity={1} onPress={() => setShowAssignModal(false)}>
            <TouchableOpacity activeOpacity={1} style={styles.assignModalBox} onPress={e => e.stopPropagation()}>
              <View style={styles.assignModalHeader}>
                <Text style={styles.assignModalTitle}>Assign To</Text>
                <TouchableOpacity onPress={() => setShowAssignModal(false)}>
                  <IconComponent name="close" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.assignModalSubtitle}>
                {autoStatus} · {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
              </Text>
              <ScrollView style={styles.assignUserList} showsVerticalScrollIndicator={false}>
                {filteredUsers.length === 0 ? (
                  <Text style={styles.assignNoUsers}>No users available for this status</Text>
                ) : (
                  filteredUsers.map(u => {
                    const uid = u.id || u._id || u.userId;
                    const uname = String(u.name || u.Name || u.username || u.email || uid || '?');
                    const isSelected = assignedTo?.id === uid;
                    return (
                      <TouchableOpacity
                        key={uid}
                        style={[styles.assignUserRow, isSelected && styles.assignUserRowActive]}
                        onPress={() => {
                          setAssignedTo({ id: uid, name: uname });
                          setShowAssignModal(false);
                        }}
                        activeOpacity={0.8}
                      >
                        <View style={styles.assignUserAvatar}>
                          <Text style={styles.assignUserAvatarText}>{uname.charAt(0).toUpperCase()}</Text>
                        </View>
                        <Text style={[styles.assignUserName, isSelected && styles.assignUserNameActive]}>{uname}</Text>
                        {isSelected && <IconComponent name="check" size={18} color={colors.primary} />}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        <Modal visible={showConfirmModal} transparent animationType="fade" onRequestClose={() => setShowConfirmModal(false)}>
          <View style={styles.confirmOverlay}>
            <View style={styles.confirmBox}>
              <Text style={styles.confirmTitle}>Test with AI?</Text>
              <Text style={styles.confirmDesc}>Would you like to test this description with AI parsing?</Text>
              <TouchableOpacity style={styles.confirmUploadBtn} onPress={handleImagePicker}>
                <IconComponent name="cloud-upload" size={20} color={colors.primary} />
                <Text style={styles.confirmUploadText}>Upload Screenshot</Text>
              </TouchableOpacity>
              {referenceImages.length > 0 && (
                <View style={styles.previewRow}>
                  {referenceImages.map((img, i) => (
                    <View key={i} style={styles.previewItem}>
                      <Image source={{ uri: img.uri }} style={styles.previewThumb} />
                      <TouchableOpacity onPress={() => setReferenceImages(prev => prev.filter((_, idx) => idx !== i))}>
                        <IconComponent name="close" size={16} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.confirmActions}>
                <TouchableOpacity style={styles.confirmBtnSecondary} onPress={() => setShowConfirmModal(false)}>
                  <Text style={styles.confirmBtnSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmBtnPrimary} onPress={() => { setShowConfirmModal(false); handleTextSubmit(); }}>
                  <Text style={styles.confirmBtnPrimaryText}>Yes, Parse</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={showPreviewModal} transparent animationType="slide" onRequestClose={() => {}}>
          <View style={styles.previewOverlay}>
            <View style={styles.previewBox}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.previewTitle}>Review Enquiry</Text>
                <Text style={styles.previewSubtitle}>Confirm the details before creating.</Text>

                {createdEnquiryData?.data && renderPreviewDetails(createdEnquiryData.data, styles)}
              </ScrollView>

              <View style={styles.previewActions}>
                <TouchableOpacity
                  style={[styles.previewBtn, styles.previewBtnSecondary]}
                  onPress={() => setShowPreviewModal(false)}
                  disabled={isSubmitting}
                >
                  <Text style={styles.previewBtnSecondaryText}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.previewBtn, styles.previewBtnPrimary, isSubmitting && { opacity: 0.5 }]}
                  onPress={handleConfirmCreate}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color={colors.textWhite} />
                  ) : (
                    <Text style={styles.previewBtnPrimaryText}>Create Enquiry</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  overlayTop: {
    flex: 1,
  },
  modalBox: {
    backgroundColor: colors.background,
    borderTopRightRadius: 20,
    borderTopLeftRadius: 20,
    padding: 24,
    maxHeight: '80%',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  designTypeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  designTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primaryLight || colors.primary,
    backgroundColor: colors.primaryExtraLight || colors.backgroundSecondary,
  },
  designTileActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark || colors.primary,
  },
  designTileDisabled: {
    opacity: 0.5,
    backgroundColor: colors.backgroundSecondary,
    borderColor: colors.borderLight,
  },
  designTileLabel: {
    fontSize: 11,
    fontFamily: fonts.medium,
    color: colors.primaryDark || colors.primary,
  },
  designTileLabelActive: {
    color: colors.textWhite,
  },
  headerTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  clientBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryExtraLight || colors.backgroundSecondary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  clientBadgeText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.primary,
    marginLeft: 6,
  },
  body: {
    maxHeight: 500,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    marginBottom: 12,
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  uploadArea: {
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 20,
    alignItems: 'center',
    marginBottom: 12,
  },
  uploadText: {
    fontSize: fonts.sm,
    color: colors.textSecondary,
    marginTop: 6,
  },
  uploadSubtext: {
    fontSize: fonts.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  previewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  previewItem: {
    alignItems: 'center',
    position: 'relative',
  },
  previewThumb: {
    width: 50,
    height: 50,
    borderRadius: 6,
  },
  submitBtn: {
    marginTop: 16,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: fonts.base,
    color: colors.textWhite,
    fontFamily: fonts.medium,
  },
  backBtn: {
    marginTop: 12,
    alignItems: 'center',
  },
  backBtnText: {
    fontSize: fonts.sm,
    color: colors.primary,
    fontFamily: fonts.medium,
  },
  tileGroup: {
    marginTop: 12,
    marginBottom: 4,
  },
  chipRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primaryLight || colors.primary,
    backgroundColor: colors.primaryExtraLight || colors.backgroundSecondary,
    marginRight: 8,
    marginBottom: 8,
  },
  choiceChipActive: {
    borderColor: colors.primaryDark || colors.primary,
    backgroundColor: colors.primary,
  },
  choiceChipLabel: {
    fontSize: fonts.sm,
    color: colors.primaryDark || colors.primary,
  },
  choiceChipLabelActive: {
    color: colors.textWhite,
    fontFamily: fonts.medium,
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  formField: {
    flex: 1,
  },
  fullWidthField: {
    flex: 1,
    width: '100%',
  },
  dropdownLabel: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  parsedDataCard: {
    backgroundColor: colors.backgroundSecondary,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  parsedDataLabel: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  parsedDataValue: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  editableField: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.background,
    marginBottom: 6,
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  confirmBox: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  confirmTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  confirmDesc: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  confirmUploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primaryLight || colors.primary,
    borderStyle: 'dashed',
    marginBottom: 12,
  },
  confirmUploadText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  confirmBtnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  confirmBtnSecondaryText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  confirmBtnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  confirmBtnPrimaryText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textWhite,
  },

  // Assign To row
  assignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
    minHeight: 32,
  },
  assignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primaryLight || colors.primary,
    backgroundColor: colors.primaryExtraLight || colors.backgroundSecondary,
    gap: 2,
  },
  assignBtnMissing: {
    borderColor: colors.error,
    backgroundColor: '#FEF2F2',
  },
  assignBtnText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  assignBtnTextMissing: {
    color: colors.error,
  },
  validationError: {
    fontSize: fonts.xs,
    color: colors.error,
    marginLeft: 24,
    marginBottom: 12,
    fontFamily: fonts.regular,
  },
  assignedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  assignedBadgeText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textWhite,
  },

  // Assign user picker modal
  assignModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  assignModalBox: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '60%',
  },
  assignModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  assignModalTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  assignModalSubtitle: {
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  assignUserList: {
    maxHeight: 320,
  },
  assignNoUsers: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: fonts.sm,
    paddingVertical: 24,
  },
  assignUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 4,
    gap: 12,
  },
  assignUserRowActive: {
    backgroundColor: colors.primaryExtraLight || colors.backgroundSecondary,
  },
  assignUserAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  assignUserAvatarText: {
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textWhite,
  },
  assignUserInfo: {
    flex: 1,
  },
  assignUserName: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  assignUserNameActive: {
    color: colors.primary,
    fontFamily: fonts.bold,
  },
  assignUserRole: {
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: 2,
    textTransform: 'capitalize',
  },

  // Preview modal
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  previewBox: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
  },
  previewTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
  },
  previewSubtitle: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  previewDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || colors.border,
  },
  previewDetailLabel: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    flex: 1,
  },
  previewDetailValue: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    flex: 1.5,
    textAlign: 'right',
  },
  previewActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  previewBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  previewBtnPrimary: {
    backgroundColor: colors.primary,
  },
  previewBtnPrimaryText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textWhite,
  },
  previewBtnSecondary: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewBtnSecondaryText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
});
