import React, { useCallback, useMemo, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Clipboard from '@react-native-clipboard/clipboard';

import { colors } from '../../constants/colors';
import catalogApi from '../../services/catalogApi';

const SECTION_IN_PROCESS = 'in_process';
const SECTION_DELIVERED = 'delivered';

const formatMoney = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '$0000';
  return `$${amount.toLocaleString('en-US')}`;
};

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB');
};

const getOrderStatusText = (order) => {
  if (order.status === 'order_delivered') {
    const deliveredAt =
      order.timeline?.find((entry) => entry.status === 'order_delivered')?.changedAt || order.updatedAt;
    return `Delivered on ${formatDate(deliveredAt)}, ${new Date(deliveredAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  if (order.status === 'order_shipped') return 'Shipped and on the way';
  if (order.status === 'order_in_production') return 'In production';
  if (order.status === 'order_confirmed') return 'Order confirmed';
  if (order.status === 'order_cancelled') return 'Order cancelled';
  return 'Estimated arrival in 4-5 days';
};

const getOrderItemTitle = (item) => {
  const snapshot = item?.meta?.productSnapshot || {};
  const subcategory =
    String(snapshot.subcategoryName || item?.meta?.subcategoryName || '').trim();
  const category =
    String(snapshot.categoryName || item?.meta?.categoryName || '').trim();

  if (subcategory && category) {
    return `${subcategory} ${category}`;
  }
  if (subcategory) return subcategory;
  if (category) return category;

  return item?.title || item?.styleNo || 'Ordered item';
};

const getOrderItemSubtext = (item) => {
  const snapshot = item?.meta?.productSnapshot || {};
  return String(snapshot.subcategoryProfileName || item?.meta?.subcategoryProfileName || '').trim();
};

const getDisplayOrderNo = (order) =>
  String(order?.orderNumber || order?.orderNo || order?.order_number || order?._id || 'N/A');

function OrderCard({ order, onPressOrderNo, onPressOpenDetails }) {
  const firstItem = order.items?.[0];
  const moreItemsCount = Math.max(0, (order.items?.length || 0) - 1);
  const totalPieces = order.items?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 0;
  const totalAmount =
    order.totalAmount ||
    order.items?.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0) ||
    0;
  const statusText = getOrderStatusText(order);
  const statusIcon = order.status === 'order_delivered' ? 'inventory-2' : 'hourglass-empty';

  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <View style={styles.statusWrap}>
          <MaterialIcons name={statusIcon} size={16} color={colors.textSecondary} />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
        <TouchableOpacity activeOpacity={0.85} style={styles.orderNoPill} onPress={() => onPressOrderNo(order)}>
          <Text style={styles.orderNoText}>{getDisplayOrderNo(order)}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cardDivider} />

      <View style={styles.itemRow}>
        <View style={styles.itemImageWrap}>
          {firstItem?.imageUrl ? (
            <Image source={{ uri: firstItem.imageUrl }} style={styles.itemImage} resizeMode="contain" />
          ) : (
            <View style={styles.itemImagePlaceholder} />
          )}
        </View>

        <View style={styles.itemDetails}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {getOrderItemTitle(firstItem)}
          </Text>
          {!!getOrderItemSubtext(firstItem) && (
            <Text style={styles.itemSubtext} numberOfLines={1}>
              {getOrderItemSubtext(firstItem)}
            </Text>
          )}
          <View style={styles.itemMetaRow}>
            <Text style={styles.itemMetaText}>{Number(firstItem?.quantity || 0)}pcs</Text>
            <TouchableOpacity activeOpacity={0.8} style={styles.seeDetailsChip}>
              <Text style={styles.seeDetailsText}>see details</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.itemPrice}>{formatMoney(firstItem?.lineTotal || firstItem?.unitPrice)}</Text>
      </View>

      {moreItemsCount > 0 ? (
        <TouchableOpacity activeOpacity={0.8} style={styles.moreItemsWrap}>
          <Text style={styles.moreItemsText}>+ MORE ITEMS</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.cardBottomDivider} />

      <TouchableOpacity activeOpacity={0.8} style={styles.cardBottomRow} onPress={() => onPressOpenDetails(order)}>
        <Text style={styles.cardBottomText}>
          {order.items?.length || 0} Item{(order.items?.length || 0) > 1 ? 's' : ''}
          {'   |   '}
          {formatMoney(totalAmount)}
        </Text>
        <MaterialIcons name="chevron-right" size={20} color={colors.primary} />
      </TouchableOpacity>

      {!!totalPieces && (
        <Text style={styles.piecesHint}>Total pieces: {totalPieces}</Text>
      )}
    </View>
  );
}

const MyOrdersScreen = ({ navigation }) => {
  const [activeSection, setActiveSection] = useState(SECTION_IN_PROCESS);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedOrderNo, setSelectedOrderNo] = useState('');
  const [isOrderNoModalVisible, setIsOrderNoModalVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await catalogApi.get('/orders/my');
      setOrders(Array.isArray(res?.orders) ? res.orders : []);
    } catch (err) {
      setError(err?.message || 'Could not load orders');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders]),
  );

  const filteredOrders = useMemo(() => {
    const uniqueOrdersMap = new Map();
    orders.forEach((order) => {
      const key = String(order?._id || order?.orderNumber || '');
      if (!key) return;
      if (!uniqueOrdersMap.has(key)) {
        uniqueOrdersMap.set(key, order);
      }
    });
    const uniqueOrders = Array.from(uniqueOrdersMap.values());

    if (activeSection === SECTION_DELIVERED) {
      return uniqueOrders.filter((order) => order.status === 'order_delivered');
    }
    return uniqueOrders.filter((order) => order.status !== 'order_delivered');
  }, [activeSection, orders]);

  const openOrderNoModal = useCallback((order) => {
    setSelectedOrderNo(getDisplayOrderNo(order));
    setCopied(false);
    setIsOrderNoModalVisible(true);
  }, []);

  const closeOrderNoModal = useCallback(() => {
    setIsOrderNoModalVisible(false);
  }, []);

  const onCopyOrderNo = useCallback(async () => {
    if (!selectedOrderNo) return;
    await Clipboard.setString(selectedOrderNo);
    setCopied(true);
  }, [selectedOrderNo]);

  const onOpenOrderDetails = useCallback(
    (order) => {
      navigation.navigate('MyOrderDetails', { order });
    },
    [navigation],
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.headerBackButton} activeOpacity={0.8}>
          <MaterialIcons name="chevron-left" size={24} color="#151515" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Orders</Text>
        <View style={styles.headerBackButton} />
      </View>

      <View style={styles.segmentWrap}>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.segmentButton, activeSection === SECTION_IN_PROCESS && styles.segmentButtonActive]}
          onPress={() => setActiveSection(SECTION_IN_PROCESS)}>
          <Text
            style={[
              styles.segmentText,
              activeSection === SECTION_IN_PROCESS && styles.segmentTextActive,
            ]}>
            IN PROCESS
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.segmentButton, activeSection === SECTION_DELIVERED && styles.segmentButtonActive]}
          onPress={() => setActiveSection(SECTION_DELIVERED)}>
          <Text
            style={[
              styles.segmentText,
              activeSection === SECTION_DELIVERED && styles.segmentTextActive,
            ]}>
            DELIVERED
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <Text style={styles.emptyText}>Loading orders...</Text>
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : filteredOrders.length === 0 ? (
          <Text style={styles.emptyText}>
            {activeSection === SECTION_DELIVERED ? 'No delivered orders yet.' : 'No in-process orders.'}
          </Text>
        ) : (
          filteredOrders.map((order) => (
            <OrderCard
              key={order._id}
              order={order}
              onPressOrderNo={openOrderNoModal}
              onPressOpenDetails={onOpenOrderDetails}
            />
          ))
        )}
      </ScrollView>

      <Modal
        visible={isOrderNoModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeOrderNoModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Order Number</Text>
            <View style={styles.modalOrderNoWrap}>
              <Text style={styles.modalOrderNoText}>{selectedOrderNo || 'N/A'}</Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.modalButton, styles.modalCopyButton]}
                onPress={onCopyOrderNo}>
                <Text style={styles.modalCopyButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.modalButton, styles.modalCloseButton]}
                onPress={closeOrderNoModal}>
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F2F5',
  },
  headerRow: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  headerBackButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#191919',
    fontSize: 28 / 2,
    fontWeight: '500',
  },
  segmentWrap: {
    alignSelf: 'center',
    marginTop: 2,
    marginBottom: 10,
    flexDirection: 'row',
    backgroundColor: '#E9ECEF',
    borderRadius: 22,
    padding: 2,
  },
  segmentButton: {
    minWidth: 108,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentButtonActive: {
    backgroundColor: '#1F5A62',
  },
  segmentText: {
    fontSize: 12,
    color: '#40505A',
    fontWeight: '500',
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 10,
    paddingBottom: 16,
    gap: 10,
  },
  card: {
    borderWidth: 1,
    borderColor: '#E3E6EA',
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
  },
  cardTopRow: {
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  statusText: {
    color: '#44545D',
    fontSize: 12,
  },
  orderNoPill: {
    borderWidth: 1,
    borderColor: '#DDE2E7',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  orderNoText: {
    fontSize: 11,
    color: '#396172',
    fontWeight: '500',
  },
  cardDivider: {
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E0E3E7',
  },
  itemRow: {
    marginTop: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  itemImageWrap: {
    width: 48,
    height: 48,
    borderWidth: 1,
    borderColor: '#E7EAF0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FBFCFD',
  },
  itemImage: {
    width: '86%',
    height: '86%',
  },
  itemImagePlaceholder: {
    width: 28,
    height: 12,
    borderRadius: 8,
    backgroundColor: '#E2E6EB',
  },
  itemDetails: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 18 / 1.15,
    color: '#173042',
    fontWeight: '500',
  },
  itemSubtext: {
    marginTop: 3,
    color: '#8A97A3',
    fontSize: 12,
  },
  itemMetaRow: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemMetaText: {
    color: '#88949F',
    fontSize: 12,
  },
  seeDetailsChip: {
    backgroundColor: '#DDEDEF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  seeDetailsText: {
    color: '#2E6172',
    fontSize: 12,
    fontWeight: '500',
  },
  itemPrice: {
    fontSize: 18 / 1.15,
    color: '#1B5462',
    fontWeight: '500',
  },
  moreItemsWrap: {
    marginTop: 10,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  moreItemsText: {
    color: '#215A66',
    fontSize: 20 / 2,
    fontWeight: '500',
  },
  cardBottomDivider: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E0E3E7',
  },
  cardBottomRow: {
    marginTop: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardBottomText: {
    color: '#1C596A',
    fontSize: 15 / 1.1,
    fontWeight: '500',
  },
  piecesHint: {
    marginTop: 4,
    paddingHorizontal: 12,
    color: '#8E9AA5',
    fontSize: 11,
  },
  emptyText: {
    marginTop: 24,
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 13,
  },
  errorText: {
    marginTop: 24,
    textAlign: 'center',
    color: colors.error,
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#18242D',
  },
  modalOrderNoWrap: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#DDE2E7',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#F8FAFC',
  },
  modalOrderNoText: {
    color: '#214D5B',
    fontSize: 13,
    fontWeight: '500',
  },
  modalActions: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  modalButton: {
    minWidth: 80,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCopyButton: {
    backgroundColor: '#1F5A62',
  },
  modalCloseButton: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
  },
  modalCopyButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  modalCloseButtonText: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '600',
  },
});

export default MyOrdersScreen;
