export const ROLE = {
  AD: 'AD',
  CO: 'CO',
  CD: 'CD',
  CL: 'CL',
  CH: 'CH',
};

export const ROLE_ID_TO_CODE = {
  1: ROLE.AD,
  2: ROLE.CO,
  3: ROLE.CD,
  4: ROLE.CL,
  5: ROLE.CH,
};

export const resolveRoleCode = (user) => {
  if (!user) return null;
  if (user.RoleCode) return user.RoleCode;
  if (user.Role && typeof user.Role === 'string') return user.Role;
  const id = user.RoleId ?? user.roleId ?? user.role;
  return ROLE_ID_TO_CODE[id] ?? null;
};

export const STATUS = {
  ENQUIRY_CREATED: 'Enquiry Created',
  CORAL: 'Coral',
  CAD: 'Cad',
  DESIGN_APPROVAL_PENDING: 'Design Approval Pending',
  ORDER_PLACEMENT: 'Order Placement',
  PRODUCTION: 'Production',
};

export const SUBSTATUS = {
  AP: 'Assign Pending',
  AS: 'Assigned',
  RR: 'Rejected - Redo',

  CM: 'Cost Missing',
  QR: 'Quotation Review',
  FU: 'Final Cad Upload',
};

export const TAB = {
  UNASSIGNED: 'unassigned',
  WIP: 'wip',
  APPROVAL: 'approval',
  PRODUCTION: 'production',
};

// paramsForTab: Returns query parameters for each tab's enquiry search.
// UNASSIGNED → unassigned flag + Assign Pending substatus + Enquiry Created status
// WIP → Coral, Cad, or Enquiry Created status
// APPROVAL → Design Approval Pending status
// PRODUCTION → Production status
export const paramsForTab = (tab) => {
  // TODO: Redesign tab filtering if tab logic changes
  switch (tab) {
    case TAB.WIP:
      return [{ status: [STATUS.CORAL, STATUS.CAD, STATUS.ENQUIRY_CREATED] }];
    case TAB.APPROVAL:
      return [{ status: STATUS.DESIGN_APPROVAL_PENDING }];
    case TAB.PRODUCTION:
      return [{ status: STATUS.PRODUCTION }];
    default:
      return [{}];
  }
};

export const ACTION = {
  ASSIGN: 'ASSIGN',
  ASSIGN_CAD: 'ASSIGN_CAD',
  UPLOAD_CORAL: 'UPLOAD_CORAL',
  UPLOAD_CAD: 'UPLOAD_CAD',
  UPLOAD_FINAL_CAD: 'UPLOAD_FINAL_CAD',
  CHAT: 'CHAT',
  UPDATE_QUOTATION: 'UPDATE_QUOTATION',
  REJECT_QUOTATION: 'REJECT_QUOTATION',
  VIEW_QUOTATION: 'VIEW_QUOTATION',
  MOVE_TO_APPROVAL: 'MOVE_TO_APPROVAL',
  ACCEPT_APPROVAL: 'ACCEPT_APPROVAL',
  REJECT_APPROVAL: 'REJECT_APPROVAL',
  FINAL_LOOK: 'FINAL_LOOK',
  MOVE_TO_ORDER_PLACEMENT: 'MOVE_TO_ORDER_PLACEMENT',
};

export const MODAL_PHASE = {
  EDIT: 'edit',
  REVIEW: 'review',
};

export const DESIGN_TYPE = {
  CORAL: 'coral',
  CAD: 'cad',
};

const can = (roleCode, allowed) => allowed.includes(roleCode);

// NEXT_STATE: State machine transition map.
// Defines valid transitions from each Status+SubStatus combination.
// Keys: action name → value: { status, subStatus } to transition to.
export const NEXT_STATE = {
  // TODO: Redesign state transitions based on new lifecycle flow
};

