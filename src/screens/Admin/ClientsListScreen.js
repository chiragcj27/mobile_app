import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Text,
  Image,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BrandedAlert from '../../components/common/BrandedAlert';
import { useClients } from '../../features/clients/clientsHooks';
import { Card } from '../../components/cards/Cards';
import { Button, SearchInput } from '../../components/common';
import { AnimatedLogoLoader } from '../../components/common';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import Icon from '../../components/common/Icon';
import { formatDate } from '../../utils/helpers';
import { FILE_BASE_URL } from '../../config/apiConfig';
import { useAuth } from '../../context/AuthContext';
import { useGetUsersQuery, useUpdateUserMutation } from '../../store/api';

const CLIENT_HANDLER_ROLE = 5;

const ClientsListScreen = ({ navigation }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' ||
                  user?.role === 'AD' ||
                  user?.roleNumber === 1 ||
                  user?.roleId === 1;

  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState([]);
  const [isSelecting, setIsSelecting] = useState(false);

  // Handler assignment modal state
  const [handlerModalVisible, setHandlerModalVisible] = useState(false);
  const [selectedHandlerId, setSelectedHandlerId] = useState(null);

  const showAlert = (title, message, type = 'info', buttons = []) =>
    setAlertConfig({ visible: true, title, message, type, buttons });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));

  const { clients: clientsData = [], isLoading: loading, refetch } = useClients();
  const clients = clientsData || [];

  const { data: usersData = [] } = useGetUsersQuery();
  const [updateUser, { isLoading: assigning }] = useUpdateUserMutation();

  const handlers = useMemo(
    () => usersData.filter(u => Number(u.role) === CLIENT_HANDLER_ROLE || u.roleNumber === CLIENT_HANDLER_ROLE),
    [usersData],
  );

  // Log client → handler assignment map
  useMemo(() => {
    if (usersData.length === 0 || clients.length === 0) return;
    const assignmentMap = {};
    handlers.forEach(h => {
      const assigned = (h.clientsHandled || []).map(cId => {
        const match = clients.find(c => (c.id || c._id) === cId);
        return match ? { id: cId, name: match.name, email: match.email } : { id: cId, name: 'Unknown' };
      });
      assignmentMap[h.name || h.id] = assigned;
    });
    console.log('📋 [ClientsListScreen] Clients assigned per handler:', JSON.stringify(assignmentMap, null, 2));
  }, [handlers, clients]);

  const filteredClients = useMemo(() => {
    if (!searchQuery) return clients;
    const query = searchQuery.toLowerCase();
    return clients.filter(client =>
      (client.name && client.name.toLowerCase().includes(query)) ||
      (client.email && client.email.toLowerCase().includes(query)) ||
      (client.phone && client.phone.includes(searchQuery)),
    );
  }, [clients, searchQuery]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const exitSelectMode = () => {
    setIsSelecting(false);
    setSelectedIds([]);
  };

  const handleLongPress = (client) => {
    const id = client.id || client._id;
    setIsSelecting(true);
    setSelectedIds([id]);
  };

  const handleClientPress = (client) => {
    const id = client.id || client._id;
    if (isSelecting) {
      setSelectedIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
      );
      return;
    }
    if (id) {
      navigation.navigate('ClientPricing', { clientId: id, clientName: client.name });
    } else {
      showAlert('Error', 'Client ID not found', 'error');
    }
  };

  const handleAddClient = () => {
    if (!isAdmin) {
      showAlert('Access Denied', 'Only administrators can create clients.', 'warning');
      return;
    }
    navigation.navigate('CreateClient');
  };

  const handleAssignPress = () => {
    if (handlers.length === 0) {
      showAlert('No Handlers', 'No Client Handler users found. Create one first.', 'warning');
      return;
    }
    setSelectedHandlerId(null);
    setHandlerModalVisible(true);
  };

  const handleConfirmAssign = async () => {
    if (!selectedHandlerId) {
      showAlert('Select Handler', 'Please select a Client Handler first.', 'warning');
      return;
    }

    const handler = handlers.find(h => (h.id || h._id) === selectedHandlerId);
    if (!handler) return;

    const existing = handler.clientsHandled || [];
    const merged = Array.from(new Set([...existing, ...selectedIds]));

    try {
      await updateUser({ userId: selectedHandlerId, clientsHandled: merged }).unwrap();
      setHandlerModalVisible(false);
      exitSelectMode();
      showAlert(
        'Assigned',
        `${selectedIds.length} client(s) assigned to ${handler.name || 'handler'}.`,
        'success',
      );
    } catch (err) {
      showAlert('Error', err?.error || 'Failed to assign clients.', 'error');
    }
  };

  const getClientImageUrl = (client) => {
    if (!client.imageUrl) return null;
    let url = client.imageUrl;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (url.includes('google.com/url') && url.includes('url=')) {
        try {
          const m = url.match(/url=([^&]+)/);
          if (m) url = decodeURIComponent(m[1]);
        } catch { return null; }
      }
    } else {
      url = url.startsWith('/')
        ? `${FILE_BASE_URL}${url}`
        : `${FILE_BASE_URL}/api/clients/files/${encodeURIComponent(url)}`;
    }
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url) ||
      url.includes('amazonaws.com') || url.includes('s3.') ||
      url.includes('cloudinary.com') || url.includes('imgur.com');
    const isHtml = /\.(html|htm)(\?|$)/i.test(url);
    if (isHtml && !isImage) return null;
    const isApi = url.includes(FILE_BASE_URL) || url.includes('/api/');
    return isImage || isApi ? url : null;
  };

  const renderClientItem = (client) => {
    const id = client.id || client._id;
    const imageUrl = getClientImageUrl(client);
    const isSelected = selectedIds.includes(id);

    return (
      <TouchableOpacity
        key={id}
        style={[styles.clientItem, isSelected && styles.clientItemSelected]}
        onPress={() => handleClientPress(client)}
        onLongPress={() => handleLongPress(client)}
        delayLongPress={350}>

        <View style={styles.avatarWrapper}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.clientAvatar} resizeMode="cover" />
          ) : (
            <View style={styles.clientAvatar}>
              <Icon name="account" size={20} color={colors.textWhite} />
            </View>
          )}
          {isSelected && (
            <View style={styles.checkOverlay}>
              <Text style={styles.checkMark}>✓</Text>
            </View>
          )}
        </View>

        <View style={styles.clientContent}>
          <View style={styles.clientHeader}>
            <View style={styles.clientNameContainer}>
              <Text style={styles.clientName}>{client.name || 'Unknown Client'}</Text>
              {client.lastOrder && (
                <Text style={styles.clientDate}>{formatDate(client.lastOrder)}</Text>
              )}
            </View>
          </View>

          {(client.email !== 'N/A' || client.phone !== 'N/A') ? (
            <View style={styles.clientDetails}>
              {client.email && client.email !== 'N/A' && (
                <View style={styles.clientRow}>
                  <Icon name="email" size={14} color={colors.textSecondary} />
                  <Text style={styles.clientDetailText} numberOfLines={1}>{client.email}</Text>
                </View>
              )}
              {client.phone && client.phone !== 'N/A' && (
                <View style={styles.clientRow}>
                  <Icon name="phone" size={14} color={colors.textSecondary} />
                  <Text style={styles.clientDetailText}>{client.phone}</Text>
                </View>
              )}
            </View>
          ) : null}
        </View>

        {!isSelecting && (
          <TouchableOpacity
            style={styles.enquiryBtn}
            onPress={() => navigation.navigate('ClientHandlerEnquiries', {
              client: { id, name: client.name },
            })}
          >
            <Icon name="visibility" size={18} color={colors.primary} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) return <AnimatedLogoLoader size={80} />;

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      {/* Header */}
      {isSelecting ? (
        <View style={styles.selectHeader}>
          <TouchableOpacity onPress={exitSelectMode} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>✕ Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.selectCount}>{selectedIds.length} selected</Text>
          <TouchableOpacity
            onPress={() => {
              const allIds = filteredClients.map(c => c.id || c._id);
              setSelectedIds(allIds);
            }}
            style={styles.selectAllBtn}>
            <Text style={styles.selectAllText}>Select All</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.header}>
          <SearchInput
            placeholder="Search clients..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            onClear={() => setSearchQuery('')}
          />
          {isAdmin && (
            <TouchableOpacity style={styles.addButton} onPress={handleAddClient}>
              <Icon name="add" size={24} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>

        {!isSelecting && (
          <>
            <View style={styles.statsContainer}>
              <Card style={styles.statCard}>
                <View style={styles.statContent}>
                  <Icon name="account" size={24} color={colors.primary} />
                  <View style={styles.statText}>
                    <Text style={styles.statCardValue}>{clients.length}</Text>
                    <Text style={styles.statCardLabel}>Total Clients</Text>
                  </View>
                </View>
              </Card>
            </View>

            <Card style={styles.clientsHeader}>
              <View style={styles.clientsHeaderContent}>
                <View>
                  <Text style={styles.allClientsTitle}>All Clients</Text>
                  <Text style={styles.allClientsSubtitle}>{filteredClients.length} clients found</Text>
                </View>
                {isAdmin && (
                  <TouchableOpacity
                    style={[styles.adminActionButton, styles.adminActionButtonPrimary]}
                    onPress={handleAddClient}
                    activeOpacity={0.85}>
                    <Icon name="add" size={18} color={colors.textWhite} />
                    <Text style={styles.adminActionText}>Create Client</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Card>
          </>
        )}

        {filteredClients.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Icon name="account" size={40} color={colors.textLight} />
            <Text style={[styles.emptyText, { color: colors.textSecondary, fontSize: fonts.base }]}>
              {searchQuery ? 'No clients found' : 'No clients available'}
            </Text>
            <Text style={{ color: colors.textLight, fontSize: fonts.sm }}>
              {searchQuery ? 'Try adjusting your search' : 'Add your first client'}
            </Text>
          </Card>
        ) : (
          <View style={styles.clientsList}>
            {filteredClients.map(renderClientItem)}
          </View>
        )}
      </ScrollView>

      {/* Assign bottom bar */}
      {isSelecting && selectedIds.length > 0 && (
        <View style={styles.assignBar}>
          <Text style={styles.assignBarText}>
            {selectedIds.length} client{selectedIds.length > 1 ? 's' : ''} selected
          </Text>
          <TouchableOpacity style={styles.assignBtn} onPress={handleAssignPress}>
            <Text style={styles.assignBtnText}>Assign to Handler →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Handler picker modal */}
      <Modal
        visible={handlerModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHandlerModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select Client Handler</Text>
            <Text style={styles.modalSubtitle}>
              {selectedIds.length} client{selectedIds.length > 1 ? 's' : ''} will be assigned
            </Text>

            <FlatList
              data={handlers}
              keyExtractor={h => String(h.id || h._id)}
              style={styles.handlerList}
              renderItem={({ item: h }) => {
                const hId = h.id || h._id;
                const isChosen = selectedHandlerId === hId;
                return (
                  <TouchableOpacity
                    style={[styles.handlerRow, isChosen && styles.handlerRowSelected]}
                    onPress={() => setSelectedHandlerId(hId)}>
                    <View style={styles.handlerAvatar}>
                      <Icon name="account" size={18} color={colors.textWhite} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.handlerName}>{h.name || 'Unnamed'}</Text>
                      <Text style={styles.handlerEmail}>{h.email || ''}</Text>
                      <Text style={styles.handlerMeta}>
                        {(h.clientsHandled || []).length} clients currently assigned
                      </Text>
                    </View>
                    {isChosen && <Text style={styles.checkIcon}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.noHandlers}>No Client Handler users found.</Text>
              }
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setHandlerModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, !selectedHandlerId && styles.modalConfirmDisabled]}
                onPress={handleConfirmAssign}
                disabled={!selectedHandlerId || assigning}>
                <Text style={styles.modalConfirmText}>
                  {assigning ? 'Assigning…' : 'Assign'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  addButton: { marginLeft: 12, padding: 8 },
  selectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.primary,
  },
  cancelBtn: { padding: 4 },
  cancelText: { color: colors.textWhite, fontSize: fonts.base, fontFamily: fonts.medium },
  selectCount: { color: colors.textWhite, fontSize: fonts.base, fontFamily: fonts.bold },
  selectAllBtn: { padding: 4 },
  selectAllText: { color: colors.textWhite, fontSize: fonts.sm, fontFamily: fonts.medium },
  scrollView: { flex: 1 },
  statsContainer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  statCard: { width: '100%' },
  statContent: { flexDirection: 'row', alignItems: 'center' },
  statText: { marginLeft: 16, flex: 1 },
  statCardValue: { fontSize: 24, fontFamily: fonts.bold, color: colors.textPrimary, marginBottom: 2 },
  statCardLabel: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.regular },
  clientsHeader: { marginHorizontal: 16, marginTop: 6, marginBottom: 8 },
  clientsHeaderContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  allClientsTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.textPrimary },
  allClientsSubtitle: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.regular },
  adminActionButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, minWidth: 120,
  },
  adminActionButtonPrimary: { backgroundColor: colors.primary },
  adminActionText: { color: colors.textWhite, fontFamily: fonts.medium, fontSize: 14, marginLeft: 8 },
  clientsList: { paddingHorizontal: 16, paddingBottom: 100 },
  clientItem: {
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
  clientItemSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.backgroundSecondary,
  },
  avatarWrapper: { position: 'relative', marginRight: 12 },
  clientAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  checkOverlay: {
    position: 'absolute', inset: 0, borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  checkMark: { color: colors.textWhite, fontSize: 22, fontFamily: fonts.bold },
  clientContent: { flex: 1, justifyContent: 'center' },
  clientHeader: { marginBottom: 6 },
  clientNameContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clientName: { fontSize: 16, fontFamily: fonts.bold, color: colors.textPrimary, flex: 1 },
  clientDate: { color: colors.textLight, fontSize: 12, fontFamily: fonts.regular },
  clientDetails: { marginTop: 4 },
  clientRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  clientDetailText: { marginLeft: 8, color: colors.textSecondary, fontSize: 13, fontFamily: fonts.regular },
  moreButton: { padding: 8, alignSelf: 'flex-start' },
  emptyCard: { margin: 16, alignItems: 'center', paddingVertical: 40 },
  emptyText: { marginTop: 16, marginBottom: 8 },
  // Assign bar
  assignBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    elevation: 8,
  },
  assignBarText: { color: colors.textWhite, fontFamily: fonts.medium, fontSize: fonts.base },
  assignBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
  },
  assignBtnText: { color: colors.textWhite, fontFamily: fonts.bold, fontSize: fonts.base },
  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '75%',
  },
  modalTitle: { fontSize: fonts.lg, fontFamily: fonts.bold, color: colors.textPrimary, marginBottom: 4 },
  modalSubtitle: { fontSize: fonts.sm, color: colors.textSecondary, fontFamily: fonts.regular, marginBottom: 16 },
  handlerList: { maxHeight: 300 },
  handlerRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, borderRadius: 10, marginBottom: 8,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1, borderColor: 'transparent',
  },
  handlerRowSelected: { borderColor: colors.primary, backgroundColor: colors.backgroundSecondary },
  handlerAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  handlerName: { fontSize: fonts.base, fontFamily: fonts.bold, color: colors.textPrimary },
  handlerEmail: { fontSize: fonts.sm, color: colors.textSecondary, fontFamily: fonts.regular },
  handlerMeta: { fontSize: fonts.xs, color: colors.textLight, fontFamily: fonts.regular, marginTop: 2 },
  checkIcon: { fontSize: 20, color: colors.primary, fontFamily: fonts.bold },
  noHandlers: { textAlign: 'center', color: colors.textSecondary, fontFamily: fonts.regular, padding: 20 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  modalCancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 10,
    backgroundColor: colors.backgroundSecondary, alignItems: 'center',
  },
  modalCancelText: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: fonts.base },
  modalConfirmBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 10,
    backgroundColor: colors.primary, alignItems: 'center',
  },
  modalConfirmDisabled: { backgroundColor: colors.border },
  modalConfirmText: { color: colors.textWhite, fontFamily: fonts.bold, fontSize: fonts.base },
  enquiryBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default ClientsListScreen;
