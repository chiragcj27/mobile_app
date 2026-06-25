import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import IconComponent from '../common/Icon';

export const isEnquiryClientUser = (user) =>
  user?.role?.toLowerCase() === 'client' ||
  user?.role === 'cl' ||
  user?.roleId === 4 ||
  user?.roleNumber === 4;

const enquiryChatCtaStyles = StyleSheet.create({
  wrapEmbedded: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  wrapStandalone: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    padding: 16,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  btnText: {
    fontSize: fonts.sm,
    fontFamily: fonts.bold,
    color: colors.textWhite,
    flexShrink: 1,
    textAlign: 'center',
  },
});

export const EnquiryChatCta = ({ user, onPress, visible = true, embedded = false }) => {
  if (!visible || !onPress) return null;
  const wrapStyle = embedded ? enquiryChatCtaStyles.wrapEmbedded : enquiryChatCtaStyles.wrapStandalone;
  const isClient = isEnquiryClientUser(user);
  const buttonLabel = isClient ? 'Have more instructions? Chat with Us' : 'Add additional info on chat';
  return (
    <View style={wrapStyle}>
      <TouchableOpacity style={enquiryChatCtaStyles.btn} onPress={onPress} activeOpacity={0.85}>
        <IconComponent name="chat" size={20} color={colors.textWhite} />
        <Text style={enquiryChatCtaStyles.btnText}>{buttonLabel}</Text>
      </TouchableOpacity>
    </View>
  );
};

const dash = (v) => {
  if (v === null || v === undefined) return '—';
  const s = String(v).trim();
  return s === '' ? '—' : s;
};

const formatDateSafe = (dateString) => {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return String(dateString);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return String(dateString);
  }
};

const formatWeightBlock = (from, to, exact) => {
  if (exact) return `${exact} g`;
  if (from && to) return `${from} – ${to} g`;
  if (from) return `From ${from} g`;
  if (to) return `Up to ${to} g`;
  return '—';
};

const SectionHeader = ({ title, icon }) => (
  <View style={styles.sectionHeaderRow}>
    {icon ? (
      <View style={styles.sectionHeaderIconWrap}>
        <IconComponent name={icon} size={18} color={colors.primary} />
      </View>
    ) : null}
    <Text style={styles.sectionHeaderText}>{title}</Text>
  </View>
);

const FieldBlock = ({ label, value, multiline }) => (
  <View style={styles.fieldBlock}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <Text style={[styles.fieldValue, multiline && styles.fieldValueMultiline]} numberOfLines={multiline ? undefined : 6}>
      {value}
    </Text>
  </View>
);

const FieldPair = ({ left, right }) => (
  <View style={styles.pairRow}>
    <View style={[styles.pairHalf, styles.pairHalfLeft]}>{left}</View>
    <View style={[styles.pairHalf, styles.pairHalfRight]}>{right}</View>
  </View>
);

const Pill = ({ text, variant = 'neutral' }) => {
  const pillStyles = [styles.pill];
  const textStyles = [styles.pillText];
  if (variant === 'primary') {
    pillStyles.push(styles.pillPrimary);
    textStyles.push(styles.pillTextOnPrimary);
  } else if (variant === 'accent') {
    pillStyles.push(styles.pillAccent);
    textStyles.push(styles.pillTextAccent);
  }
  return (
    <View style={pillStyles}>
      <Text style={textStyles} numberOfLines={1}>{text}</Text>
    </View>
  );
};

// Formats long text strings with linebreaks into scannable lists
const FormattedSummary = ({ text }) => {
  if (!text) return null;
  const lines = text.split('\n').filter(line => line.trim() !== '');

  return (
    <View style={styles.summaryBox}>
      {lines.map((line, index) => {
        // Look for "Key: Value" patterns in the text to bold the key
        const colonIndex = line.indexOf(':');
        if (colonIndex > -1 && colonIndex < 30) {
          return (
            <Text key={index} style={styles.summaryLine}>
              <Text style={styles.summaryLineKey}>{line.substring(0, colonIndex + 1)} </Text>
              <Text style={styles.summaryLineValue}>{line.substring(colonIndex + 1).trim()}</Text>
            </Text>
          );
        }
        return <Text key={index} style={styles.summaryLine}>{line}</Text>;
      })}
    </View>
  );
};

