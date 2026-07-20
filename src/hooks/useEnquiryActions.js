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
import { matchSizeToCatalog } from '../constants/referenceMappings';
import { injectStockTypeDropdown } from '../utils/excelDropdown';
import { getCategoryCode, getStoneItemCode, getStoneSieveCode, getGatiStockTypes, getDefaultGatiStockType, getToneCode } from '../constants/gatiCodes';


const getEnquiryId = (enquiry) =>
  enquiry?.Id || enquiry?._id || enquiry?.id || enquiry?._originalData?._id;

const getClientId = (enquiry) =>
  enquiry?.ClientId || enquiry?.clientId;

// Resolve the assigned designer id from the enquiry: top-level field, else the
// latest StatusHistory entry that has one.
const getAssignedId = (raw) => {
  if (raw?.AssignedTo) return raw.AssignedTo;
  if (raw?.CurrentAssignedTo) return raw.CurrentAssignedTo;
  const hist = Array.isArray(raw?.StatusHistory) ? raw.StatusHistory : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i]?.AssignedTo) return hist[i].AssignedTo;
  }
  return null;
};

const STYLE_MASTER_HEADERS = [
  'SrNo', 'InwardDate', 'JewelCode', 'JewelAliasNo', 'StyleCode', 'Manufacturer',
  'Category', 'SubCategory', 'StockType', 'MakeType', 'InwardQty', 'ItemPcs',
  'Collection', 'isBaseCollection', 'ItemSize', 'ItemCode', 'Size', 'SetCode',
  'RawFormula', 'Pcs', 'Weight', 'Rate', 'Amount', 'DisMarkupOn',
  'DisMarkupPer', 'DisMarkupAmt', 'CostRate', 'CostAmount', 'DisMarkupCostOn', 'DisMarkupCostPer',
  'DisMarkupCostAmt', 'MItemCode', 'NetWt', 'MRate', 'MAmt', 'MDisMarkupOn',
  'MDisMarkupPer', 'MDisMarkupAmt', 'MCostRate', 'MCostAmt', 'MDisMarkupCostOn', 'MDisMarkupCostPer',
  'MDisMarkupCostAmt', 'CPFRate', 'CPFIsFix', 'CPFAmt', 'CPFDisMarkupPer', 'CPFAmtDisMarkupPer',
  'CPFCostRate', 'CPFCostIsFix', 'CPFCostAmt', 'CPFDisMarkupCostPer', 'CPFAmtDisMarkupCostPer', 'MakingOn',
  'MakingCostOn', 'Remarks', 'MiscRemarks', 'Currency', 'CurrencyValue', 'RateChartCode',
  'StyleAliasNo', 'SalePlusPer', 'SalePlusIsFix', 'SalePlusAmt', 'CostPlusPer', 'CostPlusIsFix',
  'CostPlusAmt', 'OrderDate', 'OrderNo', 'PurchaseOrderNoOrBagNo', 'PurchaseOrderNoSrNoOrBagNo', 'OrderCustomerCode',
  'OrderCustomerName', 'OrderSalesPersonCode', 'OrderSalesPersonName', 'Brand', 'Gender', 'ItemPoNo',
  'PoNo', 'PoDate', 'ExpDelDate', 'CostDiscountPer', 'CostDiscountIsFix', 'CostDiscountAmt',
  'SaleDiscountPer', 'SaleDiscountIsFix', 'SaleDiscountAmt', 'Restricted', 'IsComplete', 'TagPrice',
  'ProductCode', 'ReOrderQty', 'MasterQty', 'StampingInstruction', 'CustomerProductionInstruction', 'DesignProductionInstruction',
  'SpecialRemarks', 'StyleHistory', 'FixPrice', 'WaxWt', 'ModelWt', 'Jewelry_LabName',
  'Jewelry_CertificateNo', 'BaseMetalCalculationCode', 'BaseMetalCalculationCostCode', 'MouldNo', 'MouldDescription', 'MouldQty',
  'MouldWtDesc', 'ExplorationCode', 'ExplorationValue', 'Location', 'Branch', 'PartyStyle_CustomerName',
  'ReferenceStyleCode', 'MfgCode', 'AccessoriesCode', 'BatchNo', 'CertiBatchNo', 'NBatchNo',
  'NRate', 'Description', 'SetCostRate', 'SetCostAmount', 'SetDisMarkupCostOn', 'SetDisMarkupCostPer',
  'SetRate', 'SetAmount', 'SetDisMarkupOn', 'SetDisMarkupPer', 'HandCostRate', 'HandCostAmount',
  'HandDisMarkupCostOn', 'HandDisMarkupCostPer', 'HandRate', 'HandAmount', 'HandDisMarkupOn', 'HandDisMarkupPer',
  'StonePosition', 'LossPer', 'MetalLossPerCalcOn', 'LossPerIsFix', 'LossWeight', 'LossCostPer',
  'MetalLossPerCalcCostOn', 'LossCostPerIsFix', 'LossCostWeight', 'MakeDate', 'HsnName', 'NotBase_CPFRate',
  'NotBase_CPFIsFix', 'NotBase_CPFAmt', 'NotBase_CPFDisMarkupPer', 'NotBase_CPFAmtDisMarkupPer', 'NotBase_CPFCostRate', 'NotBase_CPFCostIsFix',
  'NotBase_CPFCostAmt', 'NotBase_CPFDisMarkupCostPer', 'NotBase_CPFAmtDisMarkupCostPer', 'NotBase_LossPer', 'NotBase_MetalLossPerCalcOn', 'NotBase_LossPerIsFix',
  'NotBase_LossWeight', 'NotBase_LossCostPer', 'NotBase_MetalLossPerCalcCostOn', 'NotBase_LossCostPerIsFix', 'NotBase_LossCostWeight', 'Parts',
  'MPcs', 'MAccessoriesCode', 'MBatchNo', 'MCertiBatchNo', 'MNBatchNo', 'MNRate',
  'MSize', 'MSetCode', 'MDescription', 'MSetCostRate', 'MSetCostAmount', 'MSetDisMarkupCostOn',
  'MSetDisMarkupCostPer', 'MSetRate', 'MSetAmount', 'MSetDisMarkupOn', 'MSetDisMarkupPer', 'MHandCostRate',
  'MHandCostAmount', 'MHandDisMarkupCostOn', 'MHandDisMarkupCostPer', 'MHandRate', 'MHandAmount', 'MHandDisMarkupOn',
  'MHandDisMarkupPer', 'WebDescription', 'ParentStyleCode', 'DesignBy', 'MinWeight', 'MaxWeight',
  'StoneWt', 'DefaultWt', 'ProductionWeight', 'MMinWeight', 'MMaxWeight', 'MStoneWt',
  'MDefaultWt', 'MProductionWeight', 'UnitPriceRounding', 'UnitCostPriceRounding', 'RhodiumInstruction', 'DiamondInstruction',
  'SizeInstruction', 'EndClientPrice', 'ProductionRouteCode', 'JewelryColor',
];

