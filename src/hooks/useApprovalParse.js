import { useCallback, useMemo, useState } from 'react';
import { useParseApprovalEnquiryMutation } from '../store/api';
import {
  APPROVAL_STEPS,
  CHECKLIST_FIELDS,
  FIELD_ORDER,
  UNSPECIFIED,
  getApprovalContext,
  markFieldUnspecified,
  serializeApprovalRecord,
} from '../utils/approvalParse';

const { MESSAGE, PARSING, REVIEW, REPARSING, MANUAL, DONE } = APPROVAL_STEPS;

const INITIAL = {
  step: MESSAGE,
  message: '',
  sentMessage: '',
  record: {},
  checklist: {},
  questions: [],
  unspecified: [],
  isManual: false,
  instruction: '',
  error: null,
};

const hasValue = v => v !== undefined && v !== null && String(v).trim() !== '';

/** Normalizes a raw parser response into {record, checklist, questions, unspecified}. */
function applyParsed(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const qs = Array.isArray(v.questions) ? v.questions : [];
  const cl = v.checklist && typeof v.checklist === 'object' ? v.checklist : {};

  const rec = { ...v };
  delete rec.questions;
  delete rec.checklist;
  delete rec._unspecified;

  Object.keys(rec).forEach(k => {
    if (k === 'decision' || k === 'reason') return;
    if (!FIELD_ORDER.includes(k)) {
      delete rec[k];
      return;
    }
    if (!hasValue(rec[k])) delete rec[k];
  });

  const checklist = {};
  CHECKLIST_FIELDS.forEach(([key]) => {
    const val = String(cl[key] ?? '').trim();
    if (val && val.toUpperCase() !== 'NA') checklist[key] = val;
  });

  const questions = qs
    .filter(q => q && q.ask && q.field !== 'decision' && q.field !== 'reason' && FIELD_ORDER.includes(q.field))
    .map(q => ({ field: q.field, ask: String(q.ask), answer: '' }));

  // Asking about a field IS saying the client raised it — it goes into the
  // record straight away, marked unspecified, whether it gets answered or not.
  const unspecified = [];
  questions.forEach(q => {
    if (!unspecified.includes(q.field)) unspecified.push(q.field);
    if (!hasValue(rec[q.field])) rec[q.field] = UNSPECIFIED;
  });

  return { record: rec, checklist, questions, unspecified };
}

/**
 * Controls the complete Approval Desk workflow:
 * message → first parse → (questions → answers → second parse) →
 * editable review → serialized final payload.
 */
