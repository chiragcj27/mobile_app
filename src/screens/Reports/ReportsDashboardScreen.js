import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';
import ReorderableList from '../../components/common/ReorderableList';
import Share from 'react-native-share';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { formatDateTime, formatDate, objectIdToDate } from '../../utils';
import Icon from '../../components/common/Icon';
import { useGetEnquiriesQuery, useReorderEnquiryMutation } from '../../store/api';
import { useClients } from '../../features/clients/clientsHooks';
import { FILE_BASE_URL } from '../../config/apiConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LOGO_BASE64 } from '../../constants/logo';

let generatePDFModule = null;
try {
  const mod = require('react-native-html-to-pdf');
  generatePDFModule = mod.generatePDF || mod.default?.generatePDF || mod.default;
} catch (e) {}

const PRIORITY_ORDER = ['normal', 'high', 'super high'];

const toDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getRelativeTime = (dateString) => {
  if (!dateString) return '-';
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays} days ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
};

const getPriorityStyle = (priority) => {
  const p = (priority || '').toLowerCase();
  if (p === 'high' || p === 'super high' || p === 'urgent') return styles.badgeHigh;
  if (p === 'medium' || p === 'normal') return styles.badgeMedium;
  return styles.badgeLow;
};

const getPriorityTextStyle = (priority) => {
  const p = (priority || '').toLowerCase();
  if (p === 'high' || p === 'super high' || p === 'urgent') return { color: '#EF4444' };
  if (p === 'medium' || p === 'normal') return { color: '#F59E0B' };
  return { color: '#6B7280' };
};

const getDesignerName = (enquiry) => {
  const assigned =
    enquiry?.assignedUserName ||
    enquiry?.assignedToName ||
    enquiry?.AssignedToName ||
    '';
  if (assigned) return assigned;
  return '-';
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

const ReportsDashboardScreen = ({ route }) => {
  const navigation = useNavigation();
  const assignedTo = route.params?.assignedTo;
  console.log('[ReportsDashboard] assignedTo:', JSON.stringify(assignedTo));

  // Filter state — all of these are sent to the backend query (no client-side filtering).
  const [showFilter, setShowFilter] = useState(false);
  const [filterPriority, setFilterPriority] = useState(null);
  const [filterClient, setFilterClient] = useState('');       // display name
  const [filterClientId, setFilterClientId] = useState('');   // id sent to backend
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [clientSearchText, setClientSearchText] = useState('');
  const [clientListExpanded, setClientListExpanded] = useState(false);

  // Reports use lowercase chips; the backend expects capitalised priority values.
  const PRIORITY_API = { 'normal': 'Normal', 'high': 'High', 'super high': 'Super High' };

  const statusFilter = useMemo(() => {
    const role = (assignedTo?.role || '').toLowerCase();
    if (role === 'coral' || role === 'co') return ['Coral', 'Design Approval Pending'];
    if (role === 'cad' || role === 'cd') return ['Cad', 'Design Approval Pending'];
    if (role === 'order_placement' || role === 'op') return 'Order Placement';
    return null;
  }, [assignedTo]);

  const queryArg = useMemo(() => {
    if (!statusFilter || !assignedTo?.id) return null;
    const isOrderPlacement = statusFilter === 'Order Placement';
    const filters = isOrderPlacement
      ? { status: statusFilter }
      : { status: statusFilter, assignedTo: assignedTo.id };
    // All UI filters go to the backend query — no client-side filtering.
    if (filterPriority) filters.priority = PRIORITY_API[filterPriority] || filterPriority;
    if (filterClientId) filters.clientId = filterClientId;
    if (filterStartDate) filters.createdDateFrom = filterStartDate;
    if (filterEndDate) filters.createdDateTo = filterEndDate;
    // Sort by priority + saved drag order (OrderKey) so reordering here shows.
    filters.sortBy = 'priority';
    filters.sortOrder = 'asc';
    return { role: assignedTo.role, filters, limit: 50 };
  }, [statusFilter, assignedTo, filterPriority, filterClientId, filterStartDate, filterEndDate]);
  console.log('[ReportsDashboard] queryArg:', JSON.stringify(queryArg));

  const { clients = [] } = useClients({ skip: !queryArg });
  const clientNameMap = useMemo(() => buildClientNameMap(clients), [clients]);

  const { data: apiData, isLoading: apiLoading, refetch } = useGetEnquiriesQuery(queryArg, {
    skip: !queryArg,
  });

  useFocusEffect(useCallback(() => {
    if (queryArg) refetch();
  }, [queryArg, refetch]));

  const enquiries = useMemo(() => {
    if (apiData) {
      const data = apiData?.data || apiData || [];
      const enriched = enrich(data, clientNameMap);
      console.log('[ReportsDashboard] enquiries data enriched:', JSON.stringify(enriched));
      return enriched;
    }
    return [];
  }, [apiData, clientNameMap]);

  const [imageSources, setImageSources] = useState({});
  const [sharingPdf, setSharingPdf] = useState(false);

  useEffect(() => {
    const loadImages = async () => {
      const token = await AsyncStorage.getItem('token');
      const sources = {};
      for (const e of enquiries) {
        const id = e?._id || e?.Id || e?.id;
        const refs = e?.ReferenceImages || e?.referenceImages || [];
        const firstRef = refs[0];
        let imageKey = null;
        if (firstRef) {
          imageKey = firstRef.Key || firstRef.key || firstRef.Url || firstRef.url || null;
          if (typeof firstRef === 'string') imageKey = firstRef;
        }
        if (!id || !imageKey) {
          console.log('[ReportsDashboard] no image key for enquiry', id, 'refs:', JSON.stringify(e?.ReferenceImages));
          continue;
        }
        const url = `${FILE_BASE_URL}/api/enquiries/files/${encodeURIComponent(String(imageKey))}`;
        console.log('[ReportsDashboard] fetching image for', id, ':', url);
        try {
          const res = await fetch(url, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) { console.log('[ReportsDashboard] image fetch failed', id, res.status); continue; }
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.json();
            const uri = j.url || j.imageUrl || null;
            if (uri) sources[id] = { uri };
          } else {
            const buf = await res.arrayBuffer();
            const b64 = btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ''));
            sources[id] = { uri: `data:${ct};base64,${b64}` };
          }
        } catch (err) {
          console.log('[ReportsDashboard] image fetch error for', id, err);
        }
      }
      console.log('[ReportsDashboard] imageSources loaded:', Object.keys(sources).length);
      setImageSources(sources);
    };
    if (enquiries.length > 0) loadImages();
  }, [enquiries]);

  // The list is exactly what the backend returned for the current filters — no client-side filtering.
  const filteredEnquiries = useMemo(() => {
    const rank = (p) => {
      const s = String(p || '').toLowerCase().trim();
      if (s === 'super high') return 0;
      if (s === 'high') return 1;
      return 2;
    };
    const orderKeyOf = (x) => {
      const k = x?.OrderKey;
      return (k === null || k === undefined) ? Number.MAX_SAFE_INTEGER : Number(k);
    };
    return [...enquiries].sort((a, b) => {
      const ra = rank(a?.Priority || a?.priority);
      const rb = rank(b?.Priority || b?.priority);
      if (ra !== rb) return ra - rb;
      return orderKeyOf(a) - orderKeyOf(b);
    });
  }, [enquiries]);

  const [reorderEnquiry] = useReorderEnquiryMutation();
  const idOf = (it) => it?._id || it?.Id || it?.id;
  const handleReorder = useCallback(async ({ data, toIndex, changed }) => {
    if (!changed || toIndex == null) return;
    const draggedId = idOf(data[toIndex]);
    if (!draggedId) return;
    const previousId = toIndex > 0 ? idOf(data[toIndex - 1]) : null;
    const nextId = toIndex < data.length - 1 ? idOf(data[toIndex + 1]) : null;
    try {
      await reorderEnquiry({ draggedId, previousId, nextId }).unwrap();
      setTimeout(() => { refetch(); }, 900);
    } catch (e) {
      refetch();
    }
  }, [reorderEnquiry, refetch]);

  const clearFilters = useCallback(() => {
    setFilterPriority(null);
    setFilterClient('');
    setFilterClientId('');
    setFilterStartDate('');
    setFilterEndDate('');
    setClientSearchText('');
    setClientListExpanded(false);
  }, []);

  const handleSharePDF = useCallback(async () => {
    if (sharingPdf) return;
    setSharingPdf(true);
    const token = await AsyncStorage.getItem('token');

    const rowsWithImages = await Promise.all(filteredEnquiries.map(async (e, i) => {
      const clientName = e?.clientName || e?.ClientName || e?.client || '-';
      const designName = e?.Name || e?.title || '-';
      const designer = getDesignerName(e);
      const eid = e?._id || e?.Id || e?.id;
      const startDate = objectIdToDate(eid) || e?.CreatedDate || e?.createdAt || e?.CreatedAt || '';
      const formattedDate = startDate ? formatDateTime(startDate) : '-';
      const priority = e?.Priority || e?.priority || 'Normal';
      const priorityLower = (priority || '').toLowerCase().trim();
      const pColorMap = {
        'super high': { bg: '#FEE2E2', text: '#DC2626', border: '#FCA5A5' },
        'high': { bg: '#FEE2E2', text: '#DC2626', border: '#FCA5A5' },
        'normal': { bg: '#D1FAE5', text: '#059669', border: '#6EE7B7' },
      };
      const pColor = pColorMap[priorityLower] || { bg: '#e8f0ef', text: '#1a3c3c', border: '#b0ccc8' };

      let imgHtml = '';
      const id = e?._id || e?.Id || e?.id;
      const refs = e?.ReferenceImages || e?.referenceImages || [];
      const firstRef = refs[0];
      let imageKey = null;
      if (firstRef) {
        imageKey = firstRef.Key || firstRef.key || firstRef.Url || firstRef.url || null;
        if (typeof firstRef === 'string') imageKey = firstRef;
      }
      if (id && imageKey && token) {
        try {
          const fetchUrl = `${FILE_BASE_URL}/api/enquiries/files/${encodeURIComponent(String(imageKey))}`;
          const res = await fetch(fetchUrl, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              const j = await res.json();
              const uri = j.url || j.imageUrl || null;
              if (uri) imgHtml = `<img src="${uri}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;" />`;
            } else {
              const buf = await res.arrayBuffer();
              const b64 = btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ''));
              imgHtml = `<img src="data:${ct};base64,${b64}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;" />`;
            }
          }
        } catch {}
      }
      if (!imgHtml) imgHtml = '<span style="color:#9CA3AF;font-size:10px;">-</span>';

      return `<tr>
        <td style="padding:6px 4px;font-size:11px;border:0.5px solid #e5e7eb;text-align:center;">${i + 1}</td>
        <td style="padding:6px 4px;font-size:11px;border:0.5px solid #e5e7eb;text-align:center;">${imgHtml}</td>
        <td style="padding:6px 4px;font-size:11px;border:0.5px solid #e5e7eb;text-align:left;">${clientName}</td>
        <td style="padding:6px 4px;font-size:11px;border:0.5px solid #e5e7eb;text-align:left;">${designName}</td>
        <td style="padding:6px 4px;font-size:11px;border:0.5px solid #e5e7eb;text-align:left;">${designer}</td>
        <td style="padding:6px 4px;font-size:11px;border:0.5px solid #e5e7eb;text-align:center;">${formattedDate}</td>
        <td style="padding:6px 4px;font-size:11px;border:0.5px solid #e5e7eb;text-align:center;"><span style="background:${pColor.bg};color:${pColor.text};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;border:1px solid ${pColor.border};">${priority}</span></td>
      </tr>`;
    }));

    const rowsHtml = rowsWithImages.join('');

    const logoSrc = `data:image/png;base64,${LOGO_BASE64}`;
    const currentDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const reportName = `${assignedTo?.name || ''} Report`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=0.6, maximum-scale=5.0, user-scalable=yes">
  <title>${reportName}</title>
  <style>
    @page { margin: 0; padding: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; background-color: #f4f6f4; color: #1A1A1A; padding: 20px; }
    .header-container { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 20px; }
    .header-logo { height: 44px; width: auto; }
    .header-title { font-size: 24px; color: #D4AF37; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 2px; }
    .header-subtitle { font-size: 10px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.2em; }
    .divider { height: 1px; width: 100%; background-color: #D4AF37; opacity: 0.4; margin: 6px 0; }
    .report-card { border-radius: 14px; border: 1px solid #d0ddd0; overflow: hidden; background: #fff; }
    .card-top-bar { height: 4px; background: linear-gradient(90deg, #1a3c3c, #D4AF37); }
    .report-body { padding: 16px; }
    .report-title { font-size: 17px; font-weight: bold; color: #1a3c3c; margin-bottom: 4px; }
    .report-date { font-size: 10px; color: #9CA3AF; margin-bottom: 12px; }
    .summary-text { font-size: 12px; color: #6B7280; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #1a3c3c; color: white; padding: 8px 4px; font-size: 10px; text-align: center; }
    td { padding: 6px 4px; font-size: 11px; border: 0.5px solid #e5e7eb; }
    tr:nth-child(even) { background: #f9f9f9; }
    .pdf-img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; }
    .report-footer { background: #1a3c3c; padding: 10px 16px; text-align: center; font-size: 9px; color: rgba(255,255,255,0.6); letter-spacing: 0.5px; margin-top: 16px; }
    .footer-gold { color: #D4AF37; font-weight: bold; }
  </style>
</head>
<body>
  <div class="header-container">
    <img src="${logoSrc}" class="header-logo" />
    <div>
      <h2 class="header-title">CHANDRA JEWELS</h2>
      <div class="divider"></div>
      <p class="header-subtitle">Department Report &mdash; ${currentDate}</p>
    </div>
  </div>

  <div class="report-card">
    <div class="card-top-bar"></div>
    <div class="report-body">
      <div class="report-title">${reportName}</div>
      <div class="report-date">Generated on ${currentDate}</div>
      <div class="summary-text">Total Enquiries: ${filteredEnquiries.length}</div>

      <table>
        <thead><tr>
          <th>Sr.No</th><th>Image</th><th>Client Name</th><th>Design Name</th><th>Designer</th><th>Start Date</th><th>Priority</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="report-footer"><span class="footer-gold">CHANDRA JEWELS</span> &nbsp;&mdash;&nbsp; Fine Jewellery &nbsp;|&nbsp; Confidential</div>
  </div>
</body>
</html>`;

    try {
      if (typeof generatePDFModule !== 'function') {
        throw new Error('PDF library not available');
      }
      const pdf = await generatePDFModule({
        html,
        fileName: `${(assignedTo?.name || 'Report').replace(/\s+/g, '_')}_Report_${Date.now()}`,
        directory: 'Documents',
      });
      const cachePath = `${RNFS.CachesDirectoryPath}/Report_${Date.now()}.pdf`;
      await RNFS.copyFile(pdf.filePath, cachePath);
      await Share.open({
        title: `Share Report - ${assignedTo?.name || ''}`,
        url: Platform.OS === 'android' ? `file://${cachePath}` : cachePath,
        type: 'application/pdf',
        failOnCancel: false,
      });
      setTimeout(() => RNFS.unlink(cachePath).catch(() => {}), 5000);
    } catch (e) {
      // user cancelled or error
    } finally {
      setSharingPdf(false);
    }
  }, [filteredEnquiries, assignedTo, sharingPdf]);

  const handleRowPress = useCallback((enquiry) => {
    const id = enquiry?._id || enquiry?.Id || enquiry?.id || enquiry?._originalData?._id;
    if (!id) return;
    navigation.navigate('SingleEnquiry', { enquiryId: id, enquiry });
  }, [navigation]);

  const renderReportRow = useCallback(({ item: enquiry, index, drag, isActive }) => {
    const eid = enquiry?._id || enquiry?.Id || enquiry?.id;
    const clientName = enquiry?.clientName || enquiry?.ClientName || enquiry?.client || 'Unknown';
    const designName = enquiry?.Name || enquiry?.title || '-';
    const designer = getDesignerName(enquiry);
    const startDate = objectIdToDate(eid) || enquiry?.CreatedDate || enquiry?.createdAt || enquiry?.CreatedAt || '';
    const priority = enquiry?.Priority || enquiry?.priority || 'Normal';
    const dateOnly = startDate ? formatDate(startDate) : '-';
    const timeOnly = startDate
      ? new Date(startDate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : '';
    const timeAgo = startDate ? getRelativeTime(startDate) : '-';
    const imgSrc = eid ? imageSources[eid] : null;

    return (
      <GHTouchableOpacity
        style={[styles.tableRow, index % 2 === 0 && styles.tableRowEven, isActive && { backgroundColor: '#fff' }]}
        onPress={() => handleRowPress(enquiry)}
        onLongPress={drag}
        delayLongPress={200}
        activeOpacity={0.7}
      >
        <Text style={[styles.td, styles.tdSr]}>{index + 1}</Text>
        <View style={[styles.td, styles.tdImgCell]}>
          {imgSrc ? (
            <Image source={imgSrc} style={styles.thumb} />
          ) : (
            <Icon name="image" size={20} color={colors.textSecondary} />
          )}
        </View>
        <Text style={[styles.td, styles.tdClient]}>{clientName}</Text>
        <Text style={[styles.td, styles.tdDesignName]}>{designName}</Text>
        <Text style={[styles.td, styles.tdDesigner]}>{designer}</Text>
        <View style={[styles.td, styles.tdDate]}>
          <Text style={styles.tdDateMain}>{dateOnly}</Text>
          {timeOnly ? <Text style={styles.tdDateTime}>{timeOnly}</Text> : null}
        </View>
        <Text style={[styles.td, styles.tdTimeAgo]}>{timeAgo}</Text>
        <View style={[styles.td, styles.tdPriority]}>
          <View style={[styles.priorityBadge, getPriorityStyle(priority)]}>
            <Text style={[styles.priorityBadgeText, getPriorityTextStyle(priority)]}>
              {priority}
            </Text>
          </View>
        </View>
      </GHTouchableOpacity>
    );
  }, [imageSources, handleRowPress]);

  const togglePriority = (val) => {
    setFilterPriority(prev => prev === val ? null : val);
  };

  const allClients = useMemo(() => {
    const seen = new Set();
    const list = [];
    (clients || []).forEach(c => {
      const id = c?.id || c?._id;
      const name = c?.name || c?.Name;
      if (!id || !name || seen.has(String(id))) return;
      seen.add(String(id));
      list.push({ id: String(id), name });
    });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [clients]);

  const filteredClients = useMemo(() => {
    if (!clientSearchText) return allClients;
    const q = clientSearchText.toLowerCase();
    return allClients.filter(c => c.name.toLowerCase().includes(q));
  }, [allClients, clientSearchText]);

  const onStartDateChange = useCallback((_event, selectedDate) => {
    setShowStartPicker(Platform.OS === 'ios');
    if (selectedDate) setFilterStartDate(toDateStr(selectedDate));
  }, []);

  const onEndDateChange = useCallback((_event, selectedDate) => {
    setShowEndPicker(Platform.OS === 'ios');
    if (selectedDate) setFilterEndDate(toDateStr(selectedDate));
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={22} color={colors.textWhite} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{assignedTo?.name || 'Report'} Dashboard</Text>
        <TouchableOpacity onPress={() => setShowFilter(true)} style={styles.filterBtn}>
          <Icon name="tune" size={20} color={colors.textWhite} />
        </TouchableOpacity>
      </View>

      {/* Summary Bar */}
      <View style={styles.summaryBar}>
        <Text style={styles.summaryLabel}>Total Work</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{filteredEnquiries.length}</Text>
        </View>
        <TouchableOpacity onPress={handleSharePDF} style={styles.shareBtn} disabled={sharingPdf}>
          <Icon name="share" size={14} color={sharingPdf ? colors.textLight : colors.primary} />
          <Text style={[styles.shareBtnText, sharingPdf && { color: colors.textLight }]}>
            {sharingPdf ? 'Preparing...' : 'Share PDF'}
          </Text>
        </TouchableOpacity>
      </View>

      {apiLoading && (
        <View style={styles.apiLoader}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.apiLoaderText}>Loading report data...</Text>
        </View>
      )}

      {/* Table - flex columns; rows are hold-to-drag reorderable */}
      <View style={styles.tableContainer}>
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.th, styles.thSr]}>Sr</Text>
          <Text style={[styles.th, styles.thImgHead]}>Img</Text>
          <Text style={[styles.th, styles.thClient]}>Client</Text>
          <Text style={[styles.th, styles.thDesignName]}>Design</Text>
          <Text style={[styles.th, styles.thDesigner]}>Designer</Text>
          <Text style={[styles.th, styles.thDate]}>Date</Text>
          <Text style={[styles.th, styles.thTimeAgo]}>Ago</Text>
          <Text style={[styles.th, styles.thPriority]}>Pri</Text>
        </View>

        {filteredEnquiries.length === 0 ? (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>No enquiries found</Text>
          </View>
        ) : (
          <ReorderableList
            data={filteredEnquiries}
            renderItem={renderReportRow}
            keyExtractor={(item, idx) => item?._id || item?.Id || String(idx)}
            onDragEnd={handleReorder}
          />
        )}
      </View>

      {/* Filter Modal */}
      <Modal
        visible={showFilter}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFilter(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFilter(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={e => e.stopPropagation()} style={styles.filterPanel}>
            <View style={styles.filterHeader}>
              <Text style={styles.filterTitle}>Filter</Text>
              <TouchableOpacity onPress={() => setShowFilter(false)}>
                <Icon name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.filterContent}>
              {/* Priority */}
              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>Priority</Text>
                <View style={styles.priorityRow}>
                  {['normal', 'high', 'super high'].map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.priorityChip, filterPriority === p && styles.priorityChipActive]}
                      onPress={() => togglePriority(p)}
                    >
                      <Icon
                        name={p === 'high' || p === 'super high' ? 'error' : 'info'}
                        size={18}
                        color={filterPriority === p ? colors.textWhite : colors.textSecondary}
                      />
                      <Text style={[styles.priorityChipText, filterPriority === p && styles.priorityChipTextActive]}>
                        {p === 'super high' ? 'Super High' : p.charAt(0).toUpperCase() + p.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Client Search */}
              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>Client</Text>
                <TextInput
                  style={styles.filterInput}
                  placeholder="Search client..."
                  placeholderTextColor={colors.textLight}
                  value={clientSearchText}
                  onChangeText={text => {
                    setClientSearchText(text);
                    setClientListExpanded(true);
                  }}
                  onFocus={() => setClientListExpanded(true)}
                />
                {clientListExpanded && filteredClients.length > 0 && (
                  <View style={styles.clientListContainer}>
                    <ScrollView style={styles.clientListScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {filteredClients.map(c => (
                        <TouchableOpacity
                          key={c.id}
                          style={[styles.clientListItem, filterClientId === c.id && styles.clientListItemActive]}
                          onPress={() => {
                            setFilterClient(c.name);
                            setFilterClientId(c.id);
                            setClientSearchText(c.name);
                            setClientListExpanded(false);
                          }}
                        >
                          <Text style={[styles.clientListItemText, filterClientId === c.id && styles.clientListItemTextActive]}>
                            {c.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
                {filterClient !== '' && (
                  <TouchableOpacity
                    onPress={() => { setFilterClient(''); setFilterClientId(''); setClientSearchText(''); }}
                  >
                    <Text style={styles.clearClientBtn}>Clear Client</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Date Range */}
              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>Date Range</Text>
                <View style={styles.dateRow}>
                  <TouchableOpacity
                    style={[styles.filterInput, styles.dateInput]}
                    onPress={() => setShowStartPicker(true)}
                  >
                    <Text style={filterStartDate ? styles.dateText : styles.datePlaceholder}>
                      {filterStartDate ? formatDate(filterStartDate) : 'Start Date'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.filterInput, styles.dateInput]}
                    onPress={() => setShowEndPicker(true)}
                  >
                    <Text style={filterEndDate ? styles.dateText : styles.datePlaceholder}>
                      {filterEndDate ? formatDate(filterEndDate) : 'End Date'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {showStartPicker && (
                  <DateTimePicker
                    value={filterStartDate ? new Date(filterStartDate) : new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={onStartDateChange}
                  />
                )}
                {showEndPicker && (
                  <DateTimePicker
                    value={filterEndDate ? new Date(filterEndDate) : new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={onEndDateChange}
                  />
                )}
              </View>
            </ScrollView>

            {/* Filter Footer */}
            <View style={styles.filterFooter}>
              <TouchableOpacity onPress={clearFilters} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>Clear All</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowFilter(false)} style={styles.applyBtn}>
                <Text style={styles.applyBtnText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.textWhite },
  filterBtn: { padding: 4 },

  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  countBadge: {
    backgroundColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 8,
  },
  countText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 20,
  },
  shareBtnText: { fontSize: 12, fontWeight: '700', color: colors.primary },

  tableContainer: { flex: 1 },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: '#0d2f33',
    borderBottomWidth: 1,
    borderBottomColor: '#0d2f33',
  },
  th: {
    color: colors.textWhite,
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderRightColor: 'rgba(255,255,255,0.2)',
  },
  thSr: { flex: 0.4 },
  thImgHead: { flex: 0.5 },
  thClient: { flex: 1.2 },
  thDesignName: { flex: 1.3 },
  thDesigner: { flex: 0.9 },
  thDate: { flex: 0.9 },
  thTimeAgo: { flex: 0.6 },
  thPriority: { flex: 0.8, borderRightWidth: 0 },

  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 0.5,
    borderBottomColor: '#D1D5DB',
    borderLeftWidth: 0.5,
    borderLeftColor: '#D1D5DB',
    borderRightWidth: 0.5,
    borderRightColor: '#D1D5DB',
    paddingVertical: 8,
    paddingHorizontal: 4,
    minHeight: 48,
  },
  tableRowEven: { backgroundColor: '#F3F4F6' },
  td: {
    fontSize: 9,
    color: colors.textPrimary,
    textAlign: 'center',
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderRightColor: '#E5E7EB',
  },
  tdSr: { flex: 0.4, fontWeight: '600' },
  tdImgCell: { flex: 0.5, alignItems: 'center', justifyContent: 'center' },
  thumb: {
    width: 38,
    height: 38,
    borderRadius: 4,
    backgroundColor: '#E6F0F1',
  },
  tdClient: { flex: 1.2 },
  tdDesignName: { flex: 1.3 },
  tdDesigner: { flex: 0.9 },
  tdDate: { flex: 0.9, justifyContent: 'center' },
  tdDateMain: { fontSize: 9, color: colors.textPrimary, textAlign: 'center' },
  tdDateTime: { fontSize: 8, color: colors.textSecondary, textAlign: 'center', marginTop: 1 },
  tdTimeAgo: { flex: 0.6 },
  tdPriority: { flex: 0.8, alignItems: 'center', borderRightWidth: 0 },
  priorityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeHigh: { borderWidth: 1, borderColor: '#EF4444' },
  badgeMedium: { borderWidth: 1, borderColor: '#F59E0B' },
  badgeLow: { borderWidth: 1, borderColor: '#D1D5DB' },
  priorityBadgeText: { fontSize: 8, fontWeight: '700' },

  emptyRow: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: colors.textSecondary },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  filterPanel: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  filterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterTitle: { fontSize: 20, fontWeight: '600', color: colors.primary },
  filterContent: { padding: 20 },
  filterSection: { marginBottom: 24 },
  filterLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  priorityRow: { flexDirection: 'row', gap: 10 },
  priorityChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  priorityChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  priorityChipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  priorityChipTextActive: { color: colors.textWhite },
  filterInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.backgroundSecondary,
  },
  dateRow: { flexDirection: 'row', gap: 10 },
  dateInput: { flex: 1, justifyContent: 'center' },
  dateText: { fontSize: 14, color: colors.textPrimary },
  datePlaceholder: { fontSize: 14, color: colors.textLight },
  clientListContainer: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.background,
    maxHeight: 160,
  },
  clientListScroll: { padding: 4 },
  clientListItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  clientListItemActive: {
    backgroundColor: colors.primary + '1A',
  },
  clientListItemText: { fontSize: 14, color: colors.textPrimary },
  clientListItemTextActive: { fontWeight: '600', color: colors.primary },
  clearClientBtn: { fontSize: 12, color: colors.accent, marginTop: 6, textAlign: 'right' },
  filterFooter: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clearBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  clearBtnText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase' },
  applyBtn: {
    flex: 2,
    backgroundColor: colors.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  applyBtnText: { fontSize: 12, fontWeight: '700', color: colors.textWhite, textTransform: 'uppercase' },

  apiLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
  },
  apiLoaderText: { fontSize: 13, color: colors.textSecondary },
});

export default ReportsDashboardScreen;
