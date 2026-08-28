/**
 * approvalParse
 *
 * Frontend-only configuration and transformations for the Approval Desk flow.
 * This file must NOT: call the API, contain any AI logic, update the enquiry,
 * or decide Coral/CAD versions.
 */

// [field, label] — ordered the way the review table renders them.
export const APPROVAL_FIELDS = [
  ['deliveryDate', 'Delivery date'],
  ['priority', 'Priority'],
  ['metal', 'Metal'],
  ['colour', 'Metal colour'],
  ['stoneType', 'Stone type'],
  ['diamondQuality', 'Diamond quality'],
  ['centreStone', 'Centre stone'],
  ['colourStone', 'Colour stone'],
  ['budget', 'Budget'],
  ['weightRange', 'Weight range'],
  ['maxWeight', 'Max weight'],
  ['size', 'Size'],
  ['designChange', 'Design change'],
  ['findings', 'Findings'],
  ['engraving', 'Engraving'],
  ['finish', 'Finish'],
  ['specialRemarks', 'Special remarks'],
];

export const FIELD_LABELS = Object.fromEntries(APPROVAL_FIELDS);
export const FIELD_ORDER = APPROVAL_FIELDS.map(f => f[0]);

// [checklistKey, label, linkedField] — the workshop's ChecklistSchema, key for key.
export const CHECKLIST_FIELDS = [
  ['Engraving', 'Engraving', 'engraving'],
  ['SizeLength', 'Length', 'size'],
  ['SizeRingSize', 'Ring size', 'size'],
  ['DimensionsThickness', 'Dimensions / thickness', 'designChange'],
  ['DeliveryDate', 'Delivery date', 'deliveryDate'],
  ['EnamelPaintwork', 'Enamel / paintwork', 'finish'],
  ['RhodiumInstructions', 'Rhodium', 'finish'],
  ['Components', 'Components', 'designChange'],
  ['Findings', 'Findings', 'findings'],
];

export const CHECKLIST_KEYS = CHECKLIST_FIELDS.map(c => c[0]);

export const UNSPECIFIED = 'Not specified — client did not say';

export const APPROVAL_STEPS = {
  MESSAGE: 'message',
  PARSING: 'parsing',
  REVIEW: 'review',
  REPARSING: 'reparsing',
  SUBMITTING: 'submitting',
  MANUAL: 'manual',
  DONE: 'done',
};

/**
 * Builds the parser context. Quote values come from the selected pricing
 * entry first, then fall back to the enquiry-level metal data so the
 * backend always receives the current metal even when the quotation
 * entry carries none.
 */
export const getApprovalContext = (enquiry, selectedQuotation) => {
  const src = enquiry?._originalData || enquiry || {};
  const enquiryMetal =
    enquiry?.Metal || src?.Metal || {};

  let weight = '';
  if (selectedQuotation?.metalWeight != null) {
    weight = `${selectedQuotation.metalWeight} g`;
  } else {
    const enquiryWeight =
      enquiry?.MetalWeight ??
      src?.MetalWeight ??
      enquiry?.metalWeight ??
      src?.metalWeight;
    if (enquiryWeight != null && String(enquiryWeight).trim() !== '') {
      weight = `${enquiryWeight} g`;
    }
  }

  return {
    id:
      enquiry?._id ||
      enquiry?.Id ||
      enquiry?.id ||
      src?._id ||
      '',

    quote: {
      metal:
        selectedQuotation?.quality ||
        enquiryMetal?.Quality ||
        enquiryMetal?.quality ||
        src?.MetalQuality ||
        '',

      stoneType:
        selectedQuotation?.stoneTypes?.join(' + ') ||
        enquiry?.StoneType ||
        src?.StoneType ||
        '',

      weight,
    },
  };
};

/**
 * Ordered list of parsed field keys that carry a visible value,
 * excluding bookkeeping keys (decision/reason) and specialRemarks
 * (the modal renders that row separately).
 */
export function getVisibleFields(record) {
  if (!record || typeof record !== 'object') return [];
  return FIELD_ORDER.filter(
    k =>
      k !== 'specialRemarks' &&
      record[k] !== undefined &&
      record[k] !== null &&
      String(record[k]).trim() !== '',
  );
}

/** Marks a field as client-did-not-say. Mutates and returns the record. */
export function markFieldUnspecified(record, field) {
  if (!record || !field) return record;
  if (!FIELD_ORDER.includes(field)) return record;
  const current = record[field];
  if (current === undefined || current === null || String(current).trim() === '') {
    record[field] = UNSPECIFIED;
  }
  if (!record._unspecified) record._unspecified = [];
  if (!record._unspecified.includes(field)) record._unspecified.push(field);
  return record;
}

/**
 * Builds the workshop checklist object. Untouched keys come out 'NA'.
 * A field flagged unspecified still lands on its checklist line so the
 * designer can see the client raised it without pinning it down.
 */
export function buildApprovalChecklist(checklist, unspecified) {
  const source = checklist && typeof checklist === 'object' ? checklist : {};
  const unspecList = Array.isArray(unspecified) ? unspecified : [];
  const out = {};
  CHECKLIST_FIELDS.forEach(([key, , field]) => {
    const val = String(source[key] ?? '').trim();
    if (val && val.toUpperCase() !== 'NA') {
      out[key] = val;
    } else if (unspecList.includes(field)) {
      out[key] = UNSPECIFIED;
    } else {
      out[key] = 'NA';
    }
  });
  return out;
}

/**
 * Serializes the reviewed record into a single readable instruction string —
 * the text that travels into ApprovalRemarks / ReasonForRejection.
 */
export function serializeApprovalRecord({ mode, record, checklist, unspecified, message }) {
  const rec = record && typeof record === 'object' ? record : {};
  const unspecList = Array.isArray(unspecified)
    ? unspecified
    : Array.isArray(rec._unspecified)
      ? rec._unspecified
      : [];

  const lines = [];
  const clientMessage = String(message ?? '').trim();

  // Reject/redo carries only the client's own words — no structured
  // breakdown, checklist, or decision header.
  if (mode === 'reject') {
    if (clientMessage) return clientMessage;
    if (rec.reason && String(rec.reason).trim()) return String(rec.reason).trim();
    return 'Redo';
  }

  lines.push(`Decision: ${rec.decision || 'Approved'}`);
  lines.push(`Client said: ${clientMessage}`);

  getVisibleFields(rec).forEach(k => {
    const isUnspec = unspecList.includes(k);
    lines.push(
      `${FIELD_LABELS[k]}: ${String(rec[k]).trim()}${isUnspec ? ' (client did not say)' : ''}`,
    );
  });

  if (rec.specialRemarks && String(rec.specialRemarks).trim()) {
    lines.push(`Special remarks (must not be missed): ${String(rec.specialRemarks).trim()}`);
  }

  const cl = buildApprovalChecklist(checklist ?? rec._checklist, unspecList);
  const filled = CHECKLIST_FIELDS.filter(([key]) => cl[key] !== 'NA');
  if (filled.length) {
    lines.push('Checklist:');
    filled.forEach(([key, label]) => lines.push(`  - ${label}: ${cl[key]}`));
  }

  return lines.join('\n');
}
