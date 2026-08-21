import React, { useMemo } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Text,
} from 'react-native';
import Icon from '../../components/common/Icon';
import { colors } from '../../constants/colors';
import { formatDateTime } from '../../utils/helpers';
import { useUsers } from '../../features/users/usersHooks';
import { getUserName } from '../../utils/userUtils';

const EnquiryHistoryModal = ({ visible, onClose, enquiry }) => {
  // Fetch and cache users
  useUsers();

  // Oldest first, newest last
  const sortedHistory = useMemo(() => {
    const history = enquiry?.StatusHistory || enquiry?._originalData?.StatusHistory || [];
    return [...history].sort(
      (a, b) =>
        new Date(a.Timestamp || a.timestamp || 0) - new Date(b.Timestamp || b.timestamp || 0),
    );
  }, [enquiry]);

  const statusPalette = (status) => {
    const s = String(status || '').toLowerCase();
    if (s.includes('enquiry created') || s === 'created') return { bg: '#e8f0e8', text: '#2d7a2d' };
    if (s.includes('cad')) return { bg: '#eff6ff', text: '#1e40af' };
    if (s.includes('coral')) return { bg: '#fef3c7', text: '#b45309' };
    if (s.includes('approved')) return { bg: '#d1fae5', text: '#047857' };
    if (s.includes('rejected')) return { bg: '#fee2e2', text: '#991b1b' };
    return { bg: '#f3f4f6', text: '#374151' };
  };

  const renderHistoryItem = (item, index) => {
    const status = item.Status || item.status || 'N/A';
    const subStatus = item.SubStatus || item.subStatus || null;
    const details = item.Details || item.details || '-';
    const assignedToId = item.AssignedTo || item.assignedTo || '';
    const addedById = item.AddedBy || item.addedBy || '';
    const timestamp = item.Timestamp || item.timestamp || '';
    
    // Get names from IDs using cached users
    const assignedToName = getUserName(assignedToId);
    const addedByName = getUserName(addedById);
    
    const { bg: statusBgColor, text: statusTextColor } = statusPalette(status);
    
    // Format status display with SubStatus if available
    const statusDisplay = subStatus ? `${status} - ${subStatus}` : status;
    
    return (
      <View key={index} style={styles.historyCard}>
        <View style={styles.cardGrid}>
          {/* Status */}
          <View style={styles.gridCell}>
            <Text style={styles.cellLabel}>Status</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusBgColor }]}>
              <Text style={[styles.statusText, { color: statusTextColor }]}>
                {statusDisplay}
              </Text>
            </View>
          </View>
          
          {/* Details */}
          <View style={styles.gridCell}>
            <Text style={styles.cellLabel}>Details</Text>
            <Text style={styles.cellValue} numberOfLines={2}>{details}</Text>
          </View>
          
          {/* Assigned To */}
          <View style={styles.gridCell}>
            <Text style={styles.cellLabel}>Assigned To</Text>
            <View style={styles.userRow}>
              {assignedToName && assignedToName !== '-' ? (
                <>
                  <View style={styles.userAvatar}>
                    <Text style={styles.userAvatarText}>
                      {assignedToName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.cellValue}>{assignedToName}</Text>
                </>
              ) : (
                <Text style={styles.cellValue}>-</Text>
              )}
            </View>
          </View>
          
          {/* Added By */}
          <View style={styles.gridCell}>
            <Text style={styles.cellLabel}>Added By</Text>
            <View style={styles.userRow}>
              {addedByName && addedByName !== '-' ? (
                <>
                  <View style={[styles.userAvatar, { backgroundColor: '#c5562b' }]}>
                    <Text style={styles.userAvatarText}>
                      {addedByName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.cellValue}>{addedByName}</Text>
                </>
              ) : (
                <Text style={styles.cellValue}>-</Text>
              )}
            </View>
          </View>
        </View>
        
        {/* Timestamp Footer */}
        <View style={styles.cardFooter}>
          <Icon name="schedule" size={13} color={colors.textSecondary} />
          <Text style={styles.timestampText}>
            {timestamp ? formatDateTime(timestamp) : '-'}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Icon name="arrow-back" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Enquiry History</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Content */}
        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          {sortedHistory.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon name="history" size={48} color={colors.textSecondary} />
              <Text style={styles.emptyTitle}>No History</Text>
              <Text style={styles.emptySubtitle}>
                History will appear here as the enquiry progresses
              </Text>
            </View>
          ) : (
            sortedHistory.map((item, index) => renderHistoryItem(item, index))
          )}
        </ScrollView>
      </View>
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
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 24,
  },
  historyCard: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardGrid: {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 12,
  },
  gridCell: {
    flex: 1,
    minWidth: '45%',
  },
  cellLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  cellValue: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
    lineHeight: 18,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1a3c3c',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  userAvatarText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textWhite,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  timestampText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

export default EnquiryHistoryModal;
