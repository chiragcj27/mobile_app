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
   KeyboardAvoidingView, Platform ,
} from 'react-native';
import { Input, Button } from '../../components/common';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import IconComponent from '../../components/common/Icon';
import {
  useGetUsersQuery,
  useGetStoneTypesQuery,
  useParseEnquiryMutation,
  useSubmitEnquiryMutation,
} from '../../store/api';
import { useClients } from '../../features/clients/clientsHooks';
import { useAuth } from '../../context/AuthContext';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import BrandedAlert from '../../components/common/BrandedAlert';



/** Default remark text when client picks a track on step 1 */
const CLIENT_REMARK_BY_PROJECT_TYPE = {
  coral: 'I want a coral design for this',
  cad: 'I want a cad design for this',
  approvedCad: 'I want an approved CAD design for this',
};

const AddEnquiryStep1Screen = ({ route, navigation }) => {
  // This screen is only for creating new enquiries
  const isEditMode = false;
  const { user } = useAuth();
  const [parseEnquiry, { isLoading: isParsing }] = useParseEnquiryMutation();
  const [submitEnquiry, { isLoading: isSubmitting }] = useSubmitEnquiryMutation();

 
  const roleLower = user?.role?.toLowerCase();
  const isClient =
    roleLower === 'client' ||
    roleLower === 'cl' ||
    user?.roleId === 4 ||
    user?.roleNumber === 4;

  /** Client & admin: step 1 = status tiles, step 2 = details. */
  const totalSteps = 2;
  const [currentStep, setCurrentStep] = useState(1);
  /** coral | cad | approvedCad — drives Status sent to API (client & admin) */
  const [projectType, setProjectType] = useState('coral');

  // Initialize form data for new enquiry
  const getInitialFormData = () => {
    return {
      title: '',
      description: '',
      remark: '',
      clientId: '',
      clientName: '',
      priority: 'Normal',
      category: 'Ring',
      metalColor: '', // Empty by default - optional field
      metalQuality: '10K',
      stoneType: '', // Optional field - no default
      quantity: '1',
      stamping: '',
      status: 'Coral',
      assignedTo: '',
      budget: '',
      specialRemarks: '',
      approvedDate: '',
    };
  };

  // Initialize form data - use empty form initially, will be populated in useEffect
  const [formData, setFormData] = useState(getInitialFormData());
  const [errors, setErrors] = useState({});
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [showAssignedToDropdown, setShowAssignedToDropdown] = useState(false);
  // new states
  const [TextSubmitted, setTextSubmitted] = useState(false);
  const [referenceImages, setReferenceImages] = useState([]);
  const [missingFieldsData, setMissingFieldsData] = useState({});
  const [enquiryDescription, setEnquiryDescription] = useState('');
  const [parsedData, setParsedData] = useState(null);
  const [dynamicMissingFields, setDynamicMissingFields] = useState([]);
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  const showAlert = (title, message, type = 'info', buttons = []) =>
    setAlertConfig({ visible: true, title, message, type, buttons });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));

  // Fetch clients for dropdown (using cached hook)
  const { clients: clientsData = [] } = useClients({
    skip: false,
  });

  const clients = Array.isArray(clientsData) ? clientsData : [];

  // Create client options for dropdown
  const clientOptions = clients.map(client => ({
    label: client.name || 'Unknown Client',
    value: client.id || client._id,
  }));

  // Fetch users for Assigned To field
  const { data: usersData = [] } = useGetUsersQuery(undefined, {
    skip: false,
  });
  const users = Array.isArray(usersData) ? usersData : [];

  // Create assigned-to options from users (exclude clients by role)
  // Filter based on selected status:
  // - If status is "CAD", show only users with role === 3
  // - If status is "Coral", show only users with role === 2
  // - Otherwise, show all non-client users
  const assignedToOptions = useMemo(() => {
    const statusLower = String(formData.status || '').toLowerCase();

    return users
      .filter(user => {
        const roleString = String(user.role || '').toLowerCase();
        const roleNumber =
          typeof user.role === 'number' ? user.role : parseInt(user.role);

        // Always exclude clients
        if (roleString === 'client' || roleNumber === 4) {
          return false;
        }

        // Coral → role 2; CAD and Approved Cad → role 3
        if (statusLower.includes('coral') && !statusLower.includes('cad')) {
          return roleNumber === 2;
        }
        if (statusLower.includes('cad')) {
          return roleNumber === 3;
        }
        return true;
      })
      .map(user => ({
        label: user.name || user.email || 'Unknown',
        value: user.id || user._id,
      }));
  }, [users, formData.status]);

  // Fetch stone types from API
  const { data: stoneTypesData = [] } = useGetStoneTypesQuery();

  // Initialize form on mount (only for creating new enquiries)
  useEffect(() => {
    const initialData = getInitialFormData();
    setFormData({
      ...initialData,
      status: 'Coral',
      ...(isClient ? { remark: CLIENT_REMARK_BY_PROJECT_TYPE.coral } : {}),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Client role: bind enquiry to logged-in client (no client picker on the form)
  useEffect(() => {
    if (!isClient || !user?.clientId) {
      return;
    }
    const userClient = clients.find(c => {
      const cid = c.id || c._id;
      return String(cid).trim() === String(user.clientId).trim();
    });
    const nameFromDirectory =
      userClient && (userClient.name || userClient.Name || '');
    const nameFromUser =
      user.name || user.fullName || user.Name || user.email || '';

    setFormData(prev => ({
      ...prev,
      clientId: user.clientId,
      clientName: nameFromDirectory || nameFromUser || prev.clientName || '',
    }));

    if (__DEV__ && clients.length > 0 && !userClient) {
      console.warn(
        '⚠️ [ADD ENQUIRY] Client user clientId not in clients list; using profile name.',
        {
          userClientId: user.clientId,
        },
      );
    }
  }, [
    isClient,
    user?.clientId,
    user?.name,
    user?.fullName,
    user?.Name,
    user?.email,
    clients,
  ]);

  const handleSelectImages = async () => {
    const result = await launchImageLibrary({
      mediaType: 'mixed',
      selectionLimit: 10,
    });
    if (result.assets) {
      setReferenceImages(prev => [
        ...prev,
        ...result.assets.map(a => ({
          uri: a.uri,
          name: a.fileName,
          type: a.type,
        })),
      ]);
    }
  };

  // handle text submit toggle
  const handleTextSubmit = async () => {
    try {
      const result = await parseEnquiry({
        message: enquiryDescription,
        mediaType: projectType,
      }).unwrap();
      
      
      // Store parsed data and missing fields
      setParsedData(result.parsed);
      setDynamicMissingFields(result.missingFields || []);
      
      // Pre-fill form with parsed data
      setFormData(prev => ({
        ...prev,
        title: result.parsed.Name || prev.title,
        metalColor: result.parsed.Metal?.Color || prev.metalColor,
        metalQuality: result.parsed.Metal?.Quality || prev.metalQuality,
        stoneType: result.parsed.StoneType || prev.stoneType,
        category: result.parsed.Category || prev.category,
        priority: result.parsed.Priority || prev.priority,
        budget: result.parsed.Budget || prev.budget,
        remark: result.parsed.Remarks || prev.remark,
        specialRemarks: result.parsed.SpecialRemarks || prev.specialRemarks,
        status: result.parsed.Status || prev.status,
      }));
      
      setTextSubmitted(true);
    } catch (error) {
      console.error('❌ Error parsing enquiry:', error);
      
      // Show error alert with option to continue manually
      showAlert(
        'Parsing Failed',
        'AI parsing failed. Would you like to fill the form manually?',
        'warning',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Fill Manually',
            onPress: () => {
              // Move to next step to show manual input fields
              setTextSubmitted(true);
              // Set empty parsed data to trigger manual input
              setParsedData(null);
              setDynamicMissingFields([]);
            },
          },
        ]
      );
    }
  };
  const handleCamera = async () => {
    const result = await launchCamera({
      mediaType: 'photo',
      quality: 0.8,
      saveToPhotos: true,
    });
    if (result.assets?.length > 0) {
      const a = result.assets[0];
      setReferenceImages(prev => [
        ...prev,
        {
          uri: a.uri,
          type: a.type || 'image/jpeg',
          name: a.fileName || `camera_${Date.now()}.jpg`,
        },
      ]);
    }
  };

  const handleGallery = async () => {
    const result = await launchImageLibrary({
      mediaType: 'mixed',
      quality: 0.8,
      selectionLimit: 10,
    });
    if (result.assets?.length > 0) {
      setReferenceImages(prev => [
        ...prev,
        ...result.assets.map(a => ({
          uri: a.uri,
          type: a.type || 'image/jpeg',
          name: a.fileName || `image_${Date.now()}.jpg`,
        })),
      ]);
    }
  };

  const handleImagePicker = () => {
    showAlert('Select Media', 'Choose source', 'info', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Camera', onPress: handleCamera },
      { text: 'Gallery', onPress: handleGallery },
    ]);
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  // Handle status change - clear assignedTo if current user is not valid for new status
  const handleStatusChange = newStatus => {
    handleInputChange('status', newStatus);

    // If there's a currently assigned user, check if they're still valid for the new status
    if (formData.assignedTo) {
      const statusLower = String(newStatus || '').toLowerCase();
      const assignedUser = users.find(
        u => (u.id || u._id) === formData.assignedTo,
      );

      if (assignedUser) {
        const roleNumber =
          typeof assignedUser.role === 'number'
            ? assignedUser.role
            : parseInt(assignedUser.role);

        // Check if assigned user is still valid for the new status
        let isValid = true;
        if (statusLower.includes('cad')) {
          isValid = roleNumber === 3;
        } else if (statusLower.includes('coral')) {
          isValid = roleNumber === 2;
        }

        // Clear assignedTo if user is not valid for the new status
        if (!isValid) {
          handleInputChange('assignedTo', '');
        }
      }
    }
  };

  const validateForm = () => {
    const newErrors = {};

    console.log('🔍 [validateForm] Starting validation...');
    console.log('🔍 formData.title:', formData.title);
    console.log('🔍 formData.clientId:', formData.clientId);
    console.log('🔍 formData.clientName:', formData.clientName);
    console.log('🔍 formData.status:', formData.status);
    console.log('🔍 isClient:', isClient);
    console.log('🔍 TextSubmitted:', TextSubmitted);
    console.log('🔍 parsedData:', parsedData);
    console.log('🔍 missingFieldsData:', missingFieldsData);
    console.log('🔍 user.id:', user?.id);
    console.log('🔍 user.clientId:', user?.clientId);

    // Title validation - check all possible sources
    if (TextSubmitted && parsedData) {
      // AI parsing flow - title can come from parsedData or missingFieldsData
      const hasTitle = parsedData?.Name || missingFieldsData.Name;
      if (!hasTitle) {
        newErrors.title = 'Name of the piece is required';
      } else {
      }
    } else {
      // Manual flow - title must be in formData
      if (!formData.title.trim()) {
        newErrors.title = 'Name of the piece is required';
      } else {
      }
    }

    // Client validation - different logic based on flow
    if (!isClient) {
      // Admin user validation
      if (TextSubmitted && parsedData) {
        // AI parsing flow - client can come from parsedData OR missingFieldsData OR formData
        const hasClient = parsedData?.ClientId || missingFieldsData.ClientId || formData.clientId;
        if (!hasClient) {
          newErrors.clientId = 'Client is required';
        } else {
        }
      } else {
        // Manual flow (parsing failed or user chose "Fill Manually")
        // Use old validation logic - client must be in formData
        if (!formData.clientId && !formData.clientName.trim()) {
          newErrors.clientId = 'Client is required';
        } else {
        }
      }
    } else {
      // Client user - should have clientId from user object
      if (!formData.clientId && !user?.clientId) {
        newErrors.clientId = 'Client is required';
      } else {
      }
    }

    const st = String(formData.status || '').trim();
    if (!st) {
      newErrors.status = 'Status is required';
    }

    if (isClient && !formData.metalQuality) {
      newErrors.metalQuality = 'Metal quality is required';
    }

    console.log('🔍 [validateForm] Validation complete. Errors:', newErrors);
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateCurrentStep = () => {
    console.log('🔍 [validateCurrentStep] Starting step validation...');
    console.log('🔍 currentStep:', currentStep);
    console.log('🔍 isClient:', isClient);
    console.log('🔍 TextSubmitted:', TextSubmitted);
    console.log('🔍 parsedData:', parsedData);
    console.log('🔍 formData:', formData);
    console.log('🔍 missingFieldsData:', missingFieldsData);
    
    const stepErrors = {};

    if (isClient) {
      if (currentStep === 1) {
        return true;
      }
      
      // Client step 2 validation
      if (TextSubmitted && parsedData) {
        // AI parsing flow - check parsedData and missingFieldsData
        const hasTitle = parsedData?.Name || missingFieldsData.Name;
        if (!hasTitle) {
          stepErrors.title = 'Name of the piece is required';
        }
        
        const hasClient = formData.clientId || user?.clientId;
        if (!hasClient) {
          stepErrors.clientId = 'Client is required';
        }
        
        const hasMetalQuality = parsedData?.Metal?.Quality || missingFieldsData.MetalQuality || formData.metalQuality;
        if (!hasMetalQuality) {
          stepErrors.metalQuality = 'Metal quality is required';
        }
      } else {
        // Manual flow - check formData
        if (!formData.title.trim()) {
          stepErrors.title = 'Name of the piece is required';
        }
        if (!formData.clientId && !formData.clientName.trim()) {
          stepErrors.clientId = 'Client is required';
        }
        if (!formData.metalQuality) {
          stepErrors.metalQuality = 'Metal quality is required';
        }
      }
    } else if (currentStep === 1) {
      return true;
    } else if (currentStep === 2) {
      // Admin step 2 validation
      if (TextSubmitted && parsedData) {
        // AI parsing flow - check parsedData and missingFieldsData
        const hasTitle = parsedData?.Name || missingFieldsData.Name;
        if (!hasTitle) {
          stepErrors.title = 'Name of the piece is required';
        }
        
        const hasClient = parsedData?.ClientId || missingFieldsData.ClientId || formData.clientId;
        if (!hasClient) {
          stepErrors.clientId = 'Client is required';
        }
      } else {
        // Manual flow - check formData
        if (!formData.title.trim()) {
          stepErrors.title = 'Name of the piece is required';
        }
        if (!formData.clientId && !formData.clientName.trim()) {
          stepErrors.clientId = 'Client is required';
        }
      }
    }

    console.log('🔍 [validateCurrentStep] Step errors:', stepErrors);
    setErrors(prev => ({ ...prev, ...stepErrors }));
    return Object.keys(stepErrors).length === 0;
  };

  const buildRemarksForApi = () => {
    if (isClient && formData.remark?.trim()) {
      return formData.remark.trim();
    }
    return null;
  };

  const renderDropdown = (
    label,
    value,
    options,
    onSelect,
    isVisible,
    onToggle,
  ) => {
    const selectedOption = value
      ? options.find(opt => opt.value === value)
      : null;
    const displayText = selectedOption?.label || `Select ${label}`;

    return (
      <View style={styles.dropdownContainer}>
        <Text style={styles.dropdownLabel}>{label}</Text>
        <TouchableOpacity
          style={styles.dropdown}
          onPress={onToggle}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.dropdownText, !value && styles.dropdownPlaceholder]}
          >
            {displayText}
          </Text>
          <IconComponent
            name="arrow-drop-down"
            size={24}
            color={colors.textSecondary}
          />
        </TouchableOpacity>

        <Modal
          visible={isVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={onToggle}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={onToggle}
          >
            <View style={styles.dropdownModal}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={{ height: '100%' }}
              >
                {options.map(option => {
                  const isSelected =
                    value === option.value || (!value && option.value === '');
                  return (
                    <TouchableOpacity
                      key={option.value || 'none'}
                      activeOpacity={0.7}
                      style={[
                        styles.dropdownOption,
                        isSelected && styles.dropdownOptionSelected,
                      ]}
                      onPress={() => {
                        // If "None" is selected, pass empty string
                        onSelect(option.value === 'None' ? '' : option.value);
                        onToggle();
                      }}
                    >
                      {/* <Image source={} /> */}
                      <Text
                        style={[
                          styles.dropdownOptionText,
                          isSelected && styles.dropdownOptionTextSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                      {isSelected && (
                        <IconComponent
                          name="check"
                          size={20}
                          color={colors.primary}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    if (!user?.id) {
      showAlert('Error', 'User not found. Please login again.', 'error');
      return;
    }
    

    try {
      // Check if this is AI parsing flow or manual flow
      const isAIParsingFlow = TextSubmitted && parsedData !== null;
      
      if (isAIParsingFlow) {
        // AI PARSING FLOW - Use submitEnquiry (creates enquiry + uploads images)
        console.log('🤖 [AI PARSING FLOW] Using submitEnquiry mutation');
        
        // Prepare final enquiry data - merge formData with missingFieldsData and parsedData
        // Priority: missingFieldsData > parsedData > formData > defaults
        const finalData = {
          Name: missingFieldsData.Name || parsedData?.Name || formData.title || '',
          ClientId: missingFieldsData.ClientId || parsedData.ClientId || (isClient
            ? formData.clientId || user.clientId || user.id
            : formData.clientId || user.id),
          AssignedTo: missingFieldsData.AssignedTo || parsedData?.AssignedTo || (isClient ? null : formData.assignedTo || null),
          Status: missingFieldsData.Status || parsedData?.Status || formData.status || 'Enquiry Created',
          Priority: missingFieldsData.Priority || parsedData?.Priority || formData.priority || 'Normal',
          Quantity: missingFieldsData.Quantity || parsedData?.Quantity || parseInt(formData.quantity) || 1,
          Metal: {
            Color: missingFieldsData.MetalColor || parsedData?.Metal?.Color || (
              formData.metalColor && formData.metalColor.trim()
                ? formData.metalColor.trim()
                : null
            ),
            Quality: missingFieldsData.MetalQuality || parsedData?.Metal?.Quality || formData.metalQuality || '10K',
          },
          StoneType: missingFieldsData.StoneType || parsedData?.StoneType || (
            formData.stoneType && formData.stoneType.trim()
              ? formData.stoneType.trim()
              : null
          ),
          Stamping: missingFieldsData.Stamping || parsedData?.Stamping || formData.stamping || null,
          Remarks: missingFieldsData.Remarks || parsedData?.Remarks || buildRemarksForApi() || '',
          Category: missingFieldsData.Category || parsedData?.Category || formData.category || 'Ring',
          Budget: missingFieldsData.Budget || parsedData?.Budget || (
            formData.budget && formData.budget.trim()
              ? formData.budget.trim()
              : null
          ),
          SpecialRemarks: missingFieldsData.SpecialRemarks || parsedData?.SpecialRemarks || (
            !isClient && formData.remark && formData.remark.trim()
              ? formData.remark.trim()
              : formData.specialRemarks && formData.specialRemarks.trim()
              ? formData.specialRemarks.trim()
              : null
          ),
          StyleNumber: missingFieldsData.StyleNumber || parsedData?.StyleNumber || null,
          GatiOrderNumber: missingFieldsData.GatiOrderNumber || parsedData?.GatiOrderNumber || null,
          ShippingDate: missingFieldsData.ShippingDate || parsedData?.ShippingDate || null,
          CoralCode: missingFieldsData.CoralCode || parsedData?.CoralCode || null,
          CadCode: missingFieldsData.CadCode || parsedData?.CadCode || null,
          ApprovedDate: missingFieldsData.ApprovedDate || parsedData?.ApprovedDate || null,
        };

        // Add MetalWeight if provided in missing fields
        if (missingFieldsData.MetalWeightFrom || missingFieldsData.MetalWeightTo || missingFieldsData.MetalWeightExact) {
          finalData.MetalWeight = {
            From: missingFieldsData.MetalWeightFrom || null,
            To: missingFieldsData.MetalWeightTo || null,
            Exact: missingFieldsData.MetalWeightExact || null,
          };
        }

        // Add DiamondWeight if provided in missing fields
        if (missingFieldsData.DiamondWeightFrom || missingFieldsData.DiamondWeightTo || missingFieldsData.DiamondWeightExact) {
          finalData.DiamondWeight = {
            From: missingFieldsData.DiamondWeightFrom || null,
            To: missingFieldsData.DiamondWeightTo || null,
            Exact: missingFieldsData.DiamondWeightExact || null,
          };
        }

        if (__DEV__) {
          console.log('📤 ===== AI PARSING FLOW - FINAL SUBMISSION =====');
          console.log('📤 Final Data Object:', JSON.stringify(finalData, null, 2));
          console.log('📤 Reference Images Count:', referenceImages.length);
        }

        const result = await submitEnquiry({
          data: finalData,
          referenceImages: referenceImages,
        }).unwrap();

        
        // Try multiple ways to extract enquiry ID
        let enquiryId = null;
        let enquiryPayload = null;
        
        // Method 0: Check if result is directly a string (the ID itself)
        if (typeof result === 'string' && result.length === 24) {
          // MongoDB ObjectId is 24 characters
          enquiryId = result;
          console.log('🔍 Method 0 (Direct String ID): result =', result);
        }
        
        // Method 1: Direct ID fields
        if (!enquiryId) {
          enquiryId = result?.id || result?._id;
          console.log('🔍 Method 1 (Direct): result.id =', result?.id, ', result._id =', result?._id);
        }
        
        // Method 2: Nested in data
        if (!enquiryId) {
          enquiryId = result?.data?.id || result?.data?._id;
          console.log('🔍 Method 2 (Nested data): result.data.id =', result?.data?.id, ', result.data._id =', result?.data?._id);
        }
        
        // Method 3: Nested in enquiry field
        if (!enquiryId) {
          enquiryId = result?.enquiry?.id || result?.enquiry?._id;
          console.log('🔍 Method 3 (Nested enquiry): result.enquiry.id =', result?.enquiry?.id, ', result.enquiry._id =', result?.enquiry?._id);
        }
        
        // Method 4: Check if result itself is the enquiry object with nested _id
        if (!enquiryId && result?.insertedId) {
          enquiryId = result.insertedId;
          console.log('🔍 Method 4 (insertedId): result.insertedId =', result.insertedId);
        }
        
        // Method 5: Check for MongoDB insertedId in nested objects
        if (!enquiryId && result?.data?.insertedId) {
          enquiryId = result.data.insertedId;
          console.log('🔍 Method 5 (data.insertedId): result.data.insertedId =', result.data.insertedId);
        }
        
        console.log('🔍 [ENQUIRY ID EXTRACTION] Final enquiryId:', enquiryId);
        
        // Build enquiry payload - if result is just a string ID, create a minimal object
        if (typeof result === 'string') {
          enquiryPayload = { 
            id: enquiryId, 
            _id: enquiryId,
            ...finalData // Include the data we sent
          };
        } else {
          enquiryPayload = result?.data || result?.enquiry || result || { id: enquiryId, _id: enquiryId };
        }
        console.log('🔍 Final enquiryPayload keys:', Object.keys(enquiryPayload || {}));
        
        if (!enquiryId) {
          console.error('❌ Failed to extract enquiry ID from response!');
          console.error('❌ Full response:', JSON.stringify(result, null, 2));
          console.error('❌ Please check API response structure');
          showAlert(
            'Warning', 
            'Enquiry created but ID not found. Redirecting to enquiries list.',
            'warning',
            [
              {
                text: 'OK',
                onPress: () => navigation.navigate('MainTabs', { screen: 'Enquiries' })
              }
            ]
          );
          return;
        }
        
        // Navigate to chat prompt screen
        console.log('🎉 [AI PARSING FLOW] Enquiry created successfully!');
        console.log('🎉 Enquiry ID:', enquiryId);
        console.log('🎉 Enquiry Payload:', JSON.stringify(enquiryPayload, null, 2));
        
        showAlert(
          'Enquiry Created!',
          'Have more instructions or forgot to mention something?',
          'info',
          [
            {
              text: 'Done',
              style: 'cancel',
              onPress: () => {
                navigation.navigate('MainTabs', { screen: 'Enquiries' });
              },
            },
            {
              text: 'Chat with us',
              onPress: () => {
                if (enquiryId) {
                  navigation.navigate('ChatDetail', {
                    enquiryId,
                    enquiry: enquiryPayload,
                  });
                  
                } else {
                  navigation.navigate('MainTabs', { screen: 'Enquiries' });
                }
              },
            },
          ]
        );
      } else {
        // MANUAL FLOW (OLD CODE BEHAVIOR) - Use submitEnquiry (same API as AI flow)
        console.log('📝 [MANUAL FLOW] Using submitEnquiry mutation (OLD CODE BEHAVIOR)');
        
        // Map Priority from form values to API format (OLD CODE)
        const priorityMap = {
          'low': 'Low',
          'medium': 'Medium',
          'normal': 'Normal',
          'high': 'High',
          'super high': 'Super High',
          'urgent': 'Urgent',
          'Low': 'Low',
          'Medium': 'Medium',
          'Normal': 'Normal',
          'High': 'High',
          'Super High': 'Super High',
          'Urgent': 'Urgent',
        };
        
        const mappedPriority = priorityMap[formData.priority?.toLowerCase()] || priorityMap[formData.priority] || formData.priority || 'Normal';
        const enquiryStatus = formData.status || 'Enquiry Created';

        // Prepare enquiry data according to API structure (OLD CODE)
        const enquiryData = {
          Name: formData.title || '',
          ClientId: isClient
            ? formData.clientId || user.clientId || user.id
            : formData.clientId || user.id,
          AssignedTo: isClient ? null : (formData.assignedTo || null),
          Status: enquiryStatus,
          Priority: mappedPriority,
          Quantity: parseInt(formData.quantity) || 1,
          Metal: {
            Color: formData.metalColor && formData.metalColor.trim() ? formData.metalColor.trim() : null,
            Quality: formData.metalQuality || '10K',
          },
          StyleNumber: null,
          GatiOrderNumber: null,
          StoneType: formData.stoneType && formData.stoneType.trim() ? formData.stoneType.trim() : null,
          MetalWeight: {
            From: null,
            To: null,
            Exact: null,
          },
          DiamondWeight: {
            From: null,
            To: null,
            Exact: null,
          },
          Stamping: formData.stamping || null,
          Remarks: buildRemarksForApi() || '',
          ShippingDate: null,
          CoralCode: null,
          CadCode: null,
          Category: formData.category || 'Ring',
          Budget: formData.budget && formData.budget.trim() ? formData.budget.trim() : null,
          SpecialRemarks:
            !isClient && formData.remark && formData.remark.trim()
              ? formData.remark.trim()
              : formData.specialRemarks && formData.specialRemarks.trim()
                ? formData.specialRemarks.trim()
                : null,
          ApprovedDate: formData.approvedDate && formData.approvedDate.trim() ? formData.approvedDate : null,
        };

        console.log('📤 Creating enquiry (Manual Flow - OLD CODE):', JSON.stringify(enquiryData, null, 2));
        console.log('📋 [ENQUIRY CREATION] Initial Status:', enquiryStatus);
        console.log('📋 [ENQUIRY CREATION] User Role:', user?.role);
        console.log('📋 [ENQUIRY CREATION] Is Client:', isClient);

        // Use submitEnquiry with empty referenceImages array (OLD CODE BEHAVIOR)
        const result = await submitEnquiry({
          data: enquiryData,
          referenceImages: [], // No images in manual flow
        }).unwrap();
        
        
        // Try multiple ways to extract enquiry ID (same as AI flow)
        let enquiryId = null;
        
        // Method 0: Check if result is directly a string (the ID itself)
        if (typeof result === 'string' && result.length === 24) {
          // MongoDB ObjectId is 24 characters
          enquiryId = result;
          console.log('🔍 Method 0 (Direct String ID): result =', result);
        }
        
        // Method 1: Direct ID fields
        if (!enquiryId) {
          enquiryId = result?.id || result?._id;
          console.log('🔍 Method 1 (Direct): result.id =', result?.id, ', result._id =', result?._id);
        }
        
        // Method 2: Nested in data
        if (!enquiryId) {
          enquiryId = result?.data?.id || result?.data?._id;
          console.log('🔍 Method 2 (Nested data): result.data.id =', result?.data?.id, ', result.data._id =', result?.data?._id);
        }
        
        // Method 3: Nested in enquiry field
        if (!enquiryId) {
          enquiryId = result?.enquiry?.id || result?.enquiry?._id;
          console.log('🔍 Method 3 (Nested enquiry): result.enquiry.id =', result?.enquiry?.id, ', result.enquiry._id =', result?.enquiry?._id);
        }
        
        // Method 4: Check if result itself is the enquiry object with nested _id
        if (!enquiryId && result?.insertedId) {
          enquiryId = result.insertedId;
          console.log('🔍 Method 4 (insertedId): result.insertedId =', result.insertedId);
        }
        
        // Method 5: Check for MongoDB insertedId in nested objects
        if (!enquiryId && result?.data?.insertedId) {
          enquiryId = result.data.insertedId;
          console.log('🔍 Method 5 (data.insertedId): result.data.insertedId =', result.data.insertedId);
        }
        
        console.log('🔍 [MANUAL FLOW] Final enquiryId:', enquiryId);
        
        if (!enquiryId) {
          console.error('❌ Failed to extract enquiry ID from response!');
          console.error('❌ Full response:', JSON.stringify(result, null, 2));
          showAlert('Error', 'Failed to create enquiry. Enquiry ID not returned.', 'error');
          return;
        }

        const formDataForUpload = {
          ...formData,
          description: buildRemarksForApi() || '',
        };

        // Navigate to Step 2 for image upload (OLD CODE BEHAVIOR)
        navigation.navigate('AddEnquiryStep2', {
          formData: formDataForUpload,
          enquiryId,
          isEditMode: false,
        });
      }
    } catch (error) {
      console.error('❌ Error creating/submitting enquiry:', error);
      showAlert(
        'Error',
        error?.data?.message ||
          error?.data?.error ||
          'Failed to create enquiry. Please try again.',
        'error',
      );
    }
  };

  const priorityOptions = [
    { label: 'Normal', value: 'Normal' },
    { label: 'High', value: 'High' },
    { label: 'Super High', value: 'Super High' },
  ];

  const metalColorOptions = [
    { label: 'None', value: '' }, // Option to clear selection
    { label: 'White Gold', value: 'White Gold' },
    { label: 'Rose Gold', value: 'Rose Gold' },
    { label: 'Yellow Gold', value: 'Yellow Gold' },
    { label: 'Two Tone Rose White Gold', value: 'Two Tone Rose White Gold' },
    {
      label: 'Two Tone Yellow White Gold',
      value: 'Two Tone Yellow White Gold',
    },
    {
      label: 'Three Tone Rose Yellow White Gold',
      value: 'Three Tone Rose Yellow White Gold',
    },
  ];

  const metalQualityOptions = [
    { label: '10K', value: '10K' },
    { label: '14K', value: '14K' },
    { label: '18K', value: '18K' },
    { label: '22K', value: '22K' },
    { label: 'Silver 925', value: 'Silver 925' },
    { label: 'Platinum', value: 'Platinum' },
  ];

  // Stone type options from API - add "None" option at the beginning for optional field
  const stoneTypeOptions = [
    { label: 'None', value: '' },
    ...(stoneTypesData || []),
  ];

  const goToNextStep = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleSubmit();
    }
  };

  const goToPrevStep = () => {
    if (TextSubmitted) {
      setTextSubmitted(false);
    } else if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const renderProgress = () => {
    const progress = currentStep / totalSteps;
    return (
      <View style={styles.progressBarContainer}>
        <View style={[styles.progressBarFill, { flex: progress }]} />
        <View style={{ flex: 1 - progress }} />
      </View>
    );
  };

  const handleSelectProjectType = type => {
    setProjectType(type);
    if (type === 'coral') {
      handleStatusChange('Coral');
      if (isClient) {
        handleInputChange('remark', CLIENT_REMARK_BY_PROJECT_TYPE.coral);
      }
    } else if (type === 'cad') {
      handleStatusChange('Cad');
      if (isClient) {
        handleInputChange('remark', CLIENT_REMARK_BY_PROJECT_TYPE.cad);
      }
    } else if (type === 'approvedCad') {
      handleStatusChange('Approved Cad');
      if (isClient) {
        handleInputChange('remark', CLIENT_REMARK_BY_PROJECT_TYPE.approvedCad);
      }
    }
  };

  const renderStep1TypeSelection = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepQuestion}>Choose enquiry status</Text>
      <Text style={styles.stepHint}>
        {isClient
          ? 'Pick Coral, CAD, or Approved CAD. A starting note is added to your remark — you can edit it on the next step.'
          : 'Pick Coral, CAD, or Approved CAD. Assign To options match the status you choose.'}
      </Text>
      <View style={styles.projectTileRowWrap}>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[
            styles.projectTile,
            styles.projectTileThird,
            projectType === 'coral' && styles.projectTileActive,
          ]}
          onPress={() => handleSelectProjectType('coral')}
        >
          <IconComponent name="waves" size={28} color={colors.primary} />
          <Text style={styles.projectTileTitle}>Coral</Text>
          <Text style={styles.projectTileSubtitle}>Coral design track</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[
            styles.projectTile,
            styles.projectTileThird,
            projectType === 'cad' && styles.projectTileActive,
          ]}
          onPress={() => handleSelectProjectType('cad')}
        >
          <IconComponent name="architecture" size={28} color={colors.primary} />
          <Text style={styles.projectTileTitle}>CAD</Text>
          <Text style={styles.projectTileSubtitle}>CAD workflow</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[
            styles.projectTile,
            styles.projectTileThird,
            projectType === 'approvedCad' && styles.projectTileActive,
          ]}
          onPress={() => handleSelectProjectType('approvedCad')}
        >
          <IconComponent name="description" size={28} color={colors.primary} />
          <Text style={styles.projectTileTitle}>Approved CAD</Text>
          <Text style={styles.projectTileSubtitle}>Approved CAD track</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  /** Client picker — staff only; clients are auto-bound to the logged-in account */
  const renderClientTiles = () => {
    if (isClient) {
      return null;
    }

    return (
      <View style={styles.dropdownContainer}>
        {renderDropdown(
          'Client*',
          formData.clientId,
          clientOptions,
          clientId => {
            const selectedClient = clients.find(
              c => (c.id || c._id) === clientId,
            );
            handleInputChange('clientId', clientId);
            handleInputChange('clientName', selectedClient?.name || '');
          },
          showClientDropdown,
          () => setShowClientDropdown(!showClientDropdown),
        )}
        {errors.clientId && (
          <Text style={styles.errorText}>{errors.clientId}</Text>
        )}
      </View>
    );
  };

  const renderAdminStep2Fields = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepQuestion}>Enquiry details</Text>
      <View style={styles.formRow}>
        <View style={[styles.formField, styles.fullWidthField]}>
          <Input
            label="Name of the Piece*"
            placeholder="Name of the piece"
            value={formData.title}
            onChangeText={value => handleInputChange('title', value)}
            error={errors.title}
          />
        </View>
      </View>
      <View style={styles.formRow}>
        <View style={[styles.formField, styles.fullWidthField]}>
          {renderClientTiles()}
        </View>
      </View>
      <View style={styles.formRow}>
        <View style={[styles.formField, styles.fullWidthField]}>
          {renderDropdown(
            'Assign To',
            formData.assignedTo,
            assignedToOptions,
            value => handleInputChange('assignedTo', value),
            showAssignedToDropdown,
            () => setShowAssignedToDropdown(!showAssignedToDropdown),
          )}
        </View>
      </View>
      <View style={styles.formRow}>
        <View style={[styles.formField, styles.fullWidthField]}>
          <View style={styles.priorityContainer}>
            <Text style={styles.priorityLabel}>Priority</Text>
            <View style={styles.priorityOptions}>
              {priorityOptions.map((option, index) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.priorityOption,
                    formData.priority === option.value &&
                      styles.priorityOptionActive,
                    index === priorityOptions.length - 1 &&
                      styles.priorityOptionLast,
                  ]}
                  onPress={() => handleInputChange('priority', option.value)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.priorityOptionText,
                      formData.priority === option.value &&
                        styles.priorityOptionTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </View>
      <View style={styles.formRow}>
        <View style={[styles.formField, styles.fullWidthField]}>
          <Input
            label="Remark"
            placeholder="Internal remark (optional)"
            value={formData.remark}
            onChangeText={value => handleInputChange('remark', value)}
            multiline
            numberOfLines={3}
          />
        </View>
      </View>
    </View>
  );

  const renderClientStepFields = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepQuestion}>Your enquiry</Text>
      <View style={styles.formRow}>
        <View style={[styles.formField, styles.fullWidthField]}>
          <Input
            label="Name of the Piece*"
            placeholder="Name of the piece"
            value={formData.title}
            onChangeText={(value) => handleInputChange('title', value)}
            error={errors.title}
          />
        </View>
      </View>
      {renderChipRow(
        'Stone type',
        formData.stoneType,
        stoneTypeOptions,
        (val) => handleInputChange('stoneType', val),
      )}
      {renderChipRow(
        'Metal quality*',
        formData.metalQuality,
        metalQualityOptions,
        (val) => handleInputChange('metalQuality', val),
      )}
      {errors.metalQuality ? (
        <Text style={styles.errorText}>{errors.metalQuality}</Text>
      ) : null}
      {renderChipRow(
        'Metal color',
        formData.metalColor,
        metalColorOptions,
        (val) => handleInputChange('metalColor', val),
      )}
      <View style={styles.formRow}>
        <View style={[styles.formField, styles.fullWidthField]}>
          <Input
            label="Remark"
            placeholder="Any other notes"
            value={formData.remark}
            onChangeText={(value) => handleInputChange('remark', value)}
            multiline
            numberOfLines={3}
          />
        </View>
      </View>
      <View style={styles.formRow}>
        <View style={[styles.formField, styles.fullWidthField]}>
          <Input
            label="Budget"
            placeholder="Budget (optional)"
            value={formData.budget}
            onChangeText={(value) => handleInputChange('budget', value)}
          />
        </View>
      </View>
    </View>
  );

  const renderClientInputTab = () => {
    const isSubmitReady =
      // enquiryDescription.trim().length > 0 && referenceImages.length > 0;
      enquiryDescription.trim().length > 0 ;
    return (
      <View style={styles.inputBox}>
        <Text style={styles.inputLabel}>Upload Reference Images</Text>
        <TouchableOpacity
          style={styles.uploadArea}
          onPress={handleImagePicker}
          activeOpacity={0.7}
        >
          <IconComponent name="cloud-upload" size={40} color={colors.primary} />
          <Text style={styles.uploadText}>Tap to add images / videos</Text>
          <Text style={styles.uploadSubtext}>Camera or Gallery</Text>
        </TouchableOpacity>
        {referenceImages.length > 0 && (
          <View style={styles.previewRow}>
            {referenceImages.map((img, i) => (
              <View key={i} style={styles.previewItem}>
                <Image source={{ uri: img.uri }} style={styles.previewThumb} />
                <TouchableOpacity
                  onPress={() =>
                    setReferenceImages(prev =>
                      prev.filter((_, idx) => idx !== i),
                    )
                  }
                >
                  <IconComponent name="close" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        <View style={{ marginTop: 16 }}>
          <Input
            placeholder="Describe your custom jewelry piece"
            multiline
            numberOfLines={10}
            value={enquiryDescription}
            onChangeText={setEnquiryDescription}
            style={{ minHeight: 200, textAlignVertical: 'top' }}
          />
        </View>
        <TouchableOpacity onPress={handleTextSubmit} disabled={!isSubmitReady || isParsing}>
          <View
            style={[
              styles.SubmitButton,
              (!isSubmitReady || isParsing) && styles.submitButtonDisabled,
            ]}
          >
            {isParsing ? (
              <ActivityIndicator size="small" color={colors.textWhite} />
            ) : (
              <Text style={[
                styles.SubmitButtonText,
                !isSubmitReady && styles.SubmitButtonText2,
              ]}>{isParsing ? 'Parsing...' : 'Submit'}</Text>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderImageUploadStep = () => {
    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepQuestion}>Upload Reference Images</Text>
        <Text style={styles.stepHint}>
          Add images or videos to help us understand your design requirements
        </Text>
        <TouchableOpacity
          style={styles.uploadArea}
          onPress={handleImagePicker}
          activeOpacity={0.7}
        >
          <IconComponent name="cloud-upload" size={40} color={colors.primary} />
          <Text style={styles.uploadText}>Tap to add images / videos</Text>
          <Text style={styles.uploadSubtext}>Camera or Gallery</Text>
        </TouchableOpacity>
        {referenceImages.length > 0 && (
          <View style={styles.previewRow}>
            {referenceImages.map((img, i) => (
              <View key={i} style={styles.previewItem}>
                <Image source={{ uri: img.uri }} style={styles.previewThumb} />
                <TouchableOpacity
                  onPress={() =>
                    setReferenceImages(prev =>
                      prev.filter((_, idx) => idx !== i),
                    )
                  }
                  style={styles.removeImageButton}
                >
                  <IconComponent name="close" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderRequiredFields = () => {
    const fieldsToRender = dynamicMissingFields.length > 0 ? dynamicMissingFields : [];
    
    if (fieldsToRender.length === 0) return null;
    
    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepQuestion}>Complete Missing Details</Text>
        <Text style={styles.stepHint}>
          Please provide the following required information:
        </Text>
        {fieldsToRender.map((item, index) => {
        // Special handling for ClientId field - show client name instead of ID
        if (item.field === 'ClientId' && item.options.length > 0) {
          return (
            <View key={index} style={styles.tileGroup}>
              <Text style={styles.dropdownLabel}>{item.label}</Text>
              <View style={styles.chipRowWrap}>
                {item.options.map(option => {
                  const selected = missingFieldsData[item.field] === option.value;
                  // Resolve client name from ClientId
                  const clientName = clients.find(c => (c.id || c._id) === option.value)?.name || option.label;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.choiceChip,
                        selected && styles.choiceChipActive,
                      ]}
                      activeOpacity={0.85}
                      onPress={() =>
                        setMissingFieldsData(prev => ({
                          ...prev,
                          [item.field]: option.value,
                        }))
                      }
                    >
                      <Text
                        style={[
                          styles.choiceChipLabel,
                          selected && styles.choiceChipLabelActive,
                        ]}
                      >
                        {clientName}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        } else if (item.options.length > 0) {
          // Render dropdown for fields with options
          return (
            <View key={index} style={styles.tileGroup}>
              <Text style={styles.dropdownLabel}>{item.label}</Text>
              <View style={styles.chipRowWrap}>
                {item.options.map(option => {
                  const selected = missingFieldsData[item.field] === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.choiceChip,
                        selected && styles.choiceChipActive,
                      ]}
                      activeOpacity={0.85}
                      onPress={() =>
                        setMissingFieldsData(prev => ({
                          ...prev,
                          [item.field]: option.value,
                        }))
                      }
                    >
                      <Text
                        style={[
                          styles.choiceChipLabel,
                          selected && styles.choiceChipLabelActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        } else {
          // Render text input for fields without options
          return (
            <View key={index} style={styles.formRow}>
              <View style={[styles.formField, styles.fullWidthField]}>
                <Input
                  label={item.label}
                  placeholder={`Enter ${item.label.toLowerCase()}`}
                  value={missingFieldsData[item.field] || ''}
                  onChangeText={value =>
                    setMissingFieldsData(prev => ({
                      ...prev,
                      [item.field]: value,
                    }))
                  }
                />
              </View>
            </View>
          );
        }
      })}
      </View>
    );
  };

  // const renderClientStepFields = () => (
  //   <View style={styles.stepContent}>
  //     <Text style={styles.stepQuestion}>Your enquiry</Text>
  //     <View style={styles.formRow}>
  //       <View style={[styles.formField, styles.fullWidthField]}>
  //         <Input
  //           label="Name of the Piece*"
  //           placeholder="Name of the piece"
  //           value={formData.title}
  //           onChangeText={(value) => handleInputChange('title', value)}
  //           error={errors.title}
  //         />
  //       </View>
  //     </View>
  //     {renderChipRow(
  //       'Stone type',
  //       formData.stoneType,
  //       stoneTypeOptions,
  //       (val) => handleInputChange('stoneType', val),
  //     )}
  //     {renderChipRow(
  //       'Metal quality*',
  //       formData.metalQuality,
  //       metalQualityOptions,
  //       (val) => handleInputChange('metalQuality', val),
  //     )}
  //     {errors.metalQuality ? (
  //       <Text style={styles.errorText}>{errors.metalQuality}</Text>
  //     ) : null}
  //     {renderChipRow(
  //       'Metal color',
  //       formData.metalColor,
  //       metalColorOptions,
  //       (val) => handleInputChange('metalColor', val),
  //     )}
  //     <View style={styles.formRow}>
  //       <View style={[styles.formField, styles.fullWidthField]}>
  //         <Input
  //           label="Remark"
  //           placeholder="Any other notes"
  //           value={formData.remark}
  //           onChangeText={(value) => handleInputChange('remark', value)}
  //           multiline
  //           numberOfLines={3}
  //         />
  //       </View>
  //     </View>
  //     <View style={styles.formRow}>
  //       <View style={[styles.formField, styles.fullWidthField]}>
  //         <Input
  //           label="Budget"
  //           placeholder="Budget (optional)"
  //           value={formData.budget}
  //           onChangeText={(value) => handleInputChange('budget', value)}
  //         />
  //       </View>
  //     </View>
  //   </View>
  // );

  const renderChipRow = (label, value, options, onSelect) => (
    <View style={styles.tileGroup}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <View style={styles.chipRowWrap}>
        {options.map(option => {
          const selected = value === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[styles.choiceChip, selected && styles.choiceChipActive]}
              activeOpacity={0.85}
              onPress={() => onSelect(option.value)}
            >
              <Text
                style={[
                  styles.choiceChipLabel,
                  selected && styles.choiceChipLabelActive,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderStepContent = () => {
    if (currentStep === 1) return renderStep1TypeSelection();
    
    if (isClient || roleLower === 'admin') {
      // AI Parser Flow
      if (!TextSubmitted) return renderClientInputTab();
      
      // If parsing succeeded, show parsed data and missing fields on step 2
      if (parsedData && dynamicMissingFields.length > 0) {
        if (currentStep === 2) {
          // Resolve client name from ClientId
          const clientId = parsedData.ClientId || missingFieldsData.ClientId || formData.clientId;
          const clientName = clientId 
            ? (clients.find(c => (c.id || c._id) === clientId)?.name || 'Unknown Client')
            : 'Not specified';
          
          return (
            <View>
              <View style={styles.stepContent}>
                <Text style={styles.stepQuestion}>Extracted Details</Text>
                <View style={styles.parsedDataCard}>
                  <Text style={styles.parsedDataLabel}>Name: <Text style={styles.parsedDataValue}>{parsedData.Name || 'Not specified'}</Text></Text>
                  {!isClient && (
                    <Text style={styles.parsedDataLabel}>Client: <Text style={styles.parsedDataValue}>{clientName}</Text></Text>
                  )}
                  <Text style={styles.parsedDataLabel}>Category: <Text style={styles.parsedDataValue}>{parsedData.Category || 'Not specified'}</Text></Text>
                  <Text style={styles.parsedDataLabel}>Metal: <Text style={styles.parsedDataValue}>{parsedData.Metal?.Quality || ''} {parsedData.Metal?.Color || ''}</Text></Text>
                  <Text style={styles.parsedDataLabel}>Stone Type: <Text style={styles.parsedDataValue}>{parsedData.StoneType || 'Not specified'}</Text></Text>
                  <Text style={styles.parsedDataLabel}>Priority: <Text style={styles.parsedDataValue}>{parsedData.Priority || 'Normal'}</Text></Text>
                  <Text style={styles.parsedDataLabel}>Status: <Text style={styles.parsedDataValue}>{parsedData.Status || 'Not specified'}</Text></Text>
                </View>
              </View>
              {renderRequiredFields()}
            </View>
          );
        }
      }
      
      // Manual Flow (parsing failed or user chose "Fill Manually")
      if (parsedData === null) {
        if (currentStep === 2) {
          // Step 2: Show manual form fields
          if (isClient) {
            return renderClientStepFields();
          } else {
            return renderAdminStep2Fields();
          }
        }
      }
    }
    return null;
  };

  const mainActionLabel =
    currentStep === totalSteps ? 'Create enquiry' : 'Next';
  
  const isSubmitDisabled = false;

  const onPrimaryPress = () => {
    console.log('🔘 [onPrimaryPress] Button clicked!');
    console.log('🔘 Current Step:', currentStep);
    console.log('🔘 Total Steps:', totalSteps);
    console.log('🔘 TextSubmitted:', TextSubmitted);
    console.log('🔘 Is Client:', isClient);
    console.log('🔘 Role:', roleLower);
    
    if (!validateCurrentStep()) {
      return;
    }
    
    
    // If we're on the last step, validateCurrentStep already ran full validation
    if (currentStep === totalSteps) {
      console.log('🎯 [onPrimaryPress] Calling handleSubmit...');
      handleSubmit();
    } else {
      console.log('➡️ [onPrimaryPress] Going to next step...');
      goToNextStep();
    }
  };

  return (
    <KeyboardAvoidingView
    style={{ flex: 1 }}
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  >
    <ScrollView
      style={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Create Enquiry</Text>
        <Text style={styles.headerSubtitle}>
          {`Step ${currentStep} of ${totalSteps}`}
        </Text>
        {renderProgress()}
      </View>

      <View style={styles.form}>
        {renderStepContent()}
        {currentStep >= 1 && (currentStep === 1 || TextSubmitted) && (
          <View style={styles.footerActions}>
            {currentStep > 1 && (
              <TouchableOpacity
                onPress={goToPrevStep}
                style={[
                  styles.adminActionButton,
                  styles.adminActionButtonSecondary,
                ]}
                activeOpacity={0.85}
                disabled={isSubmitting}
              >
                <IconComponent
                  name="arrow-back"
                  size={18}
                  color={colors.primary}
                />
                <Text
                  style={[
                    styles.adminActionText,
                    styles.adminActionSecondaryText,
                  ]}
                >
                  Back
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={onPrimaryPress}
              style={[
                styles.adminActionButton,
                styles.adminActionButtonPrimary,
                (isSubmitting || isSubmitDisabled) && styles.disabledButton,
              ]}
              activeOpacity={0.85}
              disabled={isSubmitting || isSubmitDisabled}
            >
              {isSubmitting ? (
                <>
                  <ActivityIndicator
                    size="small"
                    color={colors.textWhite}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.adminActionText}>
                    Submitting...
                  </Text>
                </>
              ) : (
                <>
                  <IconComponent
                    name={
                      currentStep === totalSteps
                        ? 'check-circle'
                        : 'arrow-forward'
                    }
                    size={18}
                    color={colors.textWhite}
                  />
                  <Text style={styles.adminActionText}>{mainActionLabel}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
      <BrandedAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        buttons={alertConfig.buttons}
        onClose={hideAlert}
      />
      </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: 16,
    backgroundColor: colors.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  progressBarContainer: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.border,
    marginTop: 12,
  },
  progressBarFill: {
    backgroundColor: colors.primary,
  },
  headerTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  form: {
    padding: 16,
  },
  stepContent: {
    marginTop: 12,
  },
  stepQuestion: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    marginBottom: 16,
  },
  projectTileRow: {
    flexDirection: 'row',
    gap: 12,
  },
  projectTileRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  projectTileThird: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 100,
    maxWidth: '100%',
  },
  stepHint: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  projectTile: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'space-between',
  },
  projectTileActive: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.background,
  },
  projectTileTitle: {
    marginTop: 12,
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  projectTileSubtitle: {
    marginTop: 4,
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    marginBottom: 12,
    fontSize: fonts.base,
    fontFamily: fonts.medium,
  },
  tileGroup: {
    marginTop: 16,
    marginBottom: 8,
  },
  chipScrollContent: {
    paddingVertical: 4,
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
    borderColor: colors.primaryLight,
    backgroundColor: colors.primaryExtraLight,
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
  priorityContainer: {
    marginTop: 12,
  },
  priorityLabel: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  priorityOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  priorityOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.primaryExtraLight,
    borderWidth: 1,
    borderColor: colors.primaryLight || colors.primary,
    marginRight: 8,
    marginBottom: 8,
  },
  priorityOptionLast: {
    marginRight: 0,
  },
  priorityOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark || colors.primary,
    borderWidth: 2,
  },
  priorityOptionText: {
    fontSize: fonts.sm,
    color: colors.primaryDark || colors.primary,
    fontWeight: '500',
  },
  priorityOptionTextActive: {
    fontSize: fonts.sm,
    color: colors.textWhite,
    fontWeight: '600',
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
  footerActions: {
    marginTop: 24,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  adminActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginTop: 24,
  },
  adminActionButtonPrimary: {
    backgroundColor: colors.primary,
  },
  adminActionButtonSecondary: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  disabledButton: {
    opacity: 0.6,
  },
  adminActionText: {
    color: colors.textWhite,
    fontFamily: fonts.medium,
    fontSize: 14,
    marginLeft: 8,
  },
  adminActionSecondaryText: {
    color: colors.primary,
  },
  errorText: {
    color: colors.error,
    fontSize: fonts.sm,
    marginTop: 4,
    marginLeft: 4,
  },
  dropdownContainer: {
    marginBottom: 12,
  },
  dropdownLabel: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    minHeight: 44,
  },
  dropdownText: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    flex: 1,
  },
  dropdownPlaceholder: {
    color: colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownModal: {
    backgroundColor: colors.background,
    borderRadius: 12,
    // padding: 10,
    minWidth: 300,
    maxWidth: '80%',
    height: '50%',
    overflow: 'scroll',
    shadowColor: colors.shadow || colors.textPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 10 },
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight || colors.border,
  },
  dropdownOptionSelected: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 10,
    margin: 10,
    borderBottomColor: colors.primary,
    borderBottomWidth: 2,
    borderRadius: 10,
    shadowColor: colors.shadow || colors.textPrimary,
  },
  dropdownOptionText: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    marginLeft: 10,
  },
  dropdownOptionTextSelected: {
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  disabledDropdown: {
    backgroundColor: colors.backgroundSecondary,
    opacity: 0.6,
  },
  disabledText: {
    color: colors.textSecondary,
  },
  weightRow: {
    flexDirection: 'row',
    gap: 12,
  },
  weightInput: {
    flex: 1,
  },
  datePickerContainer: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
  },
  datePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  datePickerCancel: {
    padding: 8,
  },
  datePickerCancelText: {
    fontSize: fonts.base,
    color: colors.textSecondary,
  },
  datePickerTitle: {
    fontSize: fonts.lg,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  datePickerDone: {
    padding: 8,
  },
  datePickerDoneText: {
    fontSize: fonts.base,
    color: colors.primary,
    fontWeight: '600',
  },
  datePicker: {
    width: '100%',
    height: 200,
  },
  // new input styles
  inputBox: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 300,
  },
  inputLabel: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    marginBottom: 16,
  },
  SubmitButton: {
    marginTop: 20,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  SubmitButtonText: {
    fontSize: fonts.base,
    color: colors.textWhite,
    fontWeight: '600',
  },
  SubmitButtonText2: {
    fontSize: fonts.base,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  // uploadimage styles
  uploadArea: {
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 30,
    alignItems: 'center',
    marginBottom: 16,
  },
  uploadText: {
    fontSize: fonts.sm,
    color: colors.textSecondary,
    marginTop: 8,
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
  removeImageButton: {
    marginTop: 4,
  },
  previewThumb: {
    width: 60,
    height: 60,
    borderRadius: 6,
  },
  submitButtonDisabled: {
    marginTop: 20,
    backgroundColor: colors.border,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    opacity: 0.5,
  },
  parsedDataCard: {
    backgroundColor: colors.backgroundSecondary,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  parsedDataLabel: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  parsedDataValue: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  uploadSubtext: {
    fontSize: fonts.sm,
    color: colors.textSecondary,
    marginTop: 4,
  },
});

export default AddEnquiryStep1Screen;
