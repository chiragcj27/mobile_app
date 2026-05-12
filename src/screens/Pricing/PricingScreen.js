import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Text,
  Alert,
  Switch,
  Modal,
  TextInput,
  FlatList,
  Dimensions,
  InteractionManager,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from '../../components/cards/Cards';
import { Input } from '../../components/common';
import { CustomText, Heading } from '../../components/common/Text';
import Icon from '../../components/common/Icon'; 
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { formatCurrency } from '../../utils/helpers';
import { useGetMetalPricesQuery, useCalculatePricingMutation, useSavePricingMutation, useGetEnquiryByIdQuery, useGetStoneTypesQuery } from '../../store/api';
import { API_BASE_URL } from '../../config/apiConfig';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as XLSX from 'xlsx';
import useDeviceLayout from '../../hooks/useDeviceLayout';
import { DUTY_FIELDS, computeApplicable, readDutyRates } from '../../utils/pricingDuties';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const PricingScreen = ({ route, navigation }) => {
  const { enquiry: routeEnquiry, designType, enquiryId } = route.params || {}; // designType: 'coral' or 'cad'
  const { isTablet, width } = useDeviceLayout();
  
  // Get enquiry ID
  const finalEnquiryId = enquiryId || routeEnquiry?.id || routeEnquiry?._id;
  
  // Fetch fresh enquiry data - this will refetch when cache is invalidated
  const { data: fetchedEnquiry, refetch: refetchEnquiry, isLoading: isLoadingEnquiry } = useGetEnquiryByIdQuery(finalEnquiryId, {
    skip: !finalEnquiryId,
    refetchOnFocus: true, // Refetch when screen comes into focus
    refetchOnMountOrArgChange: true, // Refetch when enquiryId changes
  });

  // Fetch stone types from API
  const { data: stoneTypesData = [] } = useGetStoneTypesQuery();
  
  // Metal quality options
  const metalQualityOptions = [
    { label: '10K', value: '10K' },
    { label: '14K', value: '14K' },
    { label: '18K', value: '18K' },
    { label: '22K', value: '22K' },
    { label: 'Silver 925', value: 'Silver 925' },
    { label: 'Platinum', value: 'Platinum' },
  ];
  
  // Use fetched enquiry if available, otherwise fall back to route params
  const enquiry = fetchedEnquiry || routeEnquiry;
  const originalData = enquiry?._originalData || enquiry;

  // Memoize design data to ensure it updates when enquiry changes
  const designData = useMemo(() => {
    return designType === 'coral' 
    ? (originalData?.Coral || enquiry?.Coral || [])
    : (originalData?.Cad || enquiry?.Cad || []);
  }, [designType, originalData, enquiry]);
  
  // Memoize latest design to ensure it updates when designData changes
  // Priority: Find version with pricing data, otherwise use latest version
  const latestDesign = useMemo(() => {
    if (!designData || designData.length === 0) return null;
    
    // First, try to find the latest version that has pricing data
    for (let i = designData.length - 1; i >= 0; i--) {
      const design = designData[i];
      const pricing = design?.Pricing || design?.pricing;
      
      // Check if this version has pricing data
      if (pricing && (
        (Array.isArray(pricing) && pricing.length > 0) ||
        (typeof pricing === 'object' && Object.keys(pricing).length > 0)
      )) {
        return design;
      }
    }
    
    // If no version has pricing, fall back to the latest version
    return designData[designData.length - 1];
  }, [designData]);
  
  // Memoize pricing extraction to ensure it updates when latestDesign changes
  const rawPricing = useMemo(() => {
    const pricing = latestDesign?.Pricing || latestDesign?.pricing || {};
    return pricing;
  }, [latestDesign]);
  
  // Get all pricing entries as an array
  const allPricingEntries = useMemo(() => {
    if (Array.isArray(rawPricing) && rawPricing.length > 0) {
      return rawPricing; // Return all pricing entries
    } else if (rawPricing && typeof rawPricing === 'object' && Object.keys(rawPricing).length > 0) {
      return [rawPricing]; // Convert single object to array
    }
    return []; // Return empty array if no pricing
  }, [rawPricing]);
  
  // Use the latest (last) pricing entry since new saves are appended to the array
  const existingPricing = useMemo(() => {
    return allPricingEntries.length > 0 ? allPricingEntries[allPricingEntries.length - 1] : {};
  }, [allPricingEntries]);
  
  
  // Normalize stones data - map API field names to UI field names
  // Memoized with useCallback to prevent function recreation on every render
  const normalizeStones = useCallback((rawStones) => {
    if (!Array.isArray(rawStones) || rawStones.length === 0) return [];
    return rawStones.map(stone => ({
      Type: stone.Type || stone.type || '',
      Color: stone.Color || stone.color || '',
      Shape: stone.Shape || stone.shape || '',
      MM: (stone.MmSize || stone.MM || stone.mmSize || stone.mm || '').toString(),
      Sieve: (stone.SieveSize || stone.Sieve || stone.sieveSize || stone.sieve || '').toString(),
      Weight: (stone.Weight || stone.weight || 0).toString(),
      Pieces: (stone.Pcs || stone.Pieces || stone.pcs || stone.pieces || 0).toString(),
      CaratWeight: (stone.CtWeight || stone.CaratWeight || stone.ctWeight || stone.caratWeight || 0).toString(),
      Price: (stone.Price || stone.price || 0).toString(),
    }));
  }, []);
  
  // Initialize state for all pricing entries - each entry has its own formData and stones
  // Memoized with useCallback to prevent function recreation on every render
  const initializePricingEntryState = useCallback((pricingEntry) => {
    // Get metal quality from pricing entry or fallback to enquiry
    const entryMetalQuality = pricingEntry?.Metal?.Quality || 
                              originalData?.Metal?.Quality || 
                              enquiry?.Metal?.Quality || 
                              '10K';
    
    const rates = readDutyRates(pricingEntry || {});
    return {
      formData: {
        metalPrice: (pricingEntry?.MetalPrice || pricingEntry?.metalPrice || 0).toString(),
        diamondPrice: (pricingEntry?.DiamondPrice || pricingEntry?.DiamondsPrice || pricingEntry?.diamondPrice || 0).toString(),
        totalPrice: (pricingEntry?.TotalPrice || pricingEntry?.totalPrice || 0).toString(),
        metalWeight: (pricingEntry?.Metal?.Weight || pricingEntry?.MetalWeight || pricingEntry?.metalWeight || 0).toString(),
        diamondWeight: (pricingEntry?.DiamondWeight || pricingEntry?.diamondWeight || 0).toString(),
        totalPieces: (pricingEntry?.TotalPieces || pricingEntry?.totalPieces || 0).toString(),
        lossPercent: (pricingEntry?.LossPercent || pricingEntry?.lossPercent || pricingEntry?.Loss || 0).toString(),
        labour: (pricingEntry?.Labour || pricingEntry?.labour || 0).toString(),
        naturalDuties: rates.NaturalDuties.toString(),
        labDuties: rates.LabDuties.toString(),
        goldDuties: rates.GoldDuties.toString(),
        silverAndLabsDuties: rates.SilverAndLabsDuties.toString(),
        lossAndLabourDuties: rates.LossAndLabourDuties.toString(),
        dutiesAmount: (pricingEntry?.DutiesAmount || pricingEntry?.dutiesAmount || 0).toString(),
        extraCharges: (pricingEntry?.ExtraCharges || pricingEntry?.extraCharges || 0).toString(),
        undercutPrice: (pricingEntry?.UndercutPrice || pricingEntry?.undercutPrice || 0).toString(),
        clientPricingMessage: pricingEntry?.ClientPricingMessage || '',
        metalQuality: entryMetalQuality,
        metalRateOverride: (pricingEntry?.Metal?.Rate || pricingEntry?.MetalRate || '').toString(),
      },
      stones: normalizeStones(pricingEntry?.Stones || pricingEntry?.stones || []),
      undercutEnabled: !!(pricingEntry?.UndercutPrice || pricingEntry?.undercutPrice),
      applicable: null,
    };
  }, [normalizeStones, originalData, enquiry]);

  // State for all pricing entries - array of { formData, stones, undercutEnabled }
  const [pricingEntriesState, setPricingEntriesState] = useState(() => {
    if (allPricingEntries.length > 0) {
      return allPricingEntries.map(entry => initializePricingEntryState(entry));
    }
    // If no existing entries, create one empty entry for new pricing
    const defaultMetalQuality = originalData?.Metal?.Quality || enquiry?.Metal?.Quality || '10K';
    return [{
      formData: {
        metalPrice: '0',
        diamondPrice: '0',
        totalPrice: '0',
        metalWeight: '0',
        diamondWeight: '0',
        totalPieces: '0',
        lossPercent: '0',
        labour: '0',
        naturalDuties: '0',
        labDuties: '0',
        goldDuties: '0',
        silverAndLabsDuties: '0',
        lossAndLabourDuties: '0',
        dutiesAmount: '0',
        extraCharges: '0',
        undercutPrice: '0',
        clientPricingMessage: '',
        metalQuality: defaultMetalQuality,
        metalRateOverride: '',
      },
      stones: [],
      undercutEnabled: false,
      applicable: null,
    }];
  });

  // For backward compatibility, keep existing formData and stones for the latest/new entry
  const latestEntryIndex = pricingEntriesState.length - 1;
  const formData = pricingEntriesState[latestEntryIndex]?.formData || {
    metalPrice: '0', diamondPrice: '0', totalPrice: '0', metalWeight: '0',
    diamondWeight: '0', totalPieces: '0', lossPercent: '0', labour: '0',
    naturalDuties: '0', labDuties: '0', goldDuties: '0', silverAndLabsDuties: '0', lossAndLabourDuties: '0',
    dutiesAmount: '0', extraCharges: '0', undercutPrice: '0', clientPricingMessage: '',
    metalRateOverride: '',
  };
  const stones = pricingEntriesState[latestEntryIndex]?.stones || [];
  const undercutEnabled = pricingEntriesState[latestEntryIndex]?.undercutEnabled || false;

  // Helper to update formData (updates latest entry)
  const setFormData = (newFormData) => {
    setPricingEntriesState(prev => {
      const updated = [...prev];
      updated[latestEntryIndex] = {
        ...updated[latestEntryIndex],
        formData: typeof newFormData === 'function' ? newFormData(updated[latestEntryIndex].formData) : newFormData,
      };
      return updated;
    });
  };

  // Helper to update stones (updates latest entry)
  const setStones = (newStones) => {
    setPricingEntriesState(prev => {
      const updated = [...prev];
      updated[latestEntryIndex] = {
        ...updated[latestEntryIndex],
        stones: typeof newStones === 'function' ? newStones(updated[latestEntryIndex].stones) : newStones,
      };
      return updated;
    });
  };

  // Helper to set undercut enabled (updates latest entry)
  const setUndercutEnabled = (value) => {
    setPricingEntriesState(prev => {
      const updated = [...prev];
      updated[latestEntryIndex] = {
        ...updated[latestEntryIndex],
        undercutEnabled: typeof value === 'function' ? value(updated[latestEntryIndex].undercutEnabled) : value,
      };
      return updated;
    });
  };

  // Refetch enquiry data when screen comes into focus (after saving)
  useFocusEffect(
    React.useCallback(() => {
      if (finalEnquiryId) {
        
        // Refetch enquiry data to get latest pricing
        refetchEnquiry();
      }
    }, [finalEnquiryId, refetchEnquiry])
  );

  // Update all pricing entries state when pricing data changes
  useEffect(() => {
    if (allPricingEntries.length > 0) {
      const updatedEntries = allPricingEntries.map(entry => initializePricingEntryState(entry));
      setPricingEntriesState(prev => {
        // Only update if the data has actually changed
        // But preserve any new entries that were added in UI but not yet saved
        // (entries beyond the length of allPricingEntries)
        const hasChanges = JSON.stringify(updatedEntries) !== JSON.stringify(prev.slice(0, updatedEntries.length));
        
        if (hasChanges) {
          // Keep any additional entries that were added in UI but not yet in API data
          const additionalEntries = prev.slice(updatedEntries.length);
          return [...updatedEntries, ...additionalEntries];
        }
        return prev;
      });
    } else if (pricingEntriesState.length === 0) {
      // If no existing entries, create one empty entry for new pricing
      setPricingEntriesState([{
        formData: {
          metalPrice: '0', diamondPrice: '0', totalPrice: '0', metalWeight: '0',
          diamondWeight: '0', totalPieces: '0', lossPercent: '0', labour: '0',
          naturalDuties: '0', labDuties: '0', goldDuties: '0', silverAndLabsDuties: '0', lossAndLabourDuties: '0',
          extraCharges: '0', undercutPrice: '0', clientPricingMessage: '',
          metalRateOverride: '',
        },
        stones: [],
        undercutEnabled: false,
        applicable: null,
      }]);
    }
  }, [allPricingEntries]);

  // Fetch latest metal prices - API is called automatically when component mounts
  const { data: metalPricesData, isLoading: loadingMetalPrices, refetch: refetchMetalPrices } = useGetMetalPricesQuery(false);
  const metalPrices = metalPricesData?.prices || metalPricesData || {};
  
  // Pricing calculation mutation
  const [calculatePricing, { isLoading: isCalculating }] = useCalculatePricingMutation();
  
  // Save pricing mutation
  const [savePricing, { isLoading: isSaving }] = useSavePricingMutation();
  
  // Sync client pricing loading state
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Determine metal type from enquiry (default to gold)
  const metalColor = originalData?.Metal?.Color || enquiry?.Metal?.Color || 'Gold';
  const metalType = metalColor.toLowerCase().includes('gold') ? 'gold' 
    : metalColor.toLowerCase().includes('silver') ? 'silver'
    : metalColor.toLowerCase().includes('platinum') ? 'platinum'
    : 'gold'; // Default to gold
  
  // Get metal rate from API
  const apiMetalRate = metalPrices[metalType]?.price || 0;
  
  // Metal Rate considered for quotation - use existing pricing data if available, otherwise use API rate
  // Priority: Metal.Rate from existing pricing > MetalRateConsidered > API rate
  const [metalRateConsidered, setMetalRateConsidered] = useState(
    existingPricing?.Metal?.Rate || existingPricing?.MetalRate || existingPricing?.MetalRateConsidered || 0
  );
  
  // Latest Metal Rate - always from current API call
  const latestMetalRate = apiMetalRate || 0;

  // Duties amount considered for quotation - the persisted sum across all duty buckets.
  const dutiesConsidered =
    parseFloat(existingPricing?.DutiesAmount ?? existingPricing?.dutiesAmount ?? formData?.dutiesAmount ?? 0) || 0;
  
  // Refetch metal prices when screen loads (when Pricing button is pressed)
  useEffect(() => {
    refetchMetalPrices();
  }, [refetchMetalPrices]);
  
  // Update metalRateConsidered from existing pricing or API if not set
  useEffect(() => {
    // First, try to get from existing pricing
    const rateFromPricing = existingPricing?.Metal?.Rate || existingPricing?.MetalRate || existingPricing?.MetalRateConsidered;
    if (rateFromPricing && rateFromPricing > 0) {
      setMetalRateConsidered(rateFromPricing);
    } else if (apiMetalRate > 0) {
      // Fallback to API rate if no existing pricing rate
      setMetalRateConsidered(apiMetalRate);
    }
  }, [apiMetalRate, existingPricing?.Metal?.Rate, existingPricing?.MetalRate, existingPricing?.MetalRateConsidered]);

  // Debug: Log pricing data structure (after all useState hooks)
  useEffect(() => {
    if (__DEV__) {
    }
  }, [latestDesign, designType]);

  // Get design code for Excel filename
  const designCode = designType === 'coral'
    ? (originalData?.CoralCode || enquiry?.CoralCode || enquiry?.coralCode || '')
    : (originalData?.CadCode || enquiry?.CadCode || enquiry?.cadCode || '');

  const handleInputChange = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleCalculate = async () => {
    let payload = null; // Declare outside try block for error logging
    
    try {
      // Get metal details from enquiry
      const metalColor = originalData?.Metal?.Color || enquiry?.Metal?.Color || 'Gold';
      const metalQuality = originalData?.Metal?.Quality || enquiry?.Metal?.Quality || '10K';
      const metalWeight = parseFloat(formData.metalWeight) || 0;
      
      // Validate metal weight is a positive number
      if (metalWeight < 0) {
        Alert.alert('Validation Error', 'Metal weight cannot be negative');
        return;
      }
      
      // Transform stones array to match API format with validation
      const transformedStones = stones.map((stone, index) => {
        // Validate stone type is provided
        if (!stone.Type || stone.Type.trim() === '') {
          
          return null;
        }
        
        // Validate stone type is a known type (optional check, but helps catch typos)
        const validStoneTypes = [
          'NaturalRegular', 'NaturalLower', 'NaturalHigher', 'Natural',
          'CVDLabGrown', 'HPHTLabGrown', 'LabGrown',
          'Moissanite', 'Diamond', 'Other'
        ];
        const stoneType = stone.Type.trim();
        if (!validStoneTypes.some(valid => stoneType.toLowerCase().includes(valid.toLowerCase()))) {
          
        }
        
        // Parse and validate numeric fields
        const ctWeight = parseFloat(stone.CaratWeight);
        const weight = parseFloat(stone.Weight);
        const pcs = parseInt(stone.Pieces);
        const price = parseFloat(stone.Price);
        
        // Validate numeric values are valid numbers
        if (isNaN(ctWeight) || ctWeight < 0) {
          
        }
        if (isNaN(weight) || weight < 0) {
          
        }
        if (isNaN(pcs) || pcs < 0) {
          
        }
        if (isNaN(price) || price < 0) {
          
        }
        
        // Build transformed stone object - only include fields that have valid values
        const transformed = {
          Type: stone.Type.trim(),
        };
        
        // Only include Color if it's not empty (backend may not accept empty strings)
        if (stone.Color && stone.Color.trim() !== '') {
          transformed.Color = stone.Color.trim();
        }
        
        // Only include Shape if it's not empty
        if (stone.Shape && stone.Shape.trim() !== '') {
          transformed.Shape = stone.Shape.trim();
        }
        
        // MmSize - ensure it's a string, default to '0' if empty
        const mmSize = stone.MM ? stone.MM.toString().trim() : '';
        transformed.MmSize = mmSize !== '' ? mmSize : '0';
        
        // Only include SieveSize if it's not empty
        if (stone.Sieve && stone.Sieve.trim() !== '') {
          transformed.SieveSize = stone.Sieve.trim();
        }
        
        // Numeric fields - ensure they're valid numbers, default to 0 if invalid
        transformed.CtWeight = (isNaN(ctWeight) || ctWeight < 0) ? 0 : Math.max(0, ctWeight);
        transformed.Weight = (isNaN(weight) || weight < 0) ? 0 : Math.max(0, weight);
        transformed.Pcs = (isNaN(pcs) || pcs < 0) ? 0 : Math.max(0, Math.floor(pcs)); // Ensure integer
        transformed.Price = (isNaN(price) || price < 0) ? 0 : Math.max(0, price);
        
        return transformed;
      }).filter(stone => stone !== null && stone.Type); // Remove null entries and ensure Type exists

      if (metalWeight <= 0 && transformedStones.length === 0) {
        Alert.alert(
          'Missing Weight Data',
          'Please provide either metal weight or stone information for pricing calculation.'
        );
        return;
      }

      // Validate and parse numeric fields
      const loss = parseFloat(formData.lossPercent);
      const labour = parseFloat(formData.labour);
      const extraCharges = parseFloat(formData.extraCharges);
      const dutyRates = readDutyRates({
        NaturalDuties: formData.naturalDuties,
        LabDuties: formData.labDuties,
        GoldDuties: formData.goldDuties,
        SilverAndLabsDuties: formData.silverAndLabsDuties,
        LossAndLabourDuties: formData.lossAndLabourDuties,
      });
      const undercutPriceValue = parseFloat(formData.undercutPrice) || 0;
      // Quantity comes from "Total Pieces" input field (formData.totalPieces)
      // const quantity = parseInt(formData.totalPieces);
      const quantity = 1;

      // Validate numeric values
      if (isNaN(loss) || loss < 0) {
        Alert.alert('Validation Error', 'Loss percentage must be a valid positive number');
        return;
      }
      if (isNaN(labour) || labour < 0) {
        Alert.alert('Validation Error', 'Labour must be a valid positive number');
        return;
      }
      if (isNaN(extraCharges) || extraCharges < 0) {
        Alert.alert('Validation Error', 'Extra charges must be a valid positive number');
        return;
      }
      if (Object.values(dutyRates).some((v) => v < 0)) {
        Alert.alert('Validation Error', 'Duty rates must be valid positive numbers');
        return;
      }
      if (isNaN(quantity) || quantity <= 0) {
        Alert.alert('Validation Error', 'Quantity must be a valid positive number greater than 0');
        return;
      }

      // Validate metal quality format (should be like "10K", "14K", "18K", "22K", "24K", etc.)
      const qualityMatch = metalQuality.match(/^(\d+)K$/i);
      if (!qualityMatch) {
        
      }

      // Prepare payload with validated data
      // Ensure all numeric values are properly formatted (no NaN, Infinity, etc.)
      payload = {
        clientId: null, // Calculate button does not send client ID
        details: {
          Metal: {
            Weight: Math.max(0, metalWeight), // Ensure non-negative
            Color: metalColor.trim(), // Remove whitespace
            Quality: metalQuality.trim(), // Remove whitespace
          },
          Stones: transformedStones,
          Loss: Math.max(0, loss),
          Labour: Math.max(0, labour),
          ExtraCharges: Math.max(0, extraCharges),
          UndercutPrice: Math.max(0, undercutPriceValue),
          NaturalDuties: Math.max(0, dutyRates.NaturalDuties),
          LabDuties: Math.max(0, dutyRates.LabDuties),
          GoldDuties: Math.max(0, dutyRates.GoldDuties),
          SilverAndLabsDuties: Math.max(0, dutyRates.SilverAndLabsDuties),
          LossAndLabourDuties: Math.max(0, dutyRates.LossAndLabourDuties),
          // Quantity is added to payload from "Total Pieces" input field (formData.totalPieces)
          Quantity: Math.max(1, Math.floor(quantity)), // Ensure integer and at least 1
        },
      };
      
      console.log('🔵 CALCULATE BUTTON - Client ID Status:');
      console.log('❌ Client ID is NOT being sent (clientId: null)');
      console.log('📦 Payload clientId:', payload.clientId);
      
      // Final payload validation - check for any invalid values
      if (!isFinite(payload.details.Metal.Weight) ||
          !isFinite(payload.details.Loss) ||
          !isFinite(payload.details.Labour) ||
          !isFinite(payload.details.ExtraCharges) ||
          !isFinite(payload.details.NaturalDuties) ||
          !isFinite(payload.details.LabDuties) ||
          !isFinite(payload.details.GoldDuties) ||
          !isFinite(payload.details.SilverAndLabsDuties) ||
          !isFinite(payload.details.LossAndLabourDuties) ||
          !isFinite(payload.details.Quantity)) {
        Alert.alert(
          'Validation Error',
          'One or more numeric fields contain invalid values (NaN or Infinity). Please check your inputs.'
        );
        return;
      }
      
      // Validate stones don't have invalid numeric values
      const hasInvalidStone = transformedStones.some(stone => 
        !isFinite(stone.CtWeight) || 
        !isFinite(stone.Weight) || 
        !isFinite(stone.Pcs) || 
        !isFinite(stone.Price)
      );
      
      if (hasInvalidStone) {
        Alert.alert(
          'Validation Error',
          'One or more stones contain invalid numeric values. Please check stone data.'
        );
        return;
      }

      // Final validation: ensure payload structure is correct
      if (!payload.details.Metal.Weight && payload.details.Stones.length === 0) {
        Alert.alert('Validation Error', 'At least one of Metal Weight or Stones must be provided');
        return;
      }


      // Call API
      const response = await calculatePricing(payload).unwrap();

      // Detailed TotalPrice logging
      console.log('=== API RESPONSE RECEIVED (handleCalculate) ===');
      console.log('Full Response:', JSON.stringify(response, null, 2));
      console.log('=== TOTAL PRICE CHECK ===');
      console.log('TotalPrice exists?', response ? ('TotalPrice' in response) : 'N/A (response is null)');
      if (response) {
        console.log('TotalPrice value:', response.TotalPrice);
        console.log('TotalPrice type:', typeof response.TotalPrice);
        console.log('TotalPrice is null?', response.TotalPrice === null);
        console.log('TotalPrice is undefined?', response.TotalPrice === undefined);
        console.log('TotalPrice is NaN?', isNaN(response.TotalPrice));
        console.log('TotalPrice is finite?', isFinite(response.TotalPrice));
        if (response.TotalPrice !== undefined && response.TotalPrice !== null) {
          console.log('TotalPrice parsed:', parseFloat(response.TotalPrice));
          console.log('TotalPrice formatted:', response.TotalPrice.toString());
        } else {
          console.log('⚠️ WARNING: TotalPrice is missing or null in response!');
        }
      } else {
        console.log('⚠️ WARNING: Response is null or undefined!');
      }
      console.log('=== END TOTAL PRICE CHECK ===');

      // Update form data with calculated values from response
      // Backend returns: { MetalPrice, DiamondsPrice, TotalPrice, Metal, DiamondWeight, Client, Stones }
      if (response) {
        const updates = {};
        
        // Update metal price if in response
        if (response.MetalPrice !== undefined) {
          updates.metalPrice = response.MetalPrice.toString();
        }
        
        // Update diamond price if in response (note: backend uses DiamondsPrice, not DiamondPrice)
        if (response.DiamondsPrice !== undefined) {
          updates.diamondPrice = response.DiamondsPrice.toString();
        }
        
        // Update total price if in response
        if (response.TotalPrice !== undefined) {
          console.log('✅ TotalPrice found in response, updating formData');
          console.log('TotalPrice before update:', response.TotalPrice);
          console.log('TotalPrice after toString:', response.TotalPrice.toString());
          updates.totalPrice = response.TotalPrice.toString();
        } else {
          console.log('❌ TotalPrice NOT found in response!');
        }
        
        // Update metal weight from response if provided
        if (response.Metal?.Weight !== undefined) {
          updates.metalWeight = response.Metal.Weight.toString();
        }
        
        // Update diamond weight from response if provided
        if (response.DiamondWeight !== undefined) {
          updates.diamondWeight = response.DiamondWeight.toString();
        }
        
        // Update client-specific values if provided
        if (response.Client) {
          if (response.Client.Loss !== undefined) {
            updates.lossPercent = response.Client.Loss.toString();
          }
          if (response.Client.Labour !== undefined) {
            updates.labour = response.Client.Labour.toString();
          }
          if (response.Client.ExtraCharges !== undefined) {
            updates.extraCharges = response.Client.ExtraCharges.toString();
          }
          if (response.Client.UndercutPrice !== undefined) {
            updates.undercutPrice = response.Client.UndercutPrice.toString();
          }
          if (response.Client.NaturalDuties !== undefined) {
            updates.naturalDuties = response.Client.NaturalDuties.toString();
          }
          if (response.Client.LabDuties !== undefined) {
            updates.labDuties = response.Client.LabDuties.toString();
          }
          if (response.Client.GoldDuties !== undefined) {
            updates.goldDuties = response.Client.GoldDuties.toString();
          }
          if (response.Client.SilverAndLabsDuties !== undefined) {
            updates.silverAndLabsDuties = response.Client.SilverAndLabsDuties.toString();
          }
          if (response.Client.LossAndLabourDuties !== undefined) {
            updates.lossAndLabourDuties = response.Client.LossAndLabourDuties.toString();
          }
        }
        if (response.DutiesAmount !== undefined) {
          updates.dutiesAmount = parseFloat(response.DutiesAmount).toFixed(2);
        }
        
        // Update stones with calculated prices if provided
        // Backend returns full stone objects with calculated prices
        if (response.Stones && Array.isArray(response.Stones) && response.Stones.length > 0) {
          // Map backend stones to frontend format
          const updatedStones = response.Stones.map((backendStone, index) => {
            // Try to match with existing stone by index or find by matching properties
            const existingStone = stones[index] || stones.find(s => 
              s.Type === backendStone.Type && 
              s.MM === backendStone.MmSize
            ) || {};
            
            return {
              ...existingStone,
              Type: backendStone.Type || existingStone.Type,
              Color: backendStone.Color || existingStone.Color || '',
              Shape: backendStone.Shape || existingStone.Shape || '',
              MM: backendStone.MmSize || existingStone.MM || '',
              Sieve: backendStone.SieveSize || existingStone.Sieve || '',
              CaratWeight: backendStone.CtWeight?.toString() || existingStone.CaratWeight || '0',
              Weight: backendStone.Weight?.toString() || existingStone.Weight || '0',
              Pieces: backendStone.Pcs?.toString() || existingStone.Pieces || '0',
              Price: backendStone.Price?.toString() || existingStone.Price || '0',
            };
          });
          setStones(updatedStones);
        }

        // Update form data
        if (Object.keys(updates).length > 0) {
          setFormData(prev => ({ ...prev, ...updates }));
        }

        // Stash Applicable map on the latest entry so the form can hide irrelevant duty inputs.
        if (response.Applicable) {
          setPricingEntriesState(prev => {
            const updated = [...prev];
            if (updated[latestEntryIndex]) {
              updated[latestEntryIndex] = { ...updated[latestEntryIndex], applicable: response.Applicable };
            }
            return updated;
          });
        }

        Alert.alert('Success', 'Pricing calculated successfully');
      } else {
        Alert.alert('Success', 'Calculation completed');
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Full error:', JSON.stringify(error, null, 2));
        console.error('Payload that was sent:', JSON.stringify(payload, null, 2));
      }
      
      // Provide more detailed error message with actionable suggestions
      let errorMessage = 'Failed to calculate pricing.';
      let suggestions = [];
      
      if (error.status === 500) {
        // Check for specific backend error about null client.Pricing
        const errorDataStr = JSON.stringify(error.data || {});
        const errorMessageStr = JSON.stringify(error.message || '');
        const isClientNullError = 
          errorDataStr.includes('Cannot read properties of null') ||
          errorDataStr.includes("reading 'Pricing'") ||
          errorMessageStr.includes('Cannot read properties of null') ||
          errorMessageStr.includes("reading 'Pricing'");
        
        if (isClientNullError) {
          // Specific error: Client is null or missing Pricing configuration
          errorMessage = 'Client Configuration Error\n\n';
          errorMessage += 'The backend cannot find the client or the client does not have pricing configuration set up.\n\n';
          if (payload && payload.clientId) {
            errorMessage += `Client ID: ${payload.clientId}\n\n`;
          }
          errorMessage += 'This is a backend configuration issue. Please:\n';
          errorMessage += '1. Verify the client exists in the database\n';
          errorMessage += '2. Ensure the client has pricing settings configured\n';
          errorMessage += '3. Contact the administrator to set up client pricing\n\n';
          errorMessage += 'Technical Details:\n';
          errorMessage += 'Backend tried to access client.Pricing but client was null or missing pricing configuration.\n';
          errorMessage += 'Location: enquiry.service.js:933';
        } else {
          // Generic 500 error
          errorMessage = 'Server error (500). This usually indicates a backend issue.\n\n';
          suggestions.push('Backend server may be experiencing issues');
          suggestions.push('Check if the client exists in the database');
          suggestions.push('Verify the client has pricing configuration');
          suggestions.push('Check backend logs for detailed error information');
          
          // Check payload for common issues
          if (payload) {
            if (payload.details.Metal.Weight <= 0 && payload.details.Stones.length === 0) {
              suggestions.push('Ensure at least Metal Weight or Stones are provided');
            }
            if (payload.details.Quantity <= 0) {
              suggestions.push('Quantity must be greater than 0');
            }
            if (payload.details.Stones.some(s => !s.Type || s.Type.trim() === '')) {
              suggestions.push('All stones must have a valid Type');
            }
          }
          
          errorMessage += 'Possible causes:\n';
          suggestions.forEach((suggestion, index) => {
            errorMessage += `${index + 1}. ${suggestion}\n`;
          });
          errorMessage += '\n';
          
          if (error.data) {
            if (typeof error.data === 'string') {
              errorMessage += `Backend error: ${error.data}`;
            } else if (error.data.message) {
              errorMessage += `Backend error: ${error.data.message}`;
            } else if (error.data.error) {
              errorMessage += `Backend error: ${error.data.error}`;
            } else {
              errorMessage += 'Please check backend server logs for detailed error information.';
            }
          } else {
            errorMessage += 'Please check backend server logs for detailed error information.';
          }
        }
      } else if (error.status === 400) {
        errorMessage = 'Bad Request (400). Please check your input data:\n\n';
        if (error.data) {
          if (typeof error.data === 'string') {
            errorMessage += error.data;
          } else if (error.data.message) {
            errorMessage += error.data.message;
          } else if (error.data.error) {
            errorMessage += error.data.error;
          } else {
            errorMessage += 'Invalid data format or missing required fields.';
          }
        }
      } else if (error.status === 404) {
        errorMessage = 'Not Found (404). The pricing calculation endpoint may not exist or the client may not be found.';
      } else if (error.data) {
        if (typeof error.data === 'string') {
          errorMessage = error.data;
        } else if (error.data.message) {
          errorMessage = error.data.message;
        } else if (error.data.error) {
          errorMessage = error.data.error;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      // Show detailed error alert
      Alert.alert(
        'Pricing Calculation Error',
        errorMessage,
        [
          { text: 'OK' },
          ...(payload && error.status === 500 ? [{
            text: 'View Payload',
            onPress: () => {
              // Payload details available in error message
              Alert.alert(
                'Payload Details',
                `Check console for full payload details.\n\nClient ID: ${payload.clientId}\nMetal Weight: ${payload.details.Metal.Weight}\nStones: ${payload.details.Stones.length}\nQuantity: ${payload.details.Quantity}`,
                [{ text: 'OK' }]
              );
            }
          }] : [])
        ]
      );
    }
  };

  // Stone type options from API
  const stoneTypeOptions = stoneTypesData || [];

  // Individual stone filters for each pricing entry - { entryIndex: filterValue }
  const [entryStoneFilters, setEntryStoneFilters] = useState({});
  // Individual dropdown visibility for each pricing entry - { entryIndex: isVisible }
  const [entryFilterDropdowns, setEntryFilterDropdowns] = useState({});
  const [entryMetalQualityDropdowns, setEntryMetalQualityDropdowns] = useState({});
  // Modal state for editing pricing entry
  const [editingEntryIndex, setEditingEntryIndex] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [modalContentReady, setModalContentReady] = useState(false);
  const modalTimeoutRef = useRef(null);
  const isModalOpenRef = useRef(false);
  // Store original entry state when opening edit modal (for reverting on cancel)
  const [originalEntrySnapshot, setOriginalEntrySnapshot] = useState(null);
  // Modal state for adding new pricing entry
  const [showAddModal, setShowAddModal] = useState(false);

  const stoneFilterOptions = useMemo(
    () => [{ label: 'All Stone Types', value: 'all' }, ...(stoneTypeOptions || [])],
    [stoneTypeOptions]
  );

  // Helper to get filter value for a specific entry
  const getEntryFilter = (entryIndex) => {
    return entryStoneFilters[entryIndex] || 'all';
  };

  // Helper to set filter value for a specific entry
  const setEntryFilter = (entryIndex, filterValue) => {
    setEntryStoneFilters(prev => ({
      ...prev,
      [entryIndex]: filterValue,
    }));
  };

  // Helper to toggle dropdown for a specific entry
  const toggleEntryFilterDropdown = (entryIndex) => {
    setEntryFilterDropdowns(prev => ({
      ...prev,
      [entryIndex]: !prev[entryIndex],
    }));
  };

  // Helper to toggle metal quality dropdown for a specific entry
  const toggleEntryMetalQualityDropdown = (entryIndex) => {
    setEntryMetalQualityDropdowns(prev => ({
      ...prev,
      [entryIndex]: !prev[entryIndex],
    }));
  };

  // Helper to get filtered stones for a given stones array and filter value
  // Memoized to avoid recalculating on every render
  const getFilteredStones = useCallback((stonesArray, filterValue = 'all') => {
    if (filterValue === 'all') {
      return stonesArray.map((stone, index) => ({ stone, originalIndex: index }));
    }
    return stonesArray
      .map((stone, index) => ({ stone, originalIndex: index }))
      .filter(({ stone }) => {
        const typeValue = (stone?.Type || '').toString().toLowerCase();
        return typeValue === filterValue.toLowerCase();
      });
  }, []);

  // For the latest entry (backward compatibility)
  const stonesToRender = useMemo(() => {
    const latestFilter = getEntryFilter(pricingEntriesState.length - 1);
    return getFilteredStones(stones, latestFilter);
  }, [stones, entryStoneFilters, pricingEntriesState.length]);

  const handleAddDiamond = useCallback(() => {
    // Add a new stone row with default values
    const newStone = {
      Type: '',
      Color: '',
      Shape: '',
      MM: '',
      Sieve: '',
      Weight: '0',
      Pieces: '0',
      CaratWeight: '0',
      Price: '0',
    };
    setStones(prev => [...prev, newStone]);
  }, []);

  const handleUpdateStone = useCallback((index, field, value) => {
    setStones(prev => {
      const updatedStones = [...prev];
    updatedStones[index] = {
      ...updatedStones[index],
      [field]: value,
    };
      return updatedStones;
    });
  }, []);

  const handleDeleteStone = useCallback((index) => {
    Alert.alert(
      'Delete Stone',
      'Are you sure you want to delete this stone?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setStones(prev => prev.filter((_, i) => i !== index));
          },
        },
      ]
    );
  }, []);

  // State for dropdown modals - one per row
  const [openDropdowns, setOpenDropdowns] = useState({});

  const toggleDropdown = useCallback((index) => {
    setOpenDropdowns(prev => ({
      ...prev,
      [index]: !prev[index],
    }));
  }, []);

  const renderTypeDropdown = useCallback((identifier, selectedValue, entryIndex = null, stoneIndex = null) => {
    const isOpen = openDropdowns[identifier] || false;
    // If entryIndex and stoneIndex are provided, this is for a specific pricing entry
    // Otherwise, it's for the latest entry (backward compatibility)
    const handleTypeChange = (value) => {
      if (entryIndex !== null && stoneIndex !== null) {
        updatePricingEntryStone(entryIndex, stoneIndex, 'Type', value);
      } else {
        // Backward compatibility - update latest entry
        const latestIndex = pricingEntriesState.length - 1;
        handleUpdateStone(stoneIndex !== null ? stoneIndex : parseInt(identifier), 'Type', value);
      }
    };

    return (
      <View>
        <TouchableOpacity
          style={styles.dropdownButton}
          onPress={() => toggleDropdown(identifier)}
        >
          <Text style={styles.dropdownButtonText} numberOfLines={1}>
            {selectedValue || 'Select Type'}
          </Text>
          <Icon name="arrow-drop-down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        <Modal
          visible={isOpen}
          transparent
          animationType="fade"
          onRequestClose={() => toggleDropdown(identifier)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => toggleDropdown(identifier)}
          >
            <View style={styles.dropdownModal}>
              <ScrollView 
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled={true}
                style={styles.dropdownScrollView}
              >
              {stoneTypeOptions.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={styles.dropdownOption}
                  onPress={() => {
                      handleTypeChange(option.value);
                      toggleDropdown(identifier);
                  }}
                >
                  <Text style={styles.dropdownOptionText}>{option.label}</Text>
                </TouchableOpacity>
              ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  }, [openDropdowns, stoneTypeOptions, updatePricingEntryStone, handleUpdateStone, pricingEntriesState, toggleDropdown]);

  const handleSave = async (shouldNavigateBack = true) => {
    // Prevent multiple simultaneous saves
    if (isSaving) {
      if (__DEV__) {
        console.warn('⚠️ [handleSave] Save already in progress, ignoring duplicate call');
      }
      return;
    }
    
    const startTime = Date.now();
    
    if (__DEV__) {
      console.log('💾 [handleSave] ===== START SAVE PRICING =====');
      console.log('💾 [handleSave] Timestamp:', new Date().toISOString());
      console.log('💾 [handleSave] shouldNavigateBack:', shouldNavigateBack);
    }
    
    try {
      // Get enquiry ID
      const enquiryId = enquiry?.id || enquiry?._id;
      
      if (__DEV__) {
        console.log('💾 [handleSave] Enquiry ID check:', {
          enquiryId,
          enquiryIdFromEnquiry: enquiry?.id,
          enquiryIdFromEnquiryUnderscore: enquiry?._id,
          enquiryExists: !!enquiry,
        });
      }
      
      if (!enquiryId) {
        if (__DEV__) {
          console.error('❌ [handleSave] Enquiry ID is missing');
        }
        Alert.alert('Error', 'Enquiry ID is missing');
        return;
      }

      // Get version from latest design
      let version = latestDesign?.Version || latestDesign?.version || '1';
      
      // Log all available versions in the design data for debugging
      if (__DEV__) {
        console.log('💾 [handleSave] Available versions in designData:', {
          designDataLength: designData?.length || 0,
          allVersions: designData?.map((d, idx) => ({
            index: idx,
            Version: d?.Version,
            version: d?.version,
            hasPricing: !!(d?.Pricing || d?.pricing),
          })) || [],
          latestDesignIndex: designData?.indexOf(latestDesign),
          latestDesignVersion: latestDesign?.Version || latestDesign?.version,
        });
        console.log('💾 [handleSave] Version extraction:', {
          originalVersion: latestDesign?.Version || latestDesign?.version,
          versionBeforeFormat: version,
          latestDesignExists: !!latestDesign,
          latestDesignKeys: latestDesign ? Object.keys(latestDesign) : [],
        });
      }
      
      // Send the full version string as-is (e.g., "Version 1")
      // The API expects the complete version string, not just the number
      const versionToSend = version;
      
      if (__DEV__) {
        console.log('💾 [handleSave] Version processing:', {
          originalVersion: version,
          versionToSend,
        });
      }
      
      // Get metal details from enquiry (fallback only)
      const metalColor = originalData?.Metal?.Color || enquiry?.Metal?.Color || 'Gold';
      
      // Get default metal rate for fallback (from latest entry or metalRateConsidered)
      const defaultMetalWeight = parseFloat(formData.metalWeight) || 0;
      const defaultMetalPrice = parseFloat(formData.metalPrice) || 0;
      let defaultMetalRate = existingPricing?.Metal?.Rate || existingPricing?.MetalRate || 0;
      if (!defaultMetalRate || defaultMetalRate === 0) {
        defaultMetalRate = parseFloat(metalRateConsidered) || 0;
      }
      if (!defaultMetalRate || defaultMetalRate === 0) {
        defaultMetalRate = defaultMetalWeight > 0 ? defaultMetalPrice / defaultMetalWeight : 0;
      }
      
      if (__DEV__) {
        console.log('💾 [handleSave] Pricing entries state:', {
          entriesCount: pricingEntriesState.length,
          allPricingEntriesCount: allPricingEntries.length,
          designType,
        });
      }
      
      // Convert all pricing entries from state to API format
      const pricingArray = pricingEntriesState.map((entryState, entryIndex) => {
        const entryFormData = entryState.formData;
        const entryStones = entryState.stones;
        const entryUndercutEnabled = entryState.undercutEnabled;
        
        // Get metal quality from entry state (per version), fallback to enquiry if not set
        const entryMetalQuality = entryFormData.metalQuality || 
                                  originalData?.Metal?.Quality || 
                                  enquiry?.Metal?.Quality || 
                                  '10K';
        
        // Get metal rate for this entry
        // Priority: metalRateOverride > original entry rate > calculated from price/weight > default
        const originalEntry = allPricingEntries[entryIndex];
        let entryMetalRate = 0;
        
        // First, check if user provided a metal rate override
        if (entryFormData.metalRateOverride && entryFormData.metalRateOverride.trim() !== '') {
          entryMetalRate = parseFloat(entryFormData.metalRateOverride) || 0;
        }
        
        // If no override, try to preserve from original entry
        if (!entryMetalRate || entryMetalRate === 0) {
          entryMetalRate = originalEntry?.Metal?.Rate || originalEntry?.MetalRate || 0;
        }
        
        // If still not found, calculate from price/weight, or use default
        if (!entryMetalRate || entryMetalRate === 0) {
          const entryMetalWeight = parseFloat(entryFormData.metalWeight) || 0;
          const entryMetalPrice = parseFloat(entryFormData.metalPrice) || 0;
          entryMetalRate = entryMetalWeight > 0 ? entryMetalPrice / entryMetalWeight : defaultMetalRate;
      }
      
      // Format stones data according to API structure
        const formattedStones = entryStones.map(stone => ({
        Type: stone.Type || '',
        Color: stone.Color || '',
        Shape: stone.Shape || '',
        MmSize: stone.MM || '',
        SieveSize: stone.Sieve || '',
        CtWeight: parseFloat(stone.CaratWeight) || 0,
        Weight: parseFloat(stone.Weight) || 0,
        Pcs: parseInt(stone.Pieces) || 0,
        Price: parseFloat(stone.Price) || 0,
      }));

      // Build pricing object according to API structure
      // IMPORTANT: Field order matches web payload structure exactly
      // Note: DutiesAmount is included in web payload but calculated by backend
      // We include it as null/0 to match web structure, backend will recalculate
        return {
          MetalPrice: parseFloat(entryFormData.metalPrice) || 0,
          DiamondsPrice: parseFloat(entryFormData.diamondPrice) || 0,
          TotalPrice: parseFloat(entryFormData.totalPrice) || 0,
          DutiesAmount: parseFloat(entryFormData.dutiesAmount) || 0, // Match web structure, backend will recalculate
          DiamondWeight: parseFloat(entryFormData.diamondWeight) || 0,
          TotalPieces: parseInt(entryFormData.totalPieces) || 0,
        Metal: {
            Weight: parseFloat(entryFormData.metalWeight) || 0,
          Quality: entryMetalQuality,
            Rate: entryMetalRate,
          },
          ExtraCharges: parseFloat(entryFormData.extraCharges) || 0,
          NaturalDuties: parseFloat(entryFormData.naturalDuties) || 0,
          LabDuties: parseFloat(entryFormData.labDuties) || 0,
          GoldDuties: parseFloat(entryFormData.goldDuties) || 0,
          SilverAndLabsDuties: parseFloat(entryFormData.silverAndLabsDuties) || 0,
          LossAndLabourDuties: parseFloat(entryFormData.lossAndLabourDuties) || 0,
          Loss: parseFloat(entryFormData.lossPercent) || 0,
          Labour: parseFloat(entryFormData.labour) || 0,
          UndercutPrice: entryUndercutEnabled ? (parseFloat(entryFormData.undercutPrice) || 0) : 0,
        Stones: formattedStones,
          ClientPricingMessage: entryFormData.clientPricingMessage || '',
        };
      });
      


      // Call API to save pricing
      if (__DEV__) {
        console.log('💾 [handleSave] Calling savePricing API with:', {
          enquiryId,
          designType,
          version: versionToSend,
          pricingDataEntriesCount: pricingArray.length,
        });
      }
      
      const saveResult = await savePricing({
        enquiryId,
        designType,
        version: versionToSend, // Send full version string (e.g., "Version 1")
        pricingData: pricingArray,
      }).unwrap();
      
      if (__DEV__) {
        console.log('✅ [handleSave] Save pricing API success:', {
          result: saveResult,
          timeTaken: `${Date.now() - startTime}ms`,
        });
      }

      // Refetch enquiry data to get updated pricing before navigating back
      if (finalEnquiryId) {
        await refetchEnquiry();
      }
      
      Alert.alert(
        'Success',
        'Pricing saved successfully',
        [
          {
            text: 'OK',
            onPress: () => {
              // Navigate back only if shouldNavigateBack is true
              if (shouldNavigateBack) {
                navigation.goBack();
              }
            },
          },
        ]
      );
    } catch (error) {
      const errorTime = Date.now() - startTime;
      
      if (__DEV__) {
        console.error('❌ [handleSave] ===== SAVE PRICING FAILED =====');
        console.error('❌ [handleSave] Error Type:', typeof error);
        console.error('❌ [handleSave] Error Object:', error);
        console.error('❌ [handleSave] Error Status:', error?.status);
        console.error('❌ [handleSave] Error Message:', error?.message);
        console.error('❌ [handleSave] Error Data:', error?.data);
        console.error('❌ [handleSave] Error Stack:', error?.stack);
        console.error('❌ [handleSave] Time taken before error:', `${errorTime}ms`);
        
        // Log full error details
        try {
          console.error('❌ [handleSave] Full error JSON:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
        } catch (jsonError) {
          console.error('❌ [handleSave] Could not stringify error:', jsonError);
        }
        
        // Log request details that were sent
        console.error('❌ [handleSave] Request details:', {
          enquiryId: enquiry?.id || enquiry?._id,
          designType,
          version,
          pricingEntriesCount: pricingEntriesState.length,
        });
      }
      
      let errorMessage = 'Failed to save pricing. Please try again.';
      
      if (error?.data?.message) {
        errorMessage = error.data.message;
        if (__DEV__) {
          console.error('❌ [handleSave] Error message from data.message:', error.data.message);
        }
      } else if (error?.data?.error) {
        errorMessage = error.data.error;
        if (__DEV__) {
          console.error('❌ [handleSave] Error message from data.error:', error.data.error);
        }
      } else if (error?.message) {
        errorMessage = error.message;
        if (__DEV__) {
          console.error('❌ [handleSave] Error message from error.message:', error.message);
        }
      } else if (error?.status) {
        errorMessage = `Server error (${error.status}). Please try again.`;
        if (__DEV__) {
          console.error('❌ [handleSave] Error status code:', error.status);
        }
      }
      
      if (__DEV__) {
        console.error('❌ [handleSave] Final error message to show user:', errorMessage);
        console.error('❌ [handleSave] ===== END ERROR LOG =====');
      }
      
      Alert.alert('Save Failed', errorMessage);
    }
  };

  const handleDownloadExcel = () => {
    if (!designCode) {
      Alert.alert('Error', 'Design code not available');
      return;
    }
    // TODO: Implement Excel download
    const excelUrl = `${API_BASE_URL}/api/enquiries/files/${designCode}.xlsx?download=true`;
    Alert.alert('Info', 'Download Excel functionality will be implemented');
    
  };

  // Download pricing for a specific entry
  const handleDownloadPricingForEntry = async (pricingEntry, entryStones) => {
    if (entryStones.length === 0) {
      Alert.alert('No Data', 'No stones data available to download');
      return;
    }

    try {
      // Get auth token
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        Alert.alert('Error', 'Authentication token not found');
        return;
      }

      // Prepare stones data for Excel generation
      const stonesData = entryStones.map(stone => ({
        Type: stone.Type || '',
        Color: stone.Color || '',
        Shape: stone.Shape || '',
        MmSize: stone.MM || '',
        SieveSize: stone.Sieve || '',
        Weight: parseFloat(stone.Weight) || 0,
        Pcs: parseInt(stone.Pieces) || 0,
        CtWeight: parseFloat(stone.CaratWeight) || 0,
        Price: parseFloat(stone.Price) || 0,
      }));

      // Create filename with design code and timestamp
      const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const excelFilename = designCode 
        ? `Pricing_${designCode}_${timestamp}.xlsx`
        : `Pricing_${timestamp}.xlsx`;

      // Try to call backend API to generate Excel
      const excelUrl = `${API_BASE_URL}/api/pricing/generate-excel`;

      const response = await fetch(excelUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stones: stonesData,
          designCode: designCode || '',
          designType: designType || '',
          enquiryId: enquiry?.id || enquiry?._id || '',
        }),
      });

      if (!response.ok) {
        // If backend API doesn't exist, generate CSV as fallback
        throw new Error(`Backend API not available (${response.status}), using CSV fallback`);
      }

      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        // Backend returned JSON (possibly with signed URL)
        const jsonData = await response.json();
        if (jsonData.url) {
          // Download from signed URL
          const s3Response = await fetch(jsonData.url);
          if (!s3Response.ok) {
            throw new Error('Failed to download from signed URL');
          }
          const arrayBuffer = await s3Response.arrayBuffer();
          await saveExcelFile(arrayBuffer, excelFilename);
        } else {
          throw new Error('Backend did not return a valid URL');
        }
      } else {
        // Backend returned Excel file directly
        const arrayBuffer = await response.arrayBuffer();
        await saveExcelFile(arrayBuffer, excelFilename);
        // Share modal is already opened in saveExcelFile function
      }
    } catch (error) {
      // Fallback to client-side Excel generation for this entry
      const entryStonesData = entryStones.map(stone => ({
        Type: stone.Type || '',
        Color: stone.Color || '',
        Shape: stone.Shape || '',
        MmSize: stone.MM || '',
        SieveSize: stone.Sieve || '',
        Weight: parseFloat(stone.Weight) || 0,
        Pcs: parseInt(stone.Pieces) || 0,
        CtWeight: parseFloat(stone.CaratWeight) || 0,
        Price: parseFloat(stone.Price) || 0,
      }));
      
      const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const excelFilename = designCode 
        ? `Pricing_${designCode}_${timestamp}.xlsx`
        : `Pricing_${timestamp}.xlsx`;
      
      // Generate Excel using XLSX library
      const ws = XLSX.utils.json_to_sheet(entryStonesData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Pricing');
      const wbout = XLSX.write(wb, { type: 'binary', bookType: 'xlsx' });
      
      // Convert to base64
      const base64 = btoa(wbout);
      const downloadPath = `${RNFS.DownloadDirectoryPath}/${excelFilename}`;
      
      // Write file to device
      await RNFS.writeFile(downloadPath, base64, 'base64');
      
      // Share/open the file using share modal
      try {
        await Share.open({
          url: `file://${downloadPath}`,
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: excelFilename,
          title: 'Share Pricing Excel File',
          message: `Pricing data: ${excelFilename}`,
          subject: `Pricing Data - ${excelFilename}`,
        });
      } catch (shareError) {
        if (shareError.message !== 'User did not share') {
          Alert.alert(
            'Success',
            `Excel file generated successfully!\n\nSaved to: Downloads/${excelFilename}\n\nYou can share it from your file manager.`,
            [{ text: 'OK' }]
          );
        }
      }
    }
  };

  const saveExcelFile = async (arrayBuffer, filename) => {
    const downloadPath = `${RNFS.DownloadDirectoryPath}/${filename}`;
    
    // Convert array buffer to base64
    const bytes = new Uint8Array(arrayBuffer);
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let base64 = '';
    let i = 0;
    
    while (i < bytes.length) {
      const a = bytes[i++];
      const b = i < bytes.length ? bytes[i++] : 0;
      const c = i < bytes.length ? bytes[i++] : 0;
      
      const bitmap = (a << 16) | (b << 8) | c;
      
      base64 += base64Chars.charAt((bitmap >> 18) & 63);
      base64 += base64Chars.charAt((bitmap >> 12) & 63);
      base64 += i - 2 < bytes.length ? base64Chars.charAt((bitmap >> 6) & 63) : '=';
      base64 += i - 1 < bytes.length ? base64Chars.charAt(bitmap & 63) : '=';
    }

    // Write file to device
    await RNFS.writeFile(downloadPath, base64, 'base64');

    // Share/open the file
    try {
      await Share.open({
        url: `file://${downloadPath}`,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: filename,
        title: 'Open Excel File',
        message: `Downloaded: ${filename}`,
      });
    } catch (shareError) {
      if (shareError.message !== 'User did not share') {
        Alert.alert(
          'Success',
          `Excel file downloaded successfully!\n\nSaved to: Downloads/${filename}`,
          [{ text: 'OK' }]
        );
      }
    }
  };

  const generateExcelFile = async () => {
    if (stones.length === 0) {
      Alert.alert('No Data', 'No stones data available');
      return;
    }

    try {
      // Prepare data array with headers matching the Excel structure
      const excelData = [
        ['Type', 'Color', 'Shape', 'MM Size', 'Sieve Size', 'Weight', 'Pieces', 'Carat Weight', 'Price']
      ];

      // Add stone data rows
      stones.forEach(stone => {
        excelData.push([
          stone.Type || '',
          stone.Color || '',
          stone.Shape || '',
          stone.MM || '',
          stone.Sieve || '',
          parseFloat(stone.Weight) || 0,
          parseInt(stone.Pieces) || 0,
          parseFloat(stone.CaratWeight) || 0,
          parseFloat(stone.Price) || 0,
        ]);
      });

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(excelData);

      // Set column widths for better readability
      ws['!cols'] = [
        { wch: 15 }, // Type
        { wch: 10 }, // Color
        { wch: 10 }, // Shape
        { wch: 12 }, // MM Size
        { wch: 15 }, // Sieve Size
        { wch: 12 }, // Weight
        { wch: 10 }, // Pieces
        { wch: 15 }, // Carat Weight
        { wch: 12 }, // Price
      ];

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Pricing');

      // Generate Excel file buffer
      const excelBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      // Create filename
      const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const excelFilename = designCode 
        ? `Pricing_${designCode}_${timestamp}.xlsx`
        : `Pricing_${timestamp}.xlsx`;
      
      const downloadPath = `${RNFS.DownloadDirectoryPath}/${excelFilename}`;

      // Convert array buffer to base64
      const bytes = new Uint8Array(excelBuffer);
      const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let base64 = '';
      let i = 0;
      
      while (i < bytes.length) {
        const a = bytes[i++];
        const b = i < bytes.length ? bytes[i++] : 0;
        const c = i < bytes.length ? bytes[i++] : 0;
        
        const bitmap = (a << 16) | (b << 8) | c;
        
        base64 += base64Chars.charAt((bitmap >> 18) & 63);
        base64 += base64Chars.charAt((bitmap >> 12) & 63);
        base64 += i - 2 < bytes.length ? base64Chars.charAt((bitmap >> 6) & 63) : '=';
        base64 += i - 1 < bytes.length ? base64Chars.charAt(bitmap & 63) : '=';
      }

      // Write Excel file
      await RNFS.writeFile(downloadPath, base64, 'base64');

      // Share/open the file
      try {
        await Share.open({
          url: `file://${downloadPath}`,
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: excelFilename,
          title: 'Open Excel File',
          message: `Downloaded: ${excelFilename}`,
        });
      } catch (shareError) {
        if (shareError.message !== 'User did not share') {
          Alert.alert(
            'Success',
            `Excel file downloaded successfully!\n\nSaved to: Downloads/${excelFilename}`,
            [{ text: 'OK' }]
          );
        }
      }
    } catch (error) {
      Alert.alert('Error', `Failed to generate Excel file: ${error.message}`);
    }
  };

  // Calculate pricing for a specific entry
  const handleCalculateForEntry = async (entryIndex) => {
    // Log immediately when function is called
    console.log('🚀 CALCULATE FUNCTION CALLED');
    console.log('Entry Index:', entryIndex);
    console.log('Pricing Entries State Length:', pricingEntriesState.length);
    console.log('Entry Exists:', pricingEntriesState[entryIndex] ? 'YES' : 'NO');
    
    if (entryIndex === null || !pricingEntriesState[entryIndex]) {
      console.log('❌ ERROR: Invalid pricing entry');
      console.log('Entry Index is null:', entryIndex === null);
      console.log('Entry exists:', !!pricingEntriesState[entryIndex]);
      Alert.alert('Error', 'Invalid pricing entry');
      return;
    }

    console.log('✅ Entry validation passed, starting calculation...');
    // Note: isCalculating comes from the mutation hook, no need to set it manually
    
    try {
      const entryState = pricingEntriesState[entryIndex];
      const entryFormData = entryState.formData;
      const entryStones = entryState.stones;
      
      console.log('=== CALCULATE BUTTON PRESSED ===');
      console.log('Entry Index:', entryIndex);
      console.log('Current Form Data:', JSON.stringify(entryFormData, null, 2));
      console.log('Current Stones:', JSON.stringify(entryStones, null, 2));

      // Get metal details from enquiry
      const metalColor = originalData?.Metal?.Color || enquiry?.Metal?.Color || 'Gold';
      // IMPORTANT: Use metal quality from formData (which client can change from dropdown)
      // This is the key - when client changes Metal Quality, it updates entryFormData.metalQuality
      const metalQuality = entryFormData.metalQuality || originalData?.Metal?.Quality || enquiry?.Metal?.Quality || '10K';
      const metalWeight = parseFloat(entryFormData.metalWeight) || 0;
      
      console.log('🔍 Using Metal Quality for calculation:', metalQuality);
      console.log('🔍 Metal Quality source: formData =', entryFormData.metalQuality);
      
      // Get metal rate - use override if provided, otherwise calculate or use default
      let metalRate = null;
      if (entryFormData.metalRateOverride && entryFormData.metalRateOverride.trim() !== '') {
        metalRate = parseFloat(entryFormData.metalRateOverride);
      }

      // Transform stones array to match API format
      const transformedStones = entryStones.map((stone) => {
        if (!stone.Type || stone.Type.trim() === '') {
          return null;
        }

        return {
          Type: stone.Type.trim(),
          Color: stone.Color?.trim() || '',
          Shape: stone.Shape?.trim() || '',
          MmSize: stone.MM?.toString().trim() || '0',
          SieveSize: stone.Sieve?.trim() || '',
          CtWeight: parseFloat(stone.CaratWeight) || 0,
          Weight: parseFloat(stone.Weight) || 0,
          Pcs: parseInt(stone.Pieces) || 0,
          Price: parseFloat(stone.Price) || 0,
        };
      }).filter(stone => stone !== null && stone.Type);

      // Build payload
      const metalPayload = {
        Weight: metalWeight,
        Quality: metalQuality,
        Color: metalColor,
      };
      
      // Add Rate to Metal payload if override is provided
      if (metalRate !== null && !isNaN(metalRate)) {
        metalPayload.Rate = metalRate.toString();
      }

      const payload = {
        clientId: null, // Calculate button does not send client ID
        details: {
          Metal: metalPayload,
          Stones: transformedStones,
          Loss: parseFloat(entryFormData.lossPercent) || 0,
          Labour: parseFloat(entryFormData.labour) || 0,
          ExtraCharges: parseFloat(entryFormData.extraCharges) || 0,
          UndercutPrice: parseFloat(entryFormData.undercutPrice) || 0,
          NaturalDuties: parseFloat(entryFormData.naturalDuties) || 0,
          LabDuties: parseFloat(entryFormData.labDuties) || 0,
          GoldDuties: parseFloat(entryFormData.goldDuties) || 0,
          SilverAndLabsDuties: parseFloat(entryFormData.silverAndLabsDuties) || 0,
          LossAndLabourDuties: parseFloat(entryFormData.lossAndLabourDuties) || 0,
          // Quantity is added to payload from "Total Pieces" input field (entryFormData.totalPieces)
          Quantity: 1,
        },
      };

      console.log('🔵 CALCULATE BUTTON (Entry-Specific) - Client ID Status:');
      console.log('❌ Client ID is NOT being sent (clientId: null)');
      console.log('📦 Payload clientId:', payload.clientId);
      console.log('=== PAYLOAD BEING SENT ===');
      console.log('Payload:', JSON.stringify(payload, null, 2));
      console.log('Metal Payload:', JSON.stringify(metalPayload, null, 2));
      console.log('Transformed Stones:', JSON.stringify(transformedStones, null, 2));

      // Call API to calculate pricing
      console.log('📡 Calling API calculatePricing...',"data",payload);
      console.log('Payload being sent:', JSON.stringify(payload, null, 2));
      
      let response;
      try {
        console.log('⏳ Waiting for API response...');
        response = await calculatePricing(payload).unwrap();
        console.log('✅ API call successful - response received');
        console.log('Response type:', typeof response);
        console.log('Response:', response);
      } catch (apiError) {
        console.log('❌ API call failed with error:');
        console.log('Error object:', apiError);
        console.log('Error type:', typeof apiError);
        console.log('Error message:', apiError?.message);
        console.log('Error data:', apiError?.data);
        console.log('Error status:', apiError?.status);
        throw apiError; // Re-throw to be caught by outer catch
      }
      
      console.log('=== API RESPONSE RECEIVED ===');
      console.log('Response is null?', response === null);
      console.log('Response is undefined?', response === undefined);
      console.log('Full Response:', JSON.stringify(response, null, 2));
      
      if (response) {
        console.log('MetalPrice:', response.MetalPrice);
        console.log('DiamondsPrice:', response.DiamondsPrice);
        
        // Detailed TotalPrice logging
        console.log('=== TOTAL PRICE CHECK ===');
        console.log('TotalPrice exists?', 'TotalPrice' in response);
        console.log('TotalPrice value:', response.TotalPrice);
        console.log('TotalPrice type:', typeof response.TotalPrice);
        console.log('TotalPrice is null?', response.TotalPrice === null);
        console.log('TotalPrice is undefined?', response.TotalPrice === undefined);
        console.log('TotalPrice is NaN?', isNaN(response.TotalPrice));
        console.log('TotalPrice is finite?', isFinite(response.TotalPrice));
        if (response.TotalPrice !== undefined && response.TotalPrice !== null) {
          console.log('TotalPrice parsed:', parseFloat(response.TotalPrice));
          console.log('TotalPrice formatted:', parseFloat(response.TotalPrice).toFixed(2));
        } else {
          console.log('⚠️ WARNING: TotalPrice is missing or null in response!');
        }
        console.log('=== END TOTAL PRICE CHECK ===');
        
        console.log('Metal:', response.Metal);
        console.log('DiamondWeight:', response.DiamondWeight);
        console.log('Client:', response.Client);
      } else {
        console.log('⚠️ WARNING: Response is null or undefined!');
      }

      // Update the specific entry's form data with ALL response fields
      if (response) {
        console.log('=== UPDATING FORM DATA ===');
        console.log('Before Update - Current Form Data:', JSON.stringify(entryFormData, null, 2));
        
        // Update all fields in a single state update to ensure UI refreshes
        setPricingEntriesState(prev => {
          const updated = [...prev];
          if (!updated[entryIndex]) {
            console.log('ERROR: Entry index not found in state');
            return prev;
          }
          
          const currentFormData = updated[entryIndex].formData;
          const updatedFormData = { ...currentFormData };
          
          // OVERWRITE all pricing fields with calculated values from API response
          // Metal Price
          if (response.MetalPrice !== undefined && response.MetalPrice !== null) {
            updatedFormData.metalPrice = parseFloat(response.MetalPrice).toFixed(2);
            console.log('✅ Updated metalPrice:', updatedFormData.metalPrice, 'from', response.MetalPrice);
          }
          
          // Diamonds Price
          if (response.DiamondsPrice !== undefined && response.DiamondsPrice !== null) {
            updatedFormData.diamondPrice = parseFloat(response.DiamondsPrice).toFixed(2);
            console.log('✅ Updated diamondPrice:', updatedFormData.diamondPrice, 'from', response.DiamondsPrice);
          }
          
          // Total Price - use directly from response (includes all calculations)
          if (response.TotalPrice !== undefined && response.TotalPrice !== null) {
            const totalPriceValue = parseFloat(response.TotalPrice);
            const totalPriceFormatted = totalPriceValue.toFixed(2);
            updatedFormData.totalPrice = totalPriceFormatted;
            console.log('✅ Updated totalPrice123123:', response);
            console.log('   - Original value:', response.TotalPrice);
            console.log('   - Parsed value:', totalPriceValue);
            console.log('   - Formatted value:', totalPriceFormatted);
          } else {
            console.log('❌ TotalPrice is undefined or null - NOT updating formData');
            console.log('   - TotalPrice value:', response.TotalPrice);
            console.log('   - TotalPrice undefined?', response.TotalPrice === undefined);
            console.log('   - TotalPrice null?', response.TotalPrice === null);
          }
          
          // Update Metal fields from response.Metal
          if (response.Metal) {
            // Metal Weight
            if (response.Metal.Weight !== undefined && response.Metal.Weight !== null) {
              updatedFormData.metalWeight = parseFloat(response.Metal.Weight).toString();
              console.log('✅ Updated metalWeight:', updatedFormData.metalWeight, 'from', response.Metal.Weight);
            }
            
            // Metal Quality
            if (response.Metal.Quality) {
              updatedFormData.metalQuality = response.Metal.Quality;
              console.log('✅ Updated metalQuality:', updatedFormData.metalQuality, 'from', response.Metal.Quality);
            }
            
            // Metal Rate - update the override field with the calculated rate
            if (response.Metal.Rate !== undefined && response.Metal.Rate !== null) {
              // Handle both string and number formats
              const rateValue = typeof response.Metal.Rate === 'string' 
                ? parseFloat(response.Metal.Rate) 
                : response.Metal.Rate;
              updatedFormData.metalRateOverride = rateValue.toString();
              console.log('✅ Updated metalRateOverride:', updatedFormData.metalRateOverride, 'from', response.Metal.Rate);
            }
          }
          
          // Diamond Weight
          if (response.DiamondWeight !== undefined && response.DiamondWeight !== null) {
            updatedFormData.diamondWeight = parseFloat(response.DiamondWeight).toString();
            console.log('✅ Updated diamondWeight:', updatedFormData.diamondWeight, 'from', response.DiamondWeight);
          }
          
          // Update Client pricing fields from response.Client - OVERWRITE with calculated values
          if (response.Client) {
            // Loss %
            if (response.Client.Loss !== undefined && response.Client.Loss !== null) {
              updatedFormData.lossPercent = parseFloat(response.Client.Loss).toString();
            }

            // Labour
            if (response.Client.Labour !== undefined && response.Client.Labour !== null) {
              updatedFormData.labour = parseFloat(response.Client.Labour).toString();
            }

            // Extra Charges (can be negative)
            if (response.Client.ExtraCharges !== undefined && response.Client.ExtraCharges !== null) {
              updatedFormData.extraCharges = parseFloat(response.Client.ExtraCharges).toString();
            }

            // Undercut price (per-carat cap)
            if (response.Client.UndercutPrice !== undefined && response.Client.UndercutPrice !== null) {
              updatedFormData.undercutPrice = parseFloat(response.Client.UndercutPrice).toString();
            }

            // Five duty rates
            const dutyKeys = ['NaturalDuties', 'LabDuties', 'GoldDuties', 'SilverAndLabsDuties', 'LossAndLabourDuties'];
            const dutyFormKeys = ['naturalDuties', 'labDuties', 'goldDuties', 'silverAndLabsDuties', 'lossAndLabourDuties'];
            dutyKeys.forEach((key, i) => {
              const v = response.Client[key];
              if (v !== undefined && v !== null) {
                updatedFormData[dutyFormKeys[i]] = parseFloat(v).toString();
              }
            });
          }
          
          // Handle DutiesAmount - check multiple possible locations in response
          let dutiesAmountValue = null;
          if (response.DutiesAmount !== undefined && response.DutiesAmount !== null) {
            dutiesAmountValue = response.DutiesAmount;
          } else if (response.Client?.DutiesAmount !== undefined && response.Client?.DutiesAmount !== null) {
            dutiesAmountValue = response.Client.DutiesAmount;
          }
          
          if (dutiesAmountValue !== null) {
            // Update dutiesAmount in formData
            updatedFormData.dutiesAmount = parseFloat(dutiesAmountValue).toFixed(2);
            if (__DEV__) {
              console.log('✅ Updated dutiesAmount:', updatedFormData.dutiesAmount, 'from', dutiesAmountValue);
            }
          } else {
            if (__DEV__) {
              console.log('⚠️ DutiesAmount not found in response:', {
                'response.DutiesAmount': response.DutiesAmount,
                'response.Client?.DutiesAmount': response.Client?.DutiesAmount,
              });
            }
          }
          
          console.log('After Update - Updated Form Data:', JSON.stringify(updatedFormData, null, 2));
          
          // Update the entry with new form data - FORCE OVERWRITE all values
          updated[entryIndex] = {
            ...updated[entryIndex],
            formData: updatedFormData,
            applicable: response.Applicable || updated[entryIndex].applicable || null,
          };
          
          // Update stones if response includes updated stones
          if (response.Stones && Array.isArray(response.Stones) && response.Stones.length > 0) {
            const updatedStones = response.Stones.map(stone => ({
              Type: stone.Type || '',
              Color: stone.Color || '',
              Shape: stone.Shape || '',
              MM: (stone.MmSize || stone.MM || '0').toString(),
              Sieve: (stone.SieveSize || stone.Sieve || '0').toString(),
              Weight: (stone.Weight || 0).toString(),
              Pieces: (stone.Pcs || stone.Pieces || 0).toString(),
              CaratWeight: (stone.CtWeight || stone.CaratWeight || 0).toString(),
              Price: (stone.Price || 0).toString(),
            }));
            
            console.log('Updated Stones:', JSON.stringify(updatedStones, null, 2));
            updated[entryIndex].stones = updatedStones;
          }
          
          console.log('=== STATE UPDATE COMPLETE ===');
          console.log('Final Entry State:', JSON.stringify(updated[entryIndex], null, 2));
          console.log('✅ ALL FIELDS REPLACED WITH CALCULATED VALUES');
          console.log('Display Values:');
          console.log('  Metal Price:', updatedFormData.metalPrice);
          console.log('  Diamonds Price:', updatedFormData.diamondPrice);
          console.log('  Total Price:', updatedFormData.totalPrice);
          console.log('  Metal Weight:', updatedFormData.metalWeight);
          console.log('  Metal Quality:', updatedFormData.metalQuality);
          console.log('  Metal Rate:', updatedFormData.metalRateOverride);
          console.log('  Diamond Weight:', updatedFormData.diamondWeight);
          console.log('  Loss:', updatedFormData.lossPercent);
          console.log('  Labour:', updatedFormData.labour);
          console.log('  Extra Charges:', updatedFormData.extraCharges);
          
          return updated;
        });
        
        Alert.alert('Success', 'All fields updated with calculated values');
      } else {
        console.log('ERROR: Response is null or undefined');
      }
    } catch (error) {
      console.log('=== CALCULATE ERROR ===');
      console.log('Error Type:', typeof error);
      console.log('Error Object:', error);
      console.log('Error Stringified:', JSON.stringify(error, null, 2));
      console.log('Error Message:', error?.message);
      console.log('Error Data:', error?.data);
      console.log('Error Status:', error?.status);
      console.log('Error Stack:', error?.stack);
      
      // More detailed error logging
      if (error?.data) {
        console.log('Error Data Details:', JSON.stringify(error.data, null, 2));
      }
      
      const errorMessage = error?.data?.message || error?.data?.error || error?.message || 'Failed to calculate pricing';
      console.log('Showing error alert:', errorMessage);
      Alert.alert('Error', errorMessage);
    } finally {
      // Note: isCalculating is managed by the mutation hook automatically
      console.log('=== CALCULATE COMPLETE ===');
    }
  };

  // Sync client pricing for a specific entry
  const handleSyncClientPricingForEntry = async (entryIndex) => {
    if (entryIndex === null || !pricingEntriesState[entryIndex]) {
      Alert.alert('Error', 'Invalid pricing entry');
      return;
    }

    setIsSyncing(true);
    try {
      const entryState = pricingEntriesState[entryIndex];
      const entryFormData = entryState.formData;
      const entryStones = entryState.stones;

      // Get clientId from multiple possible sources
      const clientId = enquiry?.clientId || 
                       enquiry?.ClientId || 
                       originalData?.clientId || 
                       originalData?.ClientId ||
                       null;

      if (!clientId) {
        Alert.alert(
          'Missing Client ID',
          'Client ID is required for syncing client pricing. Please ensure the enquiry has a valid client assigned.'
        );
        return;
      }

      // Get metal details from enquiry
      const metalColor = originalData?.Metal?.Color || enquiry?.Metal?.Color || 'Gold';
      const metalQuality = originalData?.Metal?.Quality || enquiry?.Metal?.Quality || '24K';
      const metalWeight = parseFloat(entryFormData.metalWeight) || 0;

      // Format stones array according to API specification
      const formattedStones = entryStones.map(stone => ({
        Type: stone.Type || '',
        Color: stone.Color || '',
        Shape: stone.Shape || '',
        MmSize: stone.MM || '0',
        SieveSize: stone.Sieve || '0',
        CtWeight: parseFloat(stone.CaratWeight) || 0,
        Weight: parseFloat(stone.Weight) || 0,
        Pcs: parseInt(stone.Pieces) || 0,
        Price: parseFloat(stone.Price) || 0,
      })).filter(stone => stone.Type); // Only include stones with Type

      // Build payload according to API specification.
      // For sync-client-pricing, we omit the rate fields so the server falls back
      // to the client policy values (Loss/Labour/ExtraCharges/UndercutPrice + the
      // five duty rates) and returns them in response.Client.
      const payload = {
        clientId: clientId,
        details: {
          Metal: {
            Weight: metalWeight,
            Quality: metalQuality,
          },
          Stones: formattedStones,
          Quantity: parseInt(entryFormData.totalPieces) || 1,
        },
      };

      console.log('🟢 SYNC CLIENT PRICING - Client ID Status:');
      console.log('✅ Client ID IS being sent');
      console.log('📦 Payload clientId:', payload.clientId);
      console.log('📋 Full payload:', JSON.stringify(payload, null, 2));

      // Call API to sync client pricing
      const response = await calculatePricing(payload).unwrap();

      console.log('🟢 SYNC PRICING - API Response:');
      console.log('📥 Full Response:', JSON.stringify(response, null, 2));
      console.log('💰 MetalPrice:', response?.MetalPrice);
      console.log('💎 DiamondsPrice:', response?.DiamondsPrice);
      console.log('💎 DiamondPrice (alternative):', response?.DiamondPrice);
      console.log('📊 TotalPrice:', response?.TotalPrice);
      console.log('💎 DiamondWeight:', response?.DiamondWeight);

      // Update the specific entry's form data with response
      if (response) {
        // Update metal price - handle 0 as valid value
        if (response.MetalPrice !== undefined && response.MetalPrice !== null) {
          console.log('✅ Updating MetalPrice:', response.MetalPrice);
          updatePricingEntryFormData(entryIndex, 'metalPrice', parseFloat(response.MetalPrice).toFixed(2));
        } else {
          console.log('⚠️ MetalPrice is undefined or null in response');
        }

        // Update diamonds price - handle 0 as valid value
        if (response.DiamondsPrice !== undefined && response.DiamondsPrice !== null) {
          console.log('✅ Updating DiamondsPrice:', response.DiamondsPrice);
          updatePricingEntryFormData(entryIndex, 'diamondPrice', parseFloat(response.DiamondsPrice).toFixed(2));
        } else {
          console.log('⚠️ DiamondsPrice is undefined or null in response');
          // Check for alternative field names
          if (response.DiamondPrice !== undefined && response.DiamondPrice !== null) {
            console.log('✅ Found DiamondPrice (alternative), updating:', response.DiamondPrice);
            updatePricingEntryFormData(entryIndex, 'diamondPrice', parseFloat(response.DiamondPrice).toFixed(2));
          } else {
            console.log('❌ No diamond price found in response. Setting to 0.');
            updatePricingEntryFormData(entryIndex, 'diamondPrice', '0.00');
          }
        }

        // Update total price - handle 0 as valid value
        if (response.TotalPrice !== undefined && response.TotalPrice !== null) {
          console.log('✅ Updating TotalPrice:', response.TotalPrice);
          updatePricingEntryFormData(entryIndex, 'totalPrice', parseFloat(response.TotalPrice).toFixed(2));
        } else {
          // Calculate total if not provided
          const metalPrice = parseFloat(response.MetalPrice || 0);
          const diamondsPrice = parseFloat(response.DiamondsPrice || response.DiamondPrice || 0);
          const totalPrice = (metalPrice + diamondsPrice).toFixed(2);
          console.log('⚠️ TotalPrice not in response, calculating:', totalPrice, 'from MetalPrice:', metalPrice, 'and DiamondsPrice:', diamondsPrice);
          updatePricingEntryFormData(entryIndex, 'totalPrice', totalPrice);
        }

        // Update metal weight and rate if provided
        if (response.Metal) {
          if (response.Metal.Weight !== undefined) {
            updatePricingEntryFormData(entryIndex, 'metalWeight', response.Metal.Weight.toString());
          }
        }

        // Update diamond weight
        if (response.DiamondWeight !== undefined) {
          updatePricingEntryFormData(entryIndex, 'diamondWeight', response.DiamondWeight.toString());
        }

        // Update client-specific charges if provided
        if (response.Client) {
          if (response.Client.Loss !== undefined) {
            updatePricingEntryFormData(entryIndex, 'lossPercent', response.Client.Loss.toString());
          }
          if (response.Client.Labour !== undefined) {
            updatePricingEntryFormData(entryIndex, 'labour', response.Client.Labour.toString());
          }
          if (response.Client.ExtraCharges !== undefined) {
            updatePricingEntryFormData(entryIndex, 'extraCharges', response.Client.ExtraCharges.toString());
          }
          if (response.Client.UndercutPrice !== undefined) {
            updatePricingEntryFormData(entryIndex, 'undercutPrice', response.Client.UndercutPrice.toString());
          }
          const syncDutyKeys = ['NaturalDuties', 'LabDuties', 'GoldDuties', 'SilverAndLabsDuties', 'LossAndLabourDuties'];
          const syncDutyFormKeys = ['naturalDuties', 'labDuties', 'goldDuties', 'silverAndLabsDuties', 'lossAndLabourDuties'];
          syncDutyKeys.forEach((key, i) => {
            const v = response.Client[key];
            if (v !== undefined && v !== null) {
              updatePricingEntryFormData(entryIndex, syncDutyFormKeys[i], v.toString());
            }
          });
        }

        if (response.Applicable) {
          setPricingEntriesState(prev => {
            const updated = [...prev];
            if (updated[entryIndex]) {
              updated[entryIndex] = { ...updated[entryIndex], applicable: response.Applicable };
            }
            return updated;
          });
        }

        Alert.alert('Success', 'Client pricing synced successfully');
      }
    } catch (error) {
      const errorMessage = error?.data?.message || error?.message || 'Failed to sync client pricing';
      Alert.alert('Error', errorMessage);
    } finally {
      setIsSyncing(false);
    }
  };

  // Legacy handleSyncClientPricing - kept for backward compatibility but now uses entry-specific function
  const handleSyncClientPricing = async () => {
    // If we're in edit modal, use entry-specific function
    if (editingEntryIndex !== null && pricingEntriesState[editingEntryIndex]) {
      await handleSyncClientPricingForEntry(editingEntryIndex);
      return;
    }
    
    // Otherwise, use the first entry or show error
    if (pricingEntriesState.length > 0) {
      await handleSyncClientPricingForEntry(0);
    } else {
      Alert.alert('Error', 'No pricing entries available');
    }
  };

  // Function to get pricing entry label
  const getPricingEntryLabel = (pricingEntry, index) => {
    const entryNumber = index + 1;
    if (pricingEntry?.ClientPricingMessage) {
      return `Pricing Entry #${entryNumber} - ${pricingEntry.ClientPricingMessage}`;
    }
    return `Pricing Entry #${entryNumber}`;
  };

  // Helper to update a specific pricing entry's formData - memoized
  const updatePricingEntryFormData = useCallback((index, field, value) => {
    setPricingEntriesState(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        formData: {
          ...updated[index].formData,
          [field]: value,
        },
      };
      return updated;
    });
  }, []);

  // Helper to update a specific pricing entry's stones - memoized
  const updatePricingEntryStone = useCallback((entryIndex, stoneIndex, field, value) => {
    setPricingEntriesState(prev => {
      const updated = [...prev];
      const newStones = [...updated[entryIndex].stones];
      newStones[stoneIndex] = {
        ...newStones[stoneIndex],
        [field]: value,
      };
      updated[entryIndex] = {
        ...updated[entryIndex],
        stones: newStones,
      };
      return updated;
    });
  }, []);

  // Helper to add a stone to a specific pricing entry - memoized
  const addStoneToPricingEntry = useCallback((entryIndex) => {
    setPricingEntriesState(prev => {
      const updated = [...prev];
      const newStone = {
        Type: '',
        Color: '',
        Shape: '',
        MM: '',
        Sieve: '',
        Weight: '0',
        Pieces: '0',
        CaratWeight: '0',
        Price: '0',
      };
      updated[entryIndex] = {
        ...updated[entryIndex],
        stones: [...updated[entryIndex].stones, newStone],
      };
      return updated;
    });
  }, []);

  // Helper to delete a stone from a specific pricing entry - memoized
  const deleteStoneFromPricingEntry = useCallback((entryIndex, stoneIndex) => {
    setPricingEntriesState(prev => {
      const updated = [...prev];
      updated[entryIndex] = {
        ...updated[entryIndex],
        stones: updated[entryIndex].stones.filter((_, i) => i !== stoneIndex),
      };
      return updated;
    });
  }, []);

  // Helper to restore original entry state when closing modal without saving
  // Restores from latest API data (allPricingEntries) to ensure we get the most recent saved pricing
  const restoreOriginalEntry = useCallback((entryIndex) => {
    if (entryIndex !== null && entryIndex < allPricingEntries.length) {
      // Restore from the latest API data (allPricingEntries) to get the most recent saved pricing
      const originalEntry = allPricingEntries[entryIndex];
      if (originalEntry) {
        const restoredState = initializePricingEntryState(originalEntry);
        setPricingEntriesState(prev => {
          const updated = [...prev];
          updated[entryIndex] = restoredState;
          return updated;
        });
      }
    } else if (entryIndex !== null && originalEntrySnapshot) {
      // Fallback to snapshot if entry doesn't exist in API data yet
      setPricingEntriesState(prev => {
        const updated = [...prev];
        updated[entryIndex] = {
          formData: { ...originalEntrySnapshot.formData },
          stones: originalEntrySnapshot.stones.map(stone => ({ ...stone })),
          undercutEnabled: originalEntrySnapshot.undercutEnabled,
        };
        return updated;
      });
    }
    setOriginalEntrySnapshot(null);
  }, [allPricingEntries, initializePricingEntryState, originalEntrySnapshot]);

  // Function to render an editable pricing entry
  const renderEditablePricingEntry = (entryState, index, originalPricingEntry) => {
    const entryFormData = entryState.formData;
    const entryStones = entryState.stones;
    const entryUndercutEnabled = entryState.undercutEnabled;
    const pricingMetalRate = originalPricingEntry?.Metal?.Rate || originalPricingEntry?.MetalRate || 0;
    
    
    return (
      <Card key={index} style={[styles.pricingEntryCard, isTablet && styles.pricingEntryCardTablet]}>
        <Heading level={4} style={styles.pricingEntryTitle}>
          {getPricingEntryLabel(originalPricingEntry, index)} - Editable
        </Heading>
        
        {/* Metal Rate and Quality Info for this pricing entry */}
        <View style={styles.pricingEntryInfo}>
          <View style={styles.pricingEntryInfoRow}>
          {pricingMetalRate > 0 && (
              <>
            <CustomText variant="body" style={styles.pricingEntryInfoText}>
              Metal Rate: ${pricingMetalRate.toFixed(2)} per gram
            </CustomText>
                <CustomText variant="body" style={styles.pricingEntryInfoText}>
                  {' • '}
                </CustomText>
              </>
          )}
          <CustomText variant="body" style={styles.pricingEntryInfoText}>
            Metal Quality: {entryFormData.metalQuality || '10K'}
          </CustomText>
          </View>
          <CustomText variant="body" style={styles.pricingEntryInfoText}>
            Duties Amount: ${(parseFloat(entryFormData.dutiesAmount) || 0).toFixed(2)}
          </CustomText>
        </View>
        
        {/* Editable Pricing Details Grid */}
        <View style={[styles.pricingGrid, isTablet && styles.pricingGridTablet]}>
          {/* Row 1 */}
          <View style={[styles.inputRowThree, isTablet && styles.inputRowThreeTablet]}>
            <Input
              label="Metal Price*"
              value={entryFormData.metalPrice}
              onChangeText={(value) => updatePricingEntryFormData(index, 'metalPrice', value)}
              keyboardType="numeric"
              style={[styles.gridInputThird, styles.compactInputField]}
            />
            <Input
              label="Diamonds Price*"
              value={entryFormData.diamondPrice}
              onChangeText={(value) => updatePricingEntryFormData(index, 'diamondPrice', value)}
              keyboardType="numeric"
              style={[styles.gridInputThird, styles.compactInputField]}
            />
            <Input
              label="Total Price*"
              value={entryFormData.totalPrice}
              onChangeText={(value) => updatePricingEntryFormData(index, 'totalPrice', value)}
              keyboardType="numeric"
              style={[styles.gridInputThird, styles.compactInputField]}
              editable={false}
            />
          </View>

          {/* Row 2 */}
          <View style={styles.inputRowThree}>
            <Input
              label="Metal Weight"
              value={entryFormData.metalWeight}
              onChangeText={(value) => updatePricingEntryFormData(index, 'metalWeight', value)}
              keyboardType="numeric"
              style={[styles.gridInputThird, styles.compactInputField]}
            />
            <Input
              label="Diamond Weight"
              value={entryFormData.diamondWeight}
              onChangeText={(value) => updatePricingEntryFormData(index, 'diamondWeight', value)}
              keyboardType="numeric"
              style={[styles.gridInputThird, styles.compactInputField]}
            />
            <Input
              label="Total Pieces"
              value={entryFormData.totalPieces}
              onChangeText={(value) => updatePricingEntryFormData(index, 'totalPieces', value)}
              keyboardType="numeric"
              style={[styles.gridInputThird, styles.compactInputField]}
            />
          </View>

          {/* Row 3 — base charges */}
          <View style={styles.inputRowFour}>
            <Input
              label="Loss (%)"
              value={entryFormData.lossPercent}
              onChangeText={(value) => updatePricingEntryFormData(index, 'lossPercent', value)}
              keyboardType="numeric"
              style={[styles.gridInputQuarter, styles.compactInputField]}
            />
            <Input
              label="Labour"
              value={entryFormData.labour}
              onChangeText={(value) => updatePricingEntryFormData(index, 'labour', value)}
              keyboardType="numeric"
              style={[styles.gridInputQuarter, styles.compactInputField]}
            />
            <Input
              label="Extra Charges"
              value={entryFormData.extraCharges}
              onChangeText={(value) => updatePricingEntryFormData(index, 'extraCharges', value)}
              keyboardType="numeric"
              style={[styles.gridInputQuarter, styles.compactInputField]}
            />
            <Input
              label="Undercut Price"
              value={entryFormData.undercutPrice}
              onChangeText={(value) => updatePricingEntryFormData(index, 'undercutPrice', value)}
              keyboardType="numeric"
              style={[styles.gridInputQuarter, styles.compactInputField]}
            />
          </View>

          {/* Row 4 — duty rates, filtered by Applicable. If we don't have an
              Applicable map yet (e.g. user opened modal before pressing Calculate),
              derive it from the current entry so the right inputs show on first paint. */}
          {(() => {
            const applicable = entryState.applicable || computeApplicable({
              Metal: { Quality: entryFormData.metalQuality, Weight: entryFormData.metalWeight, Rate: entryFormData.metalRateOverride },
              Stones: entryStones.map(s => ({ Type: s.Type, CtWeight: s.CaratWeight, Price: s.Price })),
              Loss: entryFormData.lossPercent,
              Labour: entryFormData.labour,
            });
            const visibleDuties = DUTY_FIELDS.filter(f => applicable[f.key]);
            if (visibleDuties.length === 0) return null;
            return (
              <View style={styles.inputRowFour}>
                {visibleDuties.map(field => (
                  <Input
                    key={field.key}
                    label={field.label}
                    value={entryFormData[field.formKey]}
                    onChangeText={(value) => updatePricingEntryFormData(index, field.formKey, value)}
                    keyboardType="numeric"
                    style={[styles.gridInputQuarter, styles.compactInputField]}
                  />
                ))}
              </View>
            );
          })()}
        </View>

        {/* Editable Stones Table for this pricing entry */}
        <View style={[styles.pricingEntryStonesContainer, isTablet && styles.pricingEntryStonesContainerTablet]}>
          <View style={styles.stonesHeader}>
            <Heading level={5} style={[styles.pricingEntryStonesTitle, { flex: 1 }]}>Stones</Heading>
            <TouchableOpacity
              onPress={() => addStoneToPricingEntry(index)}
              style={[styles.stonesButton, styles.addButton]}
              activeOpacity={0.8}
            >
              <View style={styles.stonesBtnContent}>
                <Icon name="add" size={14} color={colors.textWhite} />
                <Text style={styles.stonesBtnText} numberOfLines={1}>Add Stone</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Change Stone Type and Metal Quality for All Stones in this pricing entry */}
          <View style={styles.stoneFilterRow}>
            <View style={{ flex: 1, marginRight: 4 }}>
              <Text style={styles.stoneFilterLabel}>Change All Stones</Text>
              <TouchableOpacity
                style={styles.stoneFilterButton}
                onPress={() => toggleEntryFilterDropdown(index)}
                activeOpacity={0.8}
              >
                <Text style={styles.stoneFilterButtonText} numberOfLines={1}>
                  Select Stone Type
                </Text>
                <Icon name="arrow-drop-down" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1, marginLeft: 4 }}>
              <Text style={styles.stoneFilterLabel}>Metal Quality</Text>
              <TouchableOpacity
                style={styles.stoneFilterButton}
                onPress={() => toggleEntryMetalQualityDropdown(index)}
                activeOpacity={0.8}
              >
                <Text style={styles.stoneFilterButtonText} numberOfLines={1}>
                  {entryFormData.metalQuality || 'Select Quality'}
                </Text>
                <Icon name="arrow-drop-down" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Metal Rate Override */}
          <View style={styles.metalRateOverrideContainer}>
            <Text style={styles.stoneFilterLabel}>Metal Rate Override</Text>
            <TextInput
              style={styles.metalRateOverrideInput}
              placeholder="Enter metal rate (optional)"
              placeholderTextColor={colors.textLight}
              value={entryFormData.metalRateOverride || ''}
              onChangeText={(value) => updatePricingEntryFormData(index, 'metalRateOverride', value)}
              keyboardType="numeric"
            />
          </View>

          <Modal
            visible={entryFilterDropdowns[index] || false}
            transparent
            animationType="fade"
            onRequestClose={() => toggleEntryFilterDropdown(index)}
          >
            <TouchableOpacity
              style={styles.modalOverlay}
              activeOpacity={1}
              onPress={() => toggleEntryFilterDropdown(index)}
            >
              <View style={styles.dropdownModal}>
                <ScrollView 
                  showsVerticalScrollIndicator={true}
                  nestedScrollEnabled={true}
                  style={styles.dropdownScrollView}
                >
                  {stoneTypeOptions.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={styles.dropdownOption}
                      onPress={() => {
                        // Update all stones' Type to the selected value
                        // Use setPricingEntriesState directly to update all stones at once
                        setPricingEntriesState(prev => {
                          const updated = [...prev];
                          if (updated[index] && updated[index].stones.length > 0) {
                            updated[index] = {
                              ...updated[index],
                              stones: updated[index].stones.map(stone => ({
                                ...stone,
                                Type: option.value,
                              })),
                            };
                          }
                          return updated;
                        });
                        toggleEntryFilterDropdown(index);
                      }}
                    >
                      <Text style={styles.dropdownOptionText}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>

          {/* Metal Quality Dropdown Modal */}
          <Modal
            visible={entryMetalQualityDropdowns[index] || false}
            transparent
            animationType="fade"
            onRequestClose={() => toggleEntryMetalQualityDropdown(index)}
          >
            <TouchableOpacity
              style={styles.modalOverlay}
              activeOpacity={1}
              onPress={() => toggleEntryMetalQualityDropdown(index)}
            >
              <View style={styles.dropdownModal}>
                <ScrollView 
                  showsVerticalScrollIndicator={true}
                  nestedScrollEnabled={true}
                  style={styles.dropdownScrollView}
                >
                  {metalQualityOptions.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={styles.dropdownOption}
                      onPress={() => {
                        // Update metal quality for this pricing entry
                        updatePricingEntryFormData(index, 'metalQuality', option.value);
                        toggleEntryMetalQualityDropdown(index);
                      }}
                    >
                      <Text style={styles.dropdownOptionText}>{option.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>
          
          {entryStones.length > 0 ? (
              <ScrollView 
                horizontal={!isTablet} 
                showsHorizontalScrollIndicator={isTablet ? false : true} 
                style={[styles.tableScrollView, isTablet && styles.tableScrollViewTablet]}
                contentContainerStyle={isTablet ? styles.tableScrollContentTablet : null}
              >
              <View style={[styles.tableWrapper, isTablet && styles.tableWrapperTablet]}>
                {/* Table Header */}
                    <View style={[styles.tableHeader, isTablet && styles.tableHeaderTablet]}>
                  <View style={[styles.tableHeaderCell, styles.tableCellFlexNumber, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexNumberTablet]}>
                        <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>#</CustomText>
                      </View>
                  <View style={[styles.tableHeaderCell, styles.tableCellFlexType, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexTypeTablet]}>
                        <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Type</CustomText>
                      </View>
                  <View style={[styles.tableHeaderCell, styles.tableCellFlexSmall, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                        <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Shape</CustomText>
                      </View>
                  <View style={[styles.tableHeaderCell, styles.tableCellFlexSmall, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                        <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>MM</CustomText>
                      </View>
                  <View style={[styles.tableHeaderCell, styles.tableCellFlexMedium, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexMediumTablet]}>
                        <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Sieve</CustomText>
                      </View>
                  <View style={[styles.tableHeaderCell, styles.tableCellFlexWeight, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexWeightTablet]}>
                    <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Wt</CustomText>
                      </View>
                  <View style={[styles.tableHeaderCell, styles.tableCellFlexSmall, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                    <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Pcs</CustomText>
                      </View>
                  <View style={[styles.tableHeaderCell, styles.tableCellFlexSmall, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                    <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Ct</CustomText>
                      </View>
                  <View style={[styles.tableHeaderCell, styles.tableCellFlexSmall, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                        <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Price</CustomText>
                      </View>
                  <View style={[styles.tableHeaderCell, styles.tableCellFlexSmall, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                    <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Color</CustomText>
                  </View>
                  <View style={[styles.tableHeaderCell, styles.tableCellFlexAction, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexActionTablet]}>
                        <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Action</CustomText>
                      </View>
                    </View>
                    
                {/* Table Body */}
                    <View style={styles.tableBody}>
                      {entryStones.map((stone, originalIndex) => (
                      <View key={originalIndex} style={[styles.tableRow, isTablet && styles.tableRowTablet, originalIndex % 2 === 1 && styles.tableRowEven]}>
                    <View style={[styles.tableCell, styles.tableCellFlexNumber, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexNumberTablet]}>
                          <CustomText variant="body" style={[styles.tableCellText, isTablet && styles.tableCellTextTablet]}>
                            {originalIndex + 1}
                          </CustomText>
                        </View>
                    <View style={[styles.tableCell, styles.tableCellFlexType, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexTypeTablet]}>
                          {renderTypeDropdown(`${index}-${originalIndex}`, stoneTypeOptions.find(opt => opt.value === stone.Type)?.label || '', index, originalIndex)}
                        </View>
                    <View style={[styles.tableCell, styles.tableCellFlexSmall, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                          <TextInput
                            style={[styles.tableInput, isTablet && styles.tableInputTablet]}
                            value={stone.Shape || ''}
                            onChangeText={(value) => updatePricingEntryStone(index, originalIndex, 'Shape', value)}
                            placeholder="Shape"
                            placeholderTextColor={colors.textLight}
                          />
                        </View>
                    <View style={[styles.tableCell, styles.tableCellFlexSmall, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                          <TextInput
                            style={[styles.tableInput, isTablet && styles.tableInputTablet]}
                            value={stone.MM || ''}
                            onChangeText={(value) => updatePricingEntryStone(index, originalIndex, 'MM', value)}
                            placeholder="0"
                            placeholderTextColor={colors.textLight}
                            keyboardType="numeric"
                          />
                        </View>
                    <View style={[styles.tableCell, styles.tableCellFlexMedium, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexMediumTablet]}>
                          <TextInput
                            style={[styles.tableInput, isTablet && styles.tableInputTablet]}
                            value={stone.Sieve || ''}
                            onChangeText={(value) => updatePricingEntryStone(index, originalIndex, 'Sieve', value)}
                            placeholder="0"
                            placeholderTextColor={colors.textLight}
                            keyboardType="numeric"
                          />
                        </View>
                    <View style={[styles.tableCell, styles.tableCellFlexWeight, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexWeightTablet]}>
                          <TextInput
                            style={[styles.tableInput, isTablet && styles.tableInputTablet]}
                            value={stone.Weight || '0'}
                            onChangeText={(value) => updatePricingEntryStone(index, originalIndex, 'Weight', value)}
                            placeholder="0"
                            placeholderTextColor={colors.textLight}
                            keyboardType="numeric"
                          />
                        </View>
                    <View style={[styles.tableCell, styles.tableCellFlexSmall, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                          <TextInput
                            style={[styles.tableInput, isTablet && styles.tableInputTablet]}
                            value={stone.Pieces || '0'}
                            onChangeText={(value) => updatePricingEntryStone(index, originalIndex, 'Pieces', value)}
                            placeholder="0"
                            placeholderTextColor={colors.textLight}
                            keyboardType="numeric"
                          />
                        </View>
                    <View style={[styles.tableCell, styles.tableCellFlexSmall, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                          <TextInput
                            style={[styles.tableInput, isTablet && styles.tableInputTablet]}
                            value={stone.CaratWeight || '0'}
                            onChangeText={(value) => updatePricingEntryStone(index, originalIndex, 'CaratWeight', value)}
                            placeholder="0"
                            placeholderTextColor={colors.textLight}
                            keyboardType="numeric"
                          />
                        </View>
                    <View style={[styles.tableCell, styles.tableCellFlexSmall, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                          <TextInput
                            style={[styles.tableInput, isTablet && styles.tableInputTablet]}
                            value={stone.Price || '0'}
                            onChangeText={(value) => updatePricingEntryStone(index, originalIndex, 'Price', value)}
                            placeholder="0"
                            placeholderTextColor={colors.textLight}
                            keyboardType="numeric"
                          />
                        </View>
                    <View style={[styles.tableCell, styles.tableCellFlexSmall, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                      <TextInput
                        style={[styles.tableInput, isTablet && styles.tableInputTablet]}
                        value={stone.Color || ''}
                        onChangeText={(value) => updatePricingEntryStone(index, originalIndex, 'Color', value)}
                        placeholder="Color"
                        placeholderTextColor={colors.textLight}
                      />
                    </View>
                    <View style={[styles.tableCell, styles.tableCellFlexAction, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexActionTablet]}>
                          <TouchableOpacity
                            onPress={() => {
                              Alert.alert(
                                'Delete Stone',
                                'Are you sure you want to delete this stone?',
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  {
                                    text: 'Delete',
                                    style: 'destructive',
                                    onPress: () => deleteStoneFromPricingEntry(index, originalIndex),
                                  },
                                ]
                              );
                            }}
                            style={styles.tableDeleteButton}
                          >
                        <Icon name="delete" size={14} color={colors.error} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
              </View>
              </ScrollView>
            ) : (
              <CustomText variant="body" style={styles.noStonesText}>
                No stones added yet. Click "Add Stone" to add stones.
              </CustomText>
            )}
        </View>

        {/* Client Pricing Message Section */}
        <View style={styles.messageCard}>
          <CustomText variant="label" style={styles.messageLabel}>
            Client Pricing Message
          </CustomText>
          <View style={styles.messageInputWrapper}>
            <TextInput
              style={styles.messageInput}
              placeholder="Enter client pricing message..."
              placeholderTextColor={colors.textLight}
              value={entryFormData.clientPricingMessage || ''}
              onChangeText={(value) => updatePricingEntryFormData(index, 'clientPricingMessage', value)}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        </View>
      </Card>
    );
  };

  // Function to render a single pricing entry (read-only display) - kept for backward compatibility
  const renderPricingEntry = (pricingEntry, index) => {
    const pricingStones = normalizeStones(pricingEntry?.Stones || pricingEntry?.stones || []);
    const pricingMetalRate = pricingEntry?.Metal?.Rate || pricingEntry?.MetalRate || 0;
    
    return (
      <View>
        {/* Metal Rate and Quality Info for this pricing entry */}
        <View style={styles.pricingEntryInfo}>
          {pricingMetalRate > 0 && (
            <CustomText variant="body" style={styles.pricingEntryInfoText}>
              Metal Rate: ${pricingMetalRate.toFixed(2)} per gram
            </CustomText>
          )}
          <CustomText variant="body" style={styles.pricingEntryInfoText}>
            Metal Quality: {pricingEntry?.Metal?.Quality || originalData?.Metal?.Quality || enquiry?.Metal?.Quality || '10K'}
          </CustomText>
          <CustomText variant="body" style={styles.pricingEntryInfoText}>
            Duties Amount: ${(pricingEntry?.DutiesAmount || pricingEntry?.dutiesAmount || 0).toFixed(2)}
          </CustomText>
        </View>
        
        {/* Pricing Details Grid */}
        <View style={[styles.pricingGrid, isTablet && styles.pricingGridTablet]}>
          {/* Row 1 */}
          <View style={[styles.inputRowThree, isTablet && styles.inputRowThreeTablet]}>
            <View style={styles.gridInputThird}>
              <CustomText variant="label" style={styles.pricingEntryLabel}>Metal Price</CustomText>
              <CustomText variant="body" style={styles.pricingEntryValue}>
                ${(pricingEntry?.MetalPrice || pricingEntry?.metalPrice || 0).toFixed(2)}
              </CustomText>
            </View>
            <View style={styles.gridInputThird}>
              <CustomText variant="label" style={styles.pricingEntryLabel}>Diamonds Price</CustomText>
              <CustomText variant="body" style={styles.pricingEntryValue}>
                ${(pricingEntry?.DiamondsPrice || pricingEntry?.DiamondPrice || pricingEntry?.diamondsPrice || pricingEntry?.diamondPrice || 0).toFixed(2)}
              </CustomText>
            </View>
            <View style={styles.gridInputThird}>
              <CustomText variant="label" style={styles.pricingEntryLabel}>Total Price</CustomText>
              <CustomText variant="body" style={styles.pricingEntryValue}>
                ${(pricingEntry?.TotalPrice || pricingEntry?.totalPrice || 0).toFixed(2)}
              </CustomText>
            </View>
          </View>

          {/* Row 2 */}
          <View style={styles.inputRowThree}>
            <View style={styles.gridInputThird}>
              <CustomText variant="label" style={styles.pricingEntryLabel}>Metal Weight</CustomText>
              <CustomText variant="body" style={styles.pricingEntryValue}>
                {(pricingEntry?.Metal?.Weight || pricingEntry?.MetalWeight || pricingEntry?.metalWeight || 0).toFixed(3)}
              </CustomText>
            </View>
            <View style={styles.gridInputThird}>
              <CustomText variant="label" style={styles.pricingEntryLabel}>Diamond Weight</CustomText>
              <CustomText variant="body" style={styles.pricingEntryValue}>
                {(pricingEntry?.DiamondWeight || pricingEntry?.diamondWeight || 0).toFixed(3)}
              </CustomText>
            </View>
            <View style={styles.gridInputThird}>
              <CustomText variant="label" style={styles.pricingEntryLabel}>Total Pieces</CustomText>
              <CustomText variant="body" style={styles.pricingEntryValue}>
                {pricingEntry?.TotalPieces || pricingEntry?.totalPieces || 0}
              </CustomText>
            </View>
          </View>

          {/* Row 3 — duty rates are summarized via "Duties Amount" above; we
              only show the base charges here. */}
          <View style={styles.inputRowThree}>
            <View style={styles.gridInputThird}>
              <CustomText variant="label" style={styles.pricingEntryLabel}>Loss (%)</CustomText>
              <CustomText variant="body" style={styles.pricingEntryValue}>
                {(pricingEntry?.Loss || pricingEntry?.lossPercent || pricingEntry?.loss || 0).toFixed(1)}%
              </CustomText>
            </View>
            <View style={styles.gridInputThird}>
              <CustomText variant="label" style={styles.pricingEntryLabel}>Labour</CustomText>
              <CustomText variant="body" style={styles.pricingEntryValue}>
                ${(pricingEntry?.Labour || pricingEntry?.labour || 0).toFixed(2)}
              </CustomText>
            </View>
            <View style={styles.gridInputThird}>
              <CustomText variant="label" style={styles.pricingEntryLabel}>Extra Charges</CustomText>
              <CustomText variant="body" style={styles.pricingEntryValue}>
                ${(pricingEntry?.ExtraCharges || pricingEntry?.extraCharges || 0).toFixed(2)}
              </CustomText>
            </View>
          </View>
        </View>

        {/* Stones Table for this pricing entry */}
        {pricingStones.length > 0 && (
          <View style={[styles.pricingEntryStonesContainer, isTablet && styles.pricingEntryStonesContainerTablet]}>
            <Heading level={5} style={styles.pricingEntryStonesTitle}>Stones</Heading>
            <ScrollView 
              horizontal={!isTablet} 
              showsHorizontalScrollIndicator={isTablet ? false : true} 
              style={[styles.tableScrollView, isTablet && styles.tableScrollViewTablet]}
              contentContainerStyle={isTablet ? styles.tableScrollContentTablet : null}
            >
            <View style={[styles.tableWrapper, isTablet && styles.tableWrapperTablet]}>
                  {/* Table Header */}
                  <View style={[styles.tableHeader, isTablet && styles.tableHeaderTablet]}>
                <View style={[styles.tableHeaderCell, styles.tableCellFlexNumber, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexNumberTablet]}>
                      <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>#</CustomText>
                    </View>
                <View style={[styles.tableHeaderCell, styles.tableCellFlexType, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexTypeTablet]}>
                      <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Type</CustomText>
                    </View>
                <View style={[styles.tableHeaderCell, styles.tableCellFlexSmall, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                      <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Shape</CustomText>
                    </View>
                <View style={[styles.tableHeaderCell, styles.tableCellFlexSmall, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                      <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>MM</CustomText>
                    </View>
                <View style={[styles.tableHeaderCell, styles.tableCellFlexMedium, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexMediumTablet]}>
                      <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Sieve</CustomText>
                    </View>
                <View style={[styles.tableHeaderCell, styles.tableCellFlexWeight, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexWeightTablet]}>
                  <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Wt</CustomText>
                    </View>
                <View style={[styles.tableHeaderCell, styles.tableCellFlexSmall, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                  <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Pcs</CustomText>
                    </View>
                <View style={[styles.tableHeaderCell, styles.tableCellFlexCt, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexCtTablet]}>
                  <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Ct</CustomText>
                    </View>
                <View style={[styles.tableHeaderCell, styles.tableCellFlexPrice, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexPriceTablet]}>
                      <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Price</CustomText>
                    </View>
                <View style={[styles.tableHeaderCell, styles.tableCellFlexSmall, isTablet && styles.tableHeaderCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                  <CustomText variant="caption" style={[styles.tableHeaderText, isTablet && styles.tableHeaderTextTablet]}>Color</CustomText>
                </View>
                  </View>
                  
                  {/* Table Body */}
                  <View style={styles.tableBody}>
                    {pricingStones.map((stone, stoneIndex) => (
                  <View key={stoneIndex} style={[styles.tableRow, styles.tableRowView, isTablet && styles.tableRowTablet, stoneIndex % 2 === 1 && styles.tableRowEven]}>
                    <View style={[styles.tableCell, styles.tableCellView, styles.tableCellFlexNumber, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexNumberTablet]}>
                          <CustomText variant="body" style={[styles.tableCellText, isTablet && styles.tableCellTextTablet]}>
                            {stoneIndex + 1}
                          </CustomText>
                        </View>
                    <View style={[styles.tableCell, styles.tableCellView, styles.tableCellFlexType, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexTypeTablet]}>
                          <CustomText variant="body" style={[styles.tableCellText, isTablet && styles.tableCellTextTablet]}>
                            {stone.Type || '-'}
                          </CustomText>
                        </View>
                    <View style={[styles.tableCell, styles.tableCellView, styles.tableCellFlexSmall, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                          <CustomText variant="body" style={[styles.tableCellText, isTablet && styles.tableCellTextTablet]}>
                            {stone.Shape || '-'}
                          </CustomText>
                        </View>
                    <View style={[styles.tableCell, styles.tableCellView, styles.tableCellFlexSmall, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                          <CustomText variant="body" style={[styles.tableCellText, isTablet && styles.tableCellTextTablet]}>
                            {stone.MM || '-'}
                          </CustomText>
                        </View>
                    <View style={[styles.tableCell, styles.tableCellView, styles.tableCellFlexMedium, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexMediumTablet]}>
                          <CustomText variant="body" style={[styles.tableCellText, isTablet && styles.tableCellTextTablet]}>
                            {stone.Sieve || '-'}
                          </CustomText>
                        </View>
                    <View style={[styles.tableCell, styles.tableCellView, styles.tableCellFlexWeight, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexWeightTablet]}>
                      <CustomText variant="body" style={[styles.tableCellText, isTablet && styles.tableCellTextTablet]} numberOfLines={1}>
                            {parseFloat(stone.Weight || 0).toFixed(4)}
                          </CustomText>
                        </View>
                    <View style={[styles.tableCell, styles.tableCellView, styles.tableCellFlexSmall, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                          <CustomText variant="body" style={[styles.tableCellText, isTablet && styles.tableCellTextTablet]}>
                            {stone.Pieces || 0}
                          </CustomText>
                        </View>
                    <View style={[styles.tableCell, styles.tableCellView, styles.tableCellFlexCt, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexCtTablet]}>
                          <CustomText variant="body" style={[styles.tableCellText, isTablet && styles.tableCellTextTablet]}>
                            {parseFloat(stone.CaratWeight || 0).toFixed(3)}
                          </CustomText>
                        </View>
                    <View style={[styles.tableCell, styles.tableCellView, styles.tableCellFlexPrice, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexPriceTablet]}>
                      <CustomText variant="body" style={[styles.tableCellText, isTablet && styles.tableCellTextTablet]}>
                            ${parseFloat(stone.Price || 0).toFixed(2)}
                          </CustomText>
                        </View>
                    <View style={[styles.tableCell, styles.tableCellView, styles.tableCellFlexSmall, isTablet && styles.tableCellTablet, isTablet && styles.tableCellFlexSmallTablet]}>
                      <CustomText variant="body" style={[styles.tableCellText, isTablet && styles.tableCellTextTablet]}>
                        {stone.Color || '-'}
                      </CustomText>
                    </View>
                      </View>
                    ))}
                  </View>
            </View>
            </ScrollView>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, isTablet && styles.scrollContentTablet]}>
        {/* Header with Download Excel */}
        <View style={styles.header}>
          <Heading level={3} style={styles.headerTitle}>Pricing</Heading>
          {/* {designCode && (
            <Button
              title={`Download Excel - ${designCode}.xlsx`}
              onPress={handleDownloadExcel}
              style={styles.downloadExcelButton}
            />
          )} */}
          <></>
        </View>

        {/* Metal Rate Information */}
        <Card style={styles.infoCard}>
          {loadingMetalPrices ? (
            <CustomText variant="body" style={styles.infoText}>
              Loading metal rates...
            </CustomText>
          ) : (
            <CustomText variant="body" style={styles.infoText}>
              {/* The Metal Rate considered for quotation was ${metalRateConsidered.toFixed(2)} per gram.{'\n'} */}
              The Latest Metal Rate is ${latestMetalRate.toFixed(2)} per gram.{'\n'}
              Please click on calculate to update calculations according to latest rates.{'\n'}
              {/* The Duties considered for quotation was ${dutiesConsidered.toFixed(2)}. */}
            </CustomText>
          )}
        </Card>

        {/* Display All Existing Pricing Entries - View Mode with Edit Button */}
        <View style={styles.allPricingEntriesContainer}>
          <Heading level={4} style={styles.allPricingEntriesTitle}>
            Pricing Entries ({allPricingEntries.length})
          </Heading>
          <View style={styles.pricingButtonsContainer}>
            {allPricingEntries.length > 0 && (
              <TouchableOpacity
                style={[styles.addPricingButton, styles.copyPricingButton]}
                onPress={() => {
                  // Copy the last pricing entry
                  const lastPricingEntry = allPricingEntries[allPricingEntries.length - 1];
                  if (lastPricingEntry) {
                    // Initialize state from the last pricing entry (deep copy)
                    const copiedEntryState = initializePricingEntryState(lastPricingEntry);
                    
                    // Deep copy stones array to avoid reference issues
                    const copiedStones = copiedEntryState.stones.map(stone => ({ ...stone }));
                    
                    const newEntryState = {
                      formData: { ...copiedEntryState.formData },
                      stones: copiedStones,
                      undercutEnabled: copiedEntryState.undercutEnabled,
                    };
                    
                    // Calculate the new index before updating state
                    const newIndex = pricingEntriesState.length;
                    
                    // Add to state temporarily for editing
                    setPricingEntriesState(prev => [...prev, newEntryState]);
                    setEditingEntryIndex(newIndex);
                    setShowAddModal(true);
                  }
                }}
                activeOpacity={0.8}
              >
                <Icon name="content-copy" size={16} color={colors.textWhite} />
                <Text style={styles.addPricingButtonText} numberOfLines={1}>Copy Last Pricing</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.addPricingButton}
              onPress={() => {
                // Create a new empty pricing entry
                const defaultMetalQuality = originalData?.Metal?.Quality || enquiry?.Metal?.Quality || '10K';
                const newEntryState = {
                  formData: {
                    metalPrice: '0',
                    diamondPrice: '0',
                    totalPrice: '0',
                    metalWeight: '0',
                    diamondWeight: '0',
                    totalPieces: '0',
                    lossPercent: '0',
                    labour: '0',
                    naturalDuties: '0',
                    labDuties: '0',
                    goldDuties: '0',
                    silverAndLabsDuties: '0',
                    lossAndLabourDuties: '0',
                    extraCharges: '0',
                    undercutPrice: '0',
                    clientPricingMessage: '',
                    metalQuality: defaultMetalQuality,
                  },
                  stones: [],
                  undercutEnabled: false,
                  applicable: null,
                };
                // Add to state temporarily for editing
                setPricingEntriesState(prev => [...prev, newEntryState]);
                setEditingEntryIndex(pricingEntriesState.length);
                setShowAddModal(true);
              }}
              activeOpacity={0.8}
            >
              <Icon name="add" size={16} color={colors.textWhite} />
              <Text style={styles.addPricingButtonText} numberOfLines={1}>+ Add Pricing</Text>
            </TouchableOpacity>
          </View>
          {pricingEntriesState.length > 0 ? (
            pricingEntriesState.map((entryState, index) => {
              // Convert state format to raw format for renderPricingEntry
              const entryFormData = entryState.formData;
              const entryStones = entryState.stones;
              const pricingEntry = {
                MetalPrice: parseFloat(entryFormData.metalPrice) || 0,
                DiamondsPrice: parseFloat(entryFormData.diamondPrice) || 0,
                TotalPrice: parseFloat(entryFormData.totalPrice) || 0,
                DutiesAmount: parseFloat(entryFormData.dutiesAmount) || 0,
                DiamondWeight: parseFloat(entryFormData.diamondWeight) || 0,
                TotalPieces: parseInt(entryFormData.totalPieces) || 0,
                Metal: {
                  Weight: parseFloat(entryFormData.metalWeight) || 0,
                  Quality: entryFormData.metalQuality || '10K',
                  Rate: parseFloat(entryFormData.metalRateOverride) || 0,
                },
                Loss: parseFloat(entryFormData.lossPercent) || 0,
                Labour: parseFloat(entryFormData.labour) || 0,
                NaturalDuties: parseFloat(entryFormData.naturalDuties) || 0,
                LabDuties: parseFloat(entryFormData.labDuties) || 0,
                GoldDuties: parseFloat(entryFormData.goldDuties) || 0,
                SilverAndLabsDuties: parseFloat(entryFormData.silverAndLabsDuties) || 0,
                LossAndLabourDuties: parseFloat(entryFormData.lossAndLabourDuties) || 0,
                UndercutPrice: parseFloat(entryFormData.undercutPrice) || 0,
                ExtraCharges: parseFloat(entryFormData.extraCharges) || 0,
                ClientPricingMessage: entryFormData.clientPricingMessage || '',
                Stones: entryStones.map(stone => ({
                  Type: stone.Type || '',
                  Color: stone.Color || '',
                  Shape: stone.Shape || '',
                  MmSize: stone.MM || '',
                  SieveSize: stone.Sieve || '',
                  CtWeight: parseFloat(stone.CaratWeight) || 0,
                  Weight: parseFloat(stone.Weight) || 0,
                  Pcs: parseInt(stone.Pieces) || 0,
                  Price: parseFloat(stone.Price) || 0,
                })),
              };
              
              return (
                <Card key={index} style={[styles.pricingEntryCard, isTablet && styles.pricingEntryCardTablet]}>
                  <View style={styles.pricingEntryHeader}>
                    <Heading level={4} style={styles.pricingEntryTitle}>
                      {getPricingEntryLabel(pricingEntry, index)}
                    </Heading>
                    <TouchableOpacity
                      style={styles.editButton}
                      onPress={() => {
                        // Save a deep copy of the current entry state before editing
                        const currentEntry = pricingEntriesState[index];
                        if (currentEntry) {
                          const snapshot = {
                            formData: { ...currentEntry.formData },
                            stones: currentEntry.stones.map(stone => ({ ...stone })),
                            undercutEnabled: currentEntry.undercutEnabled,
                          };
                          setOriginalEntrySnapshot(snapshot);
                        }
                        setEditingEntryIndex(index);
                        setShowEditModal(true);
                        // Defer heavy rendering until after modal animation
                        setModalContentReady(false);
                        isModalOpenRef.current = true;
                        // Clear any existing timeout
                        if (modalTimeoutRef.current) {
                          clearTimeout(modalTimeoutRef.current);
                        }
                        // Schedule content rendering after interactions complete
                        InteractionManager.runAfterInteractions(() => {
                          // Only set ready if modal is still open
                          if (isModalOpenRef.current) {
                            setModalContentReady(true);
                          }
                        });
                        // Fallback: ensure content renders after 300ms even if interactions don't complete
                        modalTimeoutRef.current = setTimeout(() => {
                          if (isModalOpenRef.current) {
                            setModalContentReady(prev => {
                              // Only update if still false (interaction didn't complete yet)
                              if (!prev) {
                                return true;
                              }
                              return prev;
                            });
                          }
                        }, 300);
                      }}
                      activeOpacity={0.8}
                    >
                      <Icon name="edit" size={14} color={colors.primary} />
                      <Text style={styles.editButtonText}>Edit</Text>
                    </TouchableOpacity>
                  </View>
                  {renderPricingEntry(pricingEntry, index)}
                  
                  {/* Download Button for View Mode */}
                  <View style={styles.pricingEntryActions}>
                    <TouchableOpacity
                      onPress={() => {
                        // Download pricing for this specific entry
                        handleDownloadPricingForEntry(pricingEntry, entryStones);
                      }}
                      style={[styles.pricingEntryActionButton, styles.downloadButton]}
                      activeOpacity={0.8}
                    >
                      <Icon name="file-download" size={14} color={colors.textWhite} />
                      <Text style={styles.pricingEntryActionButtonText} numberOfLines={1}>Download Pricing</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })
          ) : (
            <Card style={[styles.pricingEntryCard, isTablet && styles.pricingEntryCardTablet]}>
              <CustomText variant="body" style={styles.noPricingText}>
                No pricing entries yet. Click "Add Pricing" to create your first pricing entry.
              </CustomText>
            </Card>
          )}
        </View>

        {/* Modal for Editing Pricing Entry */}
        <Modal
          visible={showEditModal}
          animationType="slide"
          transparent={false}
          onRequestClose={() => {
            // Restore original state when closing without saving
            if (editingEntryIndex !== null) {
              restoreOriginalEntry(editingEntryIndex);
            }
            // Clean up
            isModalOpenRef.current = false;
            if (modalTimeoutRef.current) {
              clearTimeout(modalTimeoutRef.current);
              modalTimeoutRef.current = null;
            }
            setShowEditModal(false);
            setEditingEntryIndex(null);
            setModalContentReady(false);
          }}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Heading level={3} style={styles.modalTitle}>
                Edit Pricing Entry {editingEntryIndex !== null ? editingEntryIndex + 1 : ''}
              </Heading>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => {
                  // Restore original state when closing without saving
                  if (editingEntryIndex !== null) {
                    restoreOriginalEntry(editingEntryIndex);
                  }
                  // Clean up
                  isModalOpenRef.current = false;
                  if (modalTimeoutRef.current) {
                    clearTimeout(modalTimeoutRef.current);
                    modalTimeoutRef.current = null;
                  }
                  setShowEditModal(false);
                  setEditingEntryIndex(null);
                  setModalContentReady(false);
                }}
                activeOpacity={0.8}
              >
                <Icon name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView 
              style={styles.modalContent} 
              contentContainerStyle={styles.modalContentContainer}
              removeClippedSubviews={true}
            >
              {modalContentReady && editingEntryIndex !== null && pricingEntriesState[editingEntryIndex] && (
                renderEditablePricingEntry(
                  pricingEntriesState[editingEntryIndex],
                  editingEntryIndex,
                  allPricingEntries[editingEntryIndex]
                )
              )}
            </ScrollView>
            <View style={styles.modalFooter}>
              <View style={styles.modalFooterSingleRow}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelModalButton]}
                  onPress={() => {
                    // Restore original state when closing without saving
                    if (editingEntryIndex !== null) {
                      restoreOriginalEntry(editingEntryIndex);
                    }
                    // Clean up
                    isModalOpenRef.current = false;
                    if (modalTimeoutRef.current) {
                      clearTimeout(modalTimeoutRef.current);
                      modalTimeoutRef.current = null;
                    }
                    setShowEditModal(false);
                    setEditingEntryIndex(null);
                    setModalContentReady(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modalButtonText, styles.cancelModalButtonText]} numberOfLines={1}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalButton, 
                    styles.saveModalButton
                  ]}
                  onPress={async () => {
                    try {
                      // Save without navigating back (stay on pricing screen)
                      await handleSave(false);
                      // Clear snapshot after successful save
                      setOriginalEntrySnapshot(null);
                      // Close modal after successful save
                    // Clean up
                    isModalOpenRef.current = false;
                    if (modalTimeoutRef.current) {
                      clearTimeout(modalTimeoutRef.current);
                      modalTimeoutRef.current = null;
                    }
                      setShowEditModal(false);
                      setEditingEntryIndex(null);
                    setModalContentReady(false);
                    } catch (error) {
                      // Error is already handled in handleSave
                      // Modal stays open so user can fix and retry
                    }
                  }}
                  disabled={isSaving}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.modalButtonText, 
                    styles.saveModalButtonText
                  ]} numberOfLines={1}>
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    console.log('🔘 CALCULATE BUTTON PRESSED IN UI (Add Modal)');
                    console.log('Editing Entry Index:', editingEntryIndex);
                    console.log('Entry Exists:', pricingEntriesState[editingEntryIndex] ? 'YES' : 'NO');
                    if (editingEntryIndex !== null && pricingEntriesState[editingEntryIndex]) {
                      console.log('✅ Calling handleCalculateForEntry...');
                      await handleCalculateForEntry(editingEntryIndex);
                    } else {
                      console.log('❌ Cannot calculate - invalid entry index or entry does not exist');
                      Alert.alert('Error', 'Please select a valid pricing entry to calculate');
                    }
                  }}
                  disabled={isCalculating}
                  style={[styles.modalActionButton, styles.calculateBtn, isCalculating && styles.btnDisabled]}
                  activeOpacity={0.7}
                >
                  <Icon name="calculate" size={14} color={colors.textWhite} />
                  <Text style={styles.modalActionButtonText} numberOfLines={1}>
                    {isCalculating ? "Calculating..." : "Calculate"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    if (editingEntryIndex !== null && pricingEntriesState[editingEntryIndex]) {
                      await handleSyncClientPricingForEntry(editingEntryIndex);
                    }
                  }}
                  disabled={isSyncing}
                  style={[styles.modalActionButton, styles.syncBtn, isSyncing && styles.btnDisabled]}
                  activeOpacity={0.7}
                >
                  <Icon name="sync" size={14} color={colors.textWhite} />
                  <Text style={styles.modalActionButtonText} numberOfLines={1}>
                    {isSyncing ? 'Syncing...' : 'Sync'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Modal for Adding New Pricing Entry */}
        <Modal
          visible={showAddModal}
          animationType="slide"
          transparent={false}
          onRequestClose={() => {
            setShowAddModal(false);
            // Remove the temporary new entry if modal is closed without saving
            if (editingEntryIndex !== null && editingEntryIndex >= allPricingEntries.length) {
              setPricingEntriesState(prev => prev.slice(0, -1));
            }
            setEditingEntryIndex(null);
          }}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Heading level={3} style={styles.modalTitle}>
                Add New Pricing Entry
              </Heading>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => {
                  setShowAddModal(false);
                  // Remove the temporary new entry if modal is closed without saving
                  if (editingEntryIndex !== null && editingEntryIndex >= allPricingEntries.length) {
                    setPricingEntriesState(prev => prev.slice(0, -1));
                  }
                  setEditingEntryIndex(null);
                }}
                activeOpacity={0.8}
              >
                <Icon name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentContainer}>
              {editingEntryIndex !== null && pricingEntriesState[editingEntryIndex] && (
                renderEditablePricingEntry(
                  pricingEntriesState[editingEntryIndex],
                  editingEntryIndex,
                  null // No original pricing entry for new entries
                )
              )}
            </ScrollView>
            <View style={styles.modalFooter}>
              <View style={styles.modalFooterSingleRow}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelModalButton]}
                  onPress={() => {
                    setShowAddModal(false);
                    // Remove the temporary new entry if modal is closed without saving
                    if (editingEntryIndex !== null && editingEntryIndex >= allPricingEntries.length) {
                      setPricingEntriesState(prev => prev.slice(0, -1));
                    }
                    setEditingEntryIndex(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modalButtonText, styles.cancelModalButtonText]} numberOfLines={1}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalButton, 
                    styles.saveModalButton
                  ]}
                  onPress={async () => {
                    try {
                      // Save the new pricing entry
                      await handleSave(false);
                      // Close modal after successful save
                      setShowAddModal(false);
                      setEditingEntryIndex(null);
                    } catch (error) {
                      // Error is already handled in handleSave
                      // Modal stays open so user can fix and retry
                    }
                  }}
                  disabled={isSaving}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.modalButtonText, 
                    styles.saveModalButtonText
                  ]} numberOfLines={1}>
                    {isSaving ? 'Saving...' : 'Save New Pricing'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    console.log('🔘 CALCULATE BUTTON PRESSED IN UI (Edit Modal)');
                    console.log('Editing Entry Index:', editingEntryIndex);
                    console.log('Entry Exists:', pricingEntriesState[editingEntryIndex] ? 'YES' : 'NO');
                    if (editingEntryIndex !== null && pricingEntriesState[editingEntryIndex]) {
                      console.log('✅ Calling handleCalculateForEntry...');
                      await handleCalculateForEntry(editingEntryIndex);
                    } else {
                      console.log('❌ Cannot calculate - invalid entry index or entry does not exist');
                      Alert.alert('Error', 'Please select a valid pricing entry to calculate');
                    }
                  }}
                  disabled={isCalculating}
                  style={[styles.modalActionButton, styles.calculateBtn, isCalculating && styles.btnDisabled]}
                  activeOpacity={0.7}
                >
                  <Icon name="calculate" size={14} color={colors.textWhite} />
                  <Text style={styles.modalActionButtonText} numberOfLines={1}>
                    {isCalculating ? "Calculating..." : "Calculate"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    if (editingEntryIndex !== null && pricingEntriesState[editingEntryIndex]) {
                      await handleSyncClientPricingForEntry(editingEntryIndex);
                    }
                  }}
                  disabled={isSyncing}
                  style={[styles.modalActionButton, styles.syncBtn, isSyncing && styles.btnDisabled]}
                  activeOpacity={0.7}
                >
                  <Icon name="sync" size={14} color={colors.textWhite} />
                  <Text style={styles.modalActionButtonText} numberOfLines={1}>
                    {isSyncing ? 'Syncing...' : 'Sync'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Pricing Input Fields - REMOVED (only shown in modals now) */}
        {/* All form sections (Pricing Details, Stones, Action Buttons) removed from main screen */}
        {/* All editing happens in modals - use "Add Pricing" button or "Edit" button on existing entries */}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 10,
    paddingBottom: 20,
  },
  scrollContentTablet: {
    padding: 16,
    paddingBottom: 24,
    maxWidth: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerTitle: {
    color: colors.textPrimary,
  },
  downloadExcelButton: {
    backgroundColor: colors.info || '#2196F3',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  infoCard: {
    marginBottom: 10,
    padding: 10,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  infoText: {
    color: colors.textSecondary,
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    lineHeight: 16,
  },
  pricingCard: {
    marginBottom: 10,
    padding: 12,
    backgroundColor: colors.background,
    borderRadius: 8,
  },
  sectionTitle: {
    marginBottom: 10,
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: fonts.base,
  },
  pricingGrid: {
    gap: 6,
  },
  pricingGridTablet: {
    gap: 12,
    maxWidth: '100%',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  inputRowTablet: {
    gap: 12,
  },
  gridInput: {
    flex: 1,
    minWidth: '30%',
  },
  inputRowThree: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    flexWrap: 'nowrap',
  },
  inputRowThreeTablet: {
    gap: 12,
  },
  gridInputThird: {
    flexBasis: '32%',
    marginBottom: 4,
  },
  gridInputThirdTablet: {
    flexBasis: '32%',
    marginBottom: 8,
  },
  inputRowFour: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    flexWrap: 'nowrap',
  },
  gridInputQuarter: {
    flexBasis: '24%',
    marginBottom: 4,
  },
  compactInputField: {
    paddingVertical: 5,
    paddingHorizontal: 6,
    fontSize: 10,
    minHeight: 28,
  },
  undercutCard: {
    marginBottom: 16,
    padding: 20,
    backgroundColor: colors.background,
    borderRadius: 12,
  },
  undercutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  undercutLabel: {
    marginLeft: 12,
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  undercutInput: {
    marginTop: 8,
  },
  stonesCard: {
    marginBottom: 16,
    padding: 20,
    backgroundColor: colors.background,
    borderRadius: 12,
  },
  stonesHeader: {
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  stonesButtonsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  stoneFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 6,
  },
  stoneFilterLabel: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily: fonts.medium,
    fontSize: 10,
    marginBottom: 3,
  },
  stoneFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 5,
    minWidth: 120,
    backgroundColor: colors.backgroundSecondary,
  },
  stoneFilterButtonText: {
    flex: 1,
    marginRight: 4,
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  metalRateOverrideContainer: {
    marginBottom: 6,
  },
  metalRateOverrideInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 5,
    fontSize: 10,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    marginTop: 3,
  },
  stonesButton: {
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 1,
    maxWidth: 120,
  },
  stonesBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  stonesBtnText: {
    color: colors.textWhite,
    fontFamily: fonts.bold,
    fontSize: fonts.xs,
    letterSpacing: 0.1,
  },
  addButton: {
    backgroundColor: colors.primary,
  },
  downloadButton: {
    backgroundColor: colors.primary,
  },
  stonesTableContainer: {
    marginTop: 12,
  },
  stonesTableContainerTablet: {
    marginTop: 16,
    width: '100%',
  },
  tableScrollView: {
    maxHeight: 400,
  },
  tableScrollViewTablet: {
    maxHeight: 500,
    width: '100%',
  },
  tableScrollContentTablet: {
    width: '100%',
    flexGrow: 1,
  },
  tableWrapper: {
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    minWidth: SCREEN_WIDTH - 32,
  },
  tableWrapperTablet: {
    width: '100%',
    minWidth: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: colors.primary || '#2196F3',
    borderBottomWidth: 2,
    borderBottomColor: colors.primaryDark || '#1976D2',
  },
  tableHeaderTablet: {
    minHeight: 44,
  },
  tableHeaderCell: {
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tableHeaderCellTablet: {
    paddingVertical: 8,
    paddingHorizontal: 6,
    minHeight: 44,
  },
  tableHeaderText: {
    color: colors.textWhite,
    fontFamily: fonts.bold,
    fontSize: 9,
    textAlign: 'center',
  },
  tableHeaderTextTablet: {
    fontSize: 11,
  },
  tableScrollContainer: {
    // Removed - using flex layout instead
  },
  tableBody: {
    backgroundColor: colors.background,
  },
  noFilteredDataRow: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noFilteredDataText: {
    color: colors.textSecondary,
    fontFamily: fonts.medium,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 28,
  },
  tableRowTablet: {
    minHeight: 40,
  },
  tableRowEven: {
    backgroundColor: colors.backgroundSecondary,
  },
  tableCell: {
    paddingVertical: 2,
    paddingHorizontal: 2,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 28,
  },
  tableCellTablet: {
    paddingVertical: 6,
    paddingHorizontal: 6,
    minHeight: 40,
  },
  tableCellText: {
    fontSize: 10,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 12,
    flexShrink: 1,
    flexWrap: 'nowrap',
  },
  tableCellTextTablet: {
    fontSize: 12,
    lineHeight: 16,
  },
  tableInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 2,
    paddingHorizontal: 2,
    paddingVertical: 2,
    fontSize: 9,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    backgroundColor: colors.backgroundSecondary,
    textAlign: 'center',
    minWidth: 40,
    width: '100%',
  },
  tableInputTablet: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 11,
    minWidth: 50,
  },
  tableCellNumber: {
    width: 25,
    minWidth: 25,
  },
  tableCellType: {
    width: 80,
    minWidth: 80,
  },
  tableCellSmall: {
    width: 50,
    minWidth: 50,
  },
  tableCellMedium: {
    width: 65,
    minWidth: 65,
  },
  tableCellAction: {
    width: 40,
    minWidth: 40,
    borderRightWidth: 0,
  },
  // Flex-based column widths for responsive table
  tableCellFlexNumber: {
    flex: 0.4,
    maxWidth: 30,
  },
  tableCellFlexNumberTablet: {
    flex: 0.6,
    maxWidth: 60,
  },
  tableCellFlexType: {
    flex: 1.2,
    maxWidth: 90,
  },
  tableCellFlexTypeTablet: {
    flex: 2,
    maxWidth: 180,
  },
  tableCellFlexSmall: {
    flex: 0.8,
    maxWidth: 55,
  },
  tableCellFlexSmallTablet: {
    flex: 1.2,
    maxWidth: 120,
  },
  tableCellFlexWeight: {
    flex: 1,
    maxWidth: 65,
  },
  tableCellFlexWeightTablet: {
    flex: 1.5,
    maxWidth: 140,
  },
  tableCellFlexMedium: {
    flex: 1,
    maxWidth: 70,
  },
  tableCellFlexMediumTablet: {
    flex: 1.8,
    maxWidth: 160,
  },
  tableCellFlexAction: {
    flex: 0.5,
    maxWidth: 40,
    borderRightWidth: 0,
  },
  tableCellFlexActionTablet: {
    flex: 0.8,
    maxWidth: 80,
  },
  // Wider columns for view mode
  tableCellFlexCt: {
    flex: 1.2,
    maxWidth: 70,
  },
  tableCellFlexCtTablet: {
    flex: 1.5,
    maxWidth: 140,
  },
  tableCellFlexPrice: {
    flex: 1.2,
    maxWidth: 75,
  },
  tableCellFlexPriceTablet: {
    flex: 1.5,
    maxWidth: 150,
  },
  tableCellCompact: {
    minHeight: 20,
    paddingVertical: 1,
  },
  // Compact styles for view mode table
  tableRowView: {
    minHeight: 22,
  },
  tableCellView: {
    minHeight: 22,
    paddingVertical: 1,
    paddingHorizontal: 1,
  },
  tableDeleteButton: {
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    backgroundColor: colors.backgroundSecondary,
    minWidth: 100,
    width: '100%',
  },
  dropdownButtonText: {
    fontSize: fonts.xs,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'left',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownModal: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 8,
    minWidth: 200,
    maxWidth: '80%',
    maxHeight: '70%',
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  dropdownScrollView: {
    maxHeight: 400,
  },
  dropdownOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownOptionText: {
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  deleteStoneButton: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  emptyStonesContainer: {
    padding: 40,
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  emptyStonesText: {
    color: colors.textSecondary,
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStonesSubtext: {
    color: colors.textLight,
    fontSize: fonts.sm,
    fontFamily: fonts.regular,
    textAlign: 'center',
  },
  messageCard: {
    marginBottom: 10,
    padding: 10,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageLabel: {
    marginBottom: 6,
    fontSize: fonts.xs,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  messageInputWrapper: {
    marginTop: 4,
  },
  messageInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: fonts.xs,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  messageDisplayBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.background,
    minHeight: 60,
    marginTop: 8,
  },
  messageDisplayText: {
    fontSize: fonts.base,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  actionButtonsCard: {
    marginTop: 6,
    padding: 10,
    backgroundColor: colors.background,
    borderRadius: 8,
  },
  actionButtons: {
    gap: 8,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnHalf: {
    flex: 1,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnText: {
    color: colors.textWhite,
    fontFamily: fonts.bold,
    fontSize: fonts.xs,
    letterSpacing: 0.1,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    width: '100%',
  },
  cancelBtn: {
    backgroundColor: colors.textSecondary,
    width: '100%',
  },
  calculateBtn: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  syncBtn: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  btnDisabled: {
    opacity: 0.5,
    shadowOpacity: 0.1,
    elevation: 1,
  },
  filterCard: {
    marginBottom: 20,
    padding: 16,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  allPricingEntriesContainer: {
    marginBottom: 12,
  },
  allPricingEntriesTitle: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: fonts.base,
    marginBottom: 10,
  },
  pricingButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  addPricingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: colors.primary,
    gap: 6,
    minHeight: 36,
    flex: 1,
    minWidth: 120,
  },
  copyPricingButton: {
    backgroundColor: colors.accent || '#D4AF37',
  },
  addPricingButtonText: {
    color: colors.textWhite,
    fontFamily: fonts.bold,
    fontSize: fonts.xs,
  },
  noPricingText: {
    textAlign: 'center',
    color: colors.textSecondary,
    padding: 20,
    fontFamily: fonts.medium,
  },
  pricingEntryCard: {
    marginBottom: 10,
    padding: 12,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pricingEntryCardTablet: {
    padding: 16,
    marginHorizontal: 0,
  },
  pricingEntryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  pricingEntryTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: fonts.base,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.primary + '20',
    gap: 4,
  },
  editButtonText: {
    color: colors.primary,
    fontFamily: fonts.medium,
    fontSize: fonts.xs,
  },
  pricingEntryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pricingEntryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 5,
    gap: 4,
    flex: 1,
    minWidth: '30%',
  },
  pricingEntryActionButtonText: {
    color: colors.textWhite,
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    paddingTop: 50,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: fonts.sm,
  },
  closeButton: {
    padding: 6,
  },
  modalContent: {
    flex: 1,
  },
  modalContentContainer: {
    padding: 10,
  },
  modalFooter: {
    padding: 8,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  modalFooterTopRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  modalFooterActionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  modalFooterSingleRow: {
    flexDirection: 'row',
    gap: 4,
    flexWrap: 'wrap',
  },
  modalButton: {
    flex: 1,
    minWidth: '22%',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.textPrimary,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    minHeight: 30,
  },
  cancelModalButton: {
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  saveModalButton: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  modalButtonText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 0,
  },
  cancelModalButtonText: {
    color: colors.textPrimary,
  },
  saveModalButtonText: {
    color: colors.textWhite,
  },
  disabledButtonText: {
    opacity: 0.5,
  },
  modalActionButton: {
    flex: 1,
    minWidth: '22%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 5,
    gap: 2,
    shadowColor: colors.textPrimary,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    minHeight: 30,
  },
  modalActionButtonText: {
    color: colors.textWhite,
    fontFamily: fonts.semibold || fonts.bold,
    fontSize: 10,
    letterSpacing: 0,
    flexShrink: 1,
  },
  pricingEntryInfo: {
    marginBottom: 8,
    padding: 6,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 4,
  },
  pricingEntryInfoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  pricingEntryInfoText: {
    color: colors.textSecondary,
    fontSize: fonts.xs,
    fontFamily: fonts.medium,
  },
  pricingEntryLabel: {
    marginBottom: 2,
    color: colors.textSecondary,
    fontSize: 10,
    fontFamily: fonts.medium,
  },
  pricingEntryValue: {
    color: colors.textPrimary,
    fontSize: fonts.xs,
    fontFamily: fonts.bold,
  },
  pricingEntryStonesContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pricingEntryStonesContainerTablet: {
    marginTop: 12,
    paddingTop: 12,
    width: '100%',
  },
  pricingEntryStonesTitle: {
    marginBottom: 8,
    color: colors.textPrimary,
    fontFamily: fonts.bold,
    fontSize: fonts.xs,
  },
});

export default PricingScreen;