const EnquirySummaryCard = ({ formData = {}, user, getUserName, onChatPress, showChat, existingImagesCount }) => {
  const isClient = isEnquiryClientUser(user);

  const data = {
    // Prioritize Remarks if it has better formatting (like the \n splits), otherwise fallback to Summary
    summaryText: formData.Remarks || formData.remarks || formData.Summary || formData.summary || formData.description,
    title: formData.Name || formData.title || formData.Title,
    clientName: formData.ClientName || formData.clientName,
    category: formData.Category || formData.category,
    status: formData.CurrentStatus || formData.status || formData.Status,
    priority: formData.Priority || formData.priority,
    quantity: formData.Quantity || formData.quantity,
    deadline: formData.ShippingDate || formData.deadline || formData.CreatedDate,
    styleNumber: formData.StyleNumber || formData.styleNumber,
    gatiOrder: formData.GatiOrderNumber || formData.gatiOrderNumber,
    stamping: formData.Stamping || formData.stamping,
    stoneType: formData.StoneType || formData.stoneType,
    metalColor: formData.MetalColor || formData.metalColor,
    metalQuality: formData.MetalQuality || formData.metalQuality,
    budget: formData.Budget || formData.budget,
    assignedTo: formData.AssignedTo || formData.assignedTo,
    assignedToName: formData.AssignedToName || formData.assignedToName,
    approvedDate: formData.ApprovedDate || formData.approvedDate,
  };

  const assignedLabel = data.assignedToName || (getUserName && data.assignedTo ? getUserName(data.assignedTo) : null) || (data.assignedTo ? String(data.assignedTo) : null);
  const priorityDisplay = data.priority ? `${data.priority.charAt(0).toUpperCase()}${data.priority.slice(1)}` : '—';
  const metalLine = [data.metalColor, data.metalQuality].filter(Boolean).join(' · ');

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <View style={styles.iconBadge}>
            <IconComponent name="assignment" size={24} color={colors.primary} />
          </View>
          <View style={styles.cardTitleTextWrap}>
            <Text style={styles.cardTitle}>Enquiry Summary</Text>
            <Text style={styles.cardSubtitle}>Review details before uploading files</Text>
          </View>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Main Prose / Summary Data */}
      {data.summaryText ? (
        <View style={styles.sectionContainer}>
          <SectionHeader title="Design Specifications" icon="description" />
          <FormattedSummary text={data.summaryText} />
        </View>
      ) : null}

      {/* Overview */}
      <View style={styles.sectionGroup}>
        <SectionHeader title="Overview" icon="person" />
        <FieldBlock label="Piece Name" value={dash(data.title)} />
        <FieldPair
          left={<FieldBlock label="Client" value={dash(data.clientName)} />}
          right={<FieldBlock label="Category" value={dash(data.category)} />}
        />
        <FieldPair
          left={
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Status</Text>
              <Pill text={dash(data.status)} variant="primary" />
            </View>
          }
          right={
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Priority</Text>
              <Pill text={priorityDisplay} variant="accent" />
            </View>
          }
        />
        {!isClient && <FieldBlock label="Assigned To" value={dash(assignedLabel)} />}
      </View>

      {/* Product & Logistics */}
      <View style={styles.sectionGroup}>
        <SectionHeader title="Product & Logistics" icon="category" />
        <FieldPair
          left={<FieldBlock label="Quantity" value={dash(data.quantity)} />}
          right={<FieldBlock label="Shipping Date" value={formatDateSafe(data.deadline)} />}
        />
        <FieldPair
          left={<FieldBlock label="Style Number" value={dash(data.styleNumber)} />}
          right={<FieldBlock label="Gati Order No." value={dash(data.gatiOrder)} />}
        />
        <FieldBlock label="Stamping" value={dash(data.stamping)} />
      </View>

      {/* Materials */}
      <View style={styles.sectionGroup}>
        <SectionHeader title="Materials" icon="star" />
        <FieldBlock label="Stone Type" value={dash(data.stoneType)} />
        <FieldBlock label="Metal" value={metalLine ? metalLine : '—'} />
        <FieldPair
          left={<FieldBlock label="Metal Weight" value={formatWeightBlock(data.metalWeightFrom, data.metalWeightTo, data.metalWeightExact)} />}
          right={<FieldBlock label="Diamond Weight" value={formatWeightBlock(data.diamondWeightFrom, data.diamondWeightTo, data.diamondWeightExact)} />}
        />
      </View>

      {/* Commercial */}
      <View style={styles.sectionGroup}>
        <SectionHeader title="Commercial" icon="attach-money" />
        <FieldPair 
          left={<FieldBlock label="Budget" value={dash(data.budget)} />}
          right={!isClient && data.approvedDate ? <FieldBlock label="Approved Date" value={formatDateSafe(data.approvedDate)} /> : null}
        />
      </View>

      {/* Media Attachments */}
      {typeof existingImagesCount === 'number' && (
        <View style={styles.mediaRow}>
          <IconComponent name="photo-library" size={20} color={colors.primary} />
          <Text style={styles.mediaRowText}>
            Existing reference files: <Text style={styles.mediaRowCount}>{existingImagesCount}</Text>
          </Text>
        </View>
      )}

      {/* Action Area */}
      {showChat && onChatPress && (
        <EnquiryChatCta user={user} onPress={onChatPress} visible embedded />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, marginBottom: 16, padding: 20, backgroundColor: colors.background, borderRadius: 16, borderWidth: 1, borderColor: colors.borderLight, shadowColor: colors.cardShadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 5 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  iconBadge: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primaryExtraLight, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  cardTitleTextWrap: { flex: 1, justifyContent: 'center' },
  cardTitle: { fontSize: fonts.xl, fontFamily: fonts.bold, color: colors.textPrimary, letterSpacing: -0.3, marginBottom: 2 },
  cardSubtitle: { fontSize: fonts.sm, fontFamily: fonts.regular, color: colors.textSecondary },
  divider: { height: 1, backgroundColor: colors.borderLight, marginVertical: 20, opacity: 0.7 },
  
  sectionContainer: { marginBottom: 24 },
  sectionGroup: { marginBottom: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.borderLight, borderBottomStyle: 'dashed' },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sectionHeaderIconWrap: { marginRight: 10, backgroundColor: colors.backgroundSecondary, padding: 6, borderRadius: 8 },
  sectionHeaderText: { fontSize: fonts.base, fontFamily: fonts.bold, color: colors.textPrimary, letterSpacing: 0.5 },
  
  // Custom Summary Text Area
  summaryBox: { backgroundColor: colors.backgroundSecondary || '#F8FAFC', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.borderLight },
  summaryLine: { fontSize: fonts.sm, color: colors.textPrimary, lineHeight: 22, marginBottom: 6 },
  summaryLineKey: { fontFamily: fonts.bold, color: colors.textSecondary },
  summaryLineValue: { fontFamily: fonts.medium, color: colors.textPrimary },

  fieldBlock: { marginBottom: 16 },
  fieldLabel: { fontSize: fonts.xs, fontFamily: fonts.medium, color: colors.textSecondary, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' },
  fieldValue: { fontSize: fonts.base, fontFamily: fonts.medium, color: colors.textPrimary, lineHeight: 22 },
  fieldValueMultiline: { fontStyle: 'normal', color: colors.textSecondary, fontFamily: fonts.regular },
  
  pairRow: { flexDirection: 'row', alignItems: 'flex-start' },
  pairHalf: { flex: 1 },
  pairHalfLeft: { paddingRight: 8 },
  pairHalfRight: { paddingLeft: 8 },
  
  pill: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, borderWidth: 1, maxWidth: '100%' },
  pillPrimary: { backgroundColor: colors.primaryExtraLight, borderColor: colors.primaryLight },
  pillAccent: { backgroundColor: '#FFF4E5', borderColor: '#FFDDB3' }, // Warm tone for priority
  pillText: { fontSize: fonts.sm, fontFamily: fonts.bold },
  pillTextOnPrimary: { color: colors.primary },
  pillTextAccent: { color: '#C26A00' },
  
  mediaRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, backgroundColor: colors.primaryExtraLight, borderRadius: 12, marginTop: 8 },
  mediaRowText: { marginLeft: 12, fontSize: fonts.sm, fontFamily: fonts.medium, color: colors.textPrimary, flex: 1 },
  mediaRowCount: { fontFamily: fonts.bold, color: colors.primary, fontSize: fonts.base },
});

export default EnquirySummaryCard;