// actionsFor: Determines available buttons and primary action for an enquiry
// based on its CurrentStatus, CurrentSubStatus, and the user's role.
// Returns { buttons: ACTION[], primaryAction: ACTION, tab: TAB, modalPhase?, assignType? }
export const actionsFor = (enquiry, roleCode) => {
  const status = enquiry?.CurrentStatus;
  const sub = enquiry?.CurrentSubStatus;
  const isAdmin = can(roleCode, [ROLE.AD]);
  const isClientHandler = can(roleCode, [ROLE.CH]);
  const isAdminCh = isAdmin || isClientHandler;

  if (status === STATUS.ENQUIRY_CREATED) {
    return {
      buttons: isAdminCh ? [ACTION.ASSIGN] : [],
      primaryAction: ACTION.ASSIGN,
      assignType: DESIGN_TYPE.CORAL,

    };
  }

  if (status === STATUS.CORAL) {
    if (sub === SUBSTATUS.AP || !sub) {
      return {
        buttons: isAdminCh ? [ACTION.ASSIGN] : [],
        primaryAction: ACTION.ASSIGN,
        assignType: DESIGN_TYPE.CORAL,
        tab: TAB.WIP,
      };
    }
    if (sub === SUBSTATUS.AS || sub === SUBSTATUS.RR) {
      return {
        buttons: isAdminCh ? [ACTION.UPLOAD_CORAL] : roleCode === ROLE.CO ? [ACTION.UPLOAD_CORAL] : [],
        tab: TAB.WIP,
        primaryAction: ACTION.UPLOAD_CORAL,
        assignType: DESIGN_TYPE.CORAL,
      };
    }
    if ( sub === SUBSTATUS.CM) {
      return {
        buttons: isAdminCh ? [ ACTION.UPDATE_QUOTATION, ACTION.REJECT_QUOTATION] : [],
        tab: TAB.WIP,
        primaryAction: ACTION.UPDATE_QUOTATION,
      };
    }
    if ( sub === SUBSTATUS.QR ) {
      const finalCad = enquiry?._originalData?.finalCad || enquiry?.finalCad;
      const hasFinalCad = !!finalCad?.Version;

      if (hasFinalCad) {
        return {
          buttons: isAdminCh ? [ACTION.FINAL_LOOK, ACTION.MOVE_TO_ORDER_PLACEMENT] : [],
          tab: TAB.WIP,
          primaryAction: ACTION.MOVE_TO_ORDER_PLACEMENT,
        };
      }

      return{
        buttons: isAdminCh ? [ACTION.VIEW_QUOTATION,ACTION.MOVE_TO_APPROVAL]
        : [],
        tab: TAB.WIP,
        primaryAction: ACTION.MOVE_TO_APPROVAL,
      }
    }
  }

  if (status === STATUS.CAD) {
    if (sub === SUBSTATUS.AP || !sub) {
      return {
        buttons: isAdminCh ? [ACTION.ASSIGN] : [],
        primaryAction: ACTION.ASSIGN,
        assignType: DESIGN_TYPE.CAD,
        tab: TAB.WIP,
      };
    }
    if (sub === SUBSTATUS.AS || sub === SUBSTATUS.RR) {
      return {
        buttons: isAdminCh ? [ACTION.UPLOAD_CAD] : roleCode === ROLE.CD ? [ACTION.UPLOAD_CAD] : [],
        tab: TAB.WIP,
        primaryAction: ACTION.UPLOAD_CAD,
        assignType: DESIGN_TYPE.CAD,
      };
    }
    if ( sub === SUBSTATUS.CM ) {
      return {
        buttons: isAdminCh ? [ACTION.VIEW_QUOTATION, ACTION.UPDATE_QUOTATION, ACTION.REJECT_QUOTATION, ACTION.MOVE_TO_APPROVAL] : [],
        tab: TAB.WIP,
        primaryAction: ACTION.UPDATE_QUOTATION,
      };
    }
    if ( sub === SUBSTATUS.QR ) {
      const finalCad = enquiry?._originalData?.finalCad || enquiry?.finalCad;
      const hasFinalCad = !!finalCad?.Version;

      if (hasFinalCad) {
        return {
          buttons: isAdminCh ? [ACTION.FINAL_LOOK, ACTION.MOVE_TO_ORDER_PLACEMENT] : [],
          tab: TAB.WIP,
          primaryAction: ACTION.MOVE_TO_ORDER_PLACEMENT,
        };
      }

      return{
        buttons: isAdminCh ? [ACTION.VIEW_QUOTATION,ACTION.MOVE_TO_APPROVAL]
        : [],
        tab: TAB.WIP,
        primaryAction: ACTION.MOVE_TO_APPROVAL,
      }
    }
    if (sub === SUBSTATUS.FU) {
      return {
        buttons: isAdminCh ? [ACTION.UPLOAD_FINAL_CAD] : roleCode === ROLE.CD ? [ACTION.UPLOAD_FINAL_CAD] : [],
        tab: TAB.WIP,
        primaryAction: ACTION.UPLOAD_FINAL_CAD,
      };
    }
  }

  if (status === STATUS.DESIGN_APPROVAL_PENDING) {
    return {
      buttons: isAdminCh ? [ACTION.ACCEPT_APPROVAL, ACTION.REJECT_APPROVAL] : [],
      tab: TAB.APPROVAL,
      primaryAction: ACTION.ACCEPT_APPROVAL,
    };
  }

  if (status === STATUS.ORDER_PLACEMENT) {
    return {
      buttons: [],
      tab: TAB.WIP,
    };
  }

  if (status === STATUS.PRODUCTION) {
    return {
      buttons: isAdminCh ? [ACTION.CHAT] : [],
      tab: TAB.PRODUCTION,
      primaryAction: ACTION.CHAT,
    };
  }

  return { buttons: [], tab: null };
};
