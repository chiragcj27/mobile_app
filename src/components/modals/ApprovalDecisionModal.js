import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import Icon from '../common/Icon';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import useApprovalParse from '../../hooks/useApprovalParse';
import {
  APPROVAL_STEPS,
  FIELD_LABELS,
  getVisibleFields,
} from '../../utils/approvalParse';
import { useSavePricingMutation } from '../../store/api';

const { MESSAGE, PARSING, REVIEW, REPARSING, DONE } = APPROVAL_STEPS;

/** Builds an rgba() tint from a palette hex so every colour stays tied to colors.js. */
const withAlpha = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

// Semantic mapping on the shared palette
const ACCENT_APPROVE = colors.primary; // teal — brand action colour
const ACCENT_REJECT = colors.error;
const WARN_SOFT = withAlpha(colors.warning, 0.14);
const WARN_LINE = withAlpha(colors.warning, 0.4);
const WARN_DEEP = colors.secondary; // brown — readable warn text
const ERROR_SOFT = withAlpha(colors.error, 0.08);
const ERROR_LINE = withAlpha(colors.error, 0.3);
const SUCCESS_SOFT = withAlpha(colors.success, 0.1);
const SUCCESS_LINE = withAlpha(colors.success, 0.35);
const GOLD_SOFT = withAlpha(colors.accent, 0.12);
const GOLD_LINE = withAlpha(colors.accent, 0.4);

/**
 * ApprovalDecisionModal — the Approval Desk bottom sheet.
 *
 * Props:
 *   visible   — whether the sheet is open
 *   mode      — 'approve' | 'reject'
 *   enquiry   — current full enquiry
 *   onClose   — close and clear temporary parsing state
 *   onConfirm — receives { record, checklist, unspecified, instruction }
 *
 * The modal performs NO final enquiry mutations — it may only call the
 * parsing mutation (via useApprovalParse). The caller executes the actual
 * Accept/Reject updates.
 */
