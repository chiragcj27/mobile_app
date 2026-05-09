import React from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Text,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/cards/Cards';
import { Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { getRoleDisplayName } from '../../utils/helpers';

const AccountModal = ({ visible, onClose }) => {
  const { user, logout } = useAuth();
  

  const handleLogout = () => {
    onClose(); // Close modal first
    logout(); // Then logout
  };

  // Don't render if user is null
  if (!user) {
    return null;
  }

  // Debug function to quickly switch user types
  const handleQuickSwitch = () => {
    Alert.alert(
      'Quick User Switch (Debug)',
      'Choose a user type to test:',
      [
        { text: 'Admin', onPress: () => switchUser('admin') },
        { text: 'Client', onPress: () => switchUser('client') },
        { text: 'Coral Designer', onPress: () => switchUser('coral') },
        { text: 'CAD Designer', onPress: () => switchUser('cad') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const switchUser = async (role) => {
    // Dummy user data for quick switching
    const dummyUsers = {
      admin: { id: '1', name: 'Admin User', email: 'admin@chandrajewels.com', role: 'admin' },
      client: { id: '2', name: 'John Smith', email: 'john@example.com', role: 'client' },
      coral: { id: '3', name: 'Coral Designer', email: 'coral@chandrajewels.com', role: 'coral' },
      cad: { id: '4', name: 'CAD Designer', email: 'cad@chandrajewels.com', role: 'cad' },
    };
    
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.setItem('user', JSON.stringify(dummyUsers[role]));
      // Force reload by logging out and back in
      logout();
      setTimeout(() => {
        // This would normally be handled by the login flow
      }, 100);
    } catch (error) {
    }
    onClose();
  };

  const menuItems = [
    {
      icon: 'account',
      title: 'Profile',
      subtitle: 'View and edit your profile',
      onPress: () => {
        onClose();
        // Navigate to profile screen
      },
    },
    {
      icon: 'settings',
      title: 'Settings',
      subtitle: 'App preferences and configuration',
      onPress: () => {
        onClose();
        // Navigate to settings screen
      },
    },
    {
      icon: '🔄',
      title: 'Quick Switch User (Debug)',
      subtitle: 'Switch between different user types for testing',
      onPress: handleQuickSwitch,
    },
    {
      icon: '❓',
      title: 'Help & Support',
      subtitle: 'Get help and contact support',
      onPress: () => {
        onClose();
        // Navigate to help screen
      },
    },
    {
      icon: 'info',
      title: 'About',
      subtitle: 'App version and information',
      onPress: () => {
        onClose();
        // Navigate to about screen
      },
    },
  ];

  
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.header}>
          <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.textPrimary }}>
            My Account
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={{ fontSize: 16, color: colors.textPrimary }}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          <Card style={styles.profileCard}>
            <View style={styles.profileHeader}>
              <View style={styles.avatar}>
                <Icon name="account" size={24} color={colors.textWhite} />
              </View>
              <View style={styles.profileInfo}>
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.textPrimary }}>
                  {user?.name || 'User'}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                  {user?.email || 'No email'}
                </Text>
                <View style={styles.roleBadge}>
                  <Text style={{ color: colors.textWhite, fontSize: 13 }}>
                    {user?.role ? getRoleDisplayName(user.role) : 'Unknown Role'}
                  </Text>
                </View>
              </View>
            </View>
          </Card>

          <View style={styles.menuSection}>
            {menuItems.map((item, index) => (
              <TouchableOpacity
                key={index}
                style={styles.menuItem}
                onPress={item.onPress}>
                <View style={styles.menuIcon}>
                  <Icon name={item.icon} size={20} color={colors.primary} />
                </View>
                <View style={styles.menuContent}>
                  <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: 'bold' }}>
                    {item.title}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                    {item.subtitle}
                  </Text>
                </View>
                <Text style={{ fontSize: 16, color: colors.textLight }}>›</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Card style={styles.logoutCard}>
            <Button
              title="Sign Out"
              variant="primary"
              onPress={handleLogout}
              style={styles.logoutButton}
            />
          </Card>
        </ScrollView>
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
    padding: 20,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  profileCard: {
    margin: 16,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  profileInfo: {
    flex: 1,
  },
  roleBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  menuSection: {
    margin: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: colors.cardShadow,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuContent: {
    flex: 1,
  },
  logoutCard: {
    margin: 16,
  },
  logoutButton: {
    // Using primary variant, no custom styling needed
  },
});

export default AccountModal;