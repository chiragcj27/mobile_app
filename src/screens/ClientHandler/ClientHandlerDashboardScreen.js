import React, { useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Text,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import {
  useGetClientsQuery,
  useGetDepartmentsQuery,
  useGetUsersQuery,
  useGetRolesQuery,
} from '../../store/api';
import { AnimatedLogoLoader } from '../../components/common';
import Icon from '../../components/common/Icon';
import TopNavbar from '../../components/common/TopNavbar';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';

const TABS = [
  { key: 'clients',     label: 'Clients',    icon: 'people'   },
  { key: 'departments', label: 'Departments', icon: 'business' },
];

const ROLE_CONFIG = {
  coral: { label: 'Coral Designer', color: `${colors.primary}` },
  co:    { label: 'Coral Designer',color: `${colors.primary}` },
  cad:   { label: 'CAD Designer',  color: `${colors.primary}`},
  cd:    { label: 'CAD Designer',   color: `${colors.primary}` },
};

// Roles excluded from the Departments tab
const EXCLUDED_ROLES = new Set(['admin', 'ad', 'client_handler', 'ch', 'client', 'cl']);

const getRoleConfig = (roleRaw = '') => {
  const key = String(roleRaw).toLowerCase().replace(/\s+/g, '_');
  return ROLE_CONFIG[key] || { label: roleRaw || 'User', color: '#6B7280' };
};

const ClientHandlerDashboardScreen = ({ navigation, route }) => {
  const { user }    = useAuth();
  const [activeTab,  setActiveTab]  = useState('clients');
  const [refreshing, setRefreshing] = useState(false);

  // ── All hooks unconditionally at the top ─────────────────────────────────
  const { data: allClients = [],  isLoading: clientsLoading,  refetch: refetchClients }  = useGetClientsQuery();
  const { data: allDepts = [],    isLoading: deptsLoading,    refetch: refetchDepts }    = useGetDepartmentsQuery();
  const { data: allUsers = [],    isLoading: usersLoading,    refetch: refetchUsers }    = useGetUsersQuery();
  const { data: rolesData = [] }                                                          = useGetRolesQuery();

  const showAll = route?.params?.showAll;

  const clients = useMemo(() =>
    showAll
      ? allClients
      : allClients.filter(c => (user?.clientsHandled || []).includes(c.id || c._id)),
  [allClients, showAll, user]);

  const roleNameMap = useMemo(() => {
    const m = {};
    rolesData.forEach(r => {
      const id   = String(r.id   || '');
      const code = String(r.code || '').toLowerCase();
      const name = String(r.name || '').toLowerCase();
      if (id)   m[id]   = r.name || r.code;
      if (code) m[code] = r.name || r.code;
      if (name) m[name] = r.name || r.code;
    });
    return m;
  }, [rolesData]);

  const usersByRole = useMemo(() => {
    const groups = {};
    allUsers.forEach(u => {
      const rawRole      = u.role || u.Role || '';
      const resolvedRole = roleNameMap[String(rawRole).toLowerCase()] || roleNameMap[String(rawRole)] || rawRole;
      const roleKey      = String(resolvedRole).toLowerCase().replace(/\s+/g, '_');
      if (EXCLUDED_ROLES.has(roleKey)) return;
      if (!groups[roleKey]) groups[roleKey] = { roleRaw: resolvedRole || rawRole, users: [] };
      groups[roleKey].users.push(u);
    });
    const order = ['coral', 'co', 'cad', 'cd'];
    return Object.entries(groups).sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return  1;
      return a.localeCompare(b);
    });
  }, [allUsers, roleNameMap]);

  const departmentListData = useMemo(() => {
    const rows = [];
    usersByRole.forEach(([roleKey, { roleRaw, users }]) => {
      const cfg = getRoleConfig(roleRaw);
      users.forEach((u) => {
        const userName = u.name || u.Name || u.username || 'Unknown';
        const roleShort = roleKey === 'coral' || roleKey === 'co' ? 'Coral' : roleKey === 'cad' || roleKey === 'cd' ? 'CAD' : cfg.label;
        rows.push({ type: 'user', roleKey, cfg, user: u, displayName: `${roleShort} - ${userName}`, roleLabel: cfg.label });
      });
    });
    return rows;
  }, [usersByRole]);

  const activeCount = useMemo(() =>
    activeTab === 'clients'
      ? clients.length
      : allUsers.filter(u => {
          const r = String(u.role || '').toLowerCase().replace(/\s+/g, '_');
          return !EXCLUDED_ROLES.has(r);
        }).length,
  [activeTab, clients, allUsers]);

  // ── Derived flags (no hooks below) ───────────────────────────────────────
  const isLoading = activeTab === 'clients'
    ? clientsLoading
    : (deptsLoading || usersLoading);

  const onRefresh = async () => {
    setRefreshing(true);
    if (activeTab === 'clients') await refetchClients();
    else await Promise.all([refetchDepts(), refetchUsers()]);
    setRefreshing(false);
  };

  // ── Early return AFTER all hooks ─────────────────────────────────────────
  if (isLoading && !refreshing) return <AnimatedLogoLoader size={80} />;

  // ── Renderers ─────────────────────────────────────────────────────────────
  const renderClient = ({ item: client }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() =>
        navigation.navigate('ClientHandlerEnquiries', {
          client: {
            id:    client.id || client._id,
            name:  client.name  || 'Unknown Client',
            email: client.email || '',
          },
        })
      }>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {client.name ? client.name.substring(0, 2).toUpperCase() : '?'}
        </Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.rowName} numberOfLines={1}>{client.name || 'Unknown Client'}</Text>
        {client.email && client.email !== 'N/A' && (
          <Text style={styles.subText} numberOfLines={1}>{client.email}</Text>
        )}
      </View>
      <Icon name="chevron-right" size={22} color={colors.textLight} />
    </TouchableOpacity>
  );

  const renderDepartmentRow = ({ item }) => {
    const u     = item.user;
    const name  = item.displayName;
    const email = u.email || u.Email || '';
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() =>
          navigation.navigate('ClientHandlerEnquiries', {
            assignedTo: { id: String(u.id || u._id || ''), name: item.displayName },
          })
        }>
        <View style={[styles.avatar, { backgroundColor: item.cfg.color }]}>
          <Text style={styles.avatarText}>{name.substring(0, 2).toUpperCase()}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
          <Text style={[styles.rolePillText, { color: item.cfg.color }]} numberOfLines={1}>{item.roleLabel}</Text>
          {!!email && email !== 'N/A' && (
            <Text style={styles.subText} numberOfLines={1}>{email}</Text>
          )}
        </View>
        <Icon name="chevron-right" size={22} color={colors.textLight} />
      </TouchableOpacity>
    );
  };

  const titleText = activeTab === 'clients'
    ? (showAll ? 'All Clients' : 'My Clients')
    : 'Departments';

  const subtitleText = activeTab === 'clients'
    ? `${activeCount} client${activeCount !== 1 ? 's' : ''}`
    : `${activeCount} member${activeCount !== 1 ? 's' : ''}`;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <TopNavbar navigation={navigation} />

      {/* ── Tabs — above heading ── */}
      <View style={styles.tabBar}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.75}>
              <Icon name={tab.icon} size={15} color={isActive ? colors.primary : 'rgba(255,255,255,0.85)'} />
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Heading ── */}
      <View style={styles.headerSection}>
        <Text style={styles.title}>{titleText}</Text>
        <Text style={styles.subtitle}>{subtitleText}</Text>
      </View>

      {/* Unassigned Enquiries — clients tab only */}
      {activeTab === 'clients' && (
        <TouchableOpacity
          style={styles.unassignedBtn}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ClientHandlerEnquiries', { filter: 'unassigned' })}>
          <View style={styles.unassignedIconWrap}>
            <Icon name="inbox" size={20} color="#fff" />
          </View>
          <View style={styles.unassignedInfo}>
            <Text style={styles.unassignedLabel}>Unassigned Enquiries</Text>
            <Text style={styles.unassignedSub}>View all unassigned enquiries from all clients</Text>
          </View>
          <Icon name="chevron-right" size={22} color={colors.textLight} />
        </TouchableOpacity>
      )}

      {/* ── List ── */}
      {activeTab === 'clients' ? (
        clients.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="people" size={48} color={colors.textLight} />
            <Text style={styles.emptyText}>{showAll ? 'No clients found' : 'No clients assigned yet'}</Text>
            {!showAll && <Text style={styles.emptySubtext}>Contact your admin to get clients assigned</Text>}
          </View>
        ) : (
          <FlatList
            data={clients}
            keyExtractor={c => String(c.id || c._id)}
            renderItem={renderClient}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
            }
          />
        )
      ) : (
        departmentListData.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="business" size={48} color={colors.textLight} />
            <Text style={styles.emptyText}>No team members found</Text>
          </View>
        ) : (
          <FlatList
            data={departmentListData}
            keyExtractor={(item, i) => `u-${item.user?.id || item.user?._id || i}`}
            renderItem={renderDepartmentRow}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
            }
          />
        )
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f7f2' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 20,
  },
  tabActive:     { backgroundColor: '#fff' },
  tabText:       { fontFamily: fonts.medium, fontSize: fonts.sm || 13, color: 'rgba(255,255,255,0.85)' },
  tabTextActive: { fontFamily: fonts.bold,   fontSize: fonts.sm || 13, color: colors.primary },

  headerSection: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title:    { fontSize: fonts.xl, fontFamily: fonts.bold,    color: colors.textPrimary },
  subtitle: { fontSize: fonts.sm, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 2 },

  list: { paddingVertical: 8 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: 16,
    paddingVertical: 14,
    margin: 5,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  avatar: {
    width: 45,
    height: 45,
    borderRadius: 10,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText:   { color: '#fff', fontSize: fonts.base, fontFamily: fonts.bold },
  info:         { flex: 1 },
  rowName:      { fontSize: fonts.base, fontFamily: fonts.bold,    color: colors.textPrimary },
  subText:      { fontSize: fonts.sm,   fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 2 },
  rolePillText: { fontSize: 11, fontFamily: fonts.medium, marginTop: 2 },

  roleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 6,
  },
  roleHeaderDot:  { width: 8, height: 8, borderRadius: 4 },
  roleHeaderText: { fontFamily: fonts.bold, fontSize: fonts.sm || 13 },
  roleHeaderLine: { flex: 1, height: 1 },

  empty:        { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyText:    { fontSize: fonts.lg, fontFamily: fonts.bold,    color: colors.textSecondary, marginTop: 16 },
  emptySubtext: { fontSize: fonts.sm, fontFamily: fonts.regular, color: colors.textLight, marginTop: 8, textAlign: 'center' },

  unassignedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 10,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 10,
    elevation: 2,
  },
  unassignedIconWrap: {
    width: 45,
    height: 45,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  unassignedInfo:  { flex: 1 },
  unassignedLabel: { fontSize: fonts.base, fontFamily: fonts.bold,    color: '#fff' },
  unassignedSub:   { fontSize: fonts.sm,   fontFamily: fonts.regular, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
});

export default ClientHandlerDashboardScreen;