const ApprovalDecisionModal = ({ visible, mode = 'approve', enquiry, onClose, onConfirm }) => {
  const ap = useApprovalParse({ enquiry, mode });
  const isReject = mode === 'reject';
  const accent = isReject ? ACCENT_REJECT : ACCENT_APPROVE;
  const actionLabel = isReject ? 'Redo' : 'Approve';
  const footerLabel = isReject ? 'Send for redo' : 'Send forward';

  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [quotationPickerVisible, setQuotationPickerVisible] = useState(false);
  const [savePricing, { isLoading: isSavingPricing }] = useSavePricingMutation();

  const quotationData = useMemo(() => {
    const versions = [
      ...(Array.isArray(enquiry?.Cad)
        ? enquiry.Cad.map(version => ({
            ...version,
            _type: 'cad',
          }))
        : []),

      ...(Array.isArray(enquiry?.Coral)
        ? enquiry.Coral.map(version => ({
            ...version,
            _type: 'coral',
          }))
        : []),
    ];

    versions.sort(
      (a, b) =>
        new Date(b.CreatedDate || 0) -
        new Date(a.CreatedDate || 0),
    );

    const latestDesign = versions.find(
      version =>
        Array.isArray(version?.Pricing) &&
        version.Pricing.length > 0,
    );

    if (!latestDesign) {
      return {
        latestDesign: null,
        pricing: [],
        options: [],
        initialIndex: null,
      };
    }

    const pricing = latestDesign.Pricing;

    const options = pricing.map(
      (entry, entryIndex) => {
        const quality = String(
          entry?.Metal?.Quality || '',
        ).trim();

        const stoneTypes = [
          ...new Set(
            (Array.isArray(entry?.Stones)
              ? entry.Stones
              : []
            )
              .map(stone =>
                String(stone?.Type || '').trim(),
              )
              .filter(Boolean),
          ),
        ];

        const metalWeight =
          entry?.Metal?.Weight != null
            ? Number(entry.Metal.Weight)
            : null;

        return {
          entryIndex,
          quality,
          stoneTypes,
          metalWeight,

          isSentForApproaval:
            entry?.IsSentForApproaval === true,

          label: `${quality || 'No quality'} · ${
            stoneTypes.length
              ? stoneTypes.join(' + ')
              : 'Metal only'
          }`,
        };
      },
    );

    return {
      latestDesign,
      pricing,
      options,

      initialIndex:
        options.find(
          option => option.isSentForApproaval,
        )?.entryIndex ?? null,
    };
  }, [enquiry]);

  useEffect(() => {
    if (!visible) return;

    const existing =
      quotationData.options.find(
        option =>
          option.entryIndex ===
          quotationData.initialIndex,
      );

    setSelectedQuotation(
      existing ||
        quotationData.options[0] ||
        null,
    );

    setQuotationPickerVisible(false);
  }, [visible, quotationData]);

  if (!visible) return null;

  const src = enquiry?._originalData || enquiry || {};
  const clientName = asText(src?.ClientName) || asText(src?.clientName) || asText(src?.Client) || asText(src?.client);
  const styleNo = asText(src?.StyleNumber) || asText(src?.styleNumber);
  const enquiryName = asText(src?.Name);
  const metalLine = [asText(src?.MetalQuality) || asText(src?.Metal), asText(src?.WeightRange) || asText(src?.Weight)]
    .filter(Boolean)
    .join(' · ');
  const stoneLine = asText(src?.StoneType);

  const handleFinalSend = async () => {
    if (!selectedQuotation) return;

    const shouldSaveQuotation =
      selectedQuotation.entryIndex !==
      quotationData.initialIndex;

    if (shouldSaveQuotation) {
      const latestDesign =
        quotationData.latestDesign;

      const enquiryId =
        enquiry?._id ||
        enquiry?.id ||
        enquiry?.Id;

      const pricingData =
        quotationData.pricing.map(
          (entry, index) => ({
            ...entry,
            IsSentForApproaval:
              index ===
              selectedQuotation.entryIndex,
          }),
        );

      await savePricing({
        enquiryId,
        designType: latestDesign._type,
        version: latestDesign.Version,
        pricingData,
        isOnlyMetalDesign:
          latestDesign.IsOnlyMetalDesign === true,
      }).unwrap();
    }

    const payload =
      ap.prepareFinalPayload();

    await onConfirm(payload);
    ap.markSubmitted();
  };

  // ── Done strip ────────────────────────────────────────────────────────────
  const renderDone = () => (
    <View style={s.doneWrap}>
      <View style={[s.doneBadge, { backgroundColor: isReject ? ERROR_SOFT : SUCCESS_SOFT }]}>
        <Icon name={isReject ? 'refresh' : 'check-circle'} size={26} color={accent} />
      </View>
      <Text style={s.doneTitle}>{isReject ? 'Sent for redo' : 'Sent forward'}</Text>
      <Text style={s.doneSub}>
        {enquiryName}
        {!!enquiryName && '\n'}
        The instruction is on file.
      </Text>
      <TouchableOpacity style={[s.cta, s.ctaDone]} onPress={onClose}>
        <Text style={s.ctaText}>Done</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Step 1: message ───────────────────────────────────────────────────────
  const renderMessage = () => (
    <>
      <ScrollView style={s.bodyScroll} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>PLEASE SELECT THE ACCEPTED QUOTATION FROM HERE</Text>
        <TouchableOpacity
          style={s.quotationSelector}
          disabled={quotationData.options.length === 0}
          onPress={() => setQuotationPickerVisible(true)}
          activeOpacity={0.8}
        >
          <Text style={s.quotationSelectorText} numberOfLines={1}>
            {selectedQuotation?.label || 'No quotation available'}
          </Text>
          {quotationData.options.length > 0 && (
            <Icon name="keyboard-arrow-down" size={20} color={colors.textSecondary} />
          )}
        </TouchableOpacity>

        <View style={s.scrollSpacer} />

        <Text style={s.label}>WHAT THE CLIENT WROTE</Text>
        <TextInput
          style={s.messageInput}
          placeholder={isReject ? 'What does he want done again?' : 'Paste or type it…'}
          placeholderTextColor={colors.textLight}
          value={ap.message}
          onChangeText={ap.setMessage}
          multiline
          textAlignVertical="top"
          autoFocus
        />
        {ap.error ? (
          <>
            <Text style={s.errorText}>Parsing failed — {ap.error}</Text>
            <View style={s.fallbackRow}>
              <TouchableOpacity style={[s.fallbackBtn, s.fallbackBtnPrimary]} onPress={() => ap.parseMessage(selectedQuotation)}>
                <Text style={s.fallbackBtnText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.fallbackBtn, s.fallbackBtnGhost]}
                onPress={ap.continueManually}
              >
                <Text style={[s.fallbackBtnText, { color: colors.textPrimary }]}>Continue Manually</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </ScrollView>
      <View style={s.footer}>
        <TouchableOpacity
          style={[s.cta, { backgroundColor: accent, opacity: !selectedQuotation || !ap.message.trim() ? 0.4 : 1 }]}
          disabled={!selectedQuotation || !ap.message.trim()}
          onPress={() => ap.parseMessage(selectedQuotation)}
        >
          <Text style={s.ctaText}>Read it</Text>
        </TouchableOpacity>
        <Text style={s.footerNote}>
          Nothing is filled in for you — anything missing gets asked.
        </Text>
      </View>
    </>
  );

  // ── Parsing loader ────────────────────────────────────────────────────────
  const renderLoading = () => (
    <View style={s.loaderWrap}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={s.loaderText}>
        {ap.step === REPARSING ? 'Reading it again with your answers…' : 'Reading the message…'}
      </Text>
    </View>
  );

  // ── Review step ───────────────────────────────────────────────────────────
  const renderReview = () => {
    const visibleFields = getVisibleFields(ap.record);
    const showSpecial =
      ap.record.specialRemarks && String(ap.record.specialRemarks).trim() !== '';
    const fieldCount = visibleFields.length + (showSpecial ? 1 : 0);

    return (
      <>
        <ScrollView style={s.bodyScroll} keyboardShouldPersistTaps="handled">
          <View style={s.selectedQuotationSummary}>
            <Text style={s.selectedQuotationLabel}>SELECTED QUOTATION</Text>
            <Text style={s.selectedQuotationValue}>{selectedQuotation?.label}</Text>
            {selectedQuotation?.metalWeight != null && (
              <Text style={s.selectedQuotationWeight}>
                Current metal weight: {selectedQuotation.metalWeight} g
              </Text>
            )}
          </View>

          <View style={s.saidBox}>
            <Text style={s.saidLabel}>CLIENT SAID</Text>
            <Text style={s.saidText}>{ap.sentMessage}</Text>
          </View>

          {ap.error ? <Text style={s.errorText}>{ap.error}</Text> : null}

          {!!ap.questions.length && (
            <View style={s.questionBox}>
              <Text style={s.questionBoxTitle}>
                {ap.questions.length} thing{ap.questions.length === 1 ? '' : 's'} the message did not
                say
              </Text>
              {ap.questions.map((q, i) => (
                <View key={`${q.field}-${i}`} style={s.questionItem}>
                  <View style={s.questionHead}>
                    <Text style={s.questionAsk}>{q.ask}</Text>
                    <View style={s.questionTag}>
                      <Text style={s.questionTagText}>{fieldLabel(q.field)}</Text>
                    </View>
                  </View>
                  <View style={s.questionRow}>
                    <TextInput
                      style={s.questionInput}
                      placeholder="Your answer…"
                      placeholderTextColor={colors.textLight}
                      value={q.answer}
                      onChangeText={t => ap.setQuestionAnswer(i, t)}
                    />
                    <TouchableOpacity onPress={() => ap.skipQuestion(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={s.skipText}>skip</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <TouchableOpacity
                style={s.useAnswersBtn}
                onPress={() => ap.submitAnswers(selectedQuotation)}
              >
                <Text style={s.useAnswersText}>Use my answers</Text>
              </TouchableOpacity>
              <Text style={s.questionNote}>
                Skipped or left blank is fine — the field still goes to the designer, marked not
                specified.
              </Text>
            </View>
          )}

          <View style={s.tableHead}>
            <Text style={s.tableHeadTitle}>WHAT CHANGES</Text>
            <View style={s.tableCount}>
              <Text style={s.tableCountText}>
                {fieldCount} field{fieldCount === 1 ? '' : 's'}
              </Text>
            </View>
          </View>

          {!fieldCount ? (
            <View style={[s.noChangeBox, isReject && s.noChangeBoxReject]}>
              <Text style={[s.noChangeText, isReject && s.noChangeTextReject]}>
                {isReject
                  ? 'No details given — just redo it.'
                  : 'Nothing changes — approved as it is.'}
              </Text>
            </View>
          ) : (
            visibleFields.map(field => (
              <View
                key={field}
                style={[
                  s.fieldRow,
                  ap.unspecified.includes(field) && s.fieldRowUnspec,
                ]}
              >
                <View style={s.fieldKey}>
                  <Text style={s.fieldKeyText}>{fieldLabel(field)}</Text>
                  {ap.unspecified.includes(field) && (
                    <Text style={s.fieldKeyNote}>client did not say</Text>
                  )}
                </View>
                <TextInput
                  style={s.fieldValue}
                  value={String(ap.record[field])}
                  onChangeText={t => ap.updateField(field, t)}
                  multiline
                />
                <TouchableOpacity
                  style={s.fieldRemove}
                  onPress={() => ap.removeField(field)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="close" size={14} color={colors.textLight} />
                </TouchableOpacity>
              </View>
            ))
          )}

          {showSpecial && (
            <View style={[s.fieldRow, s.fieldRowSpecial]}>
              <View style={s.fieldKey}>
                <Text style={[s.fieldKeyText, { color: colors.primaryDark }]}>Special remarks</Text>
                <Text style={s.fieldKeyNote}>must not be missed</Text>
              </View>
              <TextInput
                style={s.fieldValue}
                value={String(ap.record.specialRemarks)}
                onChangeText={t => ap.updateField('specialRemarks', t)}
                multiline
              />
              <TouchableOpacity
                style={s.fieldRemove}
                onPress={() => ap.removeField('specialRemarks')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="close" size={14} color={colors.textLight} />
              </TouchableOpacity>
            </View>
          )}

          <View style={s.scrollSpacer} />
        </ScrollView>
        <View style={s.footer}>
          <TouchableOpacity
            style={[s.cta, { backgroundColor: accent, opacity: !selectedQuotation || isSavingPricing ? 0.4 : 1 }]}
            disabled={!selectedQuotation || isSavingPricing}
            onPress={handleFinalSend}
          >
            {isSavingPricing ? (
              <ActivityIndicator size="small" color={colors.textWhite} />
            ) : (
              <Text style={s.ctaText}>{footerLabel}</Text>
            )}
          </TouchableOpacity>
          <Text style={[s.footerNote, ap.questions.length > 0 && s.footerNoteWarn]}>
            {ap.questions.length
              ? `${ap.questions.length} still open—send now and they go forward as not specified.`
              : isReject
                ? 'Goes back to the designer with the reason on file.'
                : 'Posts the approval, writes the CAD instruction, releases the order.'}
          </Text>
        </View>
      </>
    );
  };

  // ── Manual fallback ───────────────────────────────────────────────────────
  const renderManual = () => (
    <>
      <ScrollView style={s.bodyScroll} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>FINAL INSTRUCTION</Text>
        <Text style={s.manualHint}>
          Write the instruction yourself — it goes to the designer exactly as typed.
        </Text>
        <TextInput
          style={[s.messageInput, s.manualInput]}
          placeholder={
            isReject
              ? 'Why does this go back, and what should change?'
              : 'What changes for the workshop?'
          }
          placeholderTextColor={colors.textLight}
          value={ap.instruction}
          onChangeText={ap.setInstruction}
          multiline
          textAlignVertical="top"
        />
      </ScrollView>
      <View style={s.footer}>
        <TouchableOpacity
          style={[s.cta, { backgroundColor: accent, opacity: isSavingPricing ? 0.4 : 1 }]}
          disabled={isSavingPricing}
          onPress={handleFinalSend}
        >
          {isSavingPricing ? (
            <ActivityIndicator size="small" color={colors.textWhite} />
          ) : (
            <Text style={s.ctaText}>{footerLabel}</Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.overlay}>
        <View style={s.sheet}>
          {/* header strip */}
          <View style={s.strip}>
            <View style={[s.stripTag, { backgroundColor: accent }]}>
              <Text style={s.stripTagText}>{actionLabel}</Text>
            </View>
            <Text style={s.stripTitle}>
              {ap.step === MESSAGE || ap.step === PARSING
                ? 'Client reply'
                : ap.isManual
                  ? 'Manual instruction'
                  : 'What changes'}
            </Text>
            <TouchableOpacity style={s.closeBtn} onPress={onClose}>
              <Icon name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* enquiry context */}
          <View style={s.context}>
            <View style={s.ctxMain}>
              <Text style={s.ctxName} numberOfLines={1}>{enquiryName}</Text>
              <Text style={s.ctxSub} numberOfLines={1}>
                {[clientName, styleNo].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {!!metalLine && (
              <View style={s.ctxQuote}>
                <Text style={s.ctxQuoteText}>
                  {metalLine}
                  {!!stoneLine ? `\n${stoneLine}` : ''}
                </Text>
              </View>
            )}
          </View>

          {ap.step === DONE
            ? renderDone()
            : ap.step === PARSING || ap.step === REPARSING
              ? renderLoading()
              : ap.step === REVIEW
                ? renderReview()
                : ap.isManual
                  ? renderManual()
                  : renderMessage()}
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={quotationPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setQuotationPickerVisible(false)}
      >
        <TouchableOpacity
          style={s.pickerOverlay}
          activeOpacity={1}
          onPress={() => setQuotationPickerVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={s.pickerSheet}>
            <Text style={s.pickerTitle}>Please select the accepted quotation from here</Text>

            {quotationData.options.map(option => {
              const isSelected =
                selectedQuotation?.entryIndex === option.entryIndex;

              return (
                <TouchableOpacity
                  key={option.entryIndex}
                  style={[
                    s.pickerOption,
                    isSelected && s.pickerOptionSelected,
                  ]}
                  onPress={() => {
                    setSelectedQuotation(option);
                    setQuotationPickerVisible(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      s.pickerOptionText,
                      isSelected && s.pickerOptionTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>

                  {isSelected && (
                    <Icon name="check" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </Modal>
  );
};

function fieldLabel(field) {
  return FIELD_LABELS[field] || field;
}

/** Some enquiry fields arrive as populated objects ({Name: …}) — unwrap to plain text. */
function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const nested =
      value.Name || value.name || value.Value || value.value || value.label || value.Label;
    if (nested !== undefined && typeof nested !== 'object') return String(nested).trim();
    return '';
  }
  return '';
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.modalOverlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.backgroundSecondary,
  },
  stripTag: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  stripTagText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.textWhite,
    textTransform: 'uppercase',
  },
  stripTitle: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.textSecondary,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  context: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.backgroundSecondary,
  },
  ctxMain: { flex: 1 },
  ctxName: { fontFamily: fonts.medium, fontSize: 15, color: colors.textPrimary },
  ctxSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.textSecondary, marginTop: 1 },
  ctxQuote: {
    backgroundColor: GOLD_SOFT,
    borderColor: GOLD_LINE,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  ctxQuoteText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 14,
    color: WARN_DEEP,
    textAlign: 'right',
  },
  bodyScroll: {
    paddingHorizontal: 18,
    paddingTop: 14,
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollSpacer: { height: 10 },
  quotationSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GOLD_SOFT,
    borderColor: GOLD_LINE,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  quotationSelectorText: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 14.5,
    color: colors.primaryDark,
  },
  selectedQuotationSummary: {
    backgroundColor: GOLD_SOFT,
    borderColor: GOLD_LINE,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
    marginBottom: 10,
  },
  selectedQuotationLabel: {
    fontFamily: fonts.medium,
    fontSize: 9.5,
    letterSpacing: 1,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  selectedQuotationValue: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.primaryDark,
  },
  selectedQuotationWeight: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: WARN_DEEP,
    marginTop: 3,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: colors.modalOverlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  pickerSheet: {
    width: '100%',
    maxHeight: '70%',
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 16,
  },
  pickerTitle: {
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 12,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    marginBottom: 8,
  },
  pickerOptionSelected: {
    backgroundColor: colors.primaryExtraLight,
    borderColor: colors.primary,
  },
  pickerOptionText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  pickerOptionTextSelected: {
    color: colors.primary,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  manualHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 10,
    lineHeight: 19,
  },
  manualInput: { minHeight: 160 },
  messageInput: {
    minHeight: 100,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 10,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    color: colors.error,
    backgroundColor: ERROR_SOFT,
    borderColor: ERROR_LINE,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  fallbackRow: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 10,
  },
  fallbackBtn: {
    flex: 1,
    borderRadius: 11,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackBtnPrimary: {
    backgroundColor: colors.primary,
  },
  fallbackBtnGhost: {
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  fallbackBtnText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.textWhite,
  },
  loaderWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 60,
  },
  loaderText: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary },
  saidBox: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  saidLabel: {
    fontFamily: fonts.medium,
    fontSize: 9.5,
    letterSpacing: 1,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  saidText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  questionBox: {
    backgroundColor: WARN_SOFT,
    borderColor: WARN_LINE,
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
    marginTop: 14,
  },
  questionBoxTitle: {
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: WARN_DEEP,
    marginBottom: 10,
  },
  questionItem: { marginBottom: 11 },
  questionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 7,
  },
  questionAsk: {
    flexShrink: 1,
    fontFamily: fonts.medium,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  questionTag: {
    backgroundColor: WARN_SOFT,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  questionTagText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: WARN_DEEP,
  },
  questionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  questionInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderColor: WARN_LINE,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.textPrimary,
  },
  skipText: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.textSecondary },
  useAnswersBtn: {
    backgroundColor: WARN_DEEP,
    borderRadius: 11,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 3,
  },
  useAnswersText: { fontFamily: fonts.medium, fontSize: 14.5, color: colors.textWhite },
  questionNote: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    lineHeight: 16,
    color: WARN_DEEP,
    textAlign: 'center',
    marginTop: 8,
  },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    marginBottom: 9,
  },
  tableHeadTitle: {
    fontFamily: fonts.medium,
    fontSize: 10.5,
    letterSpacing: 1,
    color: colors.textSecondary,
  },
  tableCount: {
    marginLeft: 'auto',
    backgroundColor: colors.primaryExtraLight,
    borderColor: colors.primaryExtraLight,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tableCountText: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.primary },
  noChangeBox: {
    backgroundColor: SUCCESS_SOFT,
    borderColor: SUCCESS_LINE,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  noChangeBoxReject: {
    backgroundColor: ERROR_SOFT,
    borderColor: ERROR_LINE,
  },
  noChangeText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.success,
    textAlign: 'center',
  },
  noChangeTextReject: {
    color: colors.error,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  fieldRowUnspec: { backgroundColor: WARN_SOFT },
  fieldRowSpecial: { backgroundColor: colors.primaryExtraLight, borderBottomWidth: 0, marginTop: 2 },
  fieldKey: {
    width: 128,
    backgroundColor: colors.backgroundSecondary,
    borderRightWidth: 1,
    borderRightColor: colors.borderLight,
    alignSelf: 'stretch',
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  fieldKeyText: { fontFamily: fonts.medium, fontSize: 12, color: colors.textPrimary },
  fieldKeyNote: {
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: WARN_DEEP,
    marginTop: 3,
  },
  fieldValue: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontFamily: fonts.regular,
    fontSize: 14.5,
    color: colors.textPrimary,
    minHeight: 44,
  },
  fieldRemove: { padding: 10 },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 13,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  cta: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaDone: { alignSelf: 'stretch' },
  ctaText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.textWhite,
  },
  footerNote: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    color: colors.textLight,
    textAlign: 'center',
    marginTop: 9,
  },
  footerNoteWarn: { color: WARN_DEEP, fontFamily: fonts.medium },
  doneWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  doneBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  doneTitle: { fontFamily: fonts.bold, fontSize: 21, color: colors.textPrimary, marginBottom: 7 },
  doneSub: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 22,
  },
});

export default ApprovalDecisionModal;
