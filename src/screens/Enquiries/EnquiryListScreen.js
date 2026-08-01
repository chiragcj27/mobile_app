import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Text,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { useFocusEffect, useRoute } from '@react-navigation/native';

import { useAuth } from '../../context/AuthContext';
import { useClients } from '../../features/clients/clientsHooks';
import {
  useGetEnquiriesQuery,
  useGetEnquiryBucketsQuery,
  useGetEnquiryByIdQuery,
  useUpdateEnquiryMutation,
  useDeleteEnquiryMutation,
  useUpdateAssetDataMutation,
} from '../../store/api';
import {
  setActiveTab,
  setFilters,
  setSearchQuery,
  setSorting,
  clearFilters,
} from '../../features/enquiries/enquiriesSlice';
import { TAB, SUBSTATUS, STATUS } from '../../constants/enquiry';

import NewCard from '../../components/cards/NewCard';
import { SearchInput, AnimatedLogoLoader } from '../../components/common';
import TopNavbar from '../../components/common/TopNavbar';
import Icon from '../../components/common/Icon';
import EnquiryFiltersModal from '../../components/filters/EnquiryFiltersModal';
import QuotationModal from '../../components/modals/QuotationModal';
import FinalLookModal from '../../components/modals/FinalLookModal';
import ShareEnquiryModal from '../../components/modals/ShareEnquiryModal';
import CreateEnquiryModal from '../EditEnquiry/createEnquiryModal';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import Clipboard from '@react-native-clipboard/clipboard';
import useDeviceLayout from '../../hooks/useDeviceLayout';
import { useEnquiryActions } from '../../hooks/useEnquiryActions';

const PAGE_SIZE = 20;

const ROLE_KIND = {
  ADMIN_CH: 'admin_ch',
  CORAL: 'coral',
  CAD: 'cad',
  CLIENT: 'client',
  OTHER: 'other',
  Order : 'Order_placement'
};

const classifyRole = (role) => {
  const r = String(role || '').toLowerCase();
  if (r === 'admin' || r === 'ad' || r === 'client_handler' || r === 'ch') return ROLE_KIND.ADMIN_CH;
  if (r === 'coral' || r === 'co') return ROLE_KIND.CORAL;
  if (r === 'cad' || r === 'cd') return ROLE_KIND.CAD;
  if (r === 'client' || r === 'cl') return ROLE_KIND.CLIENT;
  if (r === 'order_placement' || r === 'op') return ROLE_KIND.Order;
  return ROLE_KIND.OTHER;
};

const ADMIN_TABS = [
  { key: TAB.WIP, label: 'Work in Progress', bucketKey: 'wip' },
  { key: TAB.APPROVAL, label: 'Approval Pending', bucketKey: 'approvalPending' },

];

const DESIGNER_TAB = {
  MINE: 'designer_mine',
  WIP: 'designer_wip',
};

const ORDER_PLACEMENT_TABS=[
  { key: TAB.Order_Placement, label: 'Order Placement', bucketKey: 'orderPlacement' },
]

const buildArg = ({ role, userId, page, search, filters, sortBy, sortOrder, tabFilter }) => ({
  role,
  userId,
  page,
  limit: PAGE_SIZE,
  search,
  filters: {
    ...filters,
    ...tabFilter,
    sortBy,
    sortOrder,
  },
});

const routeFilterToTab = (filter) => {
  if (!filter) return null;
  const f = String(filter).toLowerCase();
  if (f === 'approval' || f.includes('design approval') || f === 'approvalpending') return TAB.APPROVAL;
  return TAB.WIP;
};

const buildClientNameMap = (clients) => {
  const map = new Map();
  (clients || []).forEach(c => {
    const id = c?.id || c?._id;
    const name = c?.name || c?.Name;
    if (!id || !name) return;
    const idStr = String(id).trim();
    map.set(idStr, name);
    const cleanId = idStr.replace(/^ObjectId\(/, '').replace(/\)$/, '').trim();
    if (cleanId !== idStr) map.set(cleanId, name);
  });
  return map;
};

const enrich = (rows, clientNameMap) =>
  (rows || []).map(e => {
    if (!e || typeof e !== 'object') return e;
    const idRaw = e.clientId || e.ClientId;
    const idStr = idRaw ? String(idRaw).trim() : '';
    let name = e.clientName || e.ClientName || e.client;
    if ((!name || name === 'Unknown Client') && idStr) {
      name = clientNameMap.get(idStr);
      if (!name) {
        const cleanId = idStr.replace(/^ObjectId\(/, '').replace(/\)$/, '').trim();
        name = clientNameMap.get(cleanId);
      }
    }
    return { ...e, clientId: idStr || e.clientId, clientName: name || 'Unknown Client' };
  });

