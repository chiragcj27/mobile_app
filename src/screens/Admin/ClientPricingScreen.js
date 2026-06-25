import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  FlatList,
} from 'react-native';
import { Input } from '../../components/common';
import BrandedAlert from '../../components/common/BrandedAlert';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useGetClientByIdQuery, useUpdateClientPricingMutation, useGetStoneTypesQuery } from '../../store/api';
import DiamondRow from './components/DiamondRow';
import DiamondEditModal from './components/DiamondEditModal';
import useDeviceLayout from '../../hooks/useDeviceLayout';
import { DUTY_FIELDS } from '../../utils/pricingDuties';

// DocumentPicker is optional
let DocumentPicker;
try {
  DocumentPicker = require('react-native-document-picker').default;
} catch (e) {
  DocumentPicker = null;
}

const ClientPricingScreen = ({ route, navigation }) => {
  const { clientId, clientName } = route.params || {};
  const [loss, setLoss] = useState('0');
  const [labour, setLabour] = useState('0');
  const [extraCharges, setExtraCharges] = useState('0');
  const [naturalDuties, setNaturalDuties] = useState('0');
  const [labDuties, setLabDuties] = useState('0');
  const [goldDuties, setGoldDuties] = useState('0');
  const [silverAndLabsDuties, setSilverAndLabsDuties] = useState('0');
  const [lossAndLabourDuties, setLossAndLabourDuties] = useState('0');
  const [undercutPrice, setUndercutPrice] = useState('0');
  const [applicableStoneTypes, setApplicableStoneTypes] = useState([]);
  const [pricingMessageFormat, setPricingMessageFormat] = useState('');
  const [diamonds, setDiamonds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const fileLibsRef = useRef({ RNFS: null, XLSX: null });
  const diamondIdRef = useRef(0);
  const [expandedType, setExpandedType] = useState(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedDiamondIndex, setSelectedDiamondIndex] = useState(null);
  const [selectedDiamondData, setSelectedDiamondData] = useState({});
  const { isTablet } = useDeviceLayout();
  const [alertConfig, setAlertConfig] = useState({ visible: false, title: '', message: '', type: 'info', buttons: [] });
  const showAlert = (title, message, type = 'info', buttons = []) =>
    setAlertConfig({ visible: true, title, message, type, buttons });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));

  // Fetch client data - refetch when screen comes into focus to get latest pricing
  const { data: clientData, isLoading: isLoadingClient, refetch } = useGetClientByIdQuery(clientId, {
    skip: !clientId,
    refetchOnFocus: true, // Refetch when screen comes into focus to get latest pricing updates
    refetchOnMountOrArgChange: true, // Refetch when clientId changes
  });

  const [updateClientPricing, { isLoading: isUpdating }] = useUpdateClientPricingMutation();
  const { data: stoneTypesData = [] } = useGetStoneTypesQuery();

  const ensureFileLibraries = useCallback(async () => {
    try {
      if (!fileLibsRef.current.RNFS) {
        const rnfsModule = await import('react-native-fs');
        fileLibsRef.current.RNFS = rnfsModule.default || rnfsModule;
      }
      if (!fileLibsRef.current.XLSX) {
        const xlsxModule = await import('xlsx');
        fileLibsRef.current.XLSX = xlsxModule.default || xlsxModule;
      }
      return fileLibsRef.current;
    } catch (error) {
      console.error('Failed to load file helpers:', error);
      throw new Error('Unable to load file helpers. Please try again.');
    }
  }, []);

  const createDiamondEntry = useCallback((diamond = {}, index = 0) => {
    const fallbackId = `diamond-${Date.now()}-${diamondIdRef.current++}-${index}`;
    return {
      localId: diamond.localId || diamond._id || diamond.id || fallbackId,
      Type: diamond.Type || diamond.type || '',
      Shape: diamond.Shape || diamond.shape || '',
      Carat: typeof diamond.Carat === 'number' ? diamond.Carat : parseFloat(diamond.Carat) || 0,
      MmSize: typeof diamond.MmSize === 'number' ? diamond.MmSize : parseFloat(diamond.MmSize) || 0,
      SieveSize: diamond.SieveSize || diamond.sieveSize || '',
      Price: typeof diamond.Price === 'number' ? diamond.Price : parseFloat(diamond.Price) || 0,
    };
  }, []);

  useEffect(() => {

    if (clientData) {
      console.log('Fetched client data:', clientData);
      const pricing = clientData.Pricing || clientData.pricing || {};
      setLoss(pricing.Loss?.toString() || pricing.loss?.toString() || '0');
      setLabour(pricing.Labour?.toString() || pricing.labour?.toString() || '0');
      setExtraCharges(pricing.ExtraCharges?.toString() || pricing.extraCharges?.toString() || '0');
      setNaturalDuties(pricing.NaturalDuties?.toString() ?? pricing.naturalDuties?.toString() ?? '0');
      setLabDuties(pricing.LabDuties?.toString() ?? pricing.labDuties?.toString() ?? '0');
      setGoldDuties(pricing.GoldDuties?.toString() ?? pricing.goldDuties?.toString() ?? '0');
      setSilverAndLabsDuties(pricing.SilverAndLabsDuties?.toString() ?? pricing.silverAndLabsDuties?.toString() ?? '0');
      setLossAndLabourDuties(pricing.LossAndLabourDuties?.toString() ?? pricing.lossAndLabourDuties?.toString() ?? '0');
      setUndercutPrice(pricing.UndercutPrice?.toString() ?? pricing.undercutPrice?.toString() ?? '0');
      setPricingMessageFormat(
        clientData.PricingMessageFormat ||
        clientData.pricingMessageFormat ||
        pricing.PricingMessageFormat ||
        pricing.pricingMessageFormat ||
        ''
      );

      const diamondsData = pricing.Diamonds || pricing.diamonds || [];
      setDiamonds(
        diamondsData.length > 0
          ? diamondsData.map((diamond, index) => createDiamondEntry(diamond, index))
          : []
      );

      setApplicableStoneTypes(clientData.ApplicableStoneTypes || []);
    }
  }, [clientData, createDiamondEntry]);

  // Memoize grouped diamonds with deep comparison
  const groupedDiamonds = useMemo(() => {
    const groups = new Map();
    diamonds.forEach((diamond, index) => {
      const type = diamond.Type || 'Other';
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type).push({ diamond, index });
    });
    return Array.from(groups.entries());
  }, [diamonds]);

  const initialExpandedSet = useRef(false);

  useEffect(() => {
    if (!initialExpandedSet.current && groupedDiamonds.length > 0) {
      setExpandedType(groupedDiamonds[0][0]);
      initialExpandedSet.current = true;
    }
  }, [groupedDiamonds]);

  const toggleType = useCallback((type) => {
    setExpandedType(prev => (prev === type ? null : type));
  }, []);

  const handleAddDiamond = useCallback(() => {
    setDiamonds(prevDiamonds => [
      ...prevDiamonds,
      createDiamondEntry({}, prevDiamonds.length),
    ]);
  }, [createDiamondEntry]);

  const handleDeleteDiamond = useCallback((index) => {
    showAlert(
      'Delete Diamond',
      'Are you sure you want to delete this diamond entry?',
      'info',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setDiamonds(prevDiamonds => prevDiamonds.filter((_, i) => i !== index));
            if (selectedDiamondIndex === index) {
              setEditModalVisible(false);
              setSelectedDiamondIndex(null);
            }
          },
        },
      ]
    );
  }, [selectedDiamondIndex]);

  const openEditModal = useCallback((index, diamond) => {
    setSelectedDiamondIndex(index);
    setSelectedDiamondData({
      Type: diamond.Type || '',
      Shape: diamond.Shape || '',
      Carat: diamond.Carat?.toString() || '',
      MmSize: diamond.MmSize?.toString() || '',
      SieveSize: diamond.SieveSize || '',
      Price: diamond.Price?.toString() || '',
    });
    setEditModalVisible(true);
  }, []);

  const closeEditModal = useCallback(() => {
    setEditModalVisible(false);
    setSelectedDiamondIndex(null);
    setSelectedDiamondData({});
  }, []);

  const handleDiamondSave = useCallback((updatedDiamond) => {
    setDiamonds(prevDiamonds =>
      prevDiamonds.map((diamond, i) => {
        if (i !== selectedDiamondIndex) return diamond;
        return {
          ...diamond,
          Type: updatedDiamond.Type || '',
          Shape: updatedDiamond.Shape || '',
          Carat: updatedDiamond.Carat || 0,
          MmSize: updatedDiamond.MmSize || 0,
          SieveSize: updatedDiamond.SieveSize || '',
          Price: updatedDiamond.Price || 0,
        };
      })
    );
    closeEditModal();
  }, [closeEditModal, selectedDiamondIndex]);

  const diamondKeyExtractor = useCallback((item) => {
    const diamond = item.diamond;
    return diamond.localId || diamond._id || diamond.id || `diamond-${item.index}`;
  }, []);

  // Memoize the render function
  const renderDiamondRow = useCallback(({ item }) => (
    <DiamondRow
      diamond={item.diamond}
      index={item.index}
      onPress={openEditModal}
      onDelete={handleDeleteDiamond}
    />
  ), [handleDeleteDiamond, openEditModal]);

  const handleDownloadExcelFormat = async () => {
    try {
      setIsDownloadingExcel(true);
      const { RNFS, XLSX } = await ensureFileLibraries();

      const excelData = [
        ['Type', 'Shape', 'Carat', 'Mm Size', 'Sieve Size', 'Price'],
      ];
      excelData.push(['LabGrown', 'RD', 0.5, 5.0, '0000-000', 100]);

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(excelData);
      ws['!cols'] = [
        { wch: 15 }, { wch: 10 }, { wch: 12 },
        { wch: 12 }, { wch: 15 }, { wch: 12 }
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Diamonds');

      const excelBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const clientNameForFile = (clientData?.Name || clientData?.name || clientName || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
      const excelFilename = `Diamond_Format_${clientNameForFile}.xlsx`;
      const downloadPath = `${RNFS.DownloadDirectoryPath}/${excelFilename}`;

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

      await RNFS.writeFile(downloadPath, base64, 'base64');

      showAlert(
        'Success',
        `Excel format downloaded successfully!\n\nSaved to: Downloads/${excelFilename}`,
        'success',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error downloading Excel format:', error);
      showAlert('Error', `Failed to download Excel format: ${error.message}`, 'error');
    } finally {
      setIsDownloadingExcel(false);
    }
  };

  const requestStoragePermission = async () => {
    if (Platform.OS !== 'android') return true;
    try {
      const androidVersion = Platform.Version;
      if (androidVersion >= 33) return true;
      const checkResult = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
      );
      if (checkResult) return true;
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        {
          title: 'Storage Permission',
          message: 'App needs access to storage to import Excel files',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn('Permission request error:', err);
      return true;
    }
  };

  const handleImportDiamondsFromExcel = async () => {
    if (!DocumentPicker) {
      showAlert(
        'Feature Not Available',
        'Document picker is not installed. Please install react-native-document-picker to use this feature.',
        'info',
        [{ text: 'OK' }]
      );
      return;
    }

    const hasPermission = await requestStoragePermission();
    if (!hasPermission && Platform.OS === 'android' && Platform.Version < 33) {
      showAlert('Permission Denied', 'Storage permission is required to import Excel files.', 'warning');
      return;
    }

    try {
      setIsImportingExcel(true);
      const { RNFS, XLSX } = await ensureFileLibraries();

      const result = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.xls, DocumentPicker.types.xlsx, DocumentPicker.types.csv],
        copyTo: 'cachesDirectory',
      });

      if (result) {
        const fileUri = result.copyUri || result.uri;
        if (!fileUri) {
          showAlert('Error', 'Could not access the selected file', 'error');
          return;
        }

        const fileContent = await RNFS.readFile(fileUri, 'base64');
        const workbook = XLSX.read(fileContent, { type: 'base64' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (jsonData.length < 2) {
          showAlert('Error', 'Excel file must have at least a header row and one data row', 'error');
          return;
        }

        const importedDiamonds = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (row && row.length > 0) {
            importedDiamonds.push(
              createDiamondEntry({
                Type: row[0]?.toString() || '',
                Shape: row[1]?.toString() || '',
                Carat: parseFloat(row[2]) || 0,
                MmSize: parseFloat(row[3]) || 0,
                SieveSize: row[4]?.toString() || '',
                Price: parseFloat(row[5]) || 0,
              }, importedDiamonds.length)
            );
          }
        }

        if (importedDiamonds.length === 0) {
          showAlert('Error', 'No valid diamond data found in Excel file', 'error');
          return;
        }

        setDiamonds(importedDiamonds);

        showAlert(
          'Success',
          `Imported ${importedDiamonds.length} diamond(s) from Excel.\n\nPlease click on Save after importing.`,
          'success',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      if (DocumentPicker && DocumentPicker.isCancel && DocumentPicker.isCancel(error)) {
        return;
      }
      console.error('Error importing Excel:', error);
      showAlert('Error', `Failed to import Excel file: ${error.message}`, 'error');
    } finally {
      setIsImportingExcel(false);
    }
  };

  const handleSave = async () => {
    if (!clientId) {
      showAlert('Error', 'Client ID is missing', 'error');
      return;
    }

    try {
      setLoading(true);

      const pricingData = {
        Name: clientData?.Name || clientData?.name || clientName || '',
        ApplicableStoneTypes: applicableStoneTypes,
        PricingMessageFormat: pricingMessageFormat || '',
        Pricing: {
          Loss: parseFloat(loss) || 0,
          Labour: parseFloat(labour) || 0,
          ExtraCharges: parseFloat(extraCharges) || 0,
          NaturalDuties: parseFloat(naturalDuties) || 0,
          LabDuties: parseFloat(labDuties) || 0,
          GoldDuties: parseFloat(goldDuties) || 0,
          SilverAndLabsDuties: parseFloat(silverAndLabsDuties) || 0,
          LossAndLabourDuties: parseFloat(lossAndLabourDuties) || 0,
          UndercutPrice: parseFloat(undercutPrice) || 0,
          PricingMessageFormat: pricingMessageFormat || '',
          Diamonds: diamonds.map(d => ({
            Type: d.Type || '',
            Shape: d.Shape || '',
            Carat: d.Carat || 0,
            MmSize: d.MmSize || 0,
            SieveSize: d.SieveSize || '',
            Price: d.Price || 0,
          })),
        },
      };

      await updateClientPricing({
        clientId,
        ...pricingData,
      }).unwrap();

      showAlert('Success', 'Client pricing updated successfully', 'success', [
        {
          text: 'OK',
          onPress: () => {
            refetch();
          },
        },
      ]);
    } catch (error) {
      console.error('Error updating client pricing:', error);
      showAlert(
        'Error',
        error?.data?.message || error?.data?.error || 'Failed to update client pricing',
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  // Render header component
  const ListHeaderComponent = useMemo(() => (
    <View>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          Pricing for {clientData?.Name || clientData?.name || clientName || 'Client'}
        </Text>
      </View>

      <View style={styles.form}>
        <View style={styles.pricingFields}>
          <View style={styles.fieldsGrid}>
            <View style={[styles.fieldContainer, isTablet && styles.fieldContainerTablet]}>
              <Text style={styles.label}>Loss*</Text>
              <Input value={loss} onChangeText={setLoss} keyboardType="numeric" placeholder="0" />
            </View>
            <View style={[styles.fieldContainer, isTablet && styles.fieldContainerTablet]}>
              <Text style={styles.label}>Labour*</Text>
              <Input value={labour} onChangeText={setLabour} keyboardType="numeric" placeholder="0" />
            </View>
            <View style={[styles.fieldContainer, isTablet && styles.fieldContainerTablet]}>
              <Text style={styles.label}>Extra Charges*</Text>
              <Input value={extraCharges} onChangeText={setExtraCharges} keyboardType="numeric" placeholder="0" />
            </View>
            <View style={[styles.fieldContainer, isTablet && styles.fieldContainerTablet]}>
              <Text style={styles.label}>Undercut Price</Text>
              <Input value={undercutPrice} onChangeText={setUndercutPrice} keyboardType="numeric" placeholder="0" />
            </View>
            <View style={[styles.fieldContainer, isTablet && styles.fieldContainerTablet]}>
              <Text style={styles.label}>{DUTY_FIELDS[0].label}</Text>
              <Input value={naturalDuties} onChangeText={setNaturalDuties} keyboardType="numeric" placeholder="0" />
            </View>
            <View style={[styles.fieldContainer, isTablet && styles.fieldContainerTablet]}>
              <Text style={styles.label}>{DUTY_FIELDS[1].label}</Text>
              <Input value={labDuties} onChangeText={setLabDuties} keyboardType="numeric" placeholder="0" />
            </View>
            <View style={[styles.fieldContainer, isTablet && styles.fieldContainerTablet]}>
              <Text style={styles.label}>{DUTY_FIELDS[2].label}</Text>
              <Input value={goldDuties} onChangeText={setGoldDuties} keyboardType="numeric" placeholder="0" />
            </View>
            <View style={[styles.fieldContainer, isTablet && styles.fieldContainerTablet]}>
              <Text style={styles.label}>{DUTY_FIELDS[3].label}</Text>
              <Input value={silverAndLabsDuties} onChangeText={setSilverAndLabsDuties} keyboardType="numeric" placeholder="0" />
            </View>
            <View style={[styles.fieldContainer, isTablet && styles.fieldContainerTablet]}>
              <Text style={styles.label}>{DUTY_FIELDS[4].label}</Text>
              <Input value={lossAndLabourDuties} onChangeText={setLossAndLabourDuties} keyboardType="numeric" placeholder="0" />
            </View>
          </View>
        </View>

        <View style={styles.applicableStonesSection}>
          <Text style={styles.label}>Applicable Stone Types</Text>
          <View style={styles.chipRow}>
            {stoneTypesData.map(st => {
              const active = applicableStoneTypes.includes(st.value);
              return (
                <TouchableOpacity
                  key={st.value}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => {
                    setApplicableStoneTypes(prev =>
                      active
                        ? prev.filter(v => v !== st.value)
                        : [...prev, st.value]
                    );
                  }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {st.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.messageFormatContainer}>
          <Text style={styles.label}>Pricing Message Format</Text>
          <Input
            value={pricingMessageFormat}
            onChangeText={setPricingMessageFormat}
            placeholder="Enter pricing message format"
            multiline
            numberOfLines={3}
            style={styles.messageFormatInput}
          />
        </View>

        <View style={styles.excelButtonsContainer}>
          <TouchableOpacity
            style={[styles.excelButton, styles.downloadButton]}
            onPress={handleDownloadExcelFormat}
            disabled={isDownloadingExcel}
          >
            {isDownloadingExcel ? (
              <ActivityIndicator size="small" color={colors.textWhite} />
            ) : (
              <Icon name="download" size={18} color={colors.textWhite} />
            )}
            <Text style={styles.excelButtonText}>
              {isDownloadingExcel ? 'Downloading...' : 'Download Excel Format'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.excelButton, styles.importButton]}
            onPress={handleImportDiamondsFromExcel}
            disabled={isImportingExcel}
          >
            {isImportingExcel ? (
              <ActivityIndicator size="small" color={colors.textWhite} />
            ) : (
              <Icon name="upload" size={18} color={colors.textWhite} />
            )}
            <Text style={styles.excelButtonText}>
              {isImportingExcel ? 'Importing...' : 'Import Diamonds from Excel'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.importMessage}>
          <Text style={styles.importMessageText}>
            Please Click on Save after importing to persist the changes.
          </Text>
        </View>

        <View style={styles.diamondSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Diamond Data</Text>
            <TouchableOpacity style={styles.addButton} onPress={handleAddDiamond}>
              <Icon name="add" size={20} color={colors.textWhite} />
              <Text style={styles.addButtonText}>Add Diamond</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  ), [clientData, clientName, loss, labour, extraCharges, naturalDuties, labDuties, goldDuties, silverAndLabsDuties, lossAndLabourDuties, undercutPrice, pricingMessageFormat, applicableStoneTypes, stoneTypesData, isDownloadingExcel, isImportingExcel, handleAddDiamond, isTablet]);

  // Render type sections
  const renderTypeSection = useCallback(({ item: [type, rows] }) => {
    const isExpanded = expandedType === type;
    return (
      <View style={styles.typeSection}>
        <TouchableOpacity
          style={styles.typeHeader}
          onPress={() => toggleType(type)}
          activeOpacity={0.85}
        >
          <View>
            <Text style={styles.typeTitle}>{type}</Text>
            <Text style={styles.typeSubtitle}>{rows.length} entries</Text>
          </View>
          <Icon
            name={isExpanded ? 'expand-less' : 'expand-more'}
            size={24}
            color={colors.textPrimary}
          />
        </TouchableOpacity>
        {isExpanded && (
          <View style={styles.typeContent}>
            {isTablet && (
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderText, { width: '15%' }]}>Shape</Text>
                <Text style={[styles.tableHeaderText, { width: '15%', textAlign: 'right' }]}>Mm Size</Text>
                <Text style={[styles.tableHeaderText, { width: '20%', textAlign: 'right' }]}>Sieve</Text>
                <Text style={[styles.tableHeaderText, { width: '15%', textAlign: 'right' }]}>Carat</Text>
                <Text style={[styles.tableHeaderText, { width: '15%', textAlign: 'right' }]}>Price</Text>
                <Text style={[styles.tableHeaderText, { width: '20%', textAlign: 'center' }]}>Actions</Text>
              </View>
            )}
            <FlatList
              data={rows}
              keyExtractor={diamondKeyExtractor}
              renderItem={renderDiamondRow}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              removeClippedSubviews={true}
              scrollEnabled={false}
            />
          </View>
        )}
      </View>
    );
  }, [expandedType, toggleType, diamondKeyExtractor, renderDiamondRow]);

  // Render footer with save button
  const ListFooterComponent = useMemo(() => (
    <View style={styles.form}>
      {groupedDiamonds.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>No diamonds added yet</Text>
          <Text style={styles.emptyStateSubtext}>Click "Add Diamond" to add diamond entries</Text>
        </View>
      )}
      <TouchableOpacity
        style={[styles.saveButton, (loading || isUpdating) && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={loading || isUpdating}
      >
        {loading || isUpdating ? (
          <ActivityIndicator size="small" color={colors.textWhite} />
        ) : (
          <>
            <Icon name="save" size={20} color={colors.textWhite} />
            <Text style={styles.saveButtonText}>Save</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  ), [groupedDiamonds, loading, isUpdating, handleSave]);

  if (isLoadingClient) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading client pricing...</Text>
      </View>
    );
  }

  return (
    <>
      <FlatList
        style={styles.container}
        data={groupedDiamonds}
        keyExtractor={([type]) => type}
        renderItem={renderTypeSection}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={5}
        removeClippedSubviews={true}
        extraData={expandedType}
      />
      <DiamondEditModal
        visible={editModalVisible}
        diamond={selectedDiamondData}
        onClose={closeEditModal}
        onSave={handleDiamondSave}
      />
      <BrandedAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        buttons={alertConfig.buttons}
        onClose={hideAlert}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 12,
    fontSize: fonts.base,
    color: colors.textSecondary,
  },
  header: {
    padding: 20,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  form: {
    padding: 20,
  },
  pricingFields: {
    marginBottom: 24,
  },
  fieldsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6, // Negative margin to offset padding
  },
  fieldContainer: {
    width: '50%', // Default to 2 columns on mobile
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  fieldContainerTablet: {
    width: '25%', // 4 columns on tablet
  },
  label: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  diamondSection: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  addButtonText: {
    color: colors.textWhite,
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
  },
  typeSection: {
    marginBottom: 16,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: colors.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableHeaderText: {
    fontSize: fonts.xs,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
  },
  typeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.white,
  },
  typeTitle: {
    fontSize: fonts.base,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  typeSubtitle: {
    fontSize: fonts.sm,
    color: colors.textSecondary,
  },
  typeContent: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  emptyStateText: {
    fontSize: fonts.base,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: fonts.sm,
    color: colors.textSecondary,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    marginTop: 24,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: colors.textWhite,
    fontSize: fonts.base,
    fontFamily: fonts.bold,
  },
  excelButtonsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  excelButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  downloadButton: {
    backgroundColor: colors.primary,
  },
  importButton: {
    backgroundColor: colors.secondary || '#4CAF50',
  },
  excelButtonText: {
    color: colors.textWhite,
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
  },
  importMessage: {
    backgroundColor: colors.background,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  importMessageText: {
    fontSize: fonts.sm,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  applicableStonesSection: {
    marginBottom: 24,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: fonts.sm,
    fontFamily: fonts.medium,
    color: colors.textPrimary,
  },
  chipTextActive: {
    color: colors.textWhite,
  },
  messageFormatContainer: {
    marginBottom: 24,
  },
  messageFormatInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});

export default ClientPricingScreen;