export function useApprovalParse({ enquiry, mode }) {
  const [state, setState] = useState(INITIAL);
  const [parseApprovalEnquiry] = useParseApprovalEnquiryMutation();

  const patch = useCallback(updates => setState(prev => ({ ...prev, ...updates })), []);

  const setMessage = useCallback(text => patch({ message: text }), [patch]);

  const reset = useCallback(() => setState(INITIAL), []);

  /** First pass — parse the pasted client reply. */
  const parseMessage = useCallback(async selectedQuotation => {
    const text = state.message.trim();
    if (!text) {
      patch({ error: 'Type what the client said first.' });
      return false;
    }
    if (!selectedQuotation) {
      patch({ error: 'Please select the accepted quotation.' });
      return false;
    }
    patch({ error: null, step: PARSING });
    try {
      const response = await parseApprovalEnquiry({
        enquiry: getApprovalContext(enquiry, selectedQuotation),
        mode,
        message: text,
        previous: null,
        answers: [],
      }).unwrap();
      const parsed = applyParsed(response);
      patch({ sentMessage: text, step: REVIEW, ...parsed });
      return true;
    } catch (e) {
      patch({
        step: MESSAGE,
        error:
          e?.message ||
          e?.data?.message ||
          e?.error ||
          'Could not read the client message.',
      });
      return false;
    }
  }, [state.message, enquiry, mode, parseApprovalEnquiry, patch]);

  const setQuestionAnswer = useCallback(
    (index, value) =>
      setState(prev => {
        const next = prev.questions.map((q, i) =>
          i === index ? { ...q, answer: value } : q,
        );
        return { ...prev, questions: next };
      }),
    [],
  );

  /** Skip keeps the field on the record but marks it not-specified. */
  const skipQuestion = useCallback(
    index =>
      setState(prev => {
        const q = prev.questions[index];
        if (!q) return prev;
        const record = markFieldUnspecified({ ...prev.record }, q.field);
        const unspecified = prev.unspecified.includes(q.field)
          ? prev.unspecified
          : [...prev.unspecified, q.field];
        return {
          ...prev,
          record: { ...record, _unspecified: unspecified },
          unspecified,
          questions: prev.questions.filter((_, i) => i !== index),
        };
      }),
    [],
  );

  /**
   * Second pass — only answered questions trigger a reparse; blank ones are
   * marked unspecified. A parsing error preserves all current data.
   */
  const submitAnswers = useCallback(async selectedQuotation => {
    const answered = state.questions.filter(q => hasValue(q.answer));
    if (!answered.length) {
      // Nothing answered — just close the question box, record already holds
      // every field as unspecified.
      patch({ questions: [] });
      return true;
    }
    if (!selectedQuotation) {
      patch({ error: 'Please select the accepted quotation.' });
      return false;
    }
    patch({ step: REPARSING });
    try {
      const response = await parseApprovalEnquiry({
        enquiry: getApprovalContext(enquiry, selectedQuotation),
        mode,
        message: state.sentMessage,
        previous: { ...state.record, checklist: state.checklist },
        answers: answered.map(q => ({
          field: q.field,
          ask: q.ask,
          answer: q.answer.trim(),
        })),
      }).unwrap();
      const parsed = applyParsed(response);

      setState(prev => {
        // Blank/skipped answers still stand — never quietly dropped.
        const mergedUnspec = [...parsed.unspecified];
        prev.unspecified.forEach(f => {
          if (!mergedUnspec.includes(f)) mergedUnspec.push(f);
          if (!hasValue(parsed.record[f])) parsed.record[f] = UNSPECIFIED;
        });
        return {
          ...prev,
          step: REVIEW,
          error: null,
          record: { ...parsed.record, _unspecified: mergedUnspec },
          checklist: { ...prev.checklist, ...parsed.checklist },
          questions: parsed.questions.length ? parsed.questions : [],
          unspecified: mergedUnspec,
        };
      });
      return true;
    } catch (e) {
      // Keep everything the user already had — fall back to the review step.
      patch({
        step: REVIEW,
        error: e?.message || e?.data?.message || e?.error || 'Could not re-read with your answers.',
      });
      return false;
    }
  }, [state.questions, state.sentMessage, state.record, state.checklist, enquiry, mode, parseApprovalEnquiry, patch]);

  const updateField = useCallback(
    (field, value) =>
      setState(prev => ({ ...prev, record: { ...prev.record, [field]: value } })),
    [],
  );

  const removeField = useCallback(
    field =>
      setState(prev => {
        const record = { ...prev.record };
        delete record[field];
        return { ...prev, record };
      }),
    [],
  );

  /** Manual fallback — handler types the final instruction themselves. */
  const continueManually = useCallback(
    () => patch({ step: MANUAL, isManual: true, error: null }),
    [patch],
  );

  const setInstruction = useCallback(text => patch({ instruction: text }), [patch]);

  /** Final reviewed payload handed back to the caller via onConfirm. */
  const prepareFinalPayload = useCallback(() => {
    // Any question left open goes forward as not specified.
    let record = { ...state.record };
    let unspecified = [...state.unspecified];
    state.questions.forEach(q => {
      if (!unspecified.includes(q.field)) unspecified.push(q.field);
      if (!hasValue(record[q.field])) record[q.field] = UNSPECIFIED;
    });
    record = { ...record, _unspecified: unspecified };

    const instruction =
      state.isManual && hasValue(state.instruction)
        ? state.instruction.trim()
        : serializeApprovalRecord({
            mode,
            record,
            checklist: state.checklist,
            unspecified,
            message: state.sentMessage,
          });

    return {
      record,
      checklist: state.checklist,
      unspecified,
      instruction,
    };
  }, [mode, state]);

  const markSubmitted = useCallback(() => patch({ step: DONE }), [patch]);

  const isLoading = useMemo(
    () => state.step === PARSING || state.step === REPARSING,
    [state.step],
  );

  return {
    ...state,
    isLoading,
    setMessage,
    parseMessage,
    setQuestionAnswer,
    skipQuestion,
    submitAnswers,
    updateField,
    removeField,
    continueManually,
    setInstruction,
    prepareFinalPayload,
    markSubmitted,
    reset,
  };
}

export default useApprovalParse;
