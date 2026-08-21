import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';

import { colors } from '../../constants/colors';
import { useOrderingAsClient } from '../../context/OrderingAsClientContext';
import { useCart } from '../../context/CartContext';

const OrderingAsClientBanner = () => {
  const { orderingClient, cancelOrderingFor } = useOrderingAsClient();
  const { refreshCartCount } = useCart();

  if (!orderingClient) return null;

  const handleCancel = async () => {
    await cancelOrderingFor();
    await refreshCartCount();
  };

  return (
    <View style={styles.banner}>
      <MaterialIcons name="person-pin" size={16} color={colors.primary} />
      <Text style={styles.text} numberOfLines={1}>
        Placing order for <Text style={styles.name}>{orderingClient.name}</Text>
      </Text>
      <TouchableOpacity onPress={handleCancel} activeOpacity={0.7} style={styles.cancelBtn}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.primaryExtraLight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  text: {
    flex: 1,
    fontSize: 12.5,
    color: colors.textPrimary,
  },
  name: {
    fontWeight: '700',
    color: colors.primary,
  },
  cancelBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  cancelText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.error,
  },
});

export default OrderingAsClientBanner;