// Style Master built to the SJE Plus / Gati "Default Format" (214 columns).
// Values are set BY COLUMN NAME so positions stay correct. Row layout mirrors the
// macro: style/metal fields fold onto the first stone row; remaining rows are stones.
const generateStyleMasterData = (raw, stones, pricing) => {
  const category = raw?.Category || '';
  const subCategory = raw?.subCategory || raw?.SubCategory || '';
  const metalQuality = raw?.Metal?.Quality || '';
  const isRing = category.toLowerCase() === 'ring';
  const rawSize = isRing ? (raw?.Checklist?.SizeRingSize || '') : (raw?.Checklist?.SizeLength || '');
  const itemSize = matchSizeToCatalog(rawSize === 'NA' ? '' : rawSize, category);
  const metalWt = pricing?.Metal?.Weight || '';
  const defaultStockType = getDefaultGatiStockType(metalQuality, stones.length > 0);
  const metalInitial = /plat|pt/i.test(metalQuality) ? 'P' : /silver|925/i.test(metalQuality) ? 'S' : 'G';
  const qualityNum = String(metalQuality || '').replace(/[^0-9]/g, '');
  const metalItemCode = `${metalInitial}${qualityNum}KT`; // metal code e.g. "G14KT" (per reference import)
  const cadDesigner = getUserName(getAssignedId(raw));
  const inwardDate = raw?.CreatedDate ? new Date(raw.CreatedDate) : new Date();
  const styleNo = raw?.StyleNumber || '';

  const headers = STYLE_MASTER_HEADERS;
  const IDX = {};
  headers.forEach((h, i) => { if (!(h in IDX)) IDX[h] = i; });
  const blank = () => new Array(headers.length).fill(null);
  const setCol = (row, name, val) => { const i = IDX[name]; if (i != null) row[i] = val; };

  // Metal / style header row (SrNo=1) — mirrors the successful 502216R import.
  const metal = blank();
  setCol(metal, 'SrNo', 1);
  setCol(metal, 'InwardDate', inwardDate);
  setCol(metal, 'StyleCode', styleNo);
  setCol(metal, 'Manufacturer', 'chandra jewels');
  setCol(metal, 'Category', getCategoryCode(category));
  setCol(metal, 'SubCategory', subCategory);
  setCol(metal, 'StockType', defaultStockType);
  setCol(metal, 'MakeType', 'Casting');
  setCol(metal, 'InwardQty', 1);
  setCol(metal, 'ItemPcs', 1);
  setCol(metal, 'ItemCode', metalItemCode);
  setCol(metal, 'RawFormula', 'WEIGHT*RATE');
  setCol(metal, 'Weight', metalWt);
  setCol(metal, 'MakingOn', 'ZRA');
  setCol(metal, 'MakingCostOn', 'ZRA');
  setCol(metal, 'Currency', 'USD');
  setCol(metal, 'RateChartCode', 'ZRA');
  setCol(metal, 'StyleAliasNo', styleNo);
  setCol(metal, 'DesignBy', cadDesigner);

  // Stone rows — ItemCode = stone item code, Size = sieve, only Pcs + Weight (no Rate/Amount).
  const stoneRows = stones.map((stone, index) => {
    const row = blank();
    const pcs = stone.Pcs || 0;
    const totWt = (stone.CtWeight != null && stone.CtWeight !== '')
      ? stone.CtWeight
      : (Number(stone.Weight || 0) * Number(pcs));
    setCol(row, 'SrNo', index + 2);
    setCol(row, 'InwardDate', inwardDate);
    setCol(row, 'StyleCode', styleNo);
    setCol(row, 'ItemCode', getStoneItemCode(stone));
    setCol(row, 'Size', getStoneSieveCode(stone)); // MM size -> Gati sieve code
    setCol(row, 'SetCode', stone.SetCode || stone.SetTyp || '');
    setCol(row, 'RawFormula', 'WEIGHT*RATE');
    setCol(row, 'Pcs', pcs);
    setCol(row, 'Weight', totWt);
    return row;
  });

  return { headers, rows: [metal, ...stoneRows] };
};


