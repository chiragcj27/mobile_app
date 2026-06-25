import { useCallback } from 'react';
import {
  useUpdateEnquiryMutation,
  useApproveDesignVersionMutation,
} from '../store/api';
import { STATUS, SUBSTATUS } from '../constants/enquiry';

const getEnquiryId = (enquiry) =>
  enquiry?.Id || enquiry?._id || enquiry?.id || enquiry?._originalData?._id;

const getClientId = (enquiry) =>
  enquiry?.ClientId || enquiry?.clientId;

export const useEnquiryActions = () => {
  const [updateEnquiry, { isLoading: isUpdating }] = useUpdateEnquiryMutation();
  const [approveDesignVersion, { isLoading: isApproving }] = useApproveDesignVersionMutation();

  const handleAcceptApproval = useCallback(async (enquiry, coralVersion, cadVersion, approvedCoral, approvedCad) => {
    const enquiryId = getEnquiryId(enquiry);
    const raw = enquiry?._originalData || enquiry;
    const assignedTo = raw?.AssignedTo || null;

    const hasCoral = !!coralVersion;
    const hasCad = !!cadVersion;
    const hasApprovedCoral = !!approvedCoral;
    const hasApprovedCad = !!approvedCad;

    console.log('[handleAcceptApproval] enquiryId:', enquiryId, 'hasCoral:', hasCoral, 'hasCad:', hasCad, 'hasApprovedCoral:', hasApprovedCoral, 'hasApprovedCad:', hasApprovedCad, 'coralVersion:', coralVersion, 'cadVersion:', cadVersion);

    if (hasApprovedCad) {
      await updateEnquiry({
        id: enquiryId,
        CurrentSubStatus: SUBSTATUS.FU,
        ClientId: getClientId(enquiry),
        ...(assignedTo ? { AssignedTo: assignedTo } : {}),
      }).unwrap();
      return { success: true };
    }

    if (hasApprovedCoral && hasCad) {
      await approveDesignVersion({
        enquiryId,
        designType: 'cad',
        version: cadVersion,
        intent: 'approveDesign',
      }).unwrap();
      await updateEnquiry({
        id: enquiryId,
        CurrentStatus: 'Cad',
        CurrentSubStatus: SUBSTATUS.FU,
        ClientId: getClientId(enquiry),
        ...(assignedTo ? { AssignedTo: assignedTo } : {}),
      }).unwrap();
      return { success: true };
    }

    if (hasCoral) {
      await approveDesignVersion({
        enquiryId,
        designType: 'coral',
        version: coralVersion,
        intent: 'approveDesign',
      }).unwrap();
      return { success: true };
    }

    if (hasCad) {
      await approveDesignVersion({
        enquiryId,
        designType: 'cad',
        version: cadVersion,
        intent: 'approveDesign',
      }).unwrap();
      return { success: true };
    }

    await approveDesignVersion({
      enquiryId,
      designType: 'coral',
      version: '1',
      intent: 'approveDesign',
    }).unwrap();
    return { success: true };
  }, [approveDesignVersion, updateEnquiry]);

  const handleUploadFinalCad = useCallback(async (enquiry) => {
    const enquiryId = getEnquiryId(enquiry);
    const raw = enquiry?._originalData || enquiry;
    const cadData = raw?.Cad || [];
    const lastCadVersion = cadData.length > 0 ? String(cadData[cadData.length - 1]?.Version || cadData.length) : '1';

    const result = await approveDesignVersion({
      enquiryId,
      designType: 'cad',
      version: lastCadVersion,
      intent: 'finalVersion',
    }).unwrap();
    return { success: true };
  }, [approveDesignVersion]);

  const handleMoveToOrderPlacement = useCallback(async (enquiry) => {
    const enquiryId = getEnquiryId(enquiry);
    const clientId = getClientId(enquiry);
    const result = await updateEnquiry({
      id: enquiryId,
      Status: STATUS.ORDER_PLACEMENT,
      SubStatus: null,
      ClientId: clientId,
    }).unwrap();
    return { success: true };
  }, [updateEnquiry]);

  return {
    handleAcceptApproval,
    handleUploadFinalCad,
    handleMoveToOrderPlacement,
    isLoading: isUpdating || isApproving,
  };
};
