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
import { useGetEnquiryByIdQuery, useUpdateEnquiryMutation, useGetStoneTypesQuery } from '../../store/api';
import { useClients } from '../../features/clients/clientsHooks';
import { useAuth } from '../../context/AuthContext';
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

  // Fetch stone types from API
  const { data: stoneTypesData = [] } = useGetStoneTypesQuery();

  // Map enquiry data to form format
  const getInitialFormData = () => {
    const enquiry = finalEnquiryToEdit;
    
    if (!enquiry || !enquiry.id) {
      return {
        title: '',
        description: '',
        clientId: '',
        clientName: '',
        priority: 'Normal',
        stoneType: 'NaturalRegular',
        budget: '',
        specialRemarks: '',
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
    
    return {
      title: enquiry.title || enquiry.Name || originalData?.Name || '',
      description: enquiry.description || enquiry.Remarks || originalData?.Remarks || '',
      clientId: enquiryClientId,
      clientName: clientName,
      priority: mappedPriority,
      stoneType: enquiry.stoneType || enquiry.StoneType || originalData?.StoneType || originalData?.stoneType || '',
      deadline: formatDateForInput(originalData?.ShippingDate || enquiry.ShippingDate || enquiry.deadline || ''),
      budget: safeToString(originalData?.Budget || enquiry.Budget || enquiry.budget || ''),
      specialRemarks: safeToString(originalData?.SpecialRemarks || enquiry.SpecialRemarks || enquiry.specialRemarks || ''),
    };
  };

  // Initialize form data - use empty form initially, will be populated in useEffect
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    clientId: '',
    clientName: '',
    priority: 'Normal',
    stoneType: '', // Optional field - no default
    deadline: '',
    budget: '',
    specialRemarks: '',
  });
  const [errors, setErrors] = useState({});
  const [showStoneTypeDropdown, setShowStoneTypeDropdown] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());

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
  }, [finalEnquiryToEdit?.id, finalEnquiryToEdit?._id, enquiryId, fetchingEnquiry, clientsData?.length]);

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

    // Note: Client email and phone are not part of enquiry payload, so they're not included in the form

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const renderDropdown = (label, value, options, onSelect, isVisible, onToggle) => {
    const findOption = (val) => {
      if (!val) return null;
      const valStr = String(val).trim();
      
      let option = options.find(opt => {
        const optVal = String(opt.value).trim();
        return optVal === valStr;
      });
      if (option) return option;
      
      return null;
    };
    
    const selectedOption = findOption(value);
    
    let displayText = selectedOption?.label;
    if (!displayText && value) {
      displayText = String(value);
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
        Priority: priorityForAPI,
        StoneType: formData.stoneType && formData.stoneType.trim() ? formData.stoneType.trim() : null,
        Remarks: formData.description && formData.description.trim() ? formData.description : null,
        ShippingDate: formData.deadline && formData.deadline.trim() ? formData.deadline : null,
        CoralCode: finalEnquiryToEdit?.CoralCode || finalEnquiryToEdit?.coralCode || null,
        CadCode: finalEnquiryToEdit?.CadCode || finalEnquiryToEdit?.cadCode || null,
        Budget: formData.budget && formData.budget.trim() ? formData.budget.trim() : null,
        SpecialRemarks: formData.specialRemarks && formData.specialRemarks.trim() ? formData.specialRemarks.trim() : null,
      };

      

      await updateEnquiry({ id: enquiryIdToUpdate, ...enquiryData }).unwrap();
      
      showAlert(
        'Enquiry Updated',
        'Your enquiry has been updated successfully!',
        'success',
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

        {/* Row 2: Priority */}
        {!isClient && (
          <View style={styles.formRow}>
            <View style={[styles.formField, styles.fullWidthField]}>
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
          </View>
        )}

        {/* Stone Type (full width) */}
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

        {/* Shipping Date */}
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

        {/* Budget (full width) */}
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

        {/* Remarks (full width textarea) */}
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

        {/* Special Remarks (full width textarea) - Hidden for clients */}
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
    padding: 24,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    shadowColor: colors.shadow || '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  form: {
    padding: 20,
    gap: 4,
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
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    minHeight: 48,
  },
  dropdownText: {
    fontSize: fonts.base,
    color: colors.textPrimary,
    fontWeight: '500',
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownModal: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 12,
    width: '85%',
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  dropdownOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    marginBottom: 6,
  },
  dropdownOptionSelected: {
    backgroundColor: colors.backgroundSecondary,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  dropdownOptionText: {
    fontSize: fonts.base,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  dropdownOptionTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  disabledDropdown: {
    backgroundColor: colors.backgroundSecondary,
    opacity: 0.7,
  },
  disabledText: {
    color: colors.textSecondary,
    flex: 1,
    paddingRight: 8,
    fontWeight: '500',
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
    marginBottom: 10,
    fontSize: fonts.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  priorityOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  priorityOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  priorityOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    borderWidth: 2,
  },
  priorityOptionText: {
    fontSize: fonts.sm,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  priorityOptionTextActive: {
    fontSize: fonts.sm,
    color: colors.textWhite,
    fontWeight: '700',
  },
  formRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 18,
  },
  formField: {
    flex: 1,
  },
  fullWidthField: {
    flex: 1,
    width: '100%',
  },
  nextButton: {
    marginTop: 32,
    marginBottom: 16,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
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
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  dateInputButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    minHeight: 48,
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
    fontWeight: '500',
  },
  dateInputTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  dateInputPlaceholder: {
    color: colors.textSecondary,
    fontWeight: '400',
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

