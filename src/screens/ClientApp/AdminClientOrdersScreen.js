import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';

import { colors } from '../../constants/colors';
import catalogApi from '../../services/catalogApi';

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'order_received', label: 'Received' },
  { key: 'order_confirmed', label: 'Confirmed' },
  { key: 'order_in_production', label: 'Production' },
  { key: 'order_shipped', label: 'Shipped' },
  { key: 'order_delivered', label: 'Delivered' },
  { key: 'order_cancelled', label: 'Cancelled' },
];

const STATUS_CONFIG = {
  order_received: { dot: '#D4AF37', text: '#8A6B10', label: 'Received' },
  order_confirmed: { dot: '#3B82F6', text: '#1D4ED8', label: 'Confirmed' },
  order_in_production: { dot: '#8B5CF6', text: '#5B21B6', label: 'Production' },
  order_shipped: { dot: '#10B981', text: '#065F46', label: 'Shipped' },
  order_delivered: { dot: '#0891B2', text: '#155E75', label: 'Delivered' },
  order_cancelled: { dot: '#EF4444', text: '#991B1B', label: 'Cancelled' },
};

const formatDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
};

function ThumbnailStack({ items }) {
  const first = items[0];
  const overflow = items.length - 1;
  if (!first) {
    return (
      <View style={styles.thumbPlaceholder}>
        <MaterialIcons name="inventory-2" size={18} color="#B9C4CC" />
      </View>
    );
  }
  return (
    <View style={styles.thumbStack}>
      <View style={styles.thumbWrap}>
        {first.imageUrl ? (
          <Image source={{ uri: first.imageUrl }} style={styles.thumbImage} resizeMode="cover" />
        ) : (
          <View style={styles.thumbEmpty} />
        )}
      </View>
      {overflow > 0 && (
        <View style={styles.thumbOverflowBadge}>
          <Text style={styles.thumbOverflowText}>+{overflow}</Text>
        </View>
      )}
    </View>
  );
}

function ClientOrderCard({ order, onPress }) {
  const cfg = STATUS_CONFIG[order.status] || { dot: '#9CA3AF', text: '#374151', label: order.status };
  const items = Array.isArray(order.items) ? order.items : [];
  const itemCount = items.length;
  const totalPieces = items.reduce((s, i) => s + Number(i.quantity || 0), 0);

  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(order)} activeOpacity={0.75}>
      <ThumbnailStack items={items} />

      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.orderNum} numberOfLines={1}>{order.orderNumber || 'Order'}</Text>
          <Text style={styles.cardDate}>{formatDate(order.createdAt)}</Text>
        </View>

        <Text style={styles.cardMeta}>
          {itemCount} item{itemCount !== 1 ? 's' : ''}
          {'  ·  '}
          {totalPieces} pcs
        </Text>

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: cfg.dot }]} />
          <Text style={[styles.statusText, { color: cfg.text }]}>{cfg.label}</Text>
        </View>
      </View>

      <MaterialIcons name="chevron-right" size={20} color="#B9C4CC" />
    </TouchableOpacity>
  );
}

const matchesClient = (order, params) => {
  if (params.clientId) return order.clientId === params.clientId;
  if (params.clientUsername) return order.clientUsername === params.clientUsername;
  return order.clientName === params.clientName;
};

const AdminClientOrdersScreen = ({ route, navigation }) => {
  const { clientId, clientName, clientUsername } = route?.params || {};

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadOrders = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError('');
      try {
        const path = clientId
          ? `/admin/orders?clientId=${encodeURIComponent(clientId)}`
          : '/admin/orders';
        const res = await catalogApi.get(path);
        const all = Array.isArray(res?.orders) ? res.orders : [];
        setOrders(clientId ? all : all.filter((o) => matchesClient(o, route?.params || {})));
      } catch (err) {
        setError(err?.message || 'Could not load orders');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [clientId, route?.params],
  );

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders]),
  );

  const filteredOrders = useMemo(() => {
    if (statusFilter === 'all') return orders;
    return orders.filter((o) => o.status === statusFilter);
  }, [orders, statusFilter]);

  const countByStatus = useMemo(() => {
    const counts = {};
    orders.forEach((o) => {
      counts[o.status] = (counts[o.status] || 0) + 1;
    });
    return counts;
  }, [orders]);

  const handleOrderPress = useCallback(
    (order) => {
      navigation.navigate('AdminOrderDetails', { orderId: order._id, order });
    },
    [navigation],
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} style={styles.iconBtn} activeOpacity={0.8}>
          <MaterialIcons name="chevron-left" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{clientName || 'Client'}</Text>
          {clientUsername ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>@{clientUsername}</Text>
          ) : null}
        </View>
        <TouchableOpacity onPress={() => loadOrders(true)} style={styles.iconBtn} activeOpacity={0.8}>
          <MaterialIcons name="refresh" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Filter bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}>
        {STATUS_FILTERS.map((f) => {
          const count = f.key === 'all' ? orders.length : (countByStatus[f.key] || 0);
          const isActive = statusFilter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterPill, isActive && styles.filterPillActive]}
              onPress={() => setStatusFilter(f.key)}
              activeOpacity={0.75}>
              <Text style={[styles.filterPillLabel, isActive && styles.filterPillLabelActive]}>
                {f.label}
              </Text>
              {count > 0 && (
                <Text style={[styles.filterPillCount, isActive && styles.filterPillCountActive]}>
                  {count}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      {loading && !refreshing ? (
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading orders…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => loadOrders()} style={styles.retryBtn} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredOrders}
          keyExtractor={(item) => item._id || item.orderNumber}
          renderItem={({ item }) => <ClientOrderCard order={item} onPress={handleOrderPress} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <MaterialIcons name="inbox" size={44} color="#C8D5DC" />
              <Text style={styles.emptyText}>
                {statusFilter === 'all'
                  ? 'No orders from this client yet.'
                  : `No ${STATUS_FILTERS.find((f) => f.key === statusFilter)?.label?.toLowerCase() || ''} orders.`}
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadOrders(true)} />
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },

  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    letterSpacing: -0.1,
  },
  headerSubtitle: {
    marginTop: 1,
    fontSize: 11,
    color: colors.textLight,
  },
  iconBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Filter bar
  filterBar: {
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    maxHeight: 58,
  },
  filterBarContent: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 20,
    height: 32,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterPillLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterPillLabelActive: {
    color: colors.textWhite,
  },
  filterPillCount: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textLight,
  },
  filterPillCountActive: {
    color: 'rgba(255,255,255,0.7)',
  },

  // List
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 10,
  },

  // Card
  card: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  orderNum: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cardDate: {
    fontSize: 12,
    color: colors.textLight,
  },
  cardMeta: {
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 12.5,
    fontWeight: '600',
  },

  // Thumbnails
  thumbStack: {
    width: 46,
    height: 46,
    flexShrink: 0,
  },
  thumbWrap: {
    width: 46,
    height: 46,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.background,
    backgroundColor: colors.backgroundSecondary,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbEmpty: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.borderLight,
  },
  thumbOverflowBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  thumbOverflowText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.textWhite,
  },
  thumbPlaceholder: {
    width: 46,
    height: 46,
    borderRadius: 10,
    backgroundColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // States
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: 14,
    color: colors.error,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 14,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  retryBtnText: {
    color: colors.textWhite,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyWrap: {
    marginTop: 60,
    alignItems: 'center',
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textLight,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});

export default AdminClientOrdersScreen;
