import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Text,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Button, Input } from '../common';
import Icon from '../common/Icon';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useClients } from '../../features/clients/clientsHooks';
import { useGetUsersQuery, useGetStoneTypesQuery } from '../../store/api';

const EnquiryFiltersModal = ({
  visible,
  onClose,
  filters,
  onApplyFilters,
  onClearFilters,
  user,
}) => {
  const [localFilters, setLocalFilters] = useState(filters);
  const [showDropdown, setShowDropdown] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(null);
  const [tempDate, setTempDate] = useState(new Date());

  // Check if user is a designer (coral or cad)
  const isDesigner = user?.role === 'coral' || user?.role === 'cad';

  // Fetch clients for dropdown (using cached hook) - skip for designers
  const { clients: clientsData = [] } = useClients({
    skip: !user || isDesigner,
  });

  const clients = Array.isArray(clientsData) ? clientsData : [];

  // Fetch users for Assigned To dropdown - skip for designers
  const { data: usersData = [] } = useGetUsersQuery(undefined, {
    skip: !user || isDesigner,
  });
  const users = Array.isArray(usersData) ? usersData : [];

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  // Close dropdown when modal closes
  useEffect(() => {
    if (!visible) {
      setShowDropdown(null);
    }
  }, [visible]);

  const handleFilterChange = (key, value) => {
    setLocalFilters(prev => ({ ...prev, [key]: value }));
    setShowDropdown(null);
  };

  const handleApply = () => {
    onApplyFilters(localFilters);
    onClose();
  };

  const handleClear = () => {
    const clearedFilters = {
      unassigned: false,
      priority: 'all',
      category: 'all',
      clientId: 'all',
      assignedTo: 'all',
      stoneType: 'all',
      metalColor: 'all',
      metalQuality: 'all',
      shippingDateFrom: '',
      shippingDateTo: '',
      assignedDateFrom: '',
      assignedDateTo: '',
      createdDateFrom: '',
      createdDateTo: '',
    };
    setLocalFilters(clearedFilters);
    onClearFilters();
    onClose();
  };

  // Fetch stone types from API
  const { data: stoneTypesData = [] } = useGetStoneTypesQuery();

  const priorityOptions = [
    { label: 'All Priority', value: 'all' },
    { label: 'Super High', value: 'Super High' },
    { label: 'High', value: 'High' },
    { label: 'Normal', value: 'Normal' },
  ];

  const categoryOptions = [
    { label: 'All Categories', value: 'all' },
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

  // Create client options for dropdown
  const clientOptions = [
    { label: 'All Clients', value: 'all' },
    ...clients.map(client => ({
      label: client.name || 'Unknown Client',
      value: String(client.id || client._id).trim(),
    })),
  ];

  // Create assigned-to options from users (exclude clients by role)
  const assignedToOptions = [
    { label: 'All Users', value: 'all' },
    ...users
      .filter(userItem => {
        const roleString = String(userItem.role || '').toLowerCase();
        return roleString !== 'client';
      })
      .map(userItem => ({
        label: userItem.name || userItem.email || 'Unknown',
        value: String(userItem.id || userItem._id).trim(),
      })),
  ];

  // Stone type options from API with "All Stone Types" option for filters
  const stoneTypeOptions = [
    { label: 'All Stone Types', value: 'all' },
    ...(stoneTypesData || []),
  ];

  const metalColorOptions = [
    { label: 'All Colors', value: 'all' },
    { label: 'White Gold', value: 'White Gold' },
    { label: 'Rose Gold', value: 'Rose Gold' },
    { label: 'Yellow Gold', value: 'Yellow Gold' },
    { label: 'Two Tone Rose White Gold', value: 'Two Tone Rose White Gold' },
    { label: 'Two Tone Yellow White Gold', value: 'Two Tone Yellow White Gold' },
    { label: 'Three Tone Rose Yellow White Gold', value: 'Three Tone Rose Yellow White Gold' },
  ];

  const metalQualityOptions = [
    { label: 'All Qualities', value: 'all' },
    { label: '10K', value: '10K' },
    { label: '14K', value: '14K' },
    { label: '18K', value: '18K' },
    { label: '22K', value: '22K' },
    { label: 'Silver 925', value: 'Silver 925' },
    { label: 'Platinum', value: 'Platinum' },
  ];

  const renderDropdown = (key, options, label) => {
    const isOpen = showDropdown === key;
    const selectedOption = options.find(opt => opt.value === localFilters[key]) || options[0];
    const isSelected = localFilters[key] !== 'all' && localFilters[key] !== null && localFilters[key] !== undefined;

    return (
      <View style={styles.filterField}>
        <Text style={styles.filterLabel}>{label}</Text>
        <TouchableOpacity
          style={[
            styles.dropdownButton,
            isOpen && styles.dropdownButtonOpen,
            isSelected && styles.dropdownButtonSelected,
          ]}
          onPress={() => {
            setShowDropdown(isOpen ? null : key);
          }}
          activeOpacity={0.7}>
          <View style={styles.dropdownButtonContent}>
            {isSelected && (
              <View style={styles.selectedIndicator} />
            )}
            <Text style={[
              styles.dropdownText,
              isSelected && styles.dropdownTextSelected,
            ]}>
              {selectedOption?.label || 'Select...'}
            </Text>
          </View>
          <Icon
            name={isOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
            size={20}
            color={isSelected ? colors.primary : colors.textSecondary}
          />
        </TouchableOpacity>
        {isOpen && (
          <View style={styles.dropdownList}>
            <ScrollView style={styles.dropdownScroll} nestedScrollEnabled>
              {options.map(option => {
                const isOptionSelected = localFilters[key] === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.dropdownOption,
                      isOptionSelected && styles.dropdownOptionActive,
                    ]}
                    onPress={() => handleFilterChange(key, option.value)}
                    activeOpacity={0.7}>
                    {isOptionSelected && (
                      <View style={styles.checkmarkContainer}>
                        <Icon name="check" size={16} color={colors.primary} />
                      </View>
                    )}
                    <Text
                      style={[
                        styles.dropdownOptionText,
                        isOptionSelected && styles.dropdownOptionTextActive,
                      ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>
    );
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '';
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (e) {
      return '';
    }
  };

  const handleDateChange = (event, selectedDate, dateKey) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(null);
      if (event.type === 'set' && selectedDate) {
        const formattedDate = formatDate(selectedDate.toISOString());
        handleFilterChange(dateKey, formattedDate);
      }
    } else {
      // iOS - show picker in modal
      if (event.type === 'set' && selectedDate) {
        const formattedDate = formatDate(selectedDate.toISOString());
        handleFilterChange(dateKey, formattedDate);
        setShowDatePicker(null);
      } else if (event.type === 'dismissed') {
        setShowDatePicker(null);
      }
    }
  };

  const openDatePicker = (dateKey) => {
    setShowDropdown(null); // Close any open dropdown
    const currentDate = localFilters[dateKey] 
      ? new Date(localFilters[dateKey]) 
      : new Date();
    setTempDate(currentDate);
    setShowDatePicker(dateKey);
  };

  const renderDateInput = (dateKey, placeholder) => {
    const isOpen = showDatePicker === dateKey;
    const dateValue = localFilters[dateKey] || '';
    const hasValue = !!dateValue;

    return (
      <View style={styles.dateInputContainer}>
        <TouchableOpacity
          style={[
            styles.dateInputButton,
            isOpen && styles.dateInputButtonOpen,
            hasValue && styles.dateInputButtonSelected,
          ]}
          onPress={() => openDatePicker(dateKey)}
          activeOpacity={0.7}>
          {hasValue && (
            <View style={styles.selectedIndicator} />
          )}
          <Text style={[
            styles.dateInputText,
            !dateValue && styles.dateInputPlaceholder,
            hasValue && styles.dateInputTextSelected,
          ]}>
            {dateValue || placeholder}
          </Text>
          <Icon 
            name="calendar-today" 
            size={18} 
            color={hasValue ? colors.primary : colors.textSecondary} 
          />
        </TouchableOpacity>
        {isOpen && Platform.OS === 'ios' && (
          <Modal
            transparent={true}
            animationType="slide"
            visible={isOpen}
            onRequestClose={() => setShowDatePicker(null)}>
            <TouchableOpacity
              style={styles.datePickerModal}
              activeOpacity={1}
              onPress={() => setShowDatePicker(null)}>
              <TouchableOpacity
                activeOpacity={1}
                onPress={(e) => e.stopPropagation()}
                style={styles.datePickerContainer}>
                <View style={styles.datePickerHeader}>
                  <TouchableOpacity
                    onPress={() => setShowDatePicker(null)}
                    style={styles.datePickerCancel}>
                    <Text style={styles.datePickerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={styles.datePickerTitle}>Select Date</Text>
                  <TouchableOpacity
                    onPress={() => {
                      const formattedDate = formatDate(tempDate.toISOString());
                      handleFilterChange(dateKey, formattedDate);
                      setShowDatePicker(null);
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
        {isOpen && Platform.OS === 'android' && (
          <DateTimePicker
            value={tempDate}
            mode="date"
            display="default"
            onChange={(event, date) => handleDateChange(event, date, dateKey)}
          />
        )}
      </View>
    );
  };

  const renderDateRange = (fromKey, toKey, label) => {
    return (
      <View style={styles.filterField}>
        <Text style={styles.filterLabel}>{label}</Text>
        <View style={styles.dateRangeContainer}>
          {renderDateInput(fromKey, 'From Date')}
          <Text style={styles.dateRangeSeparator}>to</Text>
          {renderDateInput(toKey, 'To Date')}
        </View>
      </View>
    );
  };



  // Count active filters for badge (exclude designer-hidden filters)
  const getActiveFiltersCount = () => {
    let count = 0;
    if (localFilters.unassigned) count++;
    if (localFilters.priority && localFilters.priority !== 'all') count++;
    if (!isDesigner) {
      if (localFilters.category && localFilters.category !== 'all') count++;
      if (localFilters.clientId && localFilters.clientId !== 'all') count++;
      if (localFilters.assignedTo && localFilters.assignedTo !== 'all') count++;
      if (localFilters.stoneType && localFilters.stoneType !== 'all') count++;
      if (localFilters.shippingDateFrom) count++;
      if (localFilters.shippingDateTo) count++;
    }
    if (localFilters.metalColor && localFilters.metalColor !== 'all') count++;
    if (localFilters.metalQuality && localFilters.metalQuality !== 'all') count++;
    if (localFilters.assignedDateFrom) count++;
    if (localFilters.assignedDateTo) count++;
    if (localFilters.createdDateFrom) count++;
    if (localFilters.createdDateTo) count++;
    return count;
  };

  const activeFiltersCount = getActiveFiltersCount();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Modern Header with Brand Colors */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconContainer}>
              <Icon name="tune" size={24} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.headerTitle}>Filters</Text>
              {activeFiltersCount > 0 && (
                <Text style={styles.headerSubtitle}>
                  {activeFiltersCount} {activeFiltersCount === 1 ? 'filter' : 'filters'} active
                </Text>
              )}
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <View style={styles.closeButtonContainer}>
              <Icon name="close" size={20} color={colors.textPrimary} />
            </View>
          </TouchableOpacity>
        </View>

        <ScrollView 
          style={styles.content} 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.contentContainer}>
          {/* Basic Filters Card */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Icon name="filter-list" size={20} color={colors.primary} />
              <Text style={styles.sectionTitle}>Basic Filters</Text>
            </View>
            
            {!isDesigner && renderDropdown('category', categoryOptions, 'Category')}
            {renderDropdown('priority', priorityOptions, 'Priority')}
            {!isDesigner && <View style={styles.filterField}>
              <Text style={styles.filterLabel}>Assignment</Text>
              <TouchableOpacity
                style={[
                  styles.dropdownButton,
                  localFilters.unassigned && styles.dropdownButtonSelected,
                ]}
                onPress={() => handleFilterChange('unassigned', !localFilters.unassigned)}
                activeOpacity={0.7}>
                <View style={styles.dropdownButtonContent}>
                  {localFilters.unassigned && <View style={styles.selectedIndicator} />}
                  <Text style={[
                    styles.dropdownText,
                    localFilters.unassigned && styles.dropdownTextSelected,
                  ]}>
                    {localFilters.unassigned ? 'Unassigned Only' : 'All Assignments'}
                  </Text>
                </View>
                <Icon
                  name={localFilters.unassigned ? 'check-box' : 'check-box-outline-blank'}
                  size={20}
                  color={localFilters.unassigned ? colors.primary : colors.textSecondary}
                />
              </TouchableOpacity>
            </View>}
            {!isDesigner && renderDropdown('clientId', clientOptions, 'Client')}
            {!isDesigner && renderDropdown('assignedTo', assignedToOptions, 'Assigned To')}
            {!isDesigner && renderDropdown('stoneType', stoneTypeOptions, 'Stone Type')}
          </View>

          {/* Material Filters Card */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Icon name="diamond" size={20} color={colors.primary} />
              <Text style={styles.sectionTitle}>Material Filters</Text>
            </View>
            
            {renderDropdown('metalColor', metalColorOptions, 'Metal Color')}
            {renderDropdown('metalQuality', metalQualityOptions, 'Metal Quality')}
          </View>

          {/* Date Ranges Card */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Icon name="calendar-today" size={20} color={colors.primary} />
              <Text style={styles.sectionTitle}>Date Ranges</Text>
            </View>
            
            {!isDesigner && renderDateRange('shippingDateFrom', 'shippingDateTo', 'Shipping Date')}
            {renderDateRange('assignedDateFrom', 'assignedDateTo', 'Assigned Date')}
            {renderDateRange('createdDateFrom', 'createdDateTo', 'Created Date')}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            title="Clear All"
            onPress={handleClear}
            style={[styles.footerButton, styles.clearButton]}
            textStyle={styles.clearButtonText}
          />
          <Button
            title="Apply Filters"
            onPress={handleApply}
            style={[styles.footerButton, styles.applyButton]}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 3,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight + '15', // 15% opacity
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerTitle: {
    fontSize: fonts.xl,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  closeButtonContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 100,
  },
  sectionCard: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: colors.primaryLight + '30', // 30% opacity
  },
  sectionTitle: {
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginLeft: 8,
    letterSpacing: -0.3,
  },
  filterField: {
    marginBottom: 18,
  },
  filterLabel: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  dropdownButtonOpen: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight + '08', // 8% opacity
  },
  dropdownButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight + '10', // 10% opacity
  },
  dropdownButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  selectedIndicator: {
    width: 4,
    height: 20,
    backgroundColor: colors.primary,
    borderRadius: 2,
    marginRight: 12,
  },
  dropdownText: {
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    flex: 1,
  },
  dropdownTextSelected: {
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  dropdownList: {
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.primaryLight + '30',
    borderRadius: 10,
    marginTop: 6,
    maxHeight: 220,
    elevation: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  dropdownScroll: {
    maxHeight: 220,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    minHeight: 48,
  },
  dropdownOptionActive: {
    backgroundColor: colors.primaryLight + '10',
  },
  checkmarkContainer: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primaryLight + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  dropdownOptionText: {
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    flex: 1,
  },
  dropdownOptionTextActive: {
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  dateRangeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateInputContainer: {
    flex: 1,
  },
  dateInputButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  dateInputButtonOpen: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight + '08',
  },
  dateInputButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight + '10',
  },
  dateInputText: {
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    flex: 1,
  },
  dateInputTextSelected: {
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  dateInputPlaceholder: {
    color: colors.textLight,
  },
  dateRangeSeparator: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.primary,
    marginHorizontal: 8,
    paddingVertical: 4,
  },
  datePickerModal: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(16, 53, 52, 0.6)', // Brand color with opacity
  },
  datePickerContainer: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 32 : 0,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
  },
  datePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 2,
    borderBottomColor: colors.primaryLight + '20',
    backgroundColor: colors.background,
  },
  datePickerCancel: {
    padding: 8,
    borderRadius: 8,
  },
  datePickerCancelText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
  datePickerTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  datePickerDone: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.primaryLight + '15',
  },
  datePickerDoneText: {
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.primary,
    letterSpacing: 0.3,
  },
  datePicker: {
    width: '100%',
    backgroundColor: colors.background,
  },
  textInput: {
    backgroundColor: colors.backgroundSecondary,
  },
  filterHint: {
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    color: colors.textLight,
    marginTop: 6,
    fontStyle: 'italic',
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 12,
  },
  footerButton: {
    flex: 1,
  },
  clearButton: {
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clearButtonText: {
    color: colors.textSecondary,
  },
  applyButton: {
    backgroundColor: colors.primary,
  },
});

export default EnquiryFiltersModal;

