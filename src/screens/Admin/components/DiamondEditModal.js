import React, { useEffect, useState, useRef } from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
} from 'react-native';
import { colors } from '../../../constants/colors';
import { fonts } from '../../../constants/fonts';

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

const DiamondEditModal = ({
    visible,
    diamond,
    onClose,
    onSave,
}) => {
    const [price, setPrice] = useState('');
    const priceRef = useRef(null);

    useEffect(() => {
        if (visible) {
            setPrice(num(diamond?.Price) > 0 ? String(diamond.Price) : '');
            setTimeout(() => priceRef.current?.focus(), 300);
        }
    }, [visible, diamond]);

    const handleSave = () => {
        onSave({
            ...diamond,
            Price: num(price),
        });
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
                <TouchableOpacity activeOpacity={1} style={styles.dialog}>
                    <Text style={styles.title}>Edit Price</Text>
                    <Text style={styles.subtitle}>{diamond?.Type || 'Stone'}</Text>

                    <TextInput
                        ref={priceRef}
                        value={price}
                        onChangeText={setPrice}
                        style={styles.input}
                        keyboardType="decimal-pad"
                        placeholder="Enter $/Ct"
                        placeholderTextColor="#A0A0A0"
                        onSubmitEditing={handleSave}
                        returnKeyType="done"
                    />

                    <View style={styles.actions}>
                        <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
                            <Text style={styles.cancelBtnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.8}>
                            <Text style={styles.saveBtnText}>Save</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </TouchableOpacity>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    dialog: {
        backgroundColor: colors.background || '#fff',
        borderRadius: 16,
        padding: 24,
        width: '100%',
        maxWidth: 300,
        alignItems: 'center',
    },
    title: {
        fontSize: fonts.lg || 18,
        fontFamily: fonts.bold,
        color: colors.textPrimary,
        marginBottom: 2,
    },
    subtitle: {
        fontSize: fonts.sm || 13,
        color: colors.textSecondary,
        marginBottom: 16,
    },
    input: {
        width: '100%',
        borderWidth: 1.5,
        borderColor: '#DC2626',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: fonts.lg || 18,
        fontFamily: fonts.bold,
        color: colors.textPrimary,
        backgroundColor: '#FEF2F2',
        textAlign: 'left',
        marginBottom: 16,
    },
    actions: {
        flexDirection: 'row',
        gap: 10,
        width: '100%',
    },
    cancelBtn: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
    },
    cancelBtnText: {
        fontFamily: fonts.medium,
        fontSize: fonts.sm || 13,
        color: colors.textPrimary,
    },
    saveBtn: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        backgroundColor: colors.primary,
        alignItems: 'center',
    },
    saveBtnText: {
        fontFamily: fonts.bold,
        fontSize: fonts.sm || 13,
        color: '#fff',
    },
});

export default DiamondEditModal;