const dedupeById = (rows) => {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const id = r?._id || r?.Id || r?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
};

export default function EnquiryListScreen({ navigation }) {
  const dispatch = useDispatch();
  const route = useRoute();
  const { user } = useAuth();
  const { isTablet } = useDeviceLayout() || {};

  const role = user?.role;
  const userId = user?.id || user?._id;
  const clientId = user?.clientId || user?.ClientId || userId;
  const roleKind = classifyRole(role);
  const isAdminCh = roleKind === ROLE_KIND.ADMIN_CH;
  const isDesigner = roleKind === ROLE_KIND.CORAL || roleKind === ROLE_KIND.CAD;
  const isClient = roleKind === ROLE_KIND.CLIENT;
  const isOrderPlacement = roleKind === ROLE_KIND.Order;

  const { clients = [] } = useClients({ skip: !user || isDesigner || isClient });
  const clientNameMap = useMemo(() => buildClientNameMap(clients), [clients]);

  useEffect(() => {
    if (isOrderPlacement) {
      dispatch(setActiveTab(TAB.Order_Placement));
      return;
    }
    if (isAssignedToOrderPlacement) {
      dispatch(setActiveTab(TAB.Order_Placement));
      return;
    }
    if (!isAdminCh) return;
    const tab = routeFilterToTab(route.params?.filter);
    if (tab) dispatch(setActiveTab(tab));
  }, [route.params?.filter, dispatch, isAdminCh, isOrderPlacement, isAssignedToOrderPlacement]);

  const activeTab = useSelector(s => s.enquiries.activeTab);
  const filters = useSelector(s => s.enquiries.filters);
  const searchQuery = useSelector(s => s.enquiries.searchQuery);
  const sortBy = useSelector(s => s.enquiries.sortBy);
  const sortOrder = useSelector(s => s.enquiries.sortOrder);

  const [page, setPage] = useState(1);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [quotationEnquiry, setQuotationEnquiry] = useState(null);
  const [finalLookEnquiry, setFinalLookEnquiry] = useState(null);
  const [finalLookActionLoading, setFinalLookActionLoading] = useState(false);
  const [shareEnquiry, setShareEnquiry] = useState(null);
  const [shareEnquiryId, setShareEnquiryId] = useState(null);
  const { data: shareFullEnquiry } = useGetEnquiryByIdQuery(shareEnquiryId, { skip: !shareEnquiryId });
  const [designerTab, setDesignerTab] = useState(DESIGNER_TAB.MINE);
  const [unassignedSubFilter, setUnassignedSubFilter] = useState('unassigned');
  const [showCreateModal, setShowCreateModal] = useState(false);
  // When CH/Admin lands here via "ClientHandlerEnquiries" route with a selected client,
  // scope every query to that client only.
  const isUnassignedOnly = route.params?.filter === 'unassigned';
  const selectedClient = route.params?.client;
  const selectedClientId = selectedClient?.id || selectedClient?._id || null;
  const selectedAssignedTo = route.params?.assignedTo;
  const selectedAssignedToId = selectedAssignedTo?.id || selectedAssignedTo?._id || null;
  const selectedAssignedToName = selectedAssignedTo?.name || selectedAssignedTo?.displayName || null;
  const selectedAssignedToRole = String(selectedAssignedTo?.role || '').toLowerCase();
  const isAssignedToOrderPlacement = selectedAssignedToRole === 'order_placement' || selectedAssignedToRole === 'op';

  console.log('[EnquiryListScreen] assignedTo:', JSON.stringify(selectedAssignedTo));
  console.log('[EnquiryListScreen] selectedAssignedToRole:', selectedAssignedToRole, 'isAssignedToOrderPlacement:', isAssignedToOrderPlacement);
  console.log('[EnquiryListScreen] isAdminCh:', isAdminCh, 'isOrderPlacement:', isOrderPlacement, 'roleKind:', roleKind);
  console.log('[EnquiryListScreen] activeTab:', activeTab);

  const scopedFilters = selectedClientId
    ? { ...filters, clientId: selectedClientId }
    : selectedAssignedToId
      ? { ...filters, assignedTo: selectedAssignedToId }
      : filters;

  const baseArgs = { role, userId, page, search: searchQuery, filters: scopedFilters, sortBy, sortOrder };

  // Client role: scoped to ONLY their own enquiries (ClientId match)
  const clientArg = buildArg({
    ...baseArgs,
    tabFilter: { clientId },
  });
  const clientQ = useGetEnquiriesQuery(clientArg, { skip: !isClient });

  // Admin / Client Handler: tabs with buckets
  const unassignedArg1 = buildArg({ ...baseArgs, tabFilter: { unassigned: true } });
  const unassignedArg2 = buildArg({ ...baseArgs, tabFilter: { subStatus: SUBSTATUS.AP } });
  const unassignedArg3 = buildArg({ ...baseArgs, tabFilter: { status: STATUS.ENQUIRY_CREATED } });
  const wipArg = buildArg({ ...baseArgs, tabFilter: { status: [STATUS.CORAL, STATUS.CAD, STATUS.ENQUIRY_CREATED] } });
  const approvalArg = buildArg({ ...baseArgs, tabFilter: { status: STATUS.DESIGN_APPROVAL_PENDING } });
  const orderPlacementBaseArgs = { role, userId, page, search: searchQuery, filters: selectedClientId ? { ...filters, clientId: selectedClientId } : filters, sortBy, sortOrder };
  const orderPlacementArg = buildArg({ ...orderPlacementBaseArgs, tabFilter: { status: STATUS.ORDER_PLACEMENT } });

  // All admin/CH tab queries always fire so each tab badge has a live count.
  const unassignedQ1 = useGetEnquiriesQuery(unassignedArg1, { skip: !isAdminCh || isClient });
  const unassignedQ2 = useGetEnquiriesQuery(unassignedArg2, { skip: !isAdminCh || isClient });
  const unassignedQ3 = useGetEnquiriesQuery(unassignedArg3, { skip: !isAdminCh || isClient });
  const wipQ = useGetEnquiriesQuery(wipArg, { skip: !isAdminCh || isClient });
  const approvalQ = useGetEnquiriesQuery(approvalArg, { skip: !isAdminCh || isClient });
  const orderPlacementQ = useGetEnquiriesQuery(orderPlacementArg, { skip: (!isAdminCh && !isOrderPlacement) || isClient });

  const bucketClientId = isAdminCh ? (selectedClientId || undefined) : undefined;
  const { data: buckets, refetch: refetchBuckets } = useGetEnquiryBucketsQuery(bucketClientId, { skip: !isAdminCh });

  const unassignedRowsAll = useMemo(() => {
    const merged = dedupeById([
      ...(unassignedQ1.data?.data || []),
      ...(unassignedQ2.data?.data || []),
      ...(unassignedQ3.data?.data || []),
    ]).filter(r => {
      const s = String(r.CurrentStatus || r.status || r.Status || '').toLowerCase();
      return s !== 'order placement';
    });
    return merged;
  }, [unassignedQ1.data, unassignedQ2.data, unassignedQ3.data]);

  const wipHasData = !!wipQ.data?.data;
  const wipFilteredCount = wipHasData
    ? wipQ.data.data.length
    : (buckets?.wip ?? 0);

  const approvalHasData = !!approvalQ.data;
  const approvalCount = approvalHasData
    ? (approvalQ.data?.pagination?.total ?? approvalQ.data?.data?.length ?? 0)
    : (buckets?.approvalPending ?? 0);

  const orderPlacementHasData = !!orderPlacementQ.data;
  const orderPlacementCount = orderPlacementHasData
    ? (orderPlacementQ.data?.pagination?.total ?? orderPlacementQ.data?.data?.length ?? 0)
    : (buckets?.orderPlacement ?? 0);

  // Designers: see enquiries in their department with relevant substatuses
  const designerStatus = roleKind === ROLE_KIND.CORAL ? STATUS.CORAL : STATUS.CAD;
  const designerSubstatuses = [SUBSTATUS.AS, SUBSTATUS.RR, SUBSTATUS.FU];
  const designerMineArg = buildArg({
    ...baseArgs,
    tabFilter: { status: [designerStatus], subStatus: designerSubstatuses, assignedTo: userId },
  });
  const designerWipArg = buildArg({
    ...baseArgs,
    tabFilter: { status: [designerStatus], subStatus: designerSubstatuses },
  });
  const designerMineQ = useGetEnquiriesQuery(designerMineArg, {
    skip: isAdminCh || isClient || !isDesigner,
  });
  const designerWipQ = useGetEnquiriesQuery(designerWipArg, {
    skip: isAdminCh || isClient || !isDesigner,
  });

  const activeQuery = useMemo(() => {
    if (isClient) {
      return {
        rows: enrich(clientQ.data?.data || [], clientNameMap),
        total: clientQ.data?.pagination?.total ?? (clientQ.data?.data?.length || 0),
        isLoading: clientQ.isLoading,
        isFetching: clientQ.isFetching,
        refetch: clientQ.refetch,
      };
    }
    if (isOrderPlacement) {
      const opRows = enrich(orderPlacementQ.data?.data || [], clientNameMap);
      return {
        rows: opRows,
        total: orderPlacementCount,
        isLoading: orderPlacementQ.isLoading,
        isFetching: orderPlacementQ.isFetching,
        refetch: orderPlacementQ.refetch,
      };
    }
    if (!isAdminCh) {
      const q = designerTab === DESIGNER_TAB.WIP ? designerWipQ : designerMineQ;
      return {
        rows: enrich(q.data?.data || [], clientNameMap),
        total: q.data?.pagination?.total ?? (q.data?.data?.length || 0),
        isLoading: q.isLoading,
        isFetching: q.isFetching,
        refetch: q.refetch,
      };
    }
    if (isUnassignedOnly) {
      let rows;
      if (unassignedSubFilter === 'order_placed') {
        rows = enrich(orderPlacementQ.data?.data || [], clientNameMap);
      } else {
        rows = enrich(unassignedRowsAll, clientNameMap);
      }
      return {
        rows,
        total: rows.length,
        isLoading: unassignedQ1.isLoading || unassignedQ2.isLoading || unassignedQ3.isLoading || orderPlacementQ.isLoading,
        isFetching: unassignedQ1.isFetching || unassignedQ2.isFetching || unassignedQ3.isFetching || orderPlacementQ.isFetching,
        refetch: () => {
          unassignedQ1.refetch(); unassignedQ2.refetch(); unassignedQ3.refetch(); orderPlacementQ.refetch();
        },
      };
    }
    if (activeTab === TAB.WIP) {
      const wipRows = enrich(wipQ.data?.data || [], clientNameMap);
      return {
        rows: wipRows,
        total: wipRows.length,
        isLoading: wipQ.isLoading,
        isFetching: wipQ.isFetching,
        refetch: wipQ.refetch,
      };
    }
    if (activeTab === TAB.Order_Placement) {
      const opRows = enrich(orderPlacementQ.data?.data || [], clientNameMap);
      return {
        rows: opRows,
        total: orderPlacementCount,
        isLoading: orderPlacementQ.isLoading,
        isFetching: orderPlacementQ.isFetching,
        refetch: orderPlacementQ.refetch,
      };
    }
    return {
      rows: enrich(approvalQ.data?.data || [], clientNameMap),
      total: approvalCount,
      isLoading: approvalQ.isLoading,
      isFetching: approvalQ.isFetching,
      refetch: approvalQ.refetch,
    };
  }, [isAdminCh, isClient, isOrderPlacement, activeTab, isUnassignedOnly, unassignedSubFilter, unassignedQ1, unassignedQ2, wipQ, approvalQ, orderPlacementQ, designerMineQ, designerWipQ, designerTab, clientQ, clientNameMap]);

  // Client-side priority sorting (backend sorts alphabetically, not by priority level)
  const PRIORITY_ORDER = { 'super high': 0, 'high': 1, 'urgent': 1, 'medium': 2, 'normal': 3, 'low': 4, 'super urgent': 0 };
  const sortedRows = useMemo(() => {
    if (sortBy !== 'Priority') return activeQuery.rows;
    const rows = [...(activeQuery.rows || [])];
    rows.sort((a, b) => {
      const aRaw = a?._originalData || a;
      const bRaw = b?._originalData || b;
      const aP = (aRaw?.Priority || a?.Priority || a?.priority || '').toLowerCase().trim();
      const bP = (bRaw?.Priority || b?.Priority || b?.priority || '').toLowerCase().trim();
      const aIdx = PRIORITY_ORDER[aP] ?? 5;
      const bIdx = PRIORITY_ORDER[bP] ?? 5;
      return sortOrder === 'asc' ? aIdx - bIdx : bIdx - aIdx;
    });
    return rows;
  }, [activeQuery.rows, sortBy, sortOrder]);

  useEffect(() => {
    if (__DEV__ && activeQuery.rows.length > 0) {
      console.log('[EnquiryListScreen] enquiryData =', JSON.stringify(activeQuery.rows, null, 2));
    }
  }, [activeQuery.rows]);

  // Per-tab counts for designer view (so inactive tab also shows a badge)
  const designerMineCount = designerMineQ.data?.pagination?.total ?? (designerMineQ.data?.data?.length || 0);
  const designerWipCount  = designerWipQ.data?.pagination?.total  ?? (designerWipQ.data?.data?.length  || 0);

  useFocusEffect(useCallback(() => {
    if (isAdminCh) refetchBuckets();
    activeQuery.refetch();
    if (isDesigner) {
      designerMineQ.refetch();
      designerWipQ.refetch();
    }
  }, [activeTab, isAdminCh, isDesigner]));

  const [updateEnquiry] = useUpdateEnquiryMutation();
  const [deleteEnquiry] = useDeleteEnquiryMutation();
  const [updateAssetData] = useUpdateAssetDataMutation();
  const { generateAndShareExcel } = useEnquiryActions({});

  const refreshAll = useCallback(() => {
    if (isAdminCh) refetchBuckets();
    activeQuery.refetch();
    if (isDesigner) {
      designerMineQ.refetch();
      designerWipQ.refetch();
    }
  }, [isAdminCh, isDesigner, refetchBuckets, activeQuery, designerMineQ, designerWipQ]);

  const onUpdateEnquiry = useCallback(async (payload) => {
    try {
      const res = await updateEnquiry(payload).unwrap();
      refreshAll();
      return res;
    } catch (e) {
      return null;
    }
  }, [updateEnquiry, refreshAll]);

  const onDeleteEnquiry = useCallback(async (id) => {
    try {
      await deleteEnquiry(id).unwrap();
      refreshAll();
    } catch (e) {}
  }, [deleteEnquiry, refreshAll]);

  const handleTabChange = useCallback((tabKey) => {
    setPage(1);
    dispatch(setActiveTab(tabKey));
  }, [dispatch]);

  const handleSearchChange = useCallback((txt) => {
    setPage(1);
    dispatch(setSearchQuery(txt));
  }, [dispatch]);

  const handleApplyFilters = useCallback((next) => {
    setPage(1);
    dispatch(setFilters(next));
    setFilterModalVisible(false);
  }, [dispatch]);

  const handleClear = useCallback(() => {
    setPage(1);
    dispatch(clearFilters());
  }, [dispatch]);

  const [showSortModal, setShowSortModal] = useState(false);

  const sortOptions = [
    { key: 'CreatedDate', label: 'Date Created', icon: 'event' },
    { key: 'ShippingDate', label: 'Shipping Date', icon: 'local-shipping' },
    { key: 'Priority', label: 'Priority', icon: 'priority-high' },
    { key: 'CurrentStatus', label: 'Status', icon: 'flag' },
    { key: 'Category', label: 'Category', icon: 'category' },
  ];

  const currentSortLabel = useMemo(
    () => sortOptions.find(o => o.key === sortBy)?.label || 'Sort',
    [sortBy]
  );

  const handleSortChange = (newSortBy) => {
    if (newSortBy === sortBy) {
      const newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      dispatch(setSorting({ sortBy, sortOrder: newOrder }));
    } else {
      const dateFields = ['CreatedDate', 'ShippingDate'];
      const defaultOrder = dateFields.includes(newSortBy) ? 'desc' : 'asc';
      dispatch(setSorting({ sortBy: newSortBy, sortOrder: defaultOrder }));
    }
    setShowSortModal(false);
  };

  const adminTabCount = (key) => {
    if (key === TAB.WIP) return wipFilteredCount;
    if (key === TAB.APPROVAL) return approvalCount;
    if (key === TAB.Order_Placement) return orderPlacementCount;
    return 0;
  };

  const renderAdminTab = ({ item }) => {
    const isActive = activeTab === item.key;
    const count = adminTabCount(item.key);
    return (
      <TouchableOpacity
        style={[styles.tab, isActive && styles.tabActive]}
        onPress={() => handleTabChange(item.key)}
        activeOpacity={0.8}
      >
        <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{item.label}</Text>
        <View style={[styles.countWrap, isActive && styles.countWrapActive]}>
          <Text style={[styles.countText, isActive && styles.countTextActive]}>{count}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const designerRoleLabel = roleKind === ROLE_KIND.CORAL ? 'Coral' : 'Cad';
  const designerTabs = useMemo(() => [
    { key: DESIGNER_TAB.MINE, label: `My ${designerRoleLabel}` },
    { key: DESIGNER_TAB.WIP,  label: `All ${designerRoleLabel} (WIP)` },
  ], [designerRoleLabel]);

  const renderItem = ({ item }) => {
    const id = item?._id || item?.Id || item?.id || item?._originalData?._id;
    return (
      <NewCard
        item={item}
        navigation={navigation}
        currentTab={isAdminCh ? activeTab : 'designer'}
        onViewQuotation={() => {
          if (__DEV__) console.log('[List] View Quotation click; id=', id, 'item keys=', Object.keys(item || {}));
          setQuotationEnquiry({ ...item, _resolvedId: id });
        }}
        onFinalLook={() => setFinalLookEnquiry(item)}
        onPress={() => navigation.navigate('SingleEnquiry', {
          enquiryId: id,
          enquiry: item,
        })}
        onUpdateEnquiry={onUpdateEnquiry}
        onDeleteEnquiry={onDeleteEnquiry}
        onShare={(enq) => {
          const id = enq?._id || enq?.Id || enq?.id;
          setShareEnquiryId(id);
          setShareEnquiry(enq);
        }}
      />
    );
  };

  const renderEmpty = () => (
    <View style={styles.empty}>
      <Icon name="inbox" size={48} color={colors.textSecondary} />
      <Text style={styles.emptyText}>
        {isAdminCh ? 'No enquiries in this tab' : 'No enquiries assigned to you'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopNavbar title="Enquiries" navigation={navigation} />

      {isUnassignedOnly ? (
        <View style={styles.clientHeaderBar}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="arrow-back" size={22} color={colors.textWhite} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.clientHeaderLabel}>Unassigned Enquiries & Orders Placed</Text>
            <Text style={styles.clientHeaderName}>All clients</Text>
          </View>
        </View>
      ) : selectedClient ? (
        <View style={styles.clientHeaderBar}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="arrow-back" size={22} color={colors.textWhite} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.clientHeaderLabel}>Showing enquiries for</Text>
            <Text style={styles.clientHeaderName} numberOfLines={1}>
              {selectedClient.name || 'Selected Client'}
            </Text>
          </View>
            <TouchableOpacity onPress={()=>navigation.navigate('PricingCalci', { clientId: selectedClientId, clientName: selectedClient?.name })} style={{backgroundColor:colors.background,borderRadius:10,padding:8, flexDirection:'row', alignItems:'center', gap:4}}>
            <Icon name="calculate" size={16} color={colors.primary} />
            <Text style={{fontSize:14,fontWeight:"400",color:colors.primary}}>Calcuate</Text>
          </TouchableOpacity>
          {isAdminCh && (
            <TouchableOpacity
              style={styles.clientHeaderAddBtn}
              onPress={() => setShowCreateModal(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="add" size={22} color={colors.textWhite} />
            </TouchableOpacity>
          )}

        
        </View>
      ) : selectedAssignedTo ? (
        <View style={styles.clientHeaderBar}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="arrow-back" size={22} color={colors.textWhite} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.clientHeaderLabel}>Showing enquiries for</Text>
            <Text style={styles.clientHeaderName} numberOfLines={1}>
              {selectedAssignedToName || 'Selected Assignee'}
            </Text>
          </View>
        </View>
      ) : null}

      {!isUnassignedOnly && (
        <View style={styles.tabsBar}>
          {isClient ? (
            <View style={[styles.tabsContent, { flexDirection: 'row' }]}>
              <View style={[styles.tab, styles.tabActive]}>
                <Text style={[styles.tabText, styles.tabTextActive]}>My Enquiries</Text>
                <View style={[styles.countWrap, styles.countWrapActive]}>
                  <Text style={[styles.countText, styles.countTextActive]}>{activeQuery.total}</Text>
                </View>
              </View>
            </View>
          ) : isAdminCh && isAssignedToOrderPlacement ? (
            <View style={[styles.tabsContent, { flexDirection: 'row' }]}>
              <View style={[styles.tab, styles.tabActive]}>
                <Text style={[styles.tabText, styles.tabTextActive]}>Order Placement</Text>
                <View style={[styles.countWrap, styles.countWrapActive]}>
                  <Text style={[styles.countText, styles.countTextActive]}>{orderPlacementCount}</Text>
                </View>
              </View>
            </View>
          ) : isAdminCh ? (
            <FlatList
              data={ADMIN_TABS}
              renderItem={renderAdminTab}
              keyExtractor={t => t.key}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabsContent}
            />
          ) : isOrderPlacement ? (
            <View style={[styles.tabsContent, { flexDirection: 'row' }]}>
              <View style={[styles.tab, styles.tabActive]}>
                <Text style={[styles.tabText, styles.tabTextActive]}>Order Placement</Text>
                <View style={[styles.countWrap, styles.countWrapActive]}>
                  <Text style={[styles.countText, styles.countTextActive]}>{orderPlacementCount}</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={[styles.tabsContent, { flexDirection: 'row' }]}>
              {designerTabs.map(t => {
                const isActive = designerTab === t.key;
                const count = t.key === DESIGNER_TAB.WIP ? designerWipCount : designerMineCount;
                return (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.tab, isActive && styles.tabActive]}
                    onPress={() => { setPage(1); setDesignerTab(t.key); }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{t.label}</Text>
                    <View style={[styles.countWrap, isActive && styles.countWrapActive]}>
                      <Text style={[styles.countText, isActive && styles.countTextActive]}>{count}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      )}

      <View style={[styles.header, isTablet && styles.headerTablet]}>
        <View style={styles.searchRow}>
          <View style={styles.searchContainer}>
            <SearchInput
              placeholder="Search enquiries..."
              value={searchQuery}
              onChangeText={handleSearchChange}
              onClear={() => handleSearchChange('')}
            />
          </View>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setShowSortModal(true)}>
            <Icon name="sort" size={20} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setFilterModalVisible(true)}>
            <Icon name="tune" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {isUnassignedOnly && (
        <View style={styles.unassignedFilterBar}>
          <TouchableOpacity
            style={[styles.unassignedFilterTab, unassignedSubFilter === 'unassigned' && styles.unassignedFilterTabActive]}
            onPress={() => setUnassignedSubFilter('unassigned')}
            activeOpacity={0.8}
          >
            <Text style={[styles.unassignedFilterTabText, unassignedSubFilter === 'unassigned' && styles.unassignedFilterTabTextActive]}>
              Unassigned
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.unassignedFilterTab, unassignedSubFilter === 'order_placed' && styles.unassignedFilterTabActive]}
            onPress={() => setUnassignedSubFilter('order_placed')}
            activeOpacity={0.8}
          >
            <Text style={[styles.unassignedFilterTabText, unassignedSubFilter === 'order_placed' && styles.unassignedFilterTabTextActive]}>
              Order Placed
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.infoBar}>
        <Icon name="sort" size={12} color={colors.textSecondary} />
        <Text style={styles.infoBarText}>{currentSortLabel}</Text>
        <Text style={styles.infoBarDot}>·</Text>
        <Text style={styles.infoBarText}>{activeQuery.total} result{activeQuery.total !== 1 ? 's' : ''}</Text>
        {(activeQuery.isFetching && !activeQuery.isLoading) && (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 6 }} />
        )}
      </View>

      {activeQuery.isLoading ? (
        <View style={styles.loader}><AnimatedLogoLoader /></View>
      ) : (
        <FlatList
          data={sortedRows}
          renderItem={renderItem}
          keyExtractor={(item, idx) => item?._id || item?.Id || String(idx)}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl
              refreshing={activeQuery.isFetching}
              onRefresh={refreshAll}
              tintColor={colors.primary}
            />
          }
        />
      )}

      <Modal visible={showSortModal} transparent animationType="slide" onRequestClose={() => setShowSortModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowSortModal(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.sortModalContent}>
            <View style={styles.sortModalHeader}>
              <Text style={styles.sortModalTitle}>Sort by</Text>
              <TouchableOpacity style={styles.sortModalClose} onPress={() => setShowSortModal(false)}>
                <Icon name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.sortOptionsList}>
              {sortOptions.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.sortOption, sortBy === option.key && styles.sortOptionActive]}
                  onPress={() => handleSortChange(option.key)}
                >
                  <View style={styles.sortOptionContent}>
                    <Icon name={option.icon} size={20} color={sortBy === option.key ? colors.primary : colors.textSecondary} />
                    <Text style={[styles.sortOptionText, sortBy === option.key && styles.sortOptionTextActive]}>
                      {option.label}
                    </Text>
                  </View>
                  {sortBy === option.key && (
                    <View style={styles.sortOrderIndicator}>
                      <Icon name={sortOrder === 'asc' ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={20} color={colors.primary} />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <EnquiryFiltersModal
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        filters={filters}
        onApplyFilters={handleApplyFilters}
        onClearFilters={handleClear}
        user={user}
      />

      {quotationEnquiry && (
        <QuotationModal
          visible={!!quotationEnquiry}
          enquiryId={
            quotationEnquiry._resolvedId
              || quotationEnquiry._id
              || quotationEnquiry.Id
              || quotationEnquiry.id
              || quotationEnquiry._originalData?._id
          }
          onClose={() => {
            setQuotationEnquiry(null);
            refreshAll();
          }}
        />
      )}

      {finalLookEnquiry && (() => {
        const flRaw = finalLookEnquiry?._originalData || finalLookEnquiry || {};
        const flSrc = finalLookEnquiry || {};
        const currentStatus = (flRaw.CurrentStatus || flSrc.CurrentStatus || '').toLowerCase();
        const targetType = currentStatus === 'coral' ? 'coral' : 'cad';
        const isPlacementMode = currentStatus === 'order placement';
        const rawObj = targetType === 'cad'
          ? (flRaw.lastCad || flSrc.lastCad)
          : (flRaw.lastCoral || flSrc.lastCoral);
        const numericVersion = parseInt(rawObj?.Version || rawObj?.version || '1', 10);
        return (
          <FinalLookModal
            visible={!!finalLookEnquiry}
            enquiryId={finalLookEnquiry?._id || finalLookEnquiry?.id || finalLookEnquiry?.Id}
            clientName={finalLookEnquiry?.clientName || finalLookEnquiry?.ClientName || ''}
            onClose={() => setFinalLookEnquiry(null)}
            showApprovalActions={!isPlacementMode}
            shareExcelMode={isPlacementMode}
            isActionLoading={finalLookActionLoading}
            headerTitle={isPlacementMode ? 'Order Placement' : undefined}
            onShareExcel={isPlacementMode ? async () => {
              try {
                const result = await generateAndShareExcel(finalLookEnquiry);
                if (!result?.success) {
                  // silently ignore - user can share from card
                }
              } catch (e) {}
              setFinalLookEnquiry(null);
            } : undefined}
            onSendForApproval={!isPlacementMode ? async () => {
              const eid = finalLookEnquiry?._id || finalLookEnquiry?.id || finalLookEnquiry?.Id;
              setFinalLookActionLoading(true);
              try {
                await updateAssetData({
                  enquiryId: eid,
                  type: targetType,
                  version: String(numericVersion),
                  data: { SendForApproval: true },
                }).unwrap();
                setFinalLookEnquiry(null);
                refreshAll();
              } catch (e) {}
              finally { setFinalLookActionLoading(false); }
            } : undefined}
            onReject={!isPlacementMode ? async (reason) => {
              const eid = finalLookEnquiry?._id || finalLookEnquiry?.id || finalLookEnquiry?.Id;
              setFinalLookActionLoading(true);
              try {
                await updateAssetData({
                  enquiryId: eid,
                  type: targetType,
                  version: String(numericVersion),
                  data: { IsApprovedVersion: false, ReasonForRejection: reason },
                }).unwrap();
                setFinalLookEnquiry(null);
                refreshAll();
              } catch (e) {}
              finally { setFinalLookActionLoading(false); }
            } : undefined}
          />
        );
      })()}

      {shareEnquiry && (
        <ShareEnquiryModal
          visible={!!shareEnquiry}
          enquiry={(() => {
            const base = shareFullEnquiry || shareEnquiry;
            const idRaw = base?.clientId || base?.ClientId;
            const idStr = idRaw ? String(idRaw).trim() : '';
            let name = base?.clientName || base?.ClientName || base?.client;
            if ((!name || name === 'Unknown Client') && idStr) {
              name = clientNameMap.get(idStr);
              if (!name) {
                const cleanId = idStr.replace(/^ObjectId\(/, '').replace(/\)$/, '').trim();
                name = clientNameMap.get(cleanId);
              }
            }
            return { ...base, clientName: name || 'Unknown Client' };
          })()}
          onClose={() => { setShareEnquiry(null); setShareEnquiryId(null); }}
          isDesigner={isDesigner}
        />
      )}

      <CreateEnquiryModal
        visible={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          refreshAll();
        }}
        onUpdate={(id) => navigation.navigate('SingleEnquiry', { enquiryId: id })}
        route={{
          ...route,
          params: {
            ...(route?.params || {}),
            clientId: selectedClientId || route?.params?.clientId,
            clientName: selectedClient?.name || route?.params?.clientName,
          },
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabsBar: { backgroundColor: colors.primary },
  tabsContent: { paddingHorizontal: 16 },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    marginTop: 5,
  },
  tabText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textWhite,
  },
  tabTextActive: {
    color: colors.primary,
    fontFamily: fonts.bold,
  },
  countWrap: {
    backgroundColor: colors.background,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  countWrapActive: { backgroundColor: colors.primary },
  countText: {
    color: colors.primary,
    fontSize: fonts.xs,
    fontFamily: fonts.medium,
  },
  countTextActive: {
    color: colors.textWhite,
    fontFamily: fonts.bold,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.background,
    shadowColor: colors.cardShadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  headerTablet: { paddingHorizontal: 32, paddingVertical: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchContainer: { flex: 1, minWidth: 0 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  listContent: { paddingVertical: 8, paddingBottom: 80 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  emptyText: {
    marginTop: 12,
    fontSize: fonts.md,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  clientHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.primaryDark || colors.primary,
  },
  clientHeaderLabel: {
    fontSize: 11,
    fontFamily: fonts.medium,
    color: colors.textWhite,
    opacity: 0.75,
  },
  clientHeaderName: {
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textWhite,
  },
  clientHeaderAddBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sortModalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
    width: '100%',
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  sortModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sortModalTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  sortModalClose: { padding: 4 },
  sortOptionsList: { padding: 8 },
  sortOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    marginVertical: 2,
  },
  sortOptionActive: { backgroundColor: colors.backgroundSecondary },
  sortOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sortOptionText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    marginLeft: 12,
  },
  sortOptionTextActive: {
    color: colors.primary,
    fontFamily: fonts.bold,
  },
  sortOrderIndicator: { marginLeft: 8 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 6,
  },
  infoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: colors.backgroundSecondary,
  },
  unassignedFilterBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
  },
  unassignedFilterTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unassignedFilterTabActive: {
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  unassignedFilterTabText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
  unassignedFilterTabTextActive: {
    color: colors.textWhite,
    fontFamily: fonts.bold,
  },
  infoBarText: {
    fontSize: 11,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
  infoBarDot: {
    fontSize: 11,
    color: colors.textSecondary,
    marginHorizontal: 2,
  },

  modalBox2: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    width: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
});
