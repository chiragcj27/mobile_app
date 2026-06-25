import { useMemo } from 'react';
import {
  STATUS,
  SUBSTATUS,
  ACTION,
  DESIGN_TYPE,
  actionsFor,
  NEXT_STATE,
  resolveRoleCode,
} from '../constants/enquiry';

const ACTION_LABELS = {
  [ACTION.ASSIGN]: 'Assign',
  [ACTION.ASSIGN_CAD]: 'Assign CAD',
  [ACTION.UPLOAD_CORAL]: 'Upload Coral',
  [ACTION.UPLOAD_CAD]: 'Upload CAD',
  [ACTION.UPLOAD_FINAL_CAD]: 'Upload Final CAD',
  [ACTION.CHAT]: 'Chat',
  [ACTION.UPDATE_QUOTATION]: 'Update Quotation',
  [ACTION.REJECT_QUOTATION]: 'Reject',
  [ACTION.VIEW_QUOTATION]: 'View Quotation',
  [ACTION.MOVE_TO_APPROVAL]: 'Move to Approval Pending',
  [ACTION.ACCEPT_APPROVAL]: 'Accept',
  [ACTION.REJECT_APPROVAL]: 'Reject',
  [ACTION.FINAL_LOOK]: 'Final Look',
};

const ACTION_ICONS = {
  [ACTION.ASSIGN]: 'person-add',
  [ACTION.ASSIGN_CAD]: 'person-add',
  [ACTION.UPLOAD_CORAL]: 'cloud-upload',
  [ACTION.UPLOAD_CAD]: 'cloud-upload',
  [ACTION.UPLOAD_FINAL_CAD]: 'cloud-upload',
  [ACTION.CHAT]: 'chat',
  [ACTION.UPDATE_QUOTATION]: 'edit-note',
  [ACTION.REJECT_QUOTATION]: 'cancel',
  [ACTION.VIEW_QUOTATION]: 'picture-as-pdf',
  [ACTION.MOVE_TO_APPROVAL]: 'check-circle',
  [ACTION.ACCEPT_APPROVAL]: 'check-circle',
  [ACTION.REJECT_APPROVAL]: 'cancel',
  [ACTION.FINAL_LOOK]: 'visibility',
};

const ACTION_COLORS = {
  [ACTION.ASSIGN]: '#143F45',
  [ACTION.ASSIGN_CAD]: '#143F45',
  [ACTION.UPLOAD_CORAL]: '#143F45',
  [ACTION.UPLOAD_CAD]: '#143F45',
  [ACTION.UPLOAD_FINAL_CAD]: '#10B981',
  [ACTION.CHAT]: 'outline',
  [ACTION.UPDATE_QUOTATION]: '#F59E0B',
  [ACTION.REJECT_QUOTATION]: '#EF4444',
  [ACTION.VIEW_QUOTATION]: 'outline',
  [ACTION.MOVE_TO_APPROVAL]: '#059669',
  [ACTION.ACCEPT_APPROVAL]: '#059669',
  [ACTION.REJECT_APPROVAL]: '#EF4444',
  [ACTION.FINAL_LOOK]: 'outline',
};

export const useEnquiryFlowConfig = () => {
  const config = useMemo(() => ({
    ACTION_LABELS,
    ACTION_ICONS,
    ACTION_COLORS,
    STATUS,
    SUBSTATUS,
    ACTION,
    DESIGN_TYPE,
    NEXT_STATE,
  }), []);

  return config;
};

export const useEnquiryState = (enquiry) => {
  const status = enquiry?.CurrentStatus;
  const subStatus = enquiry?.CurrentSubStatus;

  const state = useMemo(() => {
    if (!enquiry) return null;
    return {
      status,
      subStatus,
      statusLower: (status || '').toLowerCase(),
      subStatusLower: (subStatus || '').toLowerCase(),
    };
  }, [enquiry, status, subStatus]);

  return state;
};

// useEnquiryFlow: Main flow resolver hook.
// Takes enquiry + user, returns available buttons, primary action, tab, modal phase, etc.
// Uses actionsFor() from constants/enquiry.js to determine what actions are available.
// Uses NEXT_STATE for state machine transitions.
// TODO: Redesign — this is the core flow resolution logic
export const useEnquiryFlow = (enquiry, user) => {
  const roleCode = useMemo(() => resolveRoleCode(user), [user]);
  const enquiryState = useEnquiryState(enquiry);

  const assignedTo = useMemo(() => enquiry?.AssignedTo || enquiry?.assignedTo, [enquiry]);
  const inferredSubStatus = useMemo(
    () => !enquiryState?.subStatus && assignedTo ? SUBSTATUS.AS : enquiryState?.subStatus,
    [enquiryState?.subStatus, assignedTo],
  );

  // TODO: Redesign flow resolution logic here
  // Previously:
  // 1. Called actionsFor(miniEnquiry, roleCode) to get buttons/primaryAction/tab
  // 2. Checked if substatus is FU to swap Upload CAD -> Upload Final CAD
  // 3. Checked Cad versions to show/hide Final Look button
  // 4. Mapped buttons to actionConfigs with label/icon/color
  // 5. Looked up NEXT_STATE for state machine transitions
  const config = useMemo(() => {
    return {
      buttons: [],
      primaryAction: null,
      actions: [],
      tab: null,
      modalPhase: null,
      assignType: null,
      actionConfigs: [],
      primaryActionConfig: null,
      enquiryState,
      nextState: null,
      displaySubStatus: inferredSubStatus,
      displayStatus: enquiryState?.status,
    };
  }, [enquiryState, roleCode, inferredSubStatus]);

  return config;
};

export const getActionLabel = (action) => ACTION_LABELS[action] || action;
export const getActionIcon = (action) => ACTION_ICONS[action] || 'help';
export const getActionColor = (action) => ACTION_COLORS[action] || '#6B7280';
