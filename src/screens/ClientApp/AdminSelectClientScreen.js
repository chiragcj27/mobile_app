import React, { useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';

import { colors } from '../../constants/colors';
import { useClients } from '../../features/clients/clientsHooks';
import { useOrderingAsClient } from '../../context/OrderingAsClientContext';

const getInitials = (name) => {
  const clean = String(name || '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

function ClientRow({ client, onPress }) {
  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(client)} activeOpacity={0.7}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{getInitials(client.name)}</Text>
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.clientName} numberOfLines={1}>{client.name}</Text>
        {client.email && client.email !== 'N/A' ? (
          <Text style={styles.clientMeta} numberOfLines={1}>{client.email}</Text>
        ) : null}
      </View>

      <MaterialIcons name="chevron-right" size={20} color="#B9C4CC" />
    </TouchableOpacity>
  );
}

const AdminSelectClientScreen = ({ navigation }) => {
  const { clients, isLoading, refetch } = useClients();
  const { startOrderingFor } = useOrderingAsClient();
  const [searchText, setSearchText] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const filteredClients = useMemo(() => {
    const list = Array.isArray(clients) ? clients : [];
    const query = searchText.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (c) =>
        String(c.name || '').toLowerCase().includes(query) ||
        String(c.email || '').toLowerCase().includes(query),
    );
  }, [clients, searchText]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleSelect = (client) => {
    const clientId = client.id || client._id;
    if (!clientId) return;
    startOrderingFor({ id: clientId, name: client.name });
    navigation.getParent()?.navigate('Dashboard');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} style={styles.iconBtn} activeOpacity={0.8}>
          <MaterialIcons name="chevron-left" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>Select Client</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {filteredClients.length} client{filteredClients.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <View style={styles.iconBtn} />
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
      {isLoading && !refreshing ? (
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading clients…</Text>
        </View>
      ) : (
        <FlatList
          data={filteredClients}
          keyExtractor={(item) => String(item.id || item._id)}
          renderItem={({ item }) => <ClientRow client={item} onPress={handleSelect} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <MaterialIcons name="inbox" size={44} color="#C8D5DC" />
              <Text style={styles.emptyText}>
                {searchText ? 'No clients match your search.' : 'No clients available.'}
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
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
    gap: 2,
  },
  clientName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  clientMeta: {
    fontSize: 12.5,
    color: colors.textSecondary,
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

export default AdminSelectClientScreen;
