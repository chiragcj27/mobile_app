import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import XLSX from 'xlsx';
import {
  useUpdateEnquiryMutation,
  useUpdateAssetDataMutation,
  useLazyGetEnquiryByIdQuery,
} from '../store/api';
import { SUBSTATUS } from '../constants/enquiry';
import { getUserName } from '../utils/userUtils';


const getEnquiryId = (enquiry) =>
  enquiry?.Id || enquiry?._id || enquiry?.id || enquiry?._originalData?._id;

const getClientId = (enquiry) =>
  enquiry?.ClientId || enquiry?.clientId;

const generateStyleMasterData = (raw, stones, pricing) => {
  const category = raw?.Category || '';
  const metalColor = raw?.Metal?.Color || raw?.Metal?.Type || '';
  const isRing = category.toLowerCase() === 'ring';
  const itemSize = isRing
    ? (raw?.Checklist?.SizeRingSize || '')
    : (raw?.Checklist?.SizeLength || '');
  const approxGoldWt = pricing?.Metal?.Weight || '';

  const headers = [
    'StyleNo', 'ParentStyleNo', 'Category', 'SubCategory', 'Date',
    'CADDesigner', 'Size', 'MetalColour', 'CADVolume',
    'StpInst', 'DsgPrdInst', 'SplRemarks',
    'ResinWt', 'WaxWt', 'SilverWt', 'ApproxGoldWt',
    'StnTyp', 'StnShp', 'StnClr', 'StnSz', 'PtrCts', 'Qty', 'TotCts', 'SetTyp',
  ];

  const rows = stones.map((stone) => {
    const ptrCts = stone.Price || stone.Rate || 0;
    const qty = stone.Pcs || 0;
    const totCts = Number(stone.Weight || 0) * Number(qty);
    return [
      raw?.StyleNumber || '',
      '',
      category,
      raw?.subCategory || '',
      raw?.CreatedDate ? new Date(raw.CreatedDate).toLocaleDateString() : new Date().toLocaleDateString(),
      getUserName(raw?.AssignedTo),
      itemSize,
      metalColor,
      '',
      raw?.Stamping || '',
      '',
      raw?.SpecialRemarks || '',
      '',
      '',
      '',
      approxGoldWt,
      stone.Type || '',
      stone.Shape || '',
      stone.Color || '',
      stone.MmSize || stone.SieveSize || '',
      ptrCts,
      qty,
      totCts,
      stone.SetCode || '',
    ];
  });

  return { headers, rows };
};

