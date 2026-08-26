import React, { useEffect, useState } from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ScrollView,
    SafeAreaView,
} from 'react-native';
import { colors } from '../../../constants/colors';
import { fonts } from '../../../constants/fonts';
import useDeviceLayout from '../../../hooks/useDeviceLayout';
import { useGetStoneTypesQuery } from '../../../store/api';
import Icon from '../../../components/common/Icon';

const fields = [
    { key: 'Shape', label: 'Shape', keyboardType: 'default' },
    { key: 'Carat', label: 'Carat', keyboardType: 'decimal-pad' },
    { key: 'MmSize', label: 'Mm Size', keyboardType: 'decimal-pad' },
    { key: 'SieveSize', label: 'Sieve Size', keyboardType: 'default' },
    { key: 'Price', label: 'Price', keyboardType: 'decimal-pad' },
];

const DiamondEditModal = ({
    visible,
    diamond,
    onClose,
    onSave,
}) => {
    const initialData = diamond || {};
    const [localData, setLocalData] = useState({ ...initialData });
    const { isTablet } = useDeviceLayout();
    const [showTypeDropdown, setShowTypeDropdown] = useState(false);

    const { data: stoneTypesData = [] } = useGetStoneTypesQuery();
    const stoneOptions = stoneTypesData.map((st) => ({
        label: st.label,
        value: st.value,
    }));

    useEffect(() => {
        setLocalData({ ...(diamond || {}) });
    }, [diamond]);

    const handleChange = (key, value) => {
        setLocalData(prev => ({
            ...prev,
            [key]: value,
        }));
    };

    const handleSave = () => {
        onSave({
            ...localData,
            Carat: parseFloat(localData.Carat) || 0,
            MmSize: parseFloat(localData.MmSize) || 0,
            Price: parseFloat(localData.Price) || 0,
        });
    };

    return (
        <Modal
            animationType={isTablet ? 'fade' : 'slide'}
            visible={visible}
            onRequestClose={onClose}
            presentationStyle="fullScreen"
        >
            <View style={styles.fullscreenWrapper}>
                <View style={styles.fullscreenContainer}>
                    <View style={styles.header}>
                        <View>
                            <Text style={styles.title}>Edit Diamond</Text>
                            <Text style={styles.subtitle}>{localData.Type || '—'}</Text>
                        </View>
                        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <Text style={styles.closeText}>Close</Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView
                        style={styles.form}
                        contentContainerStyle={isTablet ? styles.formContentTablet : styles.formContent}
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={isTablet ? styles.fieldsGrid : null}>
                            <View style={[styles.field, isTablet && styles.fieldTablet]}>
                                <Text style={styles.label}>Type</Text>
                                <TouchableOpacity
                                    style={styles.dropdown}
                                    onPress={() => setShowTypeDropdown(true)}
                                    activeOpacity={0.8}
                                >
                                    <Text style={[styles.dropdownText, !localData.Type && styles.placeholderText]}>
                                        {stoneOptions.find(o => o.value === localData.Type)?.label || localData.Type || 'Select stone type...'}
                                    </Text>
                                    <Icon name="arrow-drop-down" size={24} color={colors.textSecondary} />
                                </TouchableOpacity>
                            </View>

                            {fields.map(field => (
                                <View
                                    key={field.key}
                                    style={[
                                        styles.field,
                                        isTablet && styles.fieldTablet
                                    ]}
                                >
                                    <Text style={styles.label}>{field.label}</Text>
                                    <TextInput
                                        value={localData[field.key]?.toString() || ''}
                                        onChangeText={(value) => handleChange(field.key, value)}
                                        style={styles.input}
                                        keyboardType={field.keyboardType}
                                        placeholder={`Enter ${field.label}`}
                                        placeholderTextColor={colors.textSecondary}
                                    />
                                </View>
                            ))}
                        </View>
                    </ScrollView>

                    <View style={[styles.footer, isTablet && styles.footerTablet]}>
                        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                            <Text style={styles.saveButtonText}>Save Changes</Text>
                        </TouchableOpacity>
                    </View>

                    <Modal
                        visible={showTypeDropdown}
                        animationType="slide"
                        onRequestClose={() => setShowTypeDropdown(false)}
                    >
                        <View style={styles.fullscreenWrapper}>
                            <View style={styles.dropdownHeader}>
                                <Text style={styles.dropdownHeaderTitle}>Select Stone Type</Text>
                                <TouchableOpacity onPress={() => setShowTypeDropdown(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                    <Text style={styles.dropdownHeaderClose}>Done</Text>
                                </TouchableOpacity>
                            </View>
                            <ScrollView showsVerticalScrollIndicator={true} style={{ flex: 1 }}>
                                {stoneOptions.map((opt) => (
                                    <TouchableOpacity
                                        key={opt.value}
                                        style={[
                                            styles.dropdownOption,
                                            localData.Type === opt.value && styles.dropdownOptionSelected,
                                        ]}
                                        onPress={() => {
                                            handleChange('Type', opt.value);
                                            setShowTypeDropdown(false);
                                        }}
                                    >
                                        <Text style={[styles.dropdownOptionText, localData.Type === opt.value && styles.dropdownOptionTextSelected]}>
                                            {opt.label}
                                        </Text>
                                        {localData.Type === opt.value && (
                                            <Icon name="check" size={18} color={colors.primary} />
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>
                    </Modal>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    fullscreenWrapper: {
        flex: 1,
        backgroundColor: colors.white,
    },
    fullscreenContainer: {
        flex: 1,
        backgroundColor: colors.white,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 12,
        backgroundColor: colors.white,
    },
    title: {
        fontSize: fonts.lg,
        fontFamily: fonts.bold,
        color: colors.textPrimary,
    },
    subtitle: {
        fontSize: fonts.sm,
        color: colors.textSecondary,
        marginTop: 2,
    },
    closeText: {
        fontSize: fonts.sm,
        color: colors.primary,
        fontFamily: fonts.medium,
    },
    form: {
        flex: 1,
        paddingHorizontal: 20,
    },
    formContent: {
        paddingBottom: 40,
    },
    formContentTablet: {
        paddingBottom: 20,
    },
    fieldsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -8,
    },
    footer: {
        padding: 20,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.white,
    },
    footerTablet: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
    field: {
        marginBottom: 14,
    },
    fieldTablet: {
        width: '33.33%',
        paddingHorizontal: 8,
    },
    label: {
        fontSize: fonts.sm,
        color: colors.textSecondary,
        marginBottom: 6,
    },
    input: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: fonts.base,
        color: colors.textPrimary,
    },
    dropdown: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: colors.white,
    },
    dropdownText: {
        flex: 1,
        fontSize: fonts.base,
        color: colors.textPrimary,
    },
    placeholderText: {
        color: colors.textSecondary,
    },
    dropdownHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.white,
    },
    dropdownHeaderTitle: {
        fontSize: fonts.base,
        fontFamily: fonts.bold,
        color: colors.textPrimary,
    },
    dropdownHeaderClose: {
        fontSize: fonts.base,
        fontFamily: fonts.bold,
        color: colors.primary,
    },
    dropdownOption: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderLight || '#F0F0F0',
        backgroundColor: colors.white,
    },
    dropdownOptionSelected: {
        backgroundColor: (colors.primaryExtraLight) || colors.primary + '12',
    },
    dropdownOptionText: {
        flex: 1,
        fontSize: fonts.base,
        fontFamily: fonts.medium,
        color: colors.textPrimary,
    },
    dropdownOptionTextSelected: {
        color: colors.primary,
        fontFamily: fonts.bold,
    },
    saveButton: {
        backgroundColor: colors.primary,
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
    },
    saveButtonText: {
        color: colors.textWhite,
        fontSize: fonts.base,
        fontFamily: fonts.bold,
    },
});

export default DiamondEditModal;