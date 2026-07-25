import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';

import { colors } from '../../constants/colors';
import catalogApi from '../../services/catalogApi';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABEL = {
  order_received: 'Received',
  order_confirmed: 'Confirmed',
  order_in_production: 'In Production',
  order_shipped: 'Shipped',
  order_delivered: 'Delivered',
  order_cancelled: 'Cancelled',
};

const STATUS_BADGE = {
  order_received: { bg: '#FEF3C7', text: '#92400E' },
  order_confirmed: { bg: '#DBEAFE', text: '#1E40AF' },
  order_in_production: { bg: '#EDE9FE', text: '#4C1D95' },
  order_shipped: { bg: '#D1FAE5', text: '#065F46' },
  order_delivered: { bg: '#CFFAFE', text: '#155E75' },
  order_cancelled: { bg: '#FEE2E2', text: '#991B1B' },
};

const NEXT_STATUS = {
  order_received: 'order_confirmed',
  order_confirmed: 'order_in_production',
  order_in_production: 'order_shipped',
  order_shipped: 'order_delivered',
};

const ADVANCE_LABEL = {
  order_received: 'Confirm Order',
  order_confirmed: 'Mark In Production',
  order_in_production: 'Mark as Shipped',
  order_shipped: 'Mark as Delivered',
};