export const useEnquiryActions = ({ onAlert } = {}) => {
  const alert = (title, msg, type = 'error') => onAlert?.(title, msg, type, [{ text: 'OK' }]);
  const [updateEnquiry] = useUpdateEnquiryMutation();
  const [updateAssetData, { isLoading: isUpdating }] = useUpdateAssetDataMutation();
  const [triggerGetEnquiryById] = useLazyGetEnquiryByIdQuery();
  const [enquiryData, setEnquiryData] = useState(null);

  const fetchEnquiryById = useCallback(async (enquiryId) => {
    if (!enquiryId) return null;
    try {
      const result = await triggerGetEnquiryById(enquiryId).unwrap();
      setEnquiryData(result);
      return result;
    } catch (error) {
      console.error('[fetchEnquiryById] Error:', error);
      setEnquiryData(null);
      return null;
    }
  }, [triggerGetEnquiryById]);

  const handleAcceptApproval = useCallback(async (enquiry, coralVersion, cadVersion, approvedCoral, approvedCad) => {
    const enquiryId = getEnquiryId(enquiry);
    const raw = enquiry?._originalData || enquiry;
    const assignedTo = raw?.AssignedTo || null;

    const hasCoral = !!coralVersion;
    const hasCad = !!cadVersion;
    const hasApprovedCoral = !!approvedCoral;
    const hasApprovedCad = !!approvedCad;

    console.log('[handleAcceptApproval] enquiryId:', enquiryId, 'hasCoral:', hasCoral, 'hasCad:', hasCad, 'hasApprovedCoral:', hasApprovedCoral, 'hasApprovedCad:', hasApprovedCad, 'coralVersion:', coralVersion, 'cadVersion:', cadVersion);

    if (hasApprovedCoral && hasCad) {
      await updateAssetData({
        enquiryId,
        type: 'cad',
        version: cadVersion,
        data: { IsApprovedVersion: true },
      }).unwrap();
      return { success: true };
    }

    if (hasApprovedCad) {
      await updateEnquiry({
        id: enquiryId,
        CurrentSubStatus: SUBSTATUS.FU,
        ClientId: getClientId(enquiry),
        ...(assignedTo ? { AssignedTo: assignedTo } : {}),
      }).unwrap();
      return { success: true };
    }

    if (hasCoral) {
      await updateAssetData({
        enquiryId,
        type: 'coral',
        version: coralVersion,
        data: { IsApprovedVersion: true },
      }).unwrap();
      return { success: true };
    }

    if (hasCad) {
      await updateAssetData({
        enquiryId,
        type: 'cad',
        version: cadVersion,
        data: { IsApprovedVersion: true },
      }).unwrap();
      return { success: true };
    }

    await updateAssetData({
      enquiryId,
      type: 'coral',
      version: '1',
      data: { IsApprovedVersion: true },
    }).unwrap();
    return { success: true };
  }, [updateAssetData, updateEnquiry]);

  const handleMoveToOrderPlacement = useCallback(async (enquiry) => {
    const enquiryId = getEnquiryId(enquiry);
    const raw = enquiry?._originalData || enquiry;
    const cadData = Array.isArray(raw?.Cad) ? raw.Cad : [];
    const latestCadVersion = cadData.length > 0
      ? String(cadData[cadData.length - 1]?.Version || cadData.length)
      : '1';

    await updateAssetData({
      enquiryId,
      type: 'cad',
      version: latestCadVersion,
      data: { IsFinalVersion: true },
    }).unwrap();
    return { success: true };
  }, [updateAssetData]);

  const handleFinalExcelGeneration = useCallback(async (enquiry) => {
    try {
      const raw = enquiry?._originalData || enquiry;
      const cadVersions = Array.isArray(raw?.Cad) ? raw.Cad : [];
      const category = raw?.Category || '';

      const latestCad = cadVersions.length > 0 ? cadVersions[cadVersions.length - 1] : null;

      if (!latestCad) {
        console.warn('[handleFinalExcelGeneration] No CAD version found');
        return { mainData: null, rows: [], stoneCount: 0 };
      }

      const pricing = Array.isArray(latestCad.Pricing)
        ? latestCad.Pricing[0]
        : latestCad.Pricing || null;

      const stones = pricing?.Stones || [];

      if (stones.length === 0) {
        console.warn('[handleFinalExcelGeneration] No stones found in latest CAD');
        return { mainData: null, rows: [], stoneCount: 0 };
      }

      const metalColor = raw?.Metal?.Color || raw?.Metal?.Type || '';
      const metalQuality = raw?.Metal?.Quality || '';
      const metalInitial = metalColor ? metalColor.charAt(0).toUpperCase() : 'G';
      const mItemCode = `${metalInitial}${metalQuality || '10K'}T`;

      const isRing = category.toLowerCase() === 'ring';
      const itemSize = isRing
        ? (raw?.Checklist?.SizeRingSize || '')
        : (raw?.Checklist?.SizeLength || '');

      const mainData = {
        StyleCode: raw?.StyleNumber || '',
        ItemSize: itemSize,
        OrderQty: raw?.Quantity || 0,
        Metal: mItemCode,
        Tone: metalColor || '',
        SpecialRemarks: raw?.SpecialRemarks || '',
        StampInstruction: raw?.Stamping || '',
      };

      const rows = stones.map((stone, index) => ({
        SrNo: index + 1,
        StyleCode: mainData.StyleCode,
        ItemSize: index === 0 ? mainData.ItemSize : '',
        OrderQty: index === 0 ? mainData.OrderQty : '',
        OrderItemPcs: stone.Pcs || 0,
        Metal: mainData.Metal,
        Tone: mainData.Tone,
        ItemPoNo: '',
        ItemRefNo: '',
        StockType: '',
        MakeType: '',
        CustomerProductionInstruction: '',
        SpecialRemarks: mainData.SpecialRemarks,
        DesignProductionInstruction: '',
        StampInstruction: mainData.StampInstruction,
        OrderGroup: '',
        Certificate: '',
        SKUNo: '',
        Basestoneminwt: stone.Basestoneminwt || '',
        Basestonemaxwt: stone.basestonemaxwt || '',
        Basemetalminwt: stone.basemetalminwt || '',
        Basemetalmaxwt: stone.basemetalmaxwt || '',
        Productiondeliverydate: '',
        Expecteddeliverydate: '',
        '': '',
        SetPrice: stone.SetPrice || '',
        StoneQuality: '',
        RhodiumInstruction: '',
        DiamondInstruction: '',
        SizeInstruction: '',
        EndClientPrice: '',
      }));

      return { mainData, rows, stoneCount: stones.length };
    } catch (error) {
      console.error('[handleFinalExcelGeneration] Error:', error);
      return { mainData: null, rows: [], stoneCount: 0 };
    }
  }, []);

  const generateAndShareExcel = useCallback(async (enquiry) => {
    try {
      const { mainData, rows, stoneCount } = await handleFinalExcelGeneration(enquiry);

      if (!rows || rows.length === 0) {
        return { success: false, message: 'No stones found in final CAD' };
      }

      const raw = enquiry?._originalData || enquiry;
      const styleCode = raw?.StyleNumber || 'Enquiry';
      const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');

      // Extract data for style master
      const cadVersions = Array.isArray(raw?.Cad) ? raw.Cad : [];
      const latestCad = cadVersions.length > 0 ? cadVersions[cadVersions.length - 1] : null;
      const pricing = latestCad
        ? (Array.isArray(latestCad.Pricing) ? latestCad.Pricing[0] : latestCad.Pricing || null)
        : null;
      const stones = pricing?.Stones || [];

      // --- Generate Style Master Excel ---
      const styleMasterData = generateStyleMasterData(raw, stones, pricing);
      const smWb = XLSX.utils.book_new();
      const smWs = XLSX.utils.aoa_to_sheet([styleMasterData.headers, ...styleMasterData.rows]);
      smWs['!cols'] = styleMasterData.headers.map(() => ({ wch: 18 }));
      XLSX.utils.book_append_sheet(smWb, smWs, 'Style Master');
      const smBase64 = XLSX.write(smWb, { type: 'base64', bookType: 'xlsx' });

      // --- Generate Order Data Excel ---
      const headers = [
        'SrNo', 'StyleCode', 'ItemSize', 'OrderQty', 'OrderItemPcs',
        'Metal', 'Tone', 'ItemPoNo', 'ItemRefNo', 'StockType', 'MakeType',
        'CustomerProductionInstruction', 'SpecialRemarks', 'DesignProductionInstruction',
        'StampInstruction', 'OrderGroup', 'Certificate', 'SKUNo',
        'Basestoneminwt', 'Basestonemaxwt', 'Basemetalminwt', 'Basemetalmaxwt',
        'Productiondeliverydate', 'Expecteddeliverydate', '',
        'SetPrice', 'StoneQuality', 'RhodiumInstruction', 'DiamondInstruction',
        'SizeInstruction', 'EndClientPrice',
      ];

      const sheetData = rows.map(row => headers.map(h => row[h] ?? ''));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...sheetData]);
      ws['!cols'] = headers.map(() => ({ wch: 18 }));
      XLSX.utils.book_append_sheet(wb, ws, 'Order Data');
      const orderBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

      // --- Write both files ---
      const dirPath = Platform.OS === 'ios'
        ? RNFS.DocumentDirectoryPath
        : RNFS.DownloadDirectoryPath;

      const smFilename = `StyleMaster_${styleCode}_${timestamp}.xlsx`;
      const orderFilename = `Order_${styleCode}_${timestamp}.xlsx`;
      const smPath = `${dirPath}/${smFilename}`;
      const orderPath = `${dirPath}/${orderFilename}`;

      await RNFS.writeFile(smPath, smBase64, 'base64');
      await RNFS.writeFile(orderPath, orderBase64, 'base64');

      // --- Share both files ---
      try {
        await Share.open({
          urls: [`file://${smPath}`, `file://${orderPath}`],
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          title: 'Share Style Master & Order Data',
          message: `${styleCode} - ${stoneCount} stones`,
          subject: `Style Master & Order Data - ${styleCode}`,
        });
      } catch (shareErr) {
        const msg = shareErr?.message || '';
        if (!msg.includes('User did not share') && !msg.includes('cancelled')) {
          console.warn('[generateAndShareExcel] Share failed:', msg);
          alert('Share Failed', msg);
        }
      }

      if (Platform.OS === 'ios') {
        setTimeout(() => {
          RNFS.unlink(smPath).catch(() => {});
          RNFS.unlink(orderPath).catch(() => {});
        }, 10000);
      }

      return { success: true, smPath, orderPath, stoneCount };
    } catch (error) {
      console.error('[generateAndShareExcel] Error:', error);
      alert('Excel Generation Failed', error.message || 'Could not generate Excel.');
      return { success: false, message: error.message };
    }
  }, [handleFinalExcelGeneration]);

  return {
    handleAcceptApproval,
    handleMoveToOrderPlacement,
    handleFinalExcelGeneration,
    generateAndShareExcel,
    fetchEnquiryById,
    enquiryData,
    isLoading: isUpdating,
  };
};
