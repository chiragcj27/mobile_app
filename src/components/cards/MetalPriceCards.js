import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import {
  useGetMetalPricesQuery,
  useUpdateMetalPriceMutation,
} from '../../store/api';
import Icon from '../common/Icon';
import BrandedAlert from '../common/BrandedAlert';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { formatDate } from '../../utils/helpers';
import { API_BASE_URL } from '../../config/apiConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';

const METALS = [
  { key: 'gold', label: 'Au', name: 'Gold', badgeBg: '#E6C97A' },
  { key: 'silver', label: 'Ag', name: 'Silver', badgeBg: '#E2E2E2' },
  { key: 'platinum', label: 'Pt', name: 'Platinum', badgeBg: '#D4D4D4' },
];

const MetalPriceCards = () => {
  const { data, isLoading, refetch } = useGetMetalPricesQuery(false);
  const [updateMetalPrice] = useUpdateMetalPriceMutation();

  const metalPrices = useMemo(() => data?.prices || {}, [data]);

  const [editingKey, setEditingKey] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [trends, setTrends] = useState({});
  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: '',
    message: '',
    type: 'info',
  });
  const baselineRef = useRef({});

  useEffect(() => {
    METALS.forEach(({ key }) => {
      const price = metalPrices[key]?.price;
      if (price === undefined || price === null) return;

      if (baselineRef.current[key] === undefined || baselineRef.current[key] === null) {
        baselineRef.current[key] = price;
        setTrends(prev => ({ ...prev, [key]: 'trending-up' }));
        return;
      }

      const base = baselineRef.current[key];
      const next = price > base ? 'trending-up' : price < base ? 'trending-down' : 'trending-up';
      baselineRef.current[key] = price;
      setTrends(prev => ({ ...prev, [key]: next }));
    });
  }, [metalPrices]);

  const showAlert = (title, message, type) =>
    setAlertConfig({ visible: true, title, message, type });
  const hideAlert = () => setAlertConfig(prev => ({ ...prev, visible: false }));

  const startEditing = (key, price) => {
    setEditingKey(key);
    setEditingValue(price !== undefined && price !== null ? price.toString() : '');
  };

  const getLatestEntryDate = async (metal) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return null;
      const response = await fetch(`${API_BASE_URL}/api/metal-prices`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) return null;
      const fullData = await response.json();
      const metalArray = fullData[metal];
      if (Array.isArray(metalArray) && metalArray.length > 0) {
        const sortedByDate = [...metalArray].sort((a, b) => {
          const dateA = new Date(a.date || a.Date || 0);
          const dateB = new Date(b.date || b.Date || 0);
          return dateB - dateA;
        });
        return sortedByDate[0].date || sortedByDate[0].Date || null;
      }
      return null;
    } catch (error) {
      return null;
    }
  };

  const handleBlur = async ({ key, name }) => {
    const price = parseFloat(editingValue);
    setEditingKey(null);

    if (isNaN(price)) {
      showAlert('Invalid Price', 'Please enter a valid number.', 'error');
      return;
    }

    const current = metalPrices[key];
    if (current && current.price === price) return;

    const latestDate = await getLatestEntryDate(key);
    const date = latestDate || current?.lastUpdated || new Date().toISOString();

    try {
      await updateMetalPrice({ metal: key, date, price }).unwrap();
      setEditingValue('');
      refetch();
      showAlert('Price Updated', `${name} price saved successfully.`, 'success');
    } catch (error) {
      if (__DEV__) {
        console.error(`❌ ${name} price update failed:`, error?.message || error);
      }
      showAlert('Save Failed', `Could not update ${name} price.`, 'error');
    }
  };

  if (isLoading) {
    return (
      <View style={styles.section}>
        <Text style={styles.title}>Live Metal Prices</Text>
        <Text style={styles.subtitle}>Tap to update today's rates</Text>
        <View style={styles.row}>
          {[0, 1, 2].map(i => (
            <View key={i} style={styles.card}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <>
      <View style={styles.section}>
        <Text style={styles.title}>Live Metal Prices</Text>
        <Text style={styles.subtitle}>Tap to update today's rates</Text>

        <View style={styles.row}>
          {METALS.map(({ key, label, name, badgeBg }) => {
            const price = metalPrices[key]?.price;
            const lastUpdated = metalPrices[key]?.lastUpdated;
            const isEditing = editingKey === key;
            const trend = trends[key] || 'trending-up';
            const trendColor =
              trend === 'trending-down' ? colors.error : colors.success;

            return (
              <View key={key} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.badge, { backgroundColor: badgeBg }]}>
                    <Text style={styles.badgeLabel}>{label}</Text>
                  </View>
                  {trend === 'trending-down' ? (
                    <Icon name="trending-down" size={18} color={trendColor} />
                  ) : (
                    <Icon name="trending-up" size={18} color={trendColor} />
                  )}
                </View>

                <Text style={styles.metalName}>{name}</Text>

                {isEditing ? (
                  <View style={styles.inputWrapper}>
                    <Text style={styles.dollarSign}>$</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="decimal-pad"
                      value={editingValue}
                      onChangeText={setEditingValue}
                      onBlur={() => handleBlur({ key, name })}
                      onSubmitEditing={() => handleBlur({ key, name })}
                      autoFocus
                      selectTextOnFocus
                      returnKeyType="done"
                      placeholder="0.00"
                      placeholderTextColor={colors.textLight}
                    />
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.inputWrapper}
                      onPress={() => startEditing(key, price)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.dollarSign}>$</Text>
                      <Text style={styles.valueText}>
                        {price !== undefined && price !== null
                          ? price.toFixed(2)
                          : '0.00'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.updated}>
                      {lastUpdated ? `Last up: ${formatDate(lastUpdated)}` : 'No date'}
                    </Text>
                  </>
                )}
              </View>
            );
          })}
        </View>
      </View>

      <BrandedAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        type={alertConfig.type}
        onClose={hideAlert}
      />
    </>
  );
};

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fonts.lg,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fonts.sm,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  card: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: 12,
    elevation: 2,
    shadowColor: colors.cardShadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: {
    fontFamily: fonts.bold,
    fontSize: fonts.xs,
    color: colors.textPrimary,
  },
  metalName: {
    fontFamily: fonts.bold,
    fontSize: fonts.xs,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  dollarSign: {
    fontFamily: fonts.medium,
    fontSize: fonts.lg,
    color: colors.textPrimary,
    marginRight: 4,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 2,
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    borderBottomColor: colors.primary,
  },
  valueText: {
    flex: 1,
    paddingVertical: 4,
    fontSize: fonts.lg,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  updated: {
    fontFamily: fonts.regular,
    fontSize: fonts.xs,
    color: colors.textLight,
    marginTop: 6,
  },
});

export default MetalPriceCards;