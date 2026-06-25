import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import {
  useGetDashboardDataQuery,
  useGetNotificationsQuery,
} from '../../store/api';
import {
  StatusCard,
  Card,
} from '../../components/cards/Cards';
import { AnimatedLogoLoader } from '../../components/common';
import TopNavbar from '../../components/common/TopNavbar';
import Icon from '../../components/common/Icon';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import useDeviceLayout from '../../hooks/useDeviceLayout';
import { navigateFromNotification } from '../../utils/notificationNavigation';

const DashboardScreen = ({ navigation }) => {
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  // Redux hooks for data fetching
  // Pass role, userId, and clientId (for role 4 users) to get user-specific counts
  const {
    data: dashboardData,
    isLoading: dashboardLoading,
    refetch: refetchDashboard,
  } = useGetDashboardDataQuery(
    {
      role: user?.role || 'client',
      userId: user?.id || user?._id || user?.userId,
      clientId: user?.clientId, // Pass ClientId from token for role 4 users
      roleNumber: user?.roleNumber || user?.roleId, // Pass role number to identify role 4
    },
    {
      skip: !user,
    },
  );

  // Fetch recent notifications (top 5)
  const {
    data: notificationsData = [],
    isLoading: notificationsLoading,
    refetch: refetchNotifications,
  } = useGetNotificationsQuery(
    { limit: 5 },
    {
      skip: !user,
      refetchOnFocus: true,
    },
  );

  const loading =
    dashboardLoading ||
    notificationsLoading;
  const { isTablet, width } = useDeviceLayout();

  // Calculate dynamic max width for tablets (use 94% of screen width with reasonable padding)
  const tabletMaxWidth = isTablet ? Math.min(width * 0.94, width - 48) : null;

  const statsGridStyle = isTablet
    ? [
        styles.statsGrid,
        styles.statsGridTablet,
        tabletMaxWidth && { maxWidth: tabletMaxWidth },
      ]
    : styles.statsGrid;
  const tabletStatusCardStyle = isTablet ? styles.statusCardTablet : null;
  const quickActionsCardStyle = isTablet
    ? [
        styles.quickActionsCard,
        styles.quickActionsCardTablet,
        tabletMaxWidth && { maxWidth: tabletMaxWidth },
      ]
    : styles.quickActionsCard;
  const actionsGridStyle = isTablet
    ? [styles.actionsGrid, styles.actionsGridTablet]
    : styles.actionsGrid;
  const actionButtonStyle = isTablet
    ? [styles.actionButton, styles.actionButtonTablet]
    : styles.actionButton;
  const actionIconSize = isTablet ? 18 : 22;
  const actionTextStyle = isTablet
    ? [styles.actionText, styles.actionTextTablet]
    : styles.actionText;
  const statusCardIconSize = isTablet ? 16 : 20;

  const navigateWithDashboardFilter = useCallback(
    (params = {}) => {
      navigation.navigate('Enquiries', {
        ...params,
        filterSource: 'dashboard',
        filterAppliedAt: Date.now(),
      });
    },
    [navigation],
  );

  // Safety check - don't render if user is not loaded (must be after all hooks)
  if (!user) {
    return <AnimatedLogoLoader size={60} />;
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refetchDashboard(),
      refetchNotifications(),
    ]);
    setRefreshing(false);
  };

  const renderAdminDashboard = () => (
    <View style={styles.dashboardContent}>
      <View style={styles.NewEnquiryPricingButtonContainer}>
        <TouchableOpacity
          style={styles.NewEnquiryButton}
          onPress={() => navigation.navigate('PricingCalci')}
        >
          <Icon name="attach-money" size={20} color={colors.textWhite} />
          <Text style={styles.NewEnquiryText}>Pricing Calculator</Text>
        </TouchableOpacity>

           <TouchableOpacity
          style={styles.NewEnquiryButton}
          onPress={() => navigation.navigate('EstimateJwellery')}
        >
          <Icon name="attach-money" size={20} color={colors.textWhite} />
          <Text style={styles.NewEnquiryText}>Approx Pricing</Text>
        </TouchableOpacity>

          <TouchableOpacity
          style={styles.NewEnquiryButton}
          onPress={() => navigation.navigate('Reports')}
        >
          <Icon name="report" size={20} color={colors.textWhite} />
          <Text style={styles.NewEnquiryText}>Reports</Text>
        </TouchableOpacity>
      </View>

      {/* Overview Section - Only show on mobile, hidden on tablets */}
     
      {/* Clients & Departments - All Enquiries Button */}
        <View style={styles.overviewSection}>
            <Text style={styles.overviewTitle}>Client & Department Management</Text>
          </View>
      <View style={styles.allEnquiriesSection}>
        
        <TouchableOpacity
          style={styles.allEnquiriesButton}
          onPress={() => navigation.navigate('AllClientsDashboard', { showAll: true })}
          activeOpacity={0.8}
        >
          <View style={styles.allEnquiriesIconContainer}>
            <Icon name="people" size={28} color={colors.textWhite} />
          </View>
          <View style={styles.allEnquiriesTextContainer}>
            <Text style={styles.allEnquiriesTitle}>All Enquiries</Text>
            <Text style={styles.allEnquiriesSubtitle}>
              Clients & Departments
            </Text>
          </View>
          <Icon name="chevron-right" size={28} color={colors.textWhite} />
        </TouchableOpacity>
      </View>

      

       {!isTablet && (
        <>
          <View style={styles.overviewSection}>
            <Text style={styles.overviewTitle}> Overview</Text>
          </View>

          {/* Other Stats */}
          <View style={statsGridStyle}>
            <StatusCard
              title="Total Enquiries"
              value={dashboardData?.totalEnquiries || '0'}
              icon={
                <Icon
                  name="assignment"
                  size={statusCardIconSize}
                  color={colors.textWhite}
                />
              }
              color={colors.primary}
              onPress={() => navigation.navigate('Enquiries')}
              style={tabletStatusCardStyle}
            />
            <StatusCard
              title="Total Clients"
              value={dashboardData?.totalClients || '0'}
              icon={
                <Icon
                  name="people"
                  size={statusCardIconSize}
                  color={colors.textWhite}
                />
              }
              color={colors.primary}
              onPress={() => navigation.navigate('ClientsList')}
              style={tabletStatusCardStyle}
            />
          </View>
        </>
      )}

    </View>
  );

  const renderClientDashboard = () => (
    <View style={statsGridStyle}>
      <StatusCard
        title="My Enquiries"
        value={
          dashboardData?.myEnquiries ??
          dashboardData?.categorizedCounts?.['All'] ??
          0
        }
        icon={
          <Icon
            name="assignment"
            size={statusCardIconSize}
            color={colors.textWhite}
          />
        }
        color={colors.primary}
        valueColor={colors.primary}
        onPress={() => navigation.navigate('Enquiries')}
        style={tabletStatusCardStyle}
      />
      <StatusCard
        title="In-progress"
        value={
          dashboardData?.pendingApprovals ??
          dashboardData?.categorizedCounts?.['Pending'] ??
          0
        }
        icon={
          <Icon
            name="schedule"
            size={statusCardIconSize}
            color={colors.textWhite}
          />
        }
        color={colors.primary}
        valueColor={colors.primary}
        onPress={() => navigateWithDashboardFilter({ filter: 'pending' })}
        style={tabletStatusCardStyle}
      />
      <StatusCard
        title="Approval Pending"
        value={
          dashboardData?.approvalPending ??
          dashboardData?.categorizedCounts?.['Approval Pending'] ??
          0
        }
        icon={
          <Icon
            name="pending-actions"
            size={statusCardIconSize}
            color={colors.textWhite}
          />
        }
        color={colors.primary}
        valueColor={colors.primary}
        onPress={() =>
          navigateWithDashboardFilter({ filter: 'approval_pending' })
        }
        style={tabletStatusCardStyle}
      />
      <StatusCard
        title="Completed Orders"
        value={
          dashboardData?.completedOrders ??
          dashboardData?.categorizedCounts?.['Completed'] ??
          0
        }
        icon={
          <Icon
            name="check-circle"
            size={statusCardIconSize}
            color={colors.textWhite}
          />
        }
        color={colors.primary}
        valueColor={colors.primary}
        onPress={() => navigateWithDashboardFilter({ filter: 'completed' })}
        style={tabletStatusCardStyle}
      />
    </View>
  );

  const renderDesignerDashboard = role => {
    // For CAD role, show specific 4 cards
    if (role === 'cad') {
      // Get counts from dashboard data or specific status counts
      const totalCount =
        dashboardData?.assignedEnquiries ||
        dashboardData?.categorizedCounts?.['All'] ||
        dashboardData?.specificStatusCounts?.['All'] ||
        '0';

      const designApprovalPendingCount =
        dashboardData?.approvalPendingDesigns ||
        dashboardData?.specificStatusCounts?.['Design Approval Pending'] ||
        dashboardData?.categorizedCounts?.['Approval Pending'] ||
        dashboardData?.categorizedCounts?.['Design Approval Pending'] ||
        '0';

      return (
        <View style={statsGridStyle}>
          <StatusCard
            title="Total"
            value={totalCount}
            icon={
              <Icon
                name="work"
                size={statusCardIconSize}
                color={colors.textWhite}
              />
            }
            color={colors.primary}
            onPress={() => navigation.navigate('Enquiries')}
            style={tabletStatusCardStyle}
          />
          <StatusCard
            title="Design Approval Pending"
            value={designApprovalPendingCount}
            icon={
              <Icon
                name="pending-actions"
                size={statusCardIconSize}
                color={colors.textWhite}
              />
            }
            color={colors.primary}
            onPress={() =>
              navigateWithDashboardFilter({ filter: 'design approval pending' })
            }
            style={tabletStatusCardStyle}
          />
        </View>
      );
    }

    // For Coral role, keep existing cards

    // ========== PENDING DESIGNS COUNT LOGGING ==========
    const pendingDesignsValue1 = dashboardData?.pendingDesigns;
    // For Coral role: "Pending Designs" = Coral count ONLY (not "Pending" category)
    // Priority: dashboardData.pendingDesigns (from API, role-specific) > statusStats > default 0
    const finalPendingDesignsValue =
      pendingDesignsValue1 || 0;

    return (
      <View style={statsGridStyle}>
        <StatusCard
          title="Assigned Enquiries"
          value={
            dashboardData?.assignedEnquiries ||
            dashboardData?.categorizedCounts?.['All'] ||
            '0'
          }
          icon={
            <Icon
              name="work"
              size={statusCardIconSize}
              color={colors.textWhite}
            />
          }
          color={colors.primary}
          onPress={() => navigation.navigate('Enquiries')}
          style={tabletStatusCardStyle}
        />
        <StatusCard
          title="Pending Designs"
          value={finalPendingDesignsValue}
          icon={
            <Icon
              name="pending"
              size={statusCardIconSize}
              color={colors.textWhite}
            />
          }
          color={colors.primaryDark}
          onPress={() => {
            console.log(
              '🎯 [DASHBOARD] "Pending Designs" tile pressed (Coral role)',
            );
            console.log(
              '🎯 [DASHBOARD] Coral count displayed:',
              finalPendingDesignsValue,
            );
            console.log(
              '🎯 [DASHBOARD] Filter being applied: "coral" → shows Coral status enquiries',
            );
            navigateWithDashboardFilter({ filter: 'coral' });
          }}
          style={tabletStatusCardStyle}
        />
        <StatusCard
          title="Approval Pending"
          value={
            dashboardData?.approvalPendingDesigns ||
            dashboardData?.categorizedCounts?.['Approval Pending'] ||
            dashboardData?.categorizedCounts?.['Design Approval Pending'] ||
            '0'
          }
          icon={
            <Icon
              name="pending-actions"
              size={statusCardIconSize}
              color={colors.textWhite}
            />
          }
          color={colors.primaryLight}
          onPress={() =>
            navigateWithDashboardFilter({ filter: 'design approval pending' })
          }
          style={tabletStatusCardStyle}
        />
        <StatusCard
          title="Completed Designs"
          value={
            dashboardData?.completedDesigns ||
            dashboardData?.categorizedCounts?.['Completed'] ||
            '0'
          }
          icon={
            <Icon
              name="palette"
              size={statusCardIconSize}
              color={colors.textWhite}
            />
          }
          color={colors.primary}
          onPress={() => navigateWithDashboardFilter({ filter: 'completed' })}
          style={tabletStatusCardStyle}
        />
      </View>
    );
  };

  const getQuickActionsList = () => {
    const actions = [];
    if (user?.role === 'admin') {
      actions.push(
        {
          title: 'Metal Prices',
          icon: 'trending-up',
          onPress: () => navigation.navigate('MetalPrices'),
        },
        {
          title: 'Clients List',
          icon: 'people',
          onPress: () => navigation.navigate('ClientsList'),
        },
        {
          title: 'Users List',
          icon: 'account',
          onPress: () => navigation.navigate('UsersList'),
        },
      );
    }
    if (user?.role === 'client') {
      actions.push({
        title: 'Add New Enquiry',
        icon: 'add-circle',
        onPress: () => navigation.navigate('AddEnquiryStep1'),
      });
    }
    if (user?.role === 'coral' || user?.role === 'cad') {
      actions.push(
        {
          title: 'My Assignments',
          icon: 'work',
          onPress: () => navigation.navigate('EnquiryList'),
        },
        {
          title: 'Upload Design',
          icon: 'file-upload',
          onPress: () => navigation.navigate('UploadDesign'),
        },
      );
    }
    return actions;
  };

  const renderCombinedOverviewAndQuickActions = () => {
    const actions = getQuickActionsList();

    return (
      <View style={styles.combinedSectionTablet}>
        <View style={styles.combinedSectionLeft}>
          <Text style={styles.combinedSectionTitle}>Overview</Text>
          <View style={styles.combinedStatsGrid}>
            <StatusCard
              title="Total Enquiries"
              value={dashboardData?.totalEnquiries || '0'}
              icon={
                <Icon
                  name="assignment"
                  size={statusCardIconSize}
                  color={colors.textWhite}
                />
              }
              color={colors.primary}
              onPress={() => navigation.navigate('Enquiries')}
              style={styles.combinedStatusCard}
            />
            <StatusCard
              title="Total Clients"
              value={dashboardData?.totalClients || '0'}
              icon={
                <Icon
                  name="people"
                  size={statusCardIconSize}
                  color={colors.textWhite}
                />
              }
              color={colors.primary}
              onPress={() => navigation.navigate('ClientsList')}
              style={styles.combinedStatusCard}
            />
          </View>
        </View>
        <View style={styles.combinedSectionRight}>
          <Text style={styles.combinedSectionTitle}>Quick Actions</Text>
          <View style={styles.combinedActionsGrid}>
            {actions.map((action, index) => (
              <TouchableOpacity
                key={index}
                style={[styles.actionButton, styles.combinedActionButton]}
                onPress={action.onPress}
                activeOpacity={0.7}
              >
                <View style={styles.actionIcon}>
                  <Icon
                    name={action.icon}
                    size={actionIconSize}
                    color={colors.primary}
                  />
                </View>
                <Text style={actionTextStyle}>{action.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    );
  };

  const renderQuickActions = () => {
    const actions = getQuickActionsList();

    return (
      <Card style={quickActionsCardStyle}>
        <Text style={styles.quickActionsTitle}>Quick Actions</Text>
        <View style={actionsGridStyle}>
          {actions.map((action, index) => (
            <TouchableOpacity
              key={index}
              style={actionButtonStyle}
              onPress={action.onPress}
              activeOpacity={0.7}
            >
              <View style={styles.actionIcon}>
                <Icon
                  name={action.icon}
                  size={actionIconSize}
                  color={colors.primary}
                />
              </View>
              <Text style={actionTextStyle}>{action.title}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>
    );
  };

  // Helper function to format time ago
  const formatTimeAgo = timestamp => {
    if (!timestamp) return '';

    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return '';

      const now = new Date();
      const diffTime = Math.abs(now - date);
      const diffSeconds = Math.floor(diffTime / 1000);
      const diffMinutes = Math.floor(diffTime / (1000 * 60));
      const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffSeconds < 60) return 'Just now';
      if (diffMinutes < 60)
        return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
      if (diffHours < 24)
        return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
      if (diffDays < 7)
        return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;

      // For older notifications, show date
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const year = date.getFullYear();
      const currentYear = now.getFullYear();

      if (year === currentYear) {
        return `${month}/${day}`;
      } else {
        return `${month}/${day}/${year}`;
      }
    } catch (error) {
      return '';
    }
  };

  // Get icon name based on notification type
  const getNotificationIcon = type => {
    const typeLower = (type || '').toLowerCase();
    if (typeLower.includes('enquiry') || typeLower.includes('new'))
      return 'assignment';
    if (typeLower.includes('approv') || typeLower.includes('approved'))
      return 'check-circle';
    if (typeLower.includes('reject') || typeLower.includes('rejected'))
      return 'cancel';
    if (
      typeLower.includes('design') ||
      typeLower.includes('cad') ||
      typeLower.includes('coral')
    )
      return 'palette';
    if (typeLower.includes('payment') || typeLower.includes('order'))
      return 'payment';
    if (typeLower.includes('message') || typeLower.includes('chat'))
      return 'message';
    if (typeLower.includes('status') || typeLower.includes('update'))
      return 'update';
    return 'notifications';
  };

  // Get icon background color based on notification type
  const getNotificationIconColor = type => {
    const typeLower = (type || '').toLowerCase();
    if (typeLower.includes('approv') || typeLower.includes('approved'))
      return 'rgba(76, 175, 80, 0.1)';
    if (typeLower.includes('reject') || typeLower.includes('rejected'))
      return 'rgba(239, 68, 68, 0.1)';
    if (typeLower.includes('payment') || typeLower.includes('order'))
      return 'rgba(139, 69, 19, 0.1)';
    return 'rgba(33, 150, 243, 0.1)';
  };

  const renderRecentActivity = () => {
    const notifications = Array.isArray(notificationsData)
      ? notificationsData.slice(0, 5)
      : [];

    return (
      <Card style={styles.recentActivityCard}>
        <Text style={styles.recentActivityTitle}>Recent Activity</Text>

        {notifications.length > 0 ? (
          notifications.map(notification => {
            const iconName = getNotificationIcon(notification.type);
            const iconBgColor = getNotificationIconColor(notification.type);
            const timeAgo = formatTimeAgo(
              notification.timestamp || notification.createdAt,
            );

            return (
              <TouchableOpacity
                key={notification.id || notification._id}
                style={styles.activityItem}
                onPress={() => {
                  // Use the same navigation utility as NotificationsScreen
                  // This handles all notification types: enquiry, chat, design, pricing, etc.
                  const rawNotification = notification.raw || notification;
                  navigateFromNotification(rawNotification);
                }}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.activityIcon,
                    { backgroundColor: iconBgColor },
                  ]}
                >
                  <Icon name={iconName} size={16} color={colors.primary} />
                </View>
                <View style={styles.activityTextContainer}>
                  <Text style={styles.activityText} numberOfLines={2}>
                    {notification.title ||
                      notification.message ||
                      'Notification'}
                  </Text>
                  {notification.message && notification.title && (
                    <Text style={styles.activitySubtext} numberOfLines={1}>
                      {notification.message}
                    </Text>
                  )}
                  <Text style={styles.activityTime}>{timeAgo}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.activityItem}>
            <View style={styles.activityIcon}>
              <Icon
                name="notifications-none"
                size={16}
                color={colors.textLight}
              />
            </View>
            <View style={styles.activityTextContainer}>
              <Text style={[styles.activityText, { color: colors.textLight }]}>
                No recent activity
              </Text>
            </View>
          </View>
        )}
      </Card>
    );
  };

  if (loading) {
    return <AnimatedLogoLoader size={80} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <TopNavbar navigation={navigation} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Enhanced Welcome Header */}
        <View style={styles.welcomeSection}>
          <View style={styles.welcomeCard}>
            <View style={styles.welcomeContent}>
              <View style={styles.welcomeText}>
                <Text style={styles.welcomeGreeting}>
                  Hii{' '}
                  <Text style={styles.userNameHighlight}>
                    {user?.name || 'User'}
                  </Text>
                  ,
                </Text>
                <Text style={styles.welcomeSubtitle}>
                  Welcome to Chandra Jewels
                </Text>
              </View>
              <View style={styles.welcomeIconContainer}>
                <View style={styles.welcomeIcon}>
                  <Icon name="diamond" size={22} color={colors.textWhite} />
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Role-based Dashboard Content */}
        {user?.role === 'admin' && renderAdminDashboard()}
        {user?.role === 'client' && renderClientDashboard()}
        {(user?.role === 'coral' || user?.role === 'cad') &&
          renderDesignerDashboard(user.role)}

        {/* Combined Overview and Quick Actions - Only on tablets for admin role */}
        {isTablet && user?.role === 'admin' && (
          <View style={styles.combinedSectionContainer}>
            {renderCombinedOverviewAndQuickActions()}
          </View>
        )}

        {/* Quick Actions - Only show on mobile, hidden on tablets for admin (shown in combined section) */}
        {!isTablet &&
          user?.role !== 'coral' &&
          user?.role !== 'cad' &&
          user?.role !== 'client' &&
          user?.roleNumber !== 4 &&
          user?.roleId !== 4 && (
            <View style={styles.quickActionsSection}>
              {renderQuickActions()}
            </View>
          )}

        {/* Recent Activity */}
        <View style={styles.recentActivitySection}>
          {renderRecentActivity()}
        </View>
      </ScrollView>

      {/* Floating Action Button - Add New Enquiry */}
      {(user?.role === 'admin' || user?.role === 'client') && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('AllClientsDashboard', { showAll: true })}
          activeOpacity={0.8}
        >
          <Icon name="add-circle" size={24} color={colors.textWhite} />
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },

  // Welcome Section - Premium Design
  welcomeSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  welcomeCard: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: 16,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  welcomeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  welcomeText: {
    flex: 1,
  },
  welcomeGreeting: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textWhite,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  userNameHighlight: {
    fontFamily: fonts.bold,
    fontStyle: 'italic',
  },
  welcomeSubtitle: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textWhite,
    opacity: 0.9,
    letterSpacing: 0.3,
  },
  welcomeIconContainer: {
    marginLeft: 10,
  },
  welcomeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Dashboard Content
  dashboardContent: {
    paddingTop: 4,
  },

  // Overview Section
  overviewSection: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  overviewTitle: {
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    letterSpacing: 0.2,
  },

  // Stats Grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    justifyContent: 'space-between',
  },
  statsGridTablet: {
    alignSelf: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  statusCardTablet: {
    width: 200,
    maxWidth: 200,
    minWidth: 200,
    marginHorizontal: 8,
    aspectRatio: 1.1,
    minHeight: 150,
    maxHeight: 200,
  },

  // Quick Actions Section
  quickActionsSection: {
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  quickActionsCard: {
    marginHorizontal: 0,
    marginVertical: 0,
    padding: 16,
  },
  quickActionsCardTablet: {
    alignSelf: 'center',
    padding: 16,
    paddingHorizontal: 32,
  },
  quickActionsTitle: {
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 12,
    letterSpacing: 0.2,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionsGridTablet: {
    justifyContent: 'flex-start',
    gap: 16,
  },
  actionButton: {
    width: '48%',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 100,
    marginBottom: 10,
  },
  actionButtonTablet: {
    width: 180,
    maxWidth: 180,
    minWidth: 180,
    marginRight: 16,
    marginBottom: 12,
    padding: 14,
    minHeight: 130,
  },
  actionIcon: {
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  actionText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: 0.2,
  },
  actionTextTablet: {
    fontSize: fonts.xs,
    lineHeight: 16,
  },
  // Combined Overview and Quick Actions Section (Tablet only)
  combinedSectionContainer: {
    paddingHorizontal: 32,
    paddingTop: 8,
    paddingBottom: 12,
  },
  combinedSectionTablet: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 24,
  },
  combinedSectionLeft: {
    flex: 1,
    marginRight: 12,
  },
  combinedSectionRight: {
    flex: 1,
    marginLeft: 12,
  },
  combinedSectionTitle: {
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 12,
    letterSpacing: 0.2,
  },
  combinedStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 12,
    justifyContent: 'space-between',
    alignItems: 'stretch',
  },
  combinedStatusCard: {
    flex: 1,
    width: '48%',
    minWidth: 0,
    maxWidth: '48%',
    marginHorizontal: 0,
    marginVertical: 0,
    aspectRatio: 1.1,
    minHeight: 140,
  },
  combinedActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  combinedActionButton: {
    flex: 1,
    width: '48%',
    minWidth: 0,
    maxWidth: '48%',
    marginRight: 0,
    marginBottom: 0,
    minHeight: 120,
  },

  // Recent Activity Section
  recentActivitySection: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 6,
  },
  recentActivityCard: {
    marginHorizontal: 0,
    marginVertical: 0,
    padding: 16,
  },
  recentActivityTitle: {
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    marginBottom: 12,
    letterSpacing: 0.2,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.backgroundSecondary,
  },
  activityIcon: {
    borderRadius: 19,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityTextContainer: {
    flex: 1,
    paddingTop: 2,
  },
  activityText: {
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    lineHeight: 20,
    marginBottom: 4,
    letterSpacing: 0.1,
  },
  activityTime: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textLight,
    lineHeight: 16,
    letterSpacing: 0.1,
    marginTop: 2,
  },
  activitySubtext: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    lineHeight: 16,
    marginTop: 2,
    marginBottom: 2,
  },
  // Floating Action Button
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 10, // Position above bottom tab bar
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },

  // new button styles
  NewEnquiryPricingButtonContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    gap: 10,
    margin:10
  },

  NewEnquiryButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexBasis: '48%',
    flexGrow: 1,
    flexDirection: 'row',
  },

  NewEnquiryText: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textWhite,
    marginLeft: 10,
  },

  // All Enquiries Button
  allEnquiriesSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  allEnquiriesButton: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  allEnquiriesIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  allEnquiriesTextContainer: {
    flex: 1,
  },
  allEnquiriesTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.textWhite,
    letterSpacing: 0.3,
  },
  allEnquiriesSubtitle: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textWhite,
    opacity: 0.85,
    marginTop: 2,
    letterSpacing: 0.2,
  },
});

export default DashboardScreen;
