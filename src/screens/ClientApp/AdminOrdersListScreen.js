import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';

import { colors } from '../../constants/colors';
import catalogApi from '../../services/catalogApi';

const ACTIVE_STATUSES = ['order_received', 'order_confirmed', 'order_in_production', 'order_shipped'];

const formatDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
};

const getInitials = (name) => {
  const clean = String(name || '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

function ClientCard({ client, onPress }) {
  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(client)} activeOpacity={0.7}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{getInitials(client.clientName)}</Text>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.clientName} numberOfLines={1}>{client.clientName}</Text>
          <Text style={styles.lastOrderDate}>{formatDate(client.lastOrderAt)}</Text>
        </View>

        <View style={styles.cardBottomRow}>
          <Text style={styles.cardMeta}>
            {client.orderCount} order{client.orderCount !== 1 ? 's' : ''}
            {'  ·  '}
            {client.totalPieces} pcs
          </Text>
          {client.pendingCount > 0 && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{client.pendingCount} active</Text>
            </View>
          )}
        </View>
      </View>

      <MaterialIcons name="chevron-right" size={20} color="#B9C4CC" />
    </TouchableOpacity>
  );
}

const AdminOrdersListScreen = ({ navigation }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [searchText, setSearchText] = useState('');

  const loadOrders = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');
    try {
      const res = await catalogApi.get('/admin/orders');
      setOrders(Array.isArray(res?.orders) ? res.orders : []);
    } catch (err) {
      setError(err?.message || 'Could not load orders');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders]),
  );

  const clients = useMemo(() => {
    const map = new Map();
    orders.forEach((order) => {
      const key = order.clientId || order.clientUsername || order.clientName || 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          key,
          clientId: order.clientId,
          clientName: order.clientName || order.clientUsername || 'Unknown Client',
          clientUsername: order.clientUsername,
          orders: [],
        });
      }
      map.get(key).orders.push(order);
    });

    return Array.from(map.values())
      .map((group) => {
        const totalPieces = group.orders.reduce(
          (sum, o) => sum + (o.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0),
          0,
        );
        const pendingCount = group.orders.filter((o) => ACTIVE_STATUSES.includes(o.status)).length;
        const lastOrderAt = group.orders.reduce((max, o) => {
          const t = new Date(o.createdAt).getTime();
          return Number.isFinite(t) && t > max ? t : max;
        }, 0);
        return {
          ...group,
          orderCount: group.orders.length,
          totalPieces,
          pendingCount,
          lastOrderAt,
        };
      })
      .sort((a, b) => b.lastOrderAt - a.lastOrderAt);
  }, [orders]);

  const filteredClients = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter(
      (c) =>
        c.clientName.toLowerCase().includes(query) ||
        String(c.clientUsername || '').toLowerCase().includes(query),
    );
  }, [clients, searchText]);

  const totalActiveOrders = useMemo(
    () => orders.filter((o) => ACTIVE_STATUSES.includes(o.status)).length,
    [orders],
  );

  const handleClientPress = useCallback(
    (client) => {
      navigation.navigate('AdminClientOrders', {
        clientId: client.clientId,
        clientName: client.clientName,
        clientUsername: client.clientUsername,
      });
    },
    [navigation],
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Orders</Text>
          <Text style={styles.headerSubtitle}>
            {clients.length} client{clients.length !== 1 ? 's' : ''}
            {totalActiveOrders > 0 ? `  ·  ${totalActiveOrders} active` : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={() => loadOrders(true)} style={styles.iconBtn} activeOpacity={0.8}>
          <MaterialIcons name="refresh" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <MaterialIcons name="search" size={18} color="#8A97A3" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search clients"
          placeholderTextColor="#9AA6B0"
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')} activeOpacity={0.7}>
            <MaterialIcons name="close" size={18} color="#8A97A3" />
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      {loading && !refreshing ? (
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading clients…</Text>
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
          data={filteredClients}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => <ClientCard client={item} onPress={handleClientPress} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <MaterialIcons name="inbox" size={44} color="#C8D5DC" />
              <Text style={styles.emptyText}>
                {searchText ? 'No clients match your search.' : 'No orders yet.'}
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
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    marginTop: 3,
    fontSize: 13,
    color: colors.textSecondary,
  },
  iconBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Search
  searchBar: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    height: 42,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 0,
  },

  // List
  listContent: {
    paddingHorizontal: 16,
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
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primaryExtraLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
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
  clientName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  lastOrderDate: {
    fontSize: 12,
    color: colors.textLight,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardMeta: {
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  pendingBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: colors.primaryExtraLight,
  },
  pendingBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
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
  },
});

export default AdminOrdersListScreen;