// Order Data — "Quotation Order" report layout (one aggregated row per order).
const ORDER_QUOTATION_HEADERS = [
  'Image', 'SNo', 'Style No', 'Category', 'Size', 'Qty', 'Tot GrossWt', 'Net Wt',
  'Net Wt(B)', 'Net Wt(NB)', 'Metal', 'Color', 'Priority', 'Stock Type', 'Make Type',
  'Dia Pc', 'Dia Wt', 'CS Pc', 'CS Wt', 'CZ Pc', 'CZ Wt', 'Making Chart', 'Metal Amt',
  'Dia Amt', 'CS Amt', 'CZ Amt', 'Setting Amt', 'Making Amt', 'Xchg Amt', 'Loss Amt',
  'Item Price', 'Total Price', 'Set Price',
];

const generateOrderQuotationRow = (raw, stones, pricing) => {
  const category = raw?.Category || '';
  const metalQuality = raw?.Metal?.Quality || '';
  const metalColor = raw?.Metal?.Color || raw?.Metal?.Type || '';
  const isRing = category.toLowerCase() === 'ring';
  const rawSize = isRing ? (raw?.Checklist?.SizeRingSize || '') : (raw?.Checklist?.SizeLength || '');
  const itemSize = matchSizeToCatalog(rawSize === 'NA' ? '' : rawSize, category);
  const qty = raw?.Quantity || 1;
  const metalWt = pricing?.Metal?.Weight || '';
  const stockType = getDefaultGatiStockType(metalQuality, stones.length > 0);

  let diaPc = 0, diaWt = 0, csPc = 0, csWt = 0, czPc = 0, czWt = 0;
  stones.forEach((s) => {
    const t = String(s.Type || '').toLowerCase();
    const pcs = Number(s.Pcs || 0);
    const wt = (s.CtWeight != null && s.CtWeight !== '') ? Number(s.CtWeight) : Number(s.Weight || 0) * pcs;
    if (t.includes('cz') || t.includes('cubic') || t.includes('zircon')) { czPc += pcs; czWt += wt; }
    else if (t.includes('lab') || t.includes('cvd') || t.includes('diamond') || t.includes('natural') || t.includes('moissan')) { diaPc += pcs; diaWt += wt; }
    else { csPc += pcs; csWt += wt; }
  });

  const n = (v) => Number(v || 0);
  const round = (v, d) => (v ? Number(v.toFixed(d)) : '');
  const itemPrice = n(pricing?.TotalPrice);
  const byName = {
    'Image': '', 'SNo': 1, 'Style No': raw?.StyleNumber || '', 'Category': category,
    'Size': itemSize, 'Qty': qty, 'Tot GrossWt': metalWt, 'Net Wt': metalWt,
    'Net Wt(B)': '', 'Net Wt(NB)': '', 'Metal': metalQuality,
    'Color': getToneCode(metalColor), 'Priority': raw?.Priority || '',
    'Stock Type': stockType, 'Make Type': 'Casting',
    'Dia Pc': diaPc || '', 'Dia Wt': round(diaWt, 3), 'CS Pc': csPc || '', 'CS Wt': round(csWt, 3),
    'CZ Pc': czPc || '', 'CZ Wt': round(czWt, 3), 'Making Chart': '',
    'Metal Amt': round(n(pricing?.MetalPrice), 2), 'Dia Amt': round(n(pricing?.DiamondsPrice), 2),
    'CS Amt': '', 'CZ Amt': '', 'Setting Amt': '', 'Making Amt': '', 'Xchg Amt': '',
    'Loss Amt': round(n(pricing?.DutiesAmount), 2), 'Item Price': round(itemPrice, 2),
    'Total Price': round(itemPrice * qty, 2), 'Set Price': '',
  };
  return ORDER_QUOTATION_HEADERS.map((h) => (byName[h] === '' ? null : byName[h]));
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

  const handleAcceptApproval = useCallback(async (enquiry, coralVersion, cadVersion, approvedCoral, approvedCad, approvalMessage) => {
    const enquiryId = getEnquiryId(enquiry);
    const raw = enquiry?._originalData || enquiry;
    const assignedTo = raw?.AssignedTo || null;

    const hasCoral = !!coralVersion;
    const hasCad = !!cadVersion;
    const hasApprovedCoral = !!approvedCoral;
    const hasApprovedCad = !!approvedCad;
    const remarks = approvalMessage || '';

    console.log('[handleAcceptApproval] enquiryId:', enquiryId, 'hasCoral:', hasCoral, 'hasCad:', hasCad, 'hasApprovedCoral:', hasApprovedCoral, 'hasApprovedCad:', hasApprovedCad, 'coralVersion:', coralVersion, 'cadVersion:', cadVersion, 'approvalMessage:', remarks);

    if (hasApprovedCoral && hasCad) {
      await updateAssetData({
        enquiryId,
        type: 'cad',
        version: cadVersion,
        data: { IsApprovedVersion: true, ReasonForRejection: remarks },
      }).unwrap();
      return { success: true };
    }

    if (hasApprovedCad) {
      await updateEnquiry({
        id: enquiryId,
        CurrentSubStatus: SUBSTATUS.FU,
        ClientId: getClientId(enquiry),
        ...(assignedTo ? { AssignedTo: assignedTo } : {}),
        ApprovalRemarks: remarks,
      }).unwrap();
      return { success: true };
    }

    if (hasCoral) {
      await updateAssetData({
        enquiryId,
        type: 'coral',
        version: coralVersion,
        data: { IsApprovedVersion: true, ReasonForRejection: remarks },
      }).unwrap();
      return { success: true };
    }

    if (hasCad) {
      await updateAssetData({
        enquiryId,
        type: 'cad',
        version: cadVersion,
        data: { IsApprovedVersion: true, ReasonForRejection: remarks },
      }).unwrap();
      return { success: true };
    }

    await updateAssetData({
      enquiryId,
      type: 'coral',
      version: '1',
      data: { IsApprovedVersion: true, ReasonForRejection: remarks },
    }).unwrap();
    return { success: true };
  }, [updateAssetData, updateEnquiry]);

  const handleMoveToOrderPlacement = useCallback(async (enquiry) => {
    const enquiryId = getEnquiryId(enquiry);
    const raw = enquiry?._originalData || enquiry;
    console.log('[handleMoveToOrderPlacement] enquiryId:', enquiryId, 'raw.Metal:', JSON.stringify(raw?.Metal));
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
      const enquiryId = getEnquiryId(enquiry);
      const raw = enquiry?._originalData || enquiry;
      console.log('[handleFinalExcelGeneration] enquiryId:', enquiryId, 'raw keys:', Object.keys(raw || {}));
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
      // Metal code = metal-name initial (Gold=G, Silver=S, Platinum=P) + karat + KT, e.g. "G18KT"
      const metalNameInitial = /plat|pt/i.test(metalQuality) ? 'P' : /silver|925/i.test(metalQuality) ? 'S' : 'G';
      const qualityNum = String(metalQuality || '').replace(/[^0-9]/g, '');
      const mItemCode = `${metalNameInitial}${qualityNum}KT`;
      console.log('[handleFinalExcelGeneration] Metal source: raw.Metal:', JSON.stringify(raw?.Metal), 'metalColor:', metalColor, 'metalQuality:', metalQuality, 'mItemCode:', mItemCode);

      const isRing = category.toLowerCase() === 'ring';
      const rawSize = isRing
        ? (raw?.Checklist?.SizeRingSize || '')
        : (raw?.Checklist?.SizeLength || '');
      const itemSize = matchSizeToCatalog(rawSize, category);

      const mainData = {
        StyleCode: raw?.StyleNumber || '',
        ItemSize: itemSize,
        OrderQty: raw?.Quantity || 0,
        Metal: mItemCode,
        Tone: metalColor || '',
        SpecialRemarks: raw?.SpecialRemarks || '',
        StampInstruction: raw?.Stamping || '',
      };

      // Order Import Sheet is ONE row per order — stone data is NOT repeated here.
      // OrderItemPcs and MakeType are static.
      const rows = [{
        SrNo: 1,
        StyleCode: mainData.StyleCode,
        ItemSize: mainData.ItemSize,
        OrderQty: mainData.OrderQty,
        OrderItemPcs: 1,
        Metal: mainData.Metal,
        Tone: mainData.Tone,
        ItemPoNo: '',
        ItemRefNo: '',
        StockType: '',
        MakeType: 'Casting',
        CustomerProductionInstruction: '',
        SpecialRemarks: mainData.SpecialRemarks,
        DesignProductionInstruction: '',
        StampInstruction: mainData.StampInstruction,
        OrderGroup: '',
        Certificate: '',
        SKUNo: '',
        Basestoneminwt: '',
        Basestonemaxwt: '',
        Basemetalminwt: '',
        Basemetalmaxwt: '',
        Productiondeliverydate: '',
        Expecteddeliverydate: '',
        '': '',
        SetPrice: '',
        StoneQuality: '',
        RhodiumInstruction: '',
        DiamondInstruction: '',
        SizeInstruction: '',
        EndClientPrice: '',
      }];

      console.log('[handleFinalExcelGeneration] mainData:', JSON.stringify(mainData), 'stoneCount:', stones.length, 'firstRow:', rows.length > 0 ? JSON.stringify(rows[0]) : 'none');
      return { mainData, rows, stoneCount: stones.length };
    } catch (error) {
      console.error('[handleFinalExcelGeneration] Error:', error);
      return { mainData: null, rows: [], stoneCount: 0 };
    }
  }, []);

  const generateAndShareExcel = useCallback(async (enquiry) => {
    try {
      const enquiryId = getEnquiryId(enquiry);
      const raw = enquiry?._originalData || enquiry;
      console.log('[generateAndShareExcel] enquiryId:', enquiryId, 'raw.Metal:', JSON.stringify(raw?.Metal), 'styleNumber:', raw?.StyleNumber);

      const { mainData, rows, stoneCount } = await handleFinalExcelGeneration(enquiry);

      if (!rows || rows.length === 0) {
        return { success: false, message: 'No stones found in final CAD' };
      }
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
      console.log('[generateAndShareExcel] StyleMaster metalColor from row[7]:', styleMasterData.rows[0]?.[7], 'headers:', styleMasterData.headers);
      const smWb = XLSX.utils.book_new();
      const smWs = XLSX.utils.aoa_to_sheet([styleMasterData.headers, ...styleMasterData.rows]);
      smWs['!cols'] = styleMasterData.headers.map(() => ({ wch: 18 }));
      XLSX.utils.book_append_sheet(smWb, smWs, 'Style Master');

      // StockType dropdown (column I) — Gati stock-type values (as in the 502216R import),
      // valid default first.
      const smQuality = raw?.Metal?.Quality || '';
      const smDefault = getDefaultGatiStockType(smQuality, stones.length > 0);
      const smStockOptions = [
        smDefault,
        ...getGatiStockTypes(smQuality).filter(n => n !== smDefault),
      ];
      let smBase64 = XLSX.write(smWb, { type: 'base64', bookType: 'xlsx' });
      smBase64 = await injectStockTypeDropdown(smBase64, {
        column: 'I',        // StockType column in the Style Master
        firstRow: 2,        // metal/style row
        lastRow: 2,
        options: smStockOptions,
      });

      // --- Generate Order Data Excel (Quotation Order report layout) ---
      const NCOL = ORDER_QUOTATION_HEADERS.length; // 33
      const titleRow = new Array(NCOL).fill('');
      titleRow[0] = 'CHANDRA JEWELS PVT. LTD.';
      titleRow[10] = 'Quotation Order';
      const spacerRow = new Array(NCOL).fill('');
      const dataRow = generateOrderQuotationRow(raw, stones, pricing);
      const now = new Date();
      const p2 = (x) => String(x).padStart(2, '0');
      const stamp = `[admin] : ${p2(now.getDate())}:${p2(now.getMonth() + 1)}:${now.getFullYear()} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
      const adminRow = new Array(NCOL).fill('');
      adminRow[0] = stamp;

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([titleRow, spacerRow, ORDER_QUOTATION_HEADERS, dataRow, adminRow]);
      ws['!cols'] = ORDER_QUOTATION_HEADERS.map(() => ({ wch: 13 }));
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },   // A1:J1 title
        { s: { r: 0, c: 10 }, e: { r: 0, c: 19 } },  // K1:T1 "Quotation Order"
        { s: { r: 4, c: 0 }, e: { r: 4, c: 9 } },    // A5:J5 admin stamp
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
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