const EMPTY_SHIPMENT_FORM = {
  sourceCity: '',
  destinationCity: '',
  logisticsName: '',
  logisticsId: '',
  awbNo: '',
  noOfPcs: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString('en-US', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

const formatDateShort = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const COLOR_SWATCH = {
  whiteQty: { label: 'White', swatch: '#E8EAED' },
  yellowQty: { label: 'Yellow', swatch: '#D4AF37' },
  roseQty: { label: 'Rose', swatch: '#C98A7A' },
};

const getItemDisplayTitle = (item) => {
  const snapshot = item?.meta?.productSnapshot || {};
  const subcategory = String(snapshot.subcategoryName || item?.meta?.subcategoryName || '').trim();
  const category = String(snapshot.categoryName || item?.meta?.categoryName || '').trim();
  if (subcategory && category) return `${subcategory} ${category}`;
  if (subcategory) return subcategory;
  if (category) return category;
  return String(item?.title || item?.styleNo || 'Ordered Item').trim();
};

const getItemDisplaySubtitle = (item) => {
  const snapshot = item?.meta?.productSnapshot || {};
  return String(snapshot.subcategoryProfileName || item?.meta?.subcategoryProfileName || '').trim();
};

// Metal karat / stone selections captured at order time (e.g. "14 kt", "Lab Grown")
const getItemFilterMeta = (item) => {
  const filters = item?.meta?.selectedFilters;
  if (!filters || typeof filters !== 'object') return { metal: '', stone: '' };
  return {
    metal: String(filters.metal || '').trim(),
    stone: String(filters.stone || '').trim(),
  };
};

// Per-color piece breakdown (white/yellow/rose gold) recorded on the order line
const getItemColorBreakdown = (item) => {
  const meta = item?.meta || {};
  return Object.entries(COLOR_SWATCH)
    .map(([key, cfg]) => ({ ...cfg, qty: Number(meta[key] || 0) }))
    .filter((entry) => entry.qty > 0);
};

const getItemDiamondInfo = (item) => {
  const meta = item?.meta || {};
  const pointer = Number(meta.pointer || 0);
  const totalCt = Number(meta.totalDiamondWeightCt || 0);
  if (!pointer && !totalCt) return '';
  const parts = [];
  if (pointer) parts.push(`${pointer} pointer`);
  if (totalCt) parts.push(`${totalCt} ct total`);
  return parts.join('  ·  ');
};

// Upload a file to a presigned S3 URL using XMLHttpRequest (handles binary correctly in RN)
function uploadToS3(uploadUrl, fileUri, contentType) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`S3 upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('S3 upload network error'));
    xhr.send({ uri: fileUri, type: contentType, name: 'invoice.pdf' });
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }) {
  const style = STATUS_BADGE[status] || { bg: '#F3F4F6', text: '#374151' };
  return (
    <View style={[sectionStyles.badge, { backgroundColor: style.bg }]}>
      <Text style={[sectionStyles.badgeText, { color: style.text }]}>
        {STATUS_LABEL[status] || status}
      </Text>
    </View>
  );
}

function SectionCard({ children, style }) {
  return <View style={[sectionStyles.card, style]}>{children}</View>;
}

function LabelValue({ label, value }) {
  if (!value) return null;
  return (
    <View style={sectionStyles.labelValueRow}>
      <Text style={sectionStyles.labelText}>{label}</Text>
      <Text style={sectionStyles.valueText}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Shipment Tracking Modal
// ---------------------------------------------------------------------------

function ShipmentTrackingModal({ visible, onClose, onSubmit, submitting }) {
  const [form, setForm] = useState(EMPTY_SHIPMENT_FORM);

  const setField = (field) => (text) => setForm((f) => ({ ...f, [field]: text }));

  const handleSubmit = () => {
    const required = ['sourceCity', 'destinationCity', 'logisticsName', 'logisticsId', 'awbNo', 'noOfPcs'];
    for (const key of required) {
      if (!String(form[key] || '').trim()) {
        Alert.alert('Missing Field', `Please fill in ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}.`);
        return;
      }
    }
    const noOfPcs = Number(form.noOfPcs);
    if (!Number.isInteger(noOfPcs) || noOfPcs < 1) {
      Alert.alert('Invalid', 'Number of pieces must be a positive integer.');
      return;
    }
    onSubmit({ ...form, noOfPcs });
  };

  const fields = [
    { key: 'sourceCity', label: 'Source City', placeholder: 'e.g. Mumbai' },
    { key: 'destinationCity', label: 'Destination City', placeholder: 'e.g. New York' },
    { key: 'logisticsName', label: 'Logistics Name', placeholder: 'e.g. FedEx' },
    { key: 'logisticsId', label: 'Logistics ID', placeholder: 'Carrier account / tracking ID' },
    { key: 'awbNo', label: 'AWB Number', placeholder: 'Air waybill number' },
    { key: 'noOfPcs', label: 'Number of Pieces', placeholder: '0', keyboardType: 'numeric' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <TouchableOpacity style={modalStyles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={modalStyles.sheet}>
          <View style={modalStyles.handle} />
          <View style={modalStyles.headerRow}>
            <TouchableOpacity onPress={onClose} activeOpacity={0.8}>
              <Text style={modalStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={modalStyles.title}>Shipment Details</Text>
            <View style={modalStyles.headerSpacer} />
          </View>

          <ScrollView contentContainerStyle={modalStyles.content} keyboardShouldPersistTaps="handled">
            {fields.map(({ key, label, placeholder, keyboardType }) => (
              <View key={key} style={modalStyles.fieldWrap}>
                <Text style={modalStyles.fieldLabel}>{label}</Text>
                <TextInput
                  style={modalStyles.input}
                  placeholder={placeholder}
                  placeholderTextColor="#9AA6B0"
                  value={form[key]}
                  onChangeText={setField(key)}
                  keyboardType={keyboardType || 'default'}
                  autoCapitalize="words"
                />
              </View>
            ))}

            <TouchableOpacity
              style={[modalStyles.submitBtn, submitting && modalStyles.submitBtnDisabled]}
              activeOpacity={0.85}
              disabled={submitting}
              onPress={handleSubmit}>
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={modalStyles.submitBtnText}>Mark as Shipped</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

const AdminOrderDetailsScreen = ({ route, navigation }) => {
  const { orderId, order: initialOrder } = route?.params || {};

  const [order, setOrder] = useState(initialOrder || null);
  const [loading, setLoading] = useState(!initialOrder);
  const [submitting, setSubmitting] = useState(false);
  const [shipmentModalVisible, setShipmentModalVisible] = useState(false);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState(null);
  const [openingInvoiceId, setOpeningInvoiceId] = useState(null);

  // -------------------------------------------------------------------------
  // Load / refresh order
  // -------------------------------------------------------------------------

  const loadOrder = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const res = await catalogApi.get(`/admin/orders/${orderId}`);
      if (res?.order) setOrder(res.order);
    } catch (err) {
      Alert.alert('Error', err?.message || 'Could not load order.');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (!initialOrder) {
      loadOrder();
    }
  }, [initialOrder, loadOrder]);

  // -------------------------------------------------------------------------
  // Advance status
  // -------------------------------------------------------------------------

  const nextStatus = order ? NEXT_STATUS[order.status] : null;

  const handleAdvanceStatus = useCallback(() => {
    if (!nextStatus) return;

    if (nextStatus === 'order_shipped') {
      setShipmentModalVisible(true);
      return;
    }

    Alert.alert(
      'Confirm',
      `Advance order to "${STATUS_LABEL[nextStatus]}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setSubmitting(true);
            try {
              const res = await catalogApi.patch(`/admin/orders/${order._id}/status`, {
                status: nextStatus,
              });
              if (res?.order) setOrder(res.order);
            } catch (err) {
              Alert.alert('Error', err?.message || 'Status update failed.');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  }, [nextStatus, order]);

  const handleSubmitShipment = useCallback(
    async (trackingData) => {
      setSubmitting(true);
      try {
        const res = await catalogApi.patch(`/admin/orders/${order._id}/status`, {
          status: 'order_shipped',
          shipmentTracking: {
            sourceCity: trackingData.sourceCity,
            destinationCity: trackingData.destinationCity,
            logisticsName: trackingData.logisticsName,
            logisticsId: trackingData.logisticsId,
            awbNo: trackingData.awbNo,
            noOfPcs: trackingData.noOfPcs,
          },
        });
        if (res?.order) setOrder(res.order);
        setShipmentModalVisible(false);
      } catch (err) {
        Alert.alert('Error', err?.message || 'Could not mark as shipped.');
      } finally {
        setSubmitting(false);
      }
    },
    [order],
  );

  // -------------------------------------------------------------------------
  // Cancel order
  // -------------------------------------------------------------------------

  const handleCancelOrder = useCallback(() => {
    Alert.alert(
      'Cancel Order',
      'Are you sure you want to cancel this order? This cannot be undone.',
      [
        { text: 'Keep Order', style: 'cancel' },
        {
          text: 'Cancel Order',
          style: 'destructive',
          onPress: async () => {
            setSubmitting(true);
            try {
              const res = await catalogApi.patch(`/admin/orders/${order._id}/cancel`, {});
              if (res?.order) setOrder(res.order);
            } catch (err) {
              Alert.alert('Error', err?.message || 'Could not cancel order.');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  }, [order]);

  // -------------------------------------------------------------------------
  // Invoice upload
  // -------------------------------------------------------------------------

  const handleUploadInvoice = useCallback(async () => {
    try {
      const picked = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.pdf],
      });

      const fileName = picked.name || `invoice-${Date.now()}.pdf`;
      const fileUri = picked.uri;

      setUploadingInvoice(true);

      // 1. Get presigned URL
      const presignRes = await catalogApi.post(`/admin/orders/${order._id}/invoices/presign`, {
        fileName,
        contentType: 'application/pdf',
      });

      const { key, uploadUrl } = presignRes;

      // 2. Upload to S3
      await uploadToS3(uploadUrl, fileUri, 'application/pdf');

      // 3. Confirm upload
      const confirmRes = await catalogApi.post(`/admin/orders/${order._id}/invoices`, {
        key,
        filename: fileName,
      });

      if (confirmRes?.order) setOrder(confirmRes.order);
    } catch (err) {
      if (DocumentPicker.isCancel(err)) return;
      Alert.alert('Upload Failed', err?.message || 'Could not upload invoice.');
    } finally {
      setUploadingInvoice(false);
    }
  }, [order]);

  // -------------------------------------------------------------------------
  // Invoice delete
  // -------------------------------------------------------------------------

  const handleDeleteInvoice = useCallback(
    (invoice) => {
      Alert.alert(
        'Delete Invoice',
        `Delete "${invoice.filename}"? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setDeletingInvoiceId(invoice._id);
              try {
                const res = await catalogApi.delete(
                  `/admin/orders/${order._id}/invoices/${invoice._id}`,
                );
                if (res?.order) setOrder(res.order);
              } catch (err) {
                Alert.alert('Error', err?.message || 'Could not delete invoice.');
              } finally {
                setDeletingInvoiceId(null);
              }
            },
          },
        ],
      );
    },
    [order],
  );

  // -------------------------------------------------------------------------
  // Invoice open
  // -------------------------------------------------------------------------

  const handleOpenInvoice = useCallback(async (inv) => {
    if (!inv?.url) return;
    setOpeningInvoiceId(inv._id);
    try {
      const supported = await Linking.canOpenURL(inv.url);
      if (supported) {
        await Linking.openURL(inv.url);
      } else {
        Alert.alert('Error', 'Cannot open this invoice.');
      }
    } catch {
      Alert.alert('Error', 'Something went wrong opening the invoice.');
    } finally {
      setOpeningInvoiceId(null);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F5A62" />
        <Text style={styles.loadingText}>Loading order…</Text>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Order not found.</Text>
        <TouchableOpacity onPress={navigation.goBack} style={styles.retryBtn} activeOpacity={0.8}>
          <Text style={styles.retryBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const invoices = Array.isArray(order.invoices) ? order.invoices : [];
  const timeline = Array.isArray(order.timeline) ? order.timeline : [];
  const canCancel = order.status === 'order_received';
  const isTerminal = order.status === 'order_delivered' || order.status === 'order_cancelled';
  const shipmentTracking = order.orderMeta?.shipmentTracking || null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} style={styles.iconBtn} activeOpacity={0.8}>
          <MaterialIcons name="chevron-left" size={24} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Order Details</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {order.orderNumber || order._id}
          </Text>
        </View>
        <TouchableOpacity onPress={loadOrder} style={styles.iconBtn} activeOpacity={0.8}>
          <MaterialIcons name="refresh" size={20} color="#66727B" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* ---------------------------------------------------------------- */}
        {/* Status & Action Card                                               */}
        {/* ---------------------------------------------------------------- */}
        <SectionCard>
          <View style={sectionStyles.statusRow}>
            <View>
              <Text style={sectionStyles.sectionLabel}>Current Status</Text>
              <StatusBadge status={order.status} />
            </View>
            {!isTerminal && nextStatus && (
              <TouchableOpacity
                style={[sectionStyles.advanceBtn, submitting && sectionStyles.advanceBtnDisabled]}
                activeOpacity={0.85}
                disabled={submitting}
                onPress={handleAdvanceStatus}>
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialIcons name="arrow-forward" size={16} color="#FFFFFF" />
                    <Text style={sectionStyles.advanceBtnText}>
                      {ADVANCE_LABEL[order.status] || 'Advance'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          {isTerminal && (
            <Text style={sectionStyles.terminalNote}>
              {order.status === 'order_delivered'
                ? 'This order has been delivered.'
                : 'This order has been cancelled.'}
            </Text>
          )}

          {canCancel && (
            <TouchableOpacity
              style={sectionStyles.cancelBtn}
              activeOpacity={0.85}
              disabled={submitting}
              onPress={handleCancelOrder}>
              <MaterialIcons name="cancel" size={16} color="#991B1B" />
              <Text style={sectionStyles.cancelBtnText}>Cancel Order</Text>
            </TouchableOpacity>
          )}
        </SectionCard>

        {/* ---------------------------------------------------------------- */}
        {/* Client & Address                                                   */}
        {/* ---------------------------------------------------------------- */}
        <SectionCard>
          <Text style={sectionStyles.sectionTitle}>Client</Text>
          <View style={sectionStyles.clientHeadRow}>
            <Text style={sectionStyles.clientNameText}>{order.clientName || order.clientUsername || 'Unknown Client'}</Text>
            {order.clientUsername ? <Text style={sectionStyles.clientUsernameText}>@{order.clientUsername}</Text> : null}
          </View>
          <LabelValue label="Shipping Address" value={order.shippingAddress} />
          {order.notes ? <LabelValue label="Order Notes" value={order.notes} /> : null}
        </SectionCard>

        {/* ---------------------------------------------------------------- */}
        {/* Shipment Tracking (if shipped)                                    */}
        {/* ---------------------------------------------------------------- */}
        {shipmentTracking && (
          <SectionCard>
            <Text style={sectionStyles.sectionTitle}>Shipment Tracking</Text>
            <LabelValue label="From" value={shipmentTracking.sourceCity} />
            <LabelValue label="To" value={shipmentTracking.destinationCity} />
            <LabelValue label="Carrier" value={shipmentTracking.logisticsName} />
            <LabelValue label="Logistics ID" value={shipmentTracking.logisticsId} />
            <LabelValue label="AWB No." value={shipmentTracking.awbNo} />
            <LabelValue label="Pieces" value={String(shipmentTracking.noOfPcs)} />
          </SectionCard>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Items                                                              */}
        {/* ---------------------------------------------------------------- */}
        <SectionCard>
          <View style={sectionStyles.sectionHeaderRow}>
            <Text style={sectionStyles.sectionTitle}>Items</Text>
            <Text style={sectionStyles.sectionCount}>{items.length} item{items.length !== 1 ? 's' : ''}</Text>
          </View>
          {items.map((item, idx) => {
            const title = getItemDisplayTitle(item);
            const subtitle = getItemDisplaySubtitle(item);
            const { metal, stone } = getItemFilterMeta(item);
            const colorBreakdown = getItemColorBreakdown(item);
            const diamondInfo = getItemDiamondInfo(item);
            return (
              <View key={`${item.productId || item.styleNo || idx}`} style={sectionStyles.itemRow}>
                {item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={sectionStyles.itemImage} resizeMode="contain" />
                ) : (
                  <View style={sectionStyles.itemImagePlaceholder} />
                )}
                <View style={sectionStyles.itemInfo}>
                  <Text style={sectionStyles.itemTitle} numberOfLines={2}>{title}</Text>
                  {subtitle ? <Text style={sectionStyles.itemSubtitle} numberOfLines={1}>{subtitle}</Text> : null}

                  {(metal || stone || colorBreakdown.length > 0) && (
                    <View style={sectionStyles.itemChipRow}>
                      {metal ? (
                        <View style={sectionStyles.metalChip}>
                          <Text style={sectionStyles.metalChipText}>{metal}</Text>
                        </View>
                      ) : null}
                      {stone ? (
                        <View style={sectionStyles.stoneChip}>
                          <Text style={sectionStyles.stoneChipText}>{stone}</Text>
                        </View>
                      ) : null}
                      {colorBreakdown.map((c) => (
                        <View key={c.label} style={sectionStyles.colorChip}>
                          <View style={[sectionStyles.colorSwatch, { backgroundColor: c.swatch }]} />
                          <Text style={sectionStyles.colorChipText}>{c.label} · {c.qty}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {diamondInfo ? <Text style={sectionStyles.itemMeta}>{diamondInfo}</Text> : null}

                  <View style={sectionStyles.itemFooterRow}>
                    {item.styleNo ? (
                      <Text style={sectionStyles.itemStyleNo} numberOfLines={1}>Style {item.styleNo}</Text>
                    ) : <View />}
                    <Text style={sectionStyles.itemQty}>{Number(item.quantity || 0)} pcs</Text>
                  </View>

                  {item.remarks ? <Text style={sectionStyles.itemRemarks} numberOfLines={2}>{item.remarks}</Text> : null}
                </View>
              </View>
            );
          })}
        </SectionCard>

        {/* ---------------------------------------------------------------- */}
        {/* Timeline                                                           */}
        {/* ---------------------------------------------------------------- */}
        {timeline.length > 0 && (
          <SectionCard>
            <Text style={sectionStyles.sectionTitle}>Timeline</Text>
            {timeline.map((entry, idx) => (
              <View key={`${entry.status}-${entry.changedAt}-${idx}`} style={sectionStyles.timelineRow}>
                <View style={sectionStyles.timelineDot} />
                <View style={sectionStyles.timelineContent}>
                  <Text style={sectionStyles.timelineStatus}>
                    {STATUS_LABEL[entry.status] || entry.status}
                  </Text>
                  <Text style={sectionStyles.timelineMeta}>
                    {formatDateTime(entry.changedAt)} · {entry.changedBy?.role || ''}
                    {entry.note ? `  "${entry.note}"` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </SectionCard>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Invoices                                                           */}
        {/* ---------------------------------------------------------------- */}
        <SectionCard>
          <View style={sectionStyles.sectionHeaderRow}>
            <Text style={sectionStyles.sectionTitle}>Invoices</Text>
            <TouchableOpacity
              style={[sectionStyles.uploadBtn, uploadingInvoice && sectionStyles.uploadBtnDisabled]}
              activeOpacity={0.85}
              disabled={uploadingInvoice}
              onPress={handleUploadInvoice}>
              {uploadingInvoice ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialIcons name="upload-file" size={16} color="#FFFFFF" />
                  <Text style={sectionStyles.uploadBtnText}>Upload PDF</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {invoices.length === 0 ? (
            <Text style={sectionStyles.emptyInvoiceText}>No invoices uploaded yet.</Text>
          ) : (
            invoices.map((inv, idx) => (
              <View key={inv._id || idx} style={sectionStyles.invoiceRow}>
                <View style={sectionStyles.invoiceIcon}>
                  <MaterialIcons name="picture-as-pdf" size={22} color="#C05252" />
                </View>
                <View style={sectionStyles.invoiceInfo}>
                  <Text style={sectionStyles.invoiceFilename} numberOfLines={2}>
                    {inv.filename || `Invoice ${idx + 1}`}
                  </Text>
                  {inv.uploadedAt ? (
                    <Text style={sectionStyles.invoiceDate}>{formatDateShort(inv.uploadedAt)}</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={[sectionStyles.invoiceActionBtn, openingInvoiceId === inv._id && sectionStyles.invoiceActionBtnDisabled]}
                  activeOpacity={0.8}
                  disabled={openingInvoiceId === inv._id}
                  onPress={() => handleOpenInvoice(inv)}>
                  {openingInvoiceId === inv._id ? (
                    <ActivityIndicator size="small" color="#1F5A62" />
                  ) : (
                    <MaterialIcons name="open-in-new" size={18} color="#1F5A62" />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[sectionStyles.invoiceDeleteBtn, deletingInvoiceId === inv._id && sectionStyles.invoiceActionBtnDisabled]}
                  activeOpacity={0.8}
                  disabled={deletingInvoiceId === inv._id}
                  onPress={() => handleDeleteInvoice(inv)}>
                  {deletingInvoiceId === inv._id ? (
                    <ActivityIndicator size="small" color="#991B1B" />
                  ) : (
                    <MaterialIcons name="delete-outline" size={18} color="#991B1B" />
                  )}
                </TouchableOpacity>
              </View>
            ))
          )}
        </SectionCard>

        {/* Bottom padding */}
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Shipment Tracking Modal */}
      <ShipmentTrackingModal
        visible={shipmentModalVisible}
        onClose={() => setShipmentModalVisible(false)}
        onSubmit={handleSubmitShipment}
        submitting={submitting}
      />
    </View>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EFF1F3',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF1F3',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7780',
  },
  errorText: {
    fontSize: 14,
    color: colors.error || '#C05252',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 14,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#1F5A62',
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    height: 54,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DCE2E8',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  headerSub: {
    fontSize: 11,
    color: '#8A97A3',
    marginTop: 2,
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 12,
    gap: 10,
  },
});

const sectionStyles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
  },
  badge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  advanceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#135A62',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexShrink: 0,
  },
  advanceBtnDisabled: {
    backgroundColor: '#8AA8AC',
  },
  advanceBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  terminalNote: {
    marginTop: 10,
    fontSize: 13,
    color: '#6B7780',
  },
  cancelBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignSelf: 'flex-start',
  },
  cancelBtnText: {
    fontSize: 13,
    color: '#991B1B',
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 12,
    color: '#6B7780',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D2A34',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionCount: {
    fontSize: 13,
    color: '#6B7780',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  labelValueRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EAEDF0',
  },
  labelText: {
    fontSize: 11,
    color: '#6B7780',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  valueText: {
    fontSize: 14,
    color: '#1D2A34',
    fontWeight: '500',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EAEDF0',
  },
  itemImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E7EAF0',
    backgroundColor: '#F8FAFB',
  },
  itemImagePlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: '#E8ECF0',
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D2A34',
  },
  itemSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7780',
  },
  itemChipRow: {
    marginTop: 7,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metalChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#FBF3DC',
    borderWidth: 1,
    borderColor: '#EEDDA6',
  },
  metalChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8A6B10',
  },
  stoneChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#EDF3F4',
    borderWidth: 1,
    borderColor: '#D3E1E3',
  },
  stoneChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#3D6672',
  },
  colorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#F5F6F8',
    borderWidth: 1,
    borderColor: '#E3E7EB',
  },
  colorSwatch: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  colorChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#3D4952',
  },
  itemMeta: {
    marginTop: 6,
    fontSize: 12,
    color: '#6B7780',
  },
  itemFooterRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  itemStyleNo: {
    flex: 1,
    fontSize: 11,
    color: '#9AA6B0',
  },
  itemQty: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D2A34',
  },
  itemRemarks: {
    marginTop: 5,
    fontSize: 12,
    color: '#8A97A3',
    fontStyle: 'italic',
  },
  clientHeadRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EAEDF0',
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    flexWrap: 'wrap',
  },
  clientNameText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1D2A34',
  },
  clientUsernameText: {
    fontSize: 12,
    color: '#9AA6B0',
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1F5A62',
    marginTop: 5,
    flexShrink: 0,
  },
  timelineContent: {
    flex: 1,
  },
  timelineStatus: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1D2A34',
  },
  timelineMeta: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7780',
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#135A62',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  uploadBtnDisabled: {
    backgroundColor: '#8AA8AC',
  },
  uploadBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyInvoiceText: {
    fontSize: 13,
    color: '#8A97A3',
    marginTop: 4,
  },
  invoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EAEDF0',
  },
  invoiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  invoiceInfo: {
    flex: 1,
  },
  invoiceFilename: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1D2A34',
  },
  invoiceDate: {
    marginTop: 2,
    fontSize: 11,
    color: '#8A97A3',
  },
  invoiceActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#EBF5F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  invoiceDeleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  invoiceActionBtnDisabled: {
    opacity: 0.5,
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
    width: 72,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#D1D5DB',
  },
  headerRow: {
    height: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E5EA',
  },
  cancelText: {
    fontSize: 14,
    color: '#3D5A67',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1D2A34',
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    padding: 16,
    gap: 14,
    paddingBottom: 32,
  },
  fieldWrap: {
    gap: 5,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    height: 46,
    borderWidth: 1,
    borderColor: '#D1D9E0',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    color: '#1D2A34',
    backgroundColor: '#F8FAFB',
  },
  submitBtn: {
    marginTop: 8,
    height: 50,
    borderRadius: 12,
    backgroundColor: '#135A62',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    backgroundColor: '#8AA8AC',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default AdminOrderDetailsScreen;
