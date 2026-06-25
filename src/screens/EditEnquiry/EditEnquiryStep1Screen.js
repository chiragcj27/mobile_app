import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Text,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { Input, Button } from '../../components/common';
import { Heading, CustomText } from '../../components/common/Text';
import BrandedAlert from '../../components/common/BrandedAlert';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import IconComponent from '../../components/common/Icon';
import { useGetEnquiryByIdQuery, useGetUsersQuery, useUpdateEnquiryMutation, useGetStoneTypesQuery } from '../../store/api';
import { useClients } from '../../features/clients/clientsHooks';
import { useAuth } from '../../context/AuthContext';
import { useStatusOptions } from '../../features/statuses/statusesHooks';
import { formatDate } from '../../utils';

const EditEnquiryStep1Screen = ({ route, navigation }) => {
  const { user } = useAuth();
  const roleLower = user?.role?.toLowerCase();
  const isClient =
    roleLower === 'client' ||
    roleLower === 'cl' ||
    user?.roleId === 4 ||
    user?.roleNumber === 4;

  const enquiryToEdit = route.params?.enquiry || null;
  const enquiryIdFromRoute = route.params?.enquiryId || null;
  
  // API mutations
  const [updateEnquiry, { isLoading: isUpdating }] = useUpdateEnquiryMutation();
  
  // Fetch full enquiry data if we only have an ID or incomplete data
  const enquiryId = enquiryToEdit?.id || enquiryToEdit?._id || enquiryIdFromRoute;
  const { data: fetchedEnquiry, isLoading: fetchingEnquiry } = useGetEnquiryByIdQuery(enquiryId, {
    skip: !enquiryId || (enquiryToEdit?._originalData && Object.keys(enquiryToEdit._originalData).length > 1),
  });
  
  // Use fetched enquiry if available and more complete, otherwise use route enquiry
  const finalEnquiryToEdit = (fetchedEnquiry && fetchedEnquiry._originalData && Object.keys(fetchedEnquiry._originalData).length > 1) 
    ? fetchedEnquiry 
    : enquiryToEdit;
  
  // Fetch clients for dropdown (using cached hook)
  const { clients: clientsData = [] } = useClients({
    skip: false,
  });
  const clients = useMemo(() => Array.isArray(clientsData) ? clientsData : [], [clientsData]);

  // Fetch users for Assigned To field
  const { data: usersData = [] } = useGetUsersQuery(undefined, {
    skip: false,
  });
  const users = useMemo(() => Array.isArray(usersData) ? usersData : [], [usersData]);
  
  // Get status options from API (cached) - moved earlier so we can use it in getInitialFormData
  const statusOptionsFromAPI = useStatusOptions();
  
  // Fetch stone types from API
  const { data: stoneTypesData = [] } = useGetStoneTypesQuery();
  
  // Filter out "All Status" option for create/edit forms (only needed in filters)
  const statusOptions = useMemo(() => {
    return statusOptionsFromAPI.filter(opt => opt.value !== 'all');
  }, [statusOptionsFromAPI]);

  // Map enquiry data to form format
  const getInitialFormData = () => {
    const enquiry = finalEnquiryToEdit;
    
    if (!enquiry || !enquiry.id) {
      return {
        title: '',
        description: '',
        clientId: '',
        clientName: '',
        status: 'Enquiry Created',
        assignedTo: '',
        priority: 'Normal',
        category: 'Ring',
        metalColor: '',
        metalQuality: '10K',
        stoneType: 'NaturalRegular',
        quantity: '1',
        stamping: '',
        GatiOrderNumber: '',
        styleNumber: '',
        metalWeightFrom: '',
        metalWeightTo: '',
        metalWeightExact: '',
        diamondWeightFrom: '',
        diamondWeightTo: '',
        diamondWeightExact: '',
        budget: '',
        specialRemarks: '',
        approvedDate: '',
      };
    }
    
    // Map API data to form format
    const priorityMap = {
      'Low': 'Normal',
      'Medium': 'Normal',
      'Normal': 'Normal',
      'High': 'High',
      'Urgent': 'High',
      'Super Urgent': 'Super High',
      'Super High': 'Super High',
      // Handle lowercase variations
      'low': 'Normal',
      'medium': 'Normal',
      'normal': 'Normal',
      'high': 'High',
      'urgent': 'High',
      'super urgent': 'Super High',
      'super high': 'Super High',
    };
    
    // Use original data if available, otherwise use normalized
    const originalData = enquiry._originalData || enquiry;
    
    // Get client ID from enquiry
    const enquiryClientId = enquiry.clientId || originalData?.ClientId || enquiry.ClientId || '';
    
    // Find client name from ID if we have clients loaded
    let clientName = enquiry.clientName || enquiry.client || originalData?.ClientName || '';
    if (enquiryClientId && clients && Array.isArray(clients) && clients.length > 0) {
      const foundClient = clients.find(c => {
        const clientId = String(c.id || c._id || '').trim();
        const enquiryId = String(enquiryClientId).trim();
        return clientId === enquiryId || 
               clientId.replace(/\s/g, '') === enquiryId.replace(/\s/g, '');
      });
      if (foundClient) {
        clientName = foundClient.name;
      }
    }
    
    // Helper to safely convert values to string, handling null/undefined
    const safeToString = (value) => {
      if (value === null || value === undefined) return '';
      return value.toString();
    };
    
    // Format date to YYYY-MM-DD
    const formatDateForInput = (dateValue) => {
      if (!dateValue) return '';
      try {
        const dateStr = dateValue.toString();
        if (dateStr.includes('T')) {
          return dateStr.split('T')[0];
        }
        return dateStr.substring(0, 10); // Take first 10 chars (YYYY-MM-DD)
      } catch (e) {
        return '';
      }
    };
    
    
    // Priority mapping - check all possible sources
    const rawPriority = originalData?.Priority || enquiry.Priority || enquiry.priority || 'Normal';
    const mappedPriority = priorityMap[rawPriority] || priorityMap[rawPriority?.toLowerCase()] || 'Normal';
    
    // Get status from enquiry - check StatusHistory first (most accurate), then other sources
    // StatusHistory contains the chronological status changes, latest entry is current status
    const statusHistory = originalData?.StatusHistory || enquiry?.StatusHistory || [];
    let rawStatus = null;
    
    // Get latest status from StatusHistory (sorted by timestamp, latest is last)
    if (Array.isArray(statusHistory) && statusHistory.length > 0) {
      // Sort by timestamp to get the latest entry
      const sortedHistory = [...statusHistory].sort((a, b) => {
        const dateA = new Date(a.Timestamp || a.timestamp || 0);
        const dateB = new Date(b.Timestamp || b.timestamp || 0);
        return dateB - dateA; // Descending order (latest first)
      });
      rawStatus = sortedHistory[0]?.Status || sortedHistory[0]?.status;
    }
    
    // Fallback to other sources if StatusHistory doesn't have status
    if (!rawStatus) {
      rawStatus = originalData?.Status || enquiry?.Status || enquiry?.status || enquiry?.CurrentStatus || 'Enquiry Created';
    }
    
    
    let enquiryStatus = 'Enquiry Created'; // default
    
    // First, try to find exact match in statusOptions (case-insensitive)
    if (statusOptions && statusOptions.length > 0) {
      const statusStr = String(rawStatus || '').trim();
      
      // Try exact match first (case-sensitive)
      let exactMatch = statusOptions.find(opt => 
        String(opt.value).trim() === statusStr
      );
      
      // Try case-insensitive match
      if (!exactMatch) {
        exactMatch = statusOptions.find(opt => 
          String(opt.value).toLowerCase().trim() === statusStr.toLowerCase().trim()
        );
      }
      
      // Try match after normalizing spaces
      if (!exactMatch) {
        const normalizedStatus = statusStr.replace(/\s+/g, ' ').trim();
        exactMatch = statusOptions.find(opt => {
          const normalizedOpt = String(opt.value).replace(/\s+/g, ' ').trim();
          return normalizedOpt.toLowerCase() === normalizedStatus.toLowerCase();
        });
      }
      
      if (exactMatch) {
        enquiryStatus = exactMatch.value;
      } else {
        // If no exact match, try normalization
        const statusLower = statusStr.toLowerCase();
        if (statusLower.includes('completed') || statusLower === 'completed') {
          enquiryStatus = 'Completed';
        } else if (statusLower.includes('approval') && statusLower.includes('pending')) {
          enquiryStatus = 'Design Approval Pending';
        } else if (statusLower.includes('approved cad') || statusLower === 'approved cad') {
          enquiryStatus = 'Approved Cad';
        } else if (statusLower.includes('order placement') || statusLower === 'order placement') {
          enquiryStatus = 'Order Placement';
        } else if (statusLower.includes('cam pending') || statusLower === 'cam pending') {
          enquiryStatus = 'CAM Pending';
        } else if (statusLower.includes('production') || statusLower === 'production') {
          enquiryStatus = 'Production';
        } else if (statusLower === 'cad' || (statusLower.includes('cad') && !statusLower.includes('approved'))) {
          enquiryStatus = 'Cad';
        } else if (statusLower === 'coral' || statusLower.includes('coral')) {
          enquiryStatus = 'Coral';
        } else if (statusLower.includes('rejected') || statusLower === 'rejected') {
          enquiryStatus = 'Rejected';
        } else if (statusLower.includes('created') || (statusLower.includes('pending') && !statusLower.includes('approval') && !statusLower.includes('cam'))) {
          enquiryStatus = 'Enquiry Created';
        } else {
          // Try to find partial match in statusOptions
          const partialMatch = statusOptions.find(opt => 
            String(opt.value).toLowerCase().includes(statusLower) ||
            statusLower.includes(String(opt.value).toLowerCase())
          );
          if (partialMatch) {
            enquiryStatus = partialMatch.value;
          } else {
            enquiryStatus = rawStatus; // Fallback to raw value
          }
        }
      }
    } else {
      // Fallback normalization if statusOptions not loaded yet
      const statusLower = String(rawStatus).toLowerCase();
      if (statusLower.includes('completed')) {
        enquiryStatus = 'Completed';
      } else if (statusLower.includes('approval') && statusLower.includes('pending')) {
        enquiryStatus = 'Design Approval Pending';
      } else if (statusLower.includes('created') || statusLower.includes('pending')) {
        enquiryStatus = 'Enquiry Created';
      } else {
        enquiryStatus = rawStatus;
      }
    }
    
    // Get AssignedTo from enquiry - check StatusHistory first (most accurate), then other sources
    // StatusHistory contains the chronological status changes, latest entry has current AssignedTo
    let rawAssignedTo = null;
    
    // Get latest AssignedTo from StatusHistory (sorted by timestamp, latest is first)
    if (Array.isArray(statusHistory) && statusHistory.length > 0) {
      // Use the same sorted history from status lookup
      const sortedHistory = [...statusHistory].sort((a, b) => {
        const dateA = new Date(a.Timestamp || a.timestamp || 0);
        const dateB = new Date(b.Timestamp || b.timestamp || 0);
        return dateB - dateA; // Descending order (latest first)
      });
      // Find the latest entry that has AssignedTo
      for (const entry of sortedHistory) {
        if (entry.AssignedTo || entry.assignedTo) {
          rawAssignedTo = entry.AssignedTo || entry.assignedTo;
          break;
        }
      }
    }
    
    // Fallback to other sources if StatusHistory doesn't have AssignedTo
    if (!rawAssignedTo) {
      rawAssignedTo = originalData?.AssignedTo || enquiry?.AssignedTo || enquiry?.assignedTo || '';
    }
    
    
    let enquiryAssignedTo = '';
    
    if (rawAssignedTo) {
      const assignedToStr = String(rawAssignedTo).trim();
      // Try to find matching user by ID (handle various ID formats)
      if (users && Array.isArray(users) && users.length > 0) {
        const foundUser = users.find(u => {
          const userId = String(u.id || u._id || '').trim();
          return userId === assignedToStr ||
                 userId.replace(/\s/g, '') === assignedToStr.replace(/\s/g, '') ||
                 String(userId).toLowerCase() === assignedToStr.toLowerCase();
        });
        if (foundUser) {
          enquiryAssignedTo = String(foundUser.id || foundUser._id).trim();
        } else {
          // If no match found, use the raw value (might be valid but users not loaded yet)
          enquiryAssignedTo = assignedToStr;
        }
      } else {
        // Users not loaded yet, use raw value
        enquiryAssignedTo = assignedToStr;
      }
    }
    
    
    // Extract weight data
    const metalWeight = originalData?.MetalWeight || enquiry.MetalWeight || enquiry.metalWeight || {};
    const diamondWeight = originalData?.DiamondWeight || enquiry.DiamondWeight || enquiry.diamondWeight || {};
    
    return {
      title: enquiry.title || enquiry.Name || originalData?.Name || '',
      description: enquiry.description || enquiry.Remarks || originalData?.Remarks || '',
      clientId: enquiryClientId,
      clientName: clientName,
      status: enquiryStatus,
      assignedTo: enquiryAssignedTo,
      priority: mappedPriority,
      category: enquiry.category || enquiry.Category || originalData?.Category || 'Ring',
      metalColor: originalData?.Metal?.Color || enquiry.Metal?.Color || originalData?.metal?.color || '',
      metalQuality: originalData?.Metal?.Quality || enquiry.Metal?.Quality || originalData?.metal?.quality || '10K',
      stoneType: enquiry.stoneType || enquiry.StoneType || originalData?.StoneType || originalData?.stoneType || '',
      quantity: safeToString(originalData?.Quantity || enquiry.Quantity || enquiry.quantity || '1'),
      stamping: safeToString(originalData?.Stamping || enquiry.stamping || enquiry.Stamping || ''),
      GatiOrderNumber: safeToString(originalData?.GatiOrderNumber || enquiry.GatiOrderNumber || enquiry.GatiOrderNumber || ''),
      styleNumber: safeToString(originalData?.StyleNumber || enquiry.StyleNumber || enquiry.styleNumber || ''),
      metalWeightFrom: safeToString(metalWeight.From || metalWeight.from || ''),
      metalWeightTo: safeToString(metalWeight.To || metalWeight.to || ''),
      metalWeightExact: safeToString(metalWeight.Exact || metalWeight.exact || ''),
      diamondWeightFrom: safeToString(diamondWeight.From || diamondWeight.from || ''),
      diamondWeightTo: safeToString(diamondWeight.To || diamondWeight.to || ''),
      diamondWeightExact: safeToString(diamondWeight.Exact || diamondWeight.exact || ''),
      deadline: formatDateForInput(originalData?.ShippingDate || enquiry.ShippingDate || enquiry.deadline || ''),
      budget: safeToString(originalData?.Budget || enquiry.Budget || enquiry.budget || ''),
      specialRemarks: safeToString(originalData?.SpecialRemarks || enquiry.SpecialRemarks || enquiry.specialRemarks || ''),
      approvedDate: formatDateForInput(originalData?.ApprovedDate || enquiry.ApprovedDate || enquiry.approvedDate || ''),
    };
  };

  // Initialize form data - use empty form initially, will be populated in useEffect
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    clientId: '',
    clientName: '',
    status: 'Enquiry Created',
    assignedTo: '',
    priority: 'Normal',
    category: 'Ring',
    metalColor: 'Gold',
    metalQuality: '10K',
    stoneType: '', // Optional field - no default
    quantity: '1',
    stamping: '',
    GatiOrderNumber: '',
    styleNumber: '',
    metalWeightFrom: '',
    metalWeightTo: '',
    metalWeightExact: '',
    diamondWeightFrom: '',
    diamondWeightTo: '',
    diamondWeightExact: '',
    deadline: '',
    budget: '',
    specialRemarks: '',
    approvedDate: '',
  });
  const [errors, setErrors] = useState({});
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showMetalColorDropdown, setShowMetalColorDropdown] = useState(false);
  const [showMetalQualityDropdown, setShowMetalQualityDropdown] = useState(false);
  const [showStoneTypeDropdown, setShowStoneTypeDropdown] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showAssignedToDropdown, setShowAssignedToDropdown] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());
  const [showApprovedDatePicker, setShowApprovedDatePicker] = useState(false);
  const [tempApprovedDate, setTempApprovedDate] = useState(new Date());

  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  const showAlert = (title, message, type = 'info', buttons = []) =>
    setAlertConfig({ visible: true, title, message, type, buttons });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));

  // Update form data when enquiry changes or when fetched data arrives
  useEffect(() => {
    // Wait for fetched enquiry if we're fetching
    if (fetchingEnquiry) {
      return;
    }
    
    // Use a unique identifier to detect changes - use enquiry ID or timestamp
    const currentEnquiryId = finalEnquiryToEdit?.id || finalEnquiryToEdit?._id || enquiryId;
    
    if (currentEnquiryId && finalEnquiryToEdit) {
      const initialData = getInitialFormData();
      setFormData(initialData);
    }
  }, [finalEnquiryToEdit?.id, finalEnquiryToEdit?._id, enquiryId, fetchingEnquiry, clientsData?.length, statusOptions, users]);

  // Client role: keep ClientId/Name in form for API; field is hidden in UI
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
      user.name ||
      user.fullName ||
      user.Name ||
      user.email ||
      '';

    setFormData(prev => ({
      ...prev,
      clientId: user.clientId,
      clientName: nameFromDirectory || nameFromUser || prev.clientName || '',
    }));
  }, [
    isClient,
    user?.clientId,
    user?.name,
    user?.fullName,
    user?.Name,
    user?.email,
    clients,
  ]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  // Handle status change - clear assignedTo if current user is not valid for new status
  const handleStatusChange = (newStatus) => {
    handleInputChange('status', newStatus);
    
    // If there's a currently assigned user, check if they're still valid for the new status
    if (formData.assignedTo) {
      const statusLower = String(newStatus || '').toLowerCase();
      const assignedUser = users.find(u => {
        const userId = String(u.id || u._id).trim();
        const assignedToId = String(formData.assignedTo).trim();
        return userId === assignedToId;
      });
      
      if (assignedUser) {
        const roleNumber = typeof assignedUser.role === 'number' 
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

    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    }

    if (!isClient && !formData.clientId && !formData.clientName.trim()) {
      newErrors.clientId = 'Client is required';
    }
    if (isClient && !formData.clientId && !user?.clientId) {
      newErrors.clientId = 'Client account is not linked to this login';
    }

    if (formData.quantity && formData.quantity.trim() && isNaN(parseInt(formData.quantity))) {
      newErrors.quantity = 'Quantity must be a number';
    }

    // Note: Client email and phone are not part of enquiry payload, so they're not included in the form

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const renderDropdown = (label, value, options, onSelect, isVisible, onToggle, usersList = []) => {
    // Find matching option - handle case-insensitive matching for status and robust ID matching for AssignedTo
    const findOption = (val) => {
      if (!val) return null;
      const valStr = String(val).trim();
      
      // Exact match first
      let option = options.find(opt => {
        const optVal = String(opt.value).trim();
        return optVal === valStr;
      });
      if (option) return option;
      
      // Case-insensitive match (for status field)
      if (label.includes('Status')) {
        option = options.find(opt => {
          const optVal = String(opt.value).toLowerCase().trim();
          const valLower = valStr.toLowerCase().trim();
          return optVal === valLower;
        });
        if (option) return option;
        
        // Try partial match for status
        option = options.find(opt => {
          const optVal = String(opt.value).toLowerCase();
          const valLower = valStr.toLowerCase();
          return optVal.includes(valLower) || valLower.includes(optVal);
        });
        if (option) return option;
      }
      
      // For Assigned To, try to find by ID with various matching strategies
      if (label.includes('Assigned')) {
        // Try exact match with trimmed values
        option = options.find(opt => {
          const optVal = String(opt.value).trim();
          return optVal === valStr;
        });
        if (option) return option;
        
        // Try match without spaces
        const valNoSpaces = valStr.replace(/\s/g, '');
        option = options.find(opt => {
          const optVal = String(opt.value).trim().replace(/\s/g, '');
          return optVal === valNoSpaces;
        });
        if (option) return option;
        
        // Try case-insensitive match
        option = options.find(opt => {
          const optVal = String(opt.value).toLowerCase().trim();
          return optVal === valStr.toLowerCase().trim();
        });
        if (option) return option;
        
        // Try to find in usersList if provided (fallback)
        if (usersList && usersList.length > 0) {
          const foundUser = usersList.find(u => {
            const userId = String(u.id || u._id || '').trim();
            return userId === valStr ||
                   userId.replace(/\s/g, '') === valStr.replace(/\s/g, '') ||
                   userId.toLowerCase() === valStr.toLowerCase();
          });
          if (foundUser) {
            // Create a temporary option for display
            return {
              label: foundUser.name || foundUser.email || String(foundUser.id || foundUser._id),
              value: String(foundUser.id || foundUser._id).trim(),
            };
          }
        }
      }
      
      return null;
    };
    
    const selectedOption = findOption(value);
    
    // Determine display text
    let displayText = selectedOption?.label;
    if (!displayText && value) {
      if (label.includes('Assigned')) {
        // For Assigned To, try to find user name from users list with robust matching
        const valStr = String(value).trim();
        const user = usersList.find(u => {
          const userId = String(u.id || u._id || '').trim();
          return userId === valStr ||
                 userId.replace(/\s/g, '') === valStr.replace(/\s/g, '') ||
                 userId.toLowerCase() === valStr.toLowerCase();
        });
        if (user) {
          displayText = user.name || user.email || `User ${user.id || user._id}`;
        } else {
          // If user not found, show the ID value
          displayText = `User ID: ${valStr}`;
        }
      } else if (label.includes('Status')) {
        // For Status, try to show the value even if not in options
        displayText = String(value);
      } else {
        // For other fields, just show the value
        displayText = String(value);
      }
    }
    if (!displayText) {
      displayText = `Select ${label}`;
    }
    
    
    return (
    <View style={styles.dropdownContainer}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <TouchableOpacity
        style={styles.dropdown}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <Text style={styles.dropdownText}>
            {displayText}
        </Text>
        <IconComponent name="arrow-drop-down" size={24} color={colors.textSecondary} />
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
            <ScrollView showsVerticalScrollIndicator={false}  style={{height: '100%'}}   >
            {options.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.dropdownOption,
                  value === option.value && styles.dropdownOptionSelected,
                ]}
                onPress={() => {
                  onSelect(option.value);
                  onToggle();
                }}
              >
                <Text
                  style={[
                    styles.dropdownOptionText,
                    value === option.value && styles.dropdownOptionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
                {value === option.value && (
                  <IconComponent name="check" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
  };

  const handleNext = async () => {
    if (!validateForm()) {
      return;
    }

    if (!user?.id) {
      showAlert('Error', 'User not authenticated', 'error');
      return;
    }

    if (!finalEnquiryToEdit?.id && !enquiryId) {
      showAlert('Error', 'Enquiry ID is missing', 'error');
      return;
    }

    const enquiryIdToUpdate = finalEnquiryToEdit?.id || enquiryId;

    try {
      // Priority mapping for API
      const priorityForAPI = formData.priority || 'Normal';

      // Prepare enquiry data according to API payload structure
      const enquiryData = {
        Id: enquiryIdToUpdate,
        Name: formData.title,
        ClientId: isClient
          ? formData.clientId || user.clientId || finalEnquiryToEdit?.clientId || finalEnquiryToEdit?.ClientId
          : formData.clientId || finalEnquiryToEdit?.clientId || finalEnquiryToEdit?.ClientId,
        AssignedTo: formData.assignedTo || finalEnquiryToEdit?.AssignedTo || finalEnquiryToEdit?.assignedTo || null,
        Status: formData.status || finalEnquiryToEdit?.Status || finalEnquiryToEdit?.status || 'Enquiry Created',
        Priority: priorityForAPI,
        Quantity: formData.quantity && formData.quantity.trim() ? parseInt(formData.quantity) : null,
        Metal: {
          Color: formData.metalColor || null,
          Quality: formData.metalQuality || '10K',
        },
        StyleNumber: formData.styleNumber && formData.styleNumber.trim() ? formData.styleNumber : null,
        GatiOrderNumber: formData.GatiOrderNumber && formData.GatiOrderNumber.trim() ? formData.GatiOrderNumber : null,
        StoneType: formData.stoneType && formData.stoneType.trim() ? formData.stoneType.trim() : null,
        MetalWeight: {
          From: formData.metalWeightFrom && formData.metalWeightFrom.trim() ? formData.metalWeightFrom.toString() : null,
          To: formData.metalWeightTo && formData.metalWeightTo.trim() ? formData.metalWeightTo.toString() : null,
          Exact: formData.metalWeightExact && formData.metalWeightExact.trim() ? formData.metalWeightExact.toString() : null,
        },
        DiamondWeight: {
          From: formData.diamondWeightFrom && formData.diamondWeightFrom.trim() ? formData.diamondWeightFrom.toString() : null,
          To: formData.diamondWeightTo && formData.diamondWeightTo.trim() ? formData.diamondWeightTo.toString() : null,
          Exact: formData.diamondWeightExact && formData.diamondWeightExact.trim() ? formData.diamondWeightExact.toString() : null,
        },
        Stamping: formData.stamping && formData.stamping.trim() ? formData.stamping : null,
        Remarks: formData.description && formData.description.trim() ? formData.description : null,
        ShippingDate: formData.deadline && formData.deadline.trim() ? formData.deadline : null,
        CoralCode: finalEnquiryToEdit?.CoralCode || finalEnquiryToEdit?.coralCode || null,
        CadCode: finalEnquiryToEdit?.CadCode || finalEnquiryToEdit?.cadCode || null,
        Category: formData.category || 'Ring',
        Budget: formData.budget && formData.budget.trim() ? formData.budget.trim() : null,
        SpecialRemarks: formData.specialRemarks && formData.specialRemarks.trim() ? formData.specialRemarks.trim() : null,
        ApprovedDate: formData.approvedDate && formData.approvedDate.trim() ? formData.approvedDate : null,
      };

      

      await updateEnquiry({ id: enquiryIdToUpdate, ...enquiryData }).unwrap();
      
      showAlert(
        'Enquiry Updated',
        'Your enquiry has been updated successfully!',
        'info',
        [
          {
            text: 'OK',
            onPress: () => {
              // Go back to SingleEnquiry screen (removes EditEnquiryStep1 from stack)
              // The SingleEnquiry screen will automatically refresh due to cache invalidation
              navigation.goBack();
            },
          },
        ]
      );
    } catch (error) {
      showAlert(
        'Error',
        error?.data?.error || error?.message || 'Failed to update enquiry. Please try again.',
        'error',
        [{ text: 'OK', onPress: () => {} }]
      );
      // Don't navigate on error - stay on the form
      return;
    }
  };

  const priorityOptions = [
    { label: 'Normal', value: 'Normal' },
    { label: 'High', value: 'High' },
    { label: 'Super High', value: 'Super High' },
  ];

  // Create assigned-to options from users (exclude clients by role) - memoized to prevent recreation
  // Filter based on selected status:
  // - If status is "CAD", show only users with role === 3
  // - If status is "Coral", show only users with role === 2
  // - Otherwise, show all non-client users
  // Always include currently assigned user even if they don't match status filter (for display)
  const assignedToOptions = useMemo(() => {
    const statusLower = String(formData.status || '').toLowerCase();
    const currentAssignedToId = String(formData.assignedTo || '').trim();
    
    // First, get all valid users based on status
    const validUsers = users.filter(user => {
      const roleString = String(user.role || '').toLowerCase();
      const roleNumber = typeof user.role === 'number' ? user.role : parseInt(user.role);
      
      // Always exclude clients
      if (roleString === 'client' || roleNumber === 4) {
        return false;
      }
      
      // Filter based on status
      if (statusLower === 'cad') {
        // Show only users with role === 3 for CAD status
        return roleNumber === 3;
      } else if (statusLower === 'coral') {
        // Show only users with role === 2 for Coral status
        return roleNumber === 2;
      }
      
      // For other statuses, show all non-client users
      return true;
    });
    
    // If there's a currently assigned user, make sure they're included even if filtered out
    let finalUsers = [...validUsers];
    if (currentAssignedToId) {
      const assignedUser = users.find(u => {
        const userId = String(u.id || u._id || '').trim();
        return userId === currentAssignedToId ||
               userId.replace(/\s/g, '') === currentAssignedToId.replace(/\s/g, '') ||
               userId.toLowerCase() === currentAssignedToId.toLowerCase();
      });
      
      if (assignedUser) {
        // Check if already in validUsers
        const alreadyIncluded = validUsers.some(u => {
          const userId = String(u.id || u._id || '').trim();
          const assignedId = String(assignedUser.id || assignedUser._id || '').trim();
          return userId === assignedId;
        });
        
        if (!alreadyIncluded) {
          // Add the assigned user to the list
          finalUsers.push(assignedUser);
        }
      }
    }
    
    // Map to options format
    const options = finalUsers.map(user => ({
      label: user.name || user.email || 'Unknown',
      value: String(user.id || user._id).trim(), // Ensure value is a string
    }));
    
    return options;
  }, [users, formData.status, formData.assignedTo]);


  const categoryOptions = [
    { label: 'Necklace', value: 'Necklace' },
    { label: 'Ring', value: 'Ring' },
    { label: 'Earring', value: 'Earring' },
    { label: 'Bracelet', value: 'Bracelet' },
    { label: 'Pendant', value: 'Pendant' },
    { label: 'Hoops', value: 'Hoops' },
    { label: 'Chain', value: 'Chain' },
    { label: 'Bangle', value: 'Bangle' },
    { label: 'Belt Buckle', value: 'Belt Buckle' },
    { label: 'Custom', value: 'Custom' },
  ];

  const metalColorOptions = [
    { label: 'White Gold', value: 'White Gold' },
    { label: 'Rose Gold', value: 'Rose Gold' },
    { label: 'Yellow Gold', value: 'Yellow Gold' },
    { label: 'Two Tone Rose White Gold', value: 'Two Tone Rose White Gold' },
    { label: 'Two Tone Yellow White Gold', value: 'Two Tone Yellow White Gold' },
    { label: 'Three Tone Rose Yellow White Gold', value: 'Three Tone Rose Yellow White Gold' },
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
  const stoneTypeOptions = [{ label: 'None', value: '' }, ...(stoneTypesData || [])];

  if (fetchingEnquiry) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading enquiry data...</Text>
      </View>
    );
  }

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={true}>
      <View style={styles.header}>
        <Heading level={3}>Edit Enquiry</Heading>
        <CustomText variant="caption" color="secondary">
          Update enquiry information
        </CustomText>
      </View>

      <View style={styles.form}>
        {/* Row 1: Name and Client (client picker staff only) */}
        <View style={styles.formRow}>
          <View
            style={[
              styles.formField,
              isClient && styles.fullWidthField,
            ]}>
            <Input
              label="Name*"
              placeholder="Name*"
              value={formData.title}
              onChangeText={(value) => handleInputChange('title', value)}
              error={errors.title}
            />
          </View>
          {!isClient && (
            <View style={styles.formField}>
              <View style={styles.dropdownContainer}>
                <Text style={styles.dropdownLabel}>Client</Text>
                <View style={[styles.dropdown, styles.disabledDropdown]}>
                  <Text
                    style={[styles.dropdownText, styles.disabledText]}
                    numberOfLines={2}
                  >
                    {formData.clientName?.trim() || '—'}
                  </Text>
                  <IconComponent name="lock" size={20} color={colors.textSecondary} />
                </View>
                {/* <Text style={styles.readOnlyHint}>Client cannot be changed when editing</Text> */}
              </View>
            </View>
          )}
        </View>
        {isClient && errors.clientId ? (
          <Text style={styles.errorText}>{errors.clientId}</Text>
        ) : null}

        {/* Row 2: Priority (staff only) and Category */}
        <View style={styles.formRow}>
          {!isClient && (
            <View style={styles.formField}>
              <View style={styles.priorityContainer}>
                <Text style={styles.priorityLabel}>Priority</Text>
                <View style={styles.priorityOptions}>
                  {priorityOptions.map(option => (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.priorityOption,
                        formData.priority === option.value && styles.priorityOptionActive,
                      ]}
                      onPress={() => handleInputChange('priority', option.value)}>
                      <Text
                        style={[
                          styles.priorityOptionText,
                          formData.priority === option.value && styles.priorityOptionTextActive,
                        ]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          )}
          <View style={[styles.formField, isClient && styles.fullWidthField]}>
            {renderDropdown(
              'Category',
              formData.category,
              categoryOptions,
              (value) => handleInputChange('category', value),
              showCategoryDropdown,
              () => setShowCategoryDropdown(!showCategoryDropdown)
            )}
          </View>
        </View>

        {/* Row 3: Stamping and Quantity */}
        <View style={styles.formRow}>
          <View style={styles.formField}>
            <Input
              label="Stamping"
              placeholder="Stamping"
              value={formData.stamping}
              onChangeText={(value) => handleInputChange('stamping', value)}
            />
          </View>
          <View style={styles.formField}>
            <Input
              label="Quantity"
              placeholder="Quantity"
              value={formData.quantity}
              onChangeText={(value) => handleInputChange('quantity', value)}
              keyboardType="numeric"
              error={errors.quantity}
            />
          </View>
        </View>

        {/* Row 4: Status and Assigned To */}
        <View style={styles.formRow}>
          <View style={styles.formField}>
            {renderDropdown(
              'Status*',
              formData.status,
              statusOptions,
              (value) => handleStatusChange(value),
              showStatusDropdown,
              () => setShowStatusDropdown(!showStatusDropdown),
              [] // No users needed for status
            )}
          </View>
          <View style={styles.formField}>
            {renderDropdown(
              'Assigned To',
              formData.assignedTo,
              assignedToOptions,
              (value) => handleInputChange('assignedTo', value),
              showAssignedToDropdown,
              () => setShowAssignedToDropdown(!showAssignedToDropdown),
              users // Pass users list to find name if ID doesn't match options
            )}
          </View>
        </View>

        {/* Row 5: Stone Type (full width) */}
        <View style={styles.formRow}>
          <View style={[styles.formField, styles.fullWidthField]}>
            {renderDropdown(
              'Stone Type',
              formData.stoneType,
              stoneTypeOptions,
              (value) => handleInputChange('stoneType', value),
              showStoneTypeDropdown,
              () => setShowStoneTypeDropdown(!showStoneTypeDropdown)
            )}
          </View>
        </View>

        {/* Row 6: Gati Order and Style Number */}
        <View style={styles.formRow}>
          <View style={styles.formField}>
            <Input
              label="Gati Order"
              placeholder="Gati Order"
              value={formData.GatiOrderNumber}
              onChangeText={(value) => handleInputChange('GatiOrderNumber', value)}
            />
          </View>
          <View style={styles.formField}>
            <Input
              label="Style Number"
              placeholder="Style Number"
              value={formData.styleNumber}
              onChangeText={(value) => handleInputChange('styleNumber', value)}
            />
          </View>
        </View>

        {/* Row 7: Metal Quality and Metal Color */}
        <View style={styles.formRow}>
          <View style={styles.formField}>
            {renderDropdown(
              'Metal Quality*',
              formData.metalQuality,
              metalQualityOptions,
              (value) => handleInputChange('metalQuality', value),
              showMetalQualityDropdown,
              () => setShowMetalQualityDropdown(!showMetalQualityDropdown)
            )}
          </View>
          <View style={styles.formField}>
            {renderDropdown(
              'Metal Color*',
              formData.metalColor,
              metalColorOptions,
              (value) => handleInputChange('metalColor', value),
              showMetalColorDropdown,
              () => setShowMetalColorDropdown(!showMetalColorDropdown)
            )}
          </View>
        </View>

        {/* Row 8: Metal Weight - From, To, Exact */}
        <View style={styles.formRow}>
          <View style={styles.formField}>
            <Input
              label="Metal Weight - From"
              placeholder="From (gms)"
              value={formData.metalWeightFrom}
              onChangeText={(value) => handleInputChange('metalWeightFrom', value)}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.formField}>
            <Input
              label="Metal Weight - To"
              placeholder="To (gms)"
              value={formData.metalWeightTo}
              onChangeText={(value) => handleInputChange('metalWeightTo', value)}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.formField}>
            <Input
              label="Metal Weight - Exact"
              placeholder="Exact (gms)"
              value={formData.metalWeightExact}
              onChangeText={(value) => handleInputChange('metalWeightExact', value)}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        {/* Row 9: Diamond Weight - From, To, Exact */}
        <View style={styles.formRow}>
          <View style={styles.formField}>
            <Input
              label="Diamond Weight - From"
              placeholder="From (ct)"
              value={formData.diamondWeightFrom}
              onChangeText={(value) => handleInputChange('diamondWeightFrom', value)}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.formField}>
            <Input
              label="Diamond Weight - To"
              placeholder="To (ct)"
              value={formData.diamondWeightTo}
              onChangeText={(value) => handleInputChange('diamondWeightTo', value)}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.formField}>
            <Input
              label="Diamond Weight - Exact"
              placeholder="Exact (ct)"
              value={formData.diamondWeightExact}
              onChangeText={(value) => handleInputChange('diamondWeightExact', value)}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        {/* Row 10: Shipping Date */}
        <View style={styles.formRow}>
          <View style={[styles.formField, styles.fullWidthField]}>
            <Text style={styles.label}>Shipping Date</Text>
            <TouchableOpacity
              style={styles.dateInputButton}
              onPress={() => {
                if (formData.deadline) {
                  try {
                    setTempDate(new Date(formData.deadline));
                  } catch (e) {
                    setTempDate(new Date());
                  }
                } else {
                  setTempDate(new Date());
                }
                setShowDatePicker(true);
              }}
              activeOpacity={0.7}>
              <Text style={[
                styles.dateInputText,
                !formData.deadline && styles.dateInputPlaceholder,
              ]}>
                {formData.deadline || 'Select Shipping Date'}
              </Text>
              <IconComponent 
                name="calendar-today" 
                size={20} 
                color={colors.primary} 
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Row 10.5: Budget (full width) */}
        <View style={styles.formRow}>
          <View style={[styles.formField, styles.fullWidthField]}>
            <Input
              label="Budget"
              placeholder="Enter budget amount"
              value={formData.budget}
              onChangeText={(value) => handleInputChange('budget', value)}
            />
          </View>
        </View>

        {/* Row 11: Remarks (full width textarea) */}
        <View style={styles.formRow}>
          <View style={[styles.formField, styles.fullWidthField]}>
            <Input
              label="Remarks"
              placeholder="Remarks"
              value={formData.description}
              onChangeText={(value) => handleInputChange('description', value)}
              multiline
              numberOfLines={4}
              error={errors.description}
            />
          </View>
        </View>

        {/* Row 12: Special Remarks (full width textarea) - Hidden for clients */}
        {user?.role?.toLowerCase() !== 'client' && user?.roleId !== 4 && user?.roleNumber !== 4 && (
          <View style={styles.formRow}>
            <View style={[styles.formField, styles.fullWidthField]}>
              <Input
                label="Special Remarks"
                placeholder="Special Remarks"
                value={formData.specialRemarks}
                onChangeText={(value) => handleInputChange('specialRemarks', value)}
                multiline
                numberOfLines={4}
              />
            </View>
          </View>
        )}

        {/* Row 13: Approved Date (full width) - Hidden for clients */}
        {user?.role?.toLowerCase() !== 'client' && user?.roleId !== 4 && user?.roleNumber !== 4 && (
          <View style={styles.formRow}>
            <View style={[styles.formField, styles.fullWidthField]}>
              <Text style={styles.label}>Approved Date</Text>
              <TouchableOpacity
                style={styles.dateInputButton}
                onPress={() => {
                  if (formData.approvedDate) {
                    try {
                      setTempApprovedDate(new Date(formData.approvedDate));
                    } catch (e) {
                      setTempApprovedDate(new Date());
                    }
                  } else {
                    setTempApprovedDate(new Date());
                  }
                  setShowApprovedDatePicker(true);
                }}
                activeOpacity={0.7}>
                <Text style={[
                  styles.dateInputText,
                  !formData.approvedDate && styles.dateInputPlaceholder,
                ]}>
                  {formData.approvedDate || 'Select Approved Date'}
                </Text>
                <IconComponent 
                  name="calendar-today" 
                  size={20} 
                  color={colors.primary} 
                />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Date Picker Modal */}
        {showDatePicker && Platform.OS === 'ios' && (
          <Modal
            transparent={true}
            animationType="slide"
            visible={showDatePicker}
            onRequestClose={() => setShowDatePicker(false)}>
            <TouchableOpacity
              style={styles.datePickerModal}
              activeOpacity={1}
              onPress={() => setShowDatePicker(false)}>
              <TouchableOpacity
                activeOpacity={1}
                onPress={(e) => e.stopPropagation()}
                style={styles.datePickerContainer}>
                <View style={styles.datePickerHeader}>
                  <TouchableOpacity
                    onPress={() => setShowDatePicker(false)}
                    style={styles.datePickerCancel}>
                    <Text style={styles.datePickerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={styles.datePickerTitle}>Select Shipping Date</Text>
                  <TouchableOpacity
                    onPress={() => {
                      const formattedDate = tempDate.toISOString().split('T')[0];
                      handleInputChange('deadline', formattedDate);
                      setShowDatePicker(false);
                    }}
                    style={styles.datePickerDone}>
                    <Text style={styles.datePickerDoneText}>Done</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={tempDate}
                  mode="date"
                  display="spinner"
                  onChange={(event, date) => {
                    if (date) setTempDate(date);
                  }}
                  style={styles.datePicker}
                />
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        )}
        {showDatePicker && Platform.OS === 'android' && (
          <DateTimePicker
            value={tempDate}
            mode="date"
            display="default"
            onChange={(event, date) => {
              setShowDatePicker(false);
              if (event.type === 'set' && date) {
                const formattedDate = date.toISOString().split('T')[0];
                handleInputChange('deadline', formattedDate);
              }
            }}
          />
        )}

        {/* Approved Date Picker Modal - Hidden for clients */}
        {user?.role?.toLowerCase() !== 'client' && user?.roleId !== 4 && user?.roleNumber !== 4 && showApprovedDatePicker && Platform.OS === 'ios' && (
          <Modal
            transparent={true}
            animationType="slide"
            visible={showApprovedDatePicker}
            onRequestClose={() => setShowApprovedDatePicker(false)}>
            <TouchableOpacity
              style={styles.datePickerModal}
              activeOpacity={1}
              onPress={() => setShowApprovedDatePicker(false)}>
              <TouchableOpacity
                activeOpacity={1}
                onPress={(e) => e.stopPropagation()}
                style={styles.datePickerContainer}>
                <View style={styles.datePickerHeader}>
                  <TouchableOpacity
                    onPress={() => setShowApprovedDatePicker(false)}
                    style={styles.datePickerCancel}>
                    <Text style={styles.datePickerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={styles.datePickerTitle}>Select Approved Date</Text>
                  <TouchableOpacity
                    onPress={() => {
                      const formattedDate = tempApprovedDate.toISOString().split('T')[0];
                      handleInputChange('approvedDate', formattedDate);
                      setShowApprovedDatePicker(false);
                    }}
                    style={styles.datePickerDone}>
                    <Text style={styles.datePickerDoneText}>Done</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={tempApprovedDate}
                  mode="date"
                  display="spinner"
                  onChange={(event, date) => {
                    if (date) setTempApprovedDate(date);
                  }}
                  style={styles.datePicker}
                />
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        )}
        {user?.role?.toLowerCase() !== 'client' && user?.roleId !== 4 && user?.roleNumber !== 4 && showApprovedDatePicker && Platform.OS === 'android' && (
          <DateTimePicker
            value={tempApprovedDate}
            mode="date"
            display="default"
            onChange={(event, date) => {
              setShowApprovedDatePicker(false);
              if (event.type === 'set' && date) {
                const formattedDate = date.toISOString().split('T')[0];
                handleInputChange('approvedDate', formattedDate);
              }
            }}
          />
        )}

        <Button
          title={isUpdating ? "Saving..." : "Save"}
          onPress={handleNext}
          style={styles.nextButton}
          disabled={isUpdating}
        />
      </View>
      <BrandedAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        buttons={alertConfig.buttons}
        onClose={hideAlert}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    padding: 20,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  form: {
    padding: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 16,
    fontSize: fonts.base,
    fontWeight: '600',
  },
  dropdownContainer: {
    marginBottom: 16,
  },
  dropdownLabel: {
    marginBottom: 8,
    fontSize: fonts.sm,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  dropdownText: {
    fontSize: fonts.base,
    color: colors.textPrimary,
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
    padding: 16,
    width: '80%',
    maxHeight: '70%',
  },
  dropdownOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
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
    fontSize: fonts.base,
    color: colors.textPrimary,
  },
  dropdownOptionTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  disabledDropdown: {
    backgroundColor: colors.backgroundSecondary,
    opacity: 0.85,
  },
  disabledText: {
    color: colors.textSecondary,
    flex: 1,
    paddingRight: 8,
  },
  readOnlyHint: {
    marginTop: 6,
    fontSize: fonts.sm,
    color: colors.textSecondary,
    fontFamily: fonts.regular,
  },
  priorityContainer: {
    marginBottom: 16,
  },
  priorityLabel: {
    marginBottom: 8,
    fontSize: fonts.sm,
    fontWeight: '500',
  },
  priorityOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  priorityOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
    marginBottom: 8,
  },
  priorityOptionActive: {
    backgroundColor: colors.background, // Light background for black text readability
    borderColor: colors.primary,
    borderWidth: 2, // Thicker border to indicate selection
  },
  priorityOptionText: {
    fontSize: fonts.sm,
    color: colors.textPrimary, // Black text
    fontWeight: '500',
  },
  priorityOptionTextActive: {
    fontSize: fonts.sm,
    color: colors.textPrimary, // Black text when selected
    fontWeight: '600',
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  formField: {
    flex: 1,
  },
  fullWidthField: {
    flex: 1,
    width: '100%',
  },
  nextButton: {
    marginTop: 24,
  },
  errorText: {
    color: colors.error,
    fontSize: fonts.sm,
    marginTop: 4,
    marginLeft: 4,
  },
  loadingText: {
    textAlign: 'center',
    padding: 20,
    color: colors.textSecondary,
  },
  label: {
    marginBottom: 8,
    fontSize: fonts.sm,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  dateInputButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    minHeight: 50,
    marginTop: 4,
  },
  dateInputButtonSelected: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  dateInputText: {
    fontSize: fonts.base,
    color: colors.textPrimary,
    flex: 1,
  },
  dateInputTextSelected: {
    color: colors.primary,
    fontWeight: '500',
  },
  dateInputPlaceholder: {
    color: colors.textSecondary,
  },
  datePickerModal: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
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
});

export default EditEnquiryStep1Screen;

