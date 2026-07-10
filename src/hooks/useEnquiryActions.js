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


const getEnquiryId = (enquiry) =>
  enquiry?.Id || enquiry?._id || enquiry?.id || enquiry?._originalData?._id;

const getClientId = (enquiry) =>
  enquiry?.ClientId || enquiry?.clientId;

export const useEnquiryActions = () => {
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
      const metal = pricing?.Metal || {};

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
        Priority: raw?.Priority || '',
        SpecialRemarks: raw?.SpecialRemarks || '',
        StampInstruction: raw?.Stamping || '',
        MItemCode: mItemCode,
        ItemCode: `${stones[0]?.StoneType || ''} ${stones[0]?.Shape || ''}`.trim(),
        MPcs: metal.Pcs || '',
        NetWeight: metal.Weight || '',
        MRate: metal.Rate || '',
        MAmount: Number(metal.Weight || 0) * Number(metal.Rate || 0),
        LossPer: pricing?.Loss || '',
        LossWt: Number(metal.Weight || 0) * Number(pricing?.Loss || 0) / 100,
        Tone : metalColor || '',
        SizeCode:  stones[0]?.SieveSize || '',
        
      };

      const rows = stones.map((stone, index) => ({
        SrNo: 1,
        ...(index === 0 ? mainData : {
          StyleCode: mainData.StyleCode,
          ItemSize: '',
          OrderQty: '',
          Priority: '',
          SpecialRemarks: '',
          StampInstruction: '',
          ItemCode: '',
          MPcs: '',
          NetWeight: '',
          MRate: '',
          LossPer: '',
          LossWt: '',
          Amount: '',
          SizeCode: '',
          Tone: mainData.Tone,
        }),
        OrderItemPcs: '',
        ItemPoNo: '',
        ItemRefNo: '',
        StockTypeName: '',
        MakeTypeName: '',
        MetalAmtOn: '',
        RateChartCode: '',
        MakingChartCode: '',
        CustomerProductionInstruction: '',
        DesignProductionInstruction: '',
        OrderGroup: '',
        Certificate: '',
        ExportPricing: '',
        PrdDlvDate: '',
        ExpDlvDate: '',
        MarginPlusPer: '',
        MarginPlusIsFix: '',
        MarginPlusAmt: '',
        DiscountPer: '',
        DiscountIsFix: '',
        DiscountAmt: '',
        MSizeCode: '',
        MSetCode: '',
        MAccessoriesCode: '',
        MBatchNo: '',
        MCertiBatchNo: '',
        MNBatchNo: '',
        MNRate: '',
        MDescription: '',
        MRawFormula: '',
        MCPFRate: '',
        MCPFIsFix: '',
        MCPFAmount: '',
        MLossPer: '',
        MLossPerIsFix: '',
        MLossWt: '',
        MHandRate: '',
        MHandAmount: '',
        MMinWeight: '',
        MMaxWeight: '',
        SizeCode: stone.SieveSize || '',
        SetCode: stone.SetCode || '',
        StonePosition: stone.StonePosition || '',
        AccessoriesCode: stone.AccessoriesCode || '',
        BatchNo: stone.BatchNo || '',
        CertiBatchNo: stone.CertiBatchNo || '',
        NBatchNo: stone.NBatchNo || '',
        NRate: stone.NRate || '',
        Description: stone.Description || '',
        RawFormula: stone.RawFormula || '',
        Pcs: stone.Pcs || 0,
        Weight: stone.Weight || 0,
        MinWeight: stone.MinWeight || '',
        MaxWeight: stone.MaxWeight || '',
        Rate: stone.Rate || stone.Price || 0,
        Amount: Number(stone.Weight || 0) * Number(stone.Rate || stone.Price || 0),
        CPFRate: stone.CPFRate || '',
        CPFIsFix: stone.CPFIsFix || '',
        CPFAmount: stone.CPFAmount || '',
        LossPerIsFix: stone.LossPerIsFix || '',
        SetRate: stone.SetRate || '',
        SetAmount: stone.SetAmount || '',
        HandRate: stone.HandRate || '',
        HandAmount: stone.HandAmount || '',
        SetPrice: stone.SetPrice || '',
        Basestoneminwt: stone.Basestoneminwt || '',
        basestonemaxwt: stone.basestonemaxwt || '',
        basemetalminwt: stone.basemetalminwt || '',
        basemetalmaxwt: stone.basemetalmaxwt || '',
        Productiondeliverydate: '',
        Expecteddeliverydate: '',
        SKUNo: '',
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
      const excelFilename = `Order_${styleCode}_${timestamp}.xlsx`;

      const headers = [
        'SrNo', 'StyleCode', 'ItemSize', 'OrderQty', 'OrderItemPcs',
        'ItemPoNo', 'ItemRefNo', 'Priority', 'StockTypeName', 'MakeTypeName',
        'MetalAmtOn', 'RateChartCode', 'MakingChartCode', 'CustomerProductionInstruction',
        'DesignProductionInstruction', 'StampInstruction', 'SpecialRemarks', 'OrderGroup',
        'Certificate', 'ExportPricing', 'PrdDlvDate', 'ExpDlvDate',
        'MarginPlusPer', 'MarginPlusIsFix', 'MarginPlusAmt', 'DiscountPer',
        'DiscountIsFix', 'DiscountAmt', 'Tone', 'MItemCode',
        'MSizeCode', 'MSetCode', 'MAccessoriesCode', 'MBatchNo',
        'MCertiBatchNo', 'MNBatchNo', 'MNRate', 'MDescription',
        'MRawFormula', 'MPcs', 'NetWeight', 'MRate',
        'MAmount', 'MCPFRate', 'MCPFIsFix', 'MCPFAmount',
        'MLossPer', 'MLossPerIsFix', 'MLossWt', 'MHandRate',
        'MHandAmount', 'MMinWeight', 'MMaxWeight', 'ItemCode',
        'SizeCode', 'SetCode', 'StonePosition', 'AccessoriesCode',
        'BatchNo', 'CertiBatchNo', 'NBatchNo', 'NRate',
        'Description', 'RawFormula', 'Pcs', 'Weight',
        'MinWeight', 'MaxWeight', 'Rate', 'Amount',
        'CPFRate', 'CPFIsFix', 'CPFAmount', 'LossPer',
        'LossPerIsFix', 'LossWt', 'SetRate', 'SetAmount',
        'HandRate', 'HandAmount', 'SetPrice', 'Basestoneminwt',
        'basestonemaxwt', 'basemetalminwt', 'basemetalmaxwt',
        'Productiondeliverydate', 'Expecteddeliverydate', 'SKUNo',
        'RhodiumInstruction', 'DiamondInstruction', 'SizeInstruction', 'EndClientPrice',
      ];

      const sheetData = rows.map(row => headers.map(h => row[h] ?? ''));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...sheetData]);
      ws['!cols'] = headers.map(() => ({ wch: 18 }));
      XLSX.utils.book_append_sheet(wb, ws, 'Order Data');

      const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

      const dirPath = Platform.OS === 'ios'
        ? RNFS.DocumentDirectoryPath
        : RNFS.DownloadDirectoryPath;
      const filePath = `${dirPath}/${excelFilename}`;
      await RNFS.writeFile(filePath, base64, 'base64');

      try {
        await Share.open({
          url: `file://${filePath}`,
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: excelFilename,
          title: 'Share Order Excel',
          message: `${styleCode} - ${stoneCount} stones`,
          subject: `Order Data - ${styleCode}`,
        });
      } catch (shareErr) {
        if (shareErr?.message !== 'User did not share') {
          console.warn('[generateAndShareExcel] Share cancelled or failed:', shareErr?.message);
        }
      }

      if (Platform.OS === 'ios') {
        setTimeout(() => RNFS.unlink(filePath).catch(() => {}), 10000);
      }

      return { success: true, filePath, filename: excelFilename, stoneCount };
    } catch (error) {
      console.error('[generateAndShareExcel] Error:', error);
      return { success: false, message: error.message };
    }
  }, [handleFinalExcelGeneration]);

  const generateExcelPdf = useCallback(async (enquiry) => {
    try {
      const { mainData, rows, stoneCount } = await handleFinalExcelGeneration(enquiry);

      if (!rows || rows.length === 0) {
        return { success: false, html: null, stoneCount: 0 };
      }

      const raw = enquiry?._originalData || enquiry;
      const styleCode = raw?.StyleNumber || 'Enquiry';
      const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');

      const kv = (label, val) => {
        const v = val ?? '';
        return v === '' ? '' : `<div class="kv"><span class="kl">${label}</span><span class="vv">${v}</span></div>`;
      };

      const mainFields = [
        kv('Style Code', mainData.StyleCode),
        kv('Item Size', mainData.ItemSize),
        kv('Order Qty', mainData.OrderQty),
        kv('Priority', mainData.Priority),
        kv('M Item Code', mainData.MItemCode),
        kv('Net Weight', mainData.NetWeight),
        kv('M Rate', mainData.MRate),
        kv('M Pcs', mainData.MPcs),
        kv('Stamp', mainData.StampInstruction),
        kv('Remarks', mainData.SpecialRemarks),
      ].filter(Boolean).join('');

      const stoneCards = rows.map((row, i) => {
        const section = (title) => `<div class="stitle">${title}</div>`;

        const stoneFields = [
          kv('Item Code', row.ItemCode),
          kv('Description', row.Description),
          kv('Size Code', row.SizeCode),
          kv('Set Code', row.SetCode),
          kv('Position', row.StonePosition),
          kv('Pcs', row.Pcs),
          kv('Weight', row.Weight),
          kv('Rate', row.Rate),
          kv('Amount', row.Amount),
          kv('Min Wt', row.MinWeight),
          kv('Max Wt', row.MaxWeight),
        ].filter(Boolean).join('');

        const batchFields = [
          kv('Accessories', row.AccessoriesCode),
          kv('Batch No', row.BatchNo),
          kv('Certi Batch', row.CertiBatchNo),
          kv('N Batch No', row.NBatchNo),
          kv('N Rate', row.NRate),
          kv('Raw Formula', row.RawFormula),
        ].filter(Boolean).join('');

        const pricingFields = [
          kv('CPF Rate', row.CPFRate),
          kv('CPF Fix', row.CPFIsFix),
          kv('CPF Amt', row.CPFAmount),
          kv('Loss %', row.LossPer),
          kv('Loss Fix', row.LossPerIsFix),
          kv('Loss Wt', row.LossWt),
          kv('Set Rate', row.SetRate),
          kv('Set Amt', row.SetAmount),
          kv('Hand Rate', row.HandRate),
          kv('Hand Amt', row.HandAmount),
          kv('Set Price', row.SetPrice),
        ].filter(Boolean).join('');

        const baseFields = [
          kv('Base Stone Min', row.Basestoneminwt),
          kv('Base Stone Max', row.basestonemaxwt),
          kv('Base Metal Min', row.basemetalminwt),
          kv('Base Metal Max', row.basemetalmaxwt),
          kv('SKU No', row.SKUNo),
          kv('Prod Delivery', row.Productiondeliverydate),
          kv('Exp Delivery', row.Expecteddeliverydate),
          kv('Rhodium', row.RhodiumInstruction),
          kv('Diamond', row.DiamondInstruction),
          kv('Size', row.SizeInstruction),
          kv('End Client Price', row.EndClientPrice),
        ].filter(Boolean).join('');

        return `
        <div class="stone-card">
          <div class="stone-header">Stone ${row.SrNo}</div>
          ${stoneFields ? `<div class="section">${section('Stone Details')}${stoneFields}</div>` : ''}
          ${batchFields ? `<div class="section">${section('Batch & Codes')}${batchFields}</div>` : ''}
          ${pricingFields ? `<div class="section">${section('Pricing & Loss')}${pricingFields}</div>` : ''}
          ${baseFields ? `<div class="section">${section('Base & Delivery')}${baseFields}</div>` : ''}
        </div>`;
      }).join('');

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,sans-serif;padding:12px;color:#2B3735;font-size:12px;background:#f5f5f5;}
  .header{text-align:center;padding:12px 0;border-bottom:2px solid #143F46;margin-bottom:12px;}
  .header h1{color:#143F46;font-size:18px;margin:0;}
  .header p{color:#888;font-size:11px;margin:4px 0 0;}
  .main-section{background:#fff;border-radius:8px;padding:12px;margin-bottom:14px;border:1px solid #e0e0e0;}
  .main-title{font-size:13px;font-weight:bold;color:#143F46;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #eee;}
  .kv{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dotted #eee;}
  .kl{color:#666;font-size:11px;flex-shrink:0;}
  .vv{font-weight:600;font-size:11px;text-align:right;color:#2B3735;}
  .stone-card{background:#fff;border-radius:8px;padding:12px;margin-bottom:12px;border:1px solid #e0e0e0;}
  .stone-header{background:#143F46;color:#fff;padding:6px 10px;border-radius:6px;font-size:13px;font-weight:bold;margin-bottom:10px;}
  .section{margin-bottom:8px;}
  .stitle{font-size:11px;font-weight:bold;color:#BFA26C;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;}
</style></head><body>
  <div class="header">
    <h1>Order Data - ${styleCode}</h1>
    <p>Stones: ${stoneCount} | Generated: ${timestamp}</p>
  </div>
  <div class="main-section">
    <div class="main-title">Enquiry Details</div>
    ${mainFields}
  </div>
  ${stoneCards}
</body></html>`;

      return { success: true, html, stoneCount };
    } catch (error) {
      console.error('[generateExcelPdf] Error:', error);
      return { success: false, html: null, stoneCount: 0 };
    }
  }, [handleFinalExcelGeneration]);



  return {
    handleAcceptApproval,
    handleMoveToOrderPlacement,
    handleFinalExcelGeneration,
    generateAndShareExcel,
    generateExcelPdf,
    fetchEnquiryById,
    enquiryData,
    isLoading: isUpdating,
  };
};
