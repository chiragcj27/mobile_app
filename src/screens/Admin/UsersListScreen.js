import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Text,
  FlatList
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BrandedAlert from '../../components/common/BrandedAlert';
import { useGetUsersQuery } from '../../store/api';
import { Card } from '../../components/cards/Cards';
import { SearchInput } from '../../components/common';
import { AnimatedLogoLoader } from '../../components/common';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import Icon from '../../components/common/Icon';
import { useAuth } from '../../context/AuthContext';

const ROLE_MAP = {
  1: 'Admin',
  2: 'Coral Designer',
  3: 'CAD Designer',
  4: 'Client',
  5: 'Client Handler',
  6: 'Order Placement'
};

const UsersListScreen = ({ navigation }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'AD' || user?.roleNumber === 1 || user?.roleId === 1;
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  const showAlert = (title, message, type = 'info', buttons = []) =>
    setAlertConfig({ visible: true, title, message, type, buttons });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));

  const { data: usersData = [], isLoading: loading, refetch } = useGetUsersQuery();
  console.log('Fetched users:', usersData);
  const users = Array.isArray(usersData) ? usersData : [];

  const filteredUsers = useMemo(() => {
    if (!searchQuery) return users;
    const query = searchQuery.toLowerCase();
    return users.filter(user =>
      (user.name && user.name.toLowerCase().includes(query)) ||
      (user.email && user.email.toLowerCase().includes(query)) ||
      (user.skills && user.skills.toLowerCase().includes(query)) ||
      (ROLE_MAP[user.role] && ROLE_MAP[user.role].toLowerCase().includes(query))
    );
  }, [users, searchQuery]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleUserPress = (user) => {
    const userId = user.id || user._id;
    if (userId) {
      navigation.navigate('CreateUser', { userId });
    } else {
      showAlert('Error', 'User ID not found', 'error');
    }
  };

  const handleAddUser = () => {
    if (!isAdmin) {
      showAlert('Access Denied', 'Only administrators can create users.', 'warning');
      return;
    }
    navigation.navigate('CreateUser');
  };

  const renderUserItem = (user) => {
    const roleName = ROLE_MAP[user.role] || 'Unknown';
    const roleColor = user.role === 1 ? colors.error : user.role === 4 ? colors.info : colors.primary;

    return (
      <TouchableOpacity
        key={user.id || user._id}
        style={styles.userItem}
        onPress={() => handleUserPress(user)}>
        <View style={[styles.userAvatar, { backgroundColor: roleColor }]}>
          <Icon name="account" size={20} color={colors.textWhite} />
        </View>

        <View style={styles.userContent}>
          <View style={styles.userHeader}>
            <Text style={styles.userName}>{user.name || 'Unknown User'}</Text>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + '20' }]}>
              <Text style={[styles.roleText, { color: roleColor }]}>{roleName}</Text>
            </View>
          </View>

          <View style={styles.userDetails}>
            {user.email && (
              <View style={styles.userRow}>
                <Icon name="email" size={14} color={colors.textSecondary} />
                <Text style={styles.userDetailText} numberOfLines={1}>{user.email}</Text>
              </View>
            )}
            {user.skills && (
              <View style={styles.userRow}>
                <Icon name="star" size={14} color={colors.textSecondary} />
                <Text style={styles.userDetailText} numberOfLines={1}>{user.skills}</Text>
              </View>
            )}
          </View>
        </View>

        <TouchableOpacity style={styles.moreButton}>
          <Text style={{ fontSize: 16, color: colors.textSecondary }}>⋮</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderStatsCards = () => {
    const roleStats = users.reduce((acc, user) => {
      const role = user.role;
      acc[role] = (acc[role] || 0) + 1;
      return acc;
    }, {});

    return (
      <View style={styles.statsContainer}>
        <Card style={styles.statCard}>
          <View style={styles.statContent}>
            <Icon name="people" size={24} color={colors.primary} />
            <View style={styles.statText}>
              <Text style={styles.statCardValue}>{users.length}</Text>
              <Text style={styles.statCardLabel}>Total Users</Text>
            </View>
          </View>
        </Card>
        <FlatList
          data={Object.entries(roleStats).map(([role, count]) => ({ role, count }))}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.role}
          contentContainerStyle={styles.roleStatsRow}
          renderItem={({ item }) => (
            <View style={styles.roleStatItem}>
              <Text style={styles.roleStatValue}>{item.count}</Text>
              <Text style={styles.roleStatLabel}>{ROLE_MAP[item.role] || 'Unknown'}</Text>
            </View>
          )}
        />
      </View>
    );
  };

  if (loading) {
    return <AnimatedLogoLoader size={80} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['left','right','bottom']}>
      <View style={styles.header}>
        <SearchInput
          placeholder="Search users..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          onClear={() => setSearchQuery('')}
        />
        {isAdmin && (
          <TouchableOpacity style={styles.addButton} onPress={handleAddUser}>
            <Icon name="add" size={24} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {renderStatsCards()}

        <Card style={styles.usersHeader}>
          <View style={styles.usersHeaderContent}>
            <View>
              <Text style={styles.allUsersTitle}>All Users</Text>
              <Text style={styles.allUsersSubtitle}>{filteredUsers.length} users found</Text>
            </View>
            {isAdmin && (
              <TouchableOpacity 
                style={styles.adminActionButton} 
                onPress={handleAddUser}
                activeOpacity={0.85}>
                <Icon name="add" size={18} color={colors.textWhite} />
                <Text style={styles.adminActionText}>Create User</Text>
              </TouchableOpacity>
            )}
          </View>
        </Card>

        {filteredUsers.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Icon name="people" size={40} color={colors.textLight} />
            <Text style={[styles.emptyText, { color: colors.textSecondary, fontSize: fonts.base }]}>
              {searchQuery ? 'No users found' : 'No users available'}
            </Text>
            <Text style={{ color: colors.textLight, fontSize: fonts.sm }}>
              {searchQuery ? 'Try adjusting your search' : 'Add your first user'}
            </Text>
          </Card>
        ) : (
          <View style={styles.usersList}>
            {filteredUsers.map(renderUserItem)}
          </View>
        )}
      </ScrollView>
      <BrandedAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        buttons={alertConfig.buttons}
        onClose={hideAlert}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  addButton: {
    marginLeft: 12,
    padding: 8,
  },
  scrollView: {
    flex: 1,
  },
  statsContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  statCard: {
    width: '100%',
    marginBottom: 12,
  },
  statContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statText: {
    marginLeft: 16,
    flex: 1,
  },
  roleStatsRow: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    gap: 12,
  },
  roleStatItem: {
    alignItems: 'center',
    backgroundColor: colors.cardBackground || '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderLight || 'rgba(192, 200, 199, 0.3)',
  },
  roleStatValue: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  roleStatLabel: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginTop: 2,
  },
  usersHeader: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 8,
  },
  usersHeaderContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  usersList: {
    paddingHorizontal: 16,
  },
  userItem: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    shadowColor: colors.cardShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userContent: {
    flex: 1,
    justifyContent: 'center',
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  userName: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    flex: 1,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  roleText: {
    fontSize: 11,
    fontFamily: fonts.medium,
  },
  userDetails: {
    marginTop: 4,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  userDetailText: {
    marginLeft: 8,
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  statCardValue: {
    fontSize: 24,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  statCardLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  allUsersTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  allUsersSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  moreButton: {
    padding: 8,
    alignSelf: 'flex-start',
  },
  emptyCard: {
    margin: 16,
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    marginTop: 16,
    marginBottom: 8,
  },
  adminActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  adminActionText: {
    color: colors.textWhite,
    fontFamily: fonts.medium,
    fontSize: 14,
    marginLeft: 8,
  },
});

export default UsersListScreen;
