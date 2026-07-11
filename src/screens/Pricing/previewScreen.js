import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Clipboard,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import PdfViewer from '../../components/common/PdfViewer';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import Icon from '../../components/common/Icon';

let generatePDFModule = null;
try {
  const mod = require('react-native-html-to-pdf');
  generatePDFModule =
    mod.generatePDF || mod.default?.generatePDF || mod.default;
} catch (e) {}

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const formatClientMessage = (entry, metalKt) => {
  const p = entry;
  const typeName =
    (p.Stones && p.Stones.length > 0 ? p.Stones[0].Type : null) ||
    p.typeName ||
    p.name ||
    'Item';
  const rawTotalPrice =
    num(p.TotalPrice) ||
    num(p.MetalPrice) + num(p.DiamondsPrice) + num(p.DutiesAmount);
  const rounded = Math.round(rawTotalPrice / 5) * 5;
  const goldWeight = p.Metal?.Weight || p.metalWeightGrams || 0;
  const diamondWeight = p.DiamondWeight || 0;
  const metalPrice = (p.MetalPrice || 0).toFixed(2);
  const diamondsPrice = (p.DiamondsPrice || 0).toFixed(2);

  return [
    `*${typeName}*`,
    `Approx Total Price: ${rounded.toFixed(2)} - ${(rounded + 25).toFixed(2)}$`,
    `Gold: ${goldWeight} grams ${metalKt}T Gold`,
    `CVD Diamonds: ${diamondWeight} carats`,
    `Approx Gold Price: ${metalPrice}$`,
    `Approx Diamond Price: ${diamondsPrice}$`,
  ].join('\n');
};

const buildEntryHtml = (entry, index, metalKt) => {
  const p = entry;
  const stones = p.Stones || [];
  const stonesHtml = stones
    .map(
      (s, idx) => `
      <tr style="${idx % 2 === 0 ? 'background:#f9f9f9' : ''}">
        <td style="padding:8px;border:1px solid #ddd;text-align:center">${
          s.Type || '-'
        }</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center">${
          s.MmSize || '-'
        }</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center">${
          s.Color || '-'
        }</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center">${
          s.Shape || '-'
        }</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center">${
          s.SieveSize || '-'
        }</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right">${
          s.Weight || 0
        }</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center">${
          s.Pcs || 0
        }</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right">${
          s.CtWeight || 0
        }</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right">${
          s.Markup || 0
        }</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right">$${num(
          s.Price,
        ).toFixed(2)}</td>
      </tr>`,
    )
    .join('');

  const applicableDuties = p.Applicable
    ? Object.entries(p.Applicable)
        .filter(([, value]) => value)
        .map(([key]) => key.replace(/([A-Z])/g, ' $1').trim())
        .join(', ')
    : 'None';

  const typeLabel =
    stones.length > 0
      ? stones[0].Type || `Section ${index + 1}`
      : `Section ${index + 1}`;

  return `
    <div class="section">
      <h2>${typeLabel}</h2>
      <div class="info-grid">
        <div class="info-row"><div class="info-label">Metal Quality:</div><div class="info-value">${
          p.Metal?.Quality || metalKt
        }</div></div>
        <div class="info-row"><div class="info-label">Metal Weight:</div><div class="info-value">${
          p.Metal?.Weight || 0
        }g</div></div>
        <div class="info-row"><div class="info-label">Metal Rate:</div><div class="info-value">$${num(
          p.Metal?.Rate,
        ).toFixed(2)}/g</div></div>
        <div class="info-row"><div class="info-label">Diamond Weight:</div><div class="info-value">${
          p.DiamondWeight || 0
        } ct</div></div>
        <div class="info-row"><div class="info-label">Total Pieces:</div><div class="info-value">${
          p.TotalPieces || 0
        }</div></div>
      </div>

      ${
        stones.length > 0
          ? `
      <h3>Stones Breakdown (${stones.length} items)</h3>
      <table>
        <thead>
          <tr><th>Type</th><th>MM</th><th>Color</th><th>Shape</th><th>Sieve</th><th>Avg Wt</th><th>Pcs</th><th>Ct Wt</th><th>Markup</th><th>$/Ct</th></tr>
        </thead>
        <tbody>${stonesHtml}</tbody>
      </table>`
          : ''
      }

      <div style="display:flex;justify-content:space-between;margin-top:20px;">
        <div style="width:48%;">
          <h3>Client Charges</h3>
          <div class="info-grid">
            <div class="info-row"><div class="info-label" style="font-size:12px;">Loss:</div><div class="info-value" style="font-size:12px;">${
              p.Client?.Loss || 0
            }%</div></div>
            <div class="info-row"><div class="info-label" style="font-size:12px;">Labour:</div><div class="info-value" style="font-size:12px;">$${num(
              p.Client?.Labour,
            ).toFixed(2)}/g</div></div>
            <div class="info-row"><div class="info-label" style="font-size:12px;">Extra Charges:</div><div class="info-value" style="font-size:12px;">${
              p.Client?.ExtraCharges || 0
            }%</div></div>
          </div>
        </div>
        <div style="width:48%;">
          <h3>Applicable Duties</h3>
          <p style="font-size:12px;margin:0;padding:8px;">${applicableDuties}</p>
        </div>
      </div>

      <div class="total-section">
        <div class="total-row"><span class="total-label">Metal Price:</span><span class="total-value">$${num(
          p.MetalPrice,
        ).toFixed(2)}</span></div>
        <div class="total-row"><span class="total-label">Diamonds Price:</span><span class="total-value">$${num(
          p.DiamondsPrice,
        ).toFixed(2)}</span></div>
        <div class="total-row"><span class="total-label">Duties Amount:</span><span class="total-value">$${num(
          p.DutiesAmount,
        ).toFixed(2)}</span></div>
        <div class="total-row grand-total" style="border-top:2px solid #143F45;margin-top:10px;padding-top:10px;">
          <span class="total-label" style="color:#D4AF37;">TOTAL PRICE:</span>
          <span class="total-value" style="color:#D4AF37;">$${num(
            p.TotalPrice,
          ).toFixed(2)}</span>
        </div>
      </div>
    </div>
  `;
};

const buildCombinedHtml = (
  pricingEntries,
  clientName,
  metalKt,
  messageSectionHtml,
) => {
  if (!pricingEntries || pricingEntries.length === 0) return '';

  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const sectionsHtml = pricingEntries
    .map((entry, index) => buildEntryHtml(entry, index, metalKt))
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=0.6,maximum-scale=3.0,minimum-scale=0.3,user-scalable=yes"><style>@page{margin:0;padding:0}*{margin:0;padding:0;box-sizing:border-box}html,body{margin:0;padding:0;-webkit-text-size-adjust:100%}body{font-family:Arial,sans-serif;padding:10px;color:#1A1A1A;background:#fff}.header{text-align:center;margin-bottom:12px;border-bottom:2px solid #143F45;padding-bottom:8px}.header h1{color:#143F45;margin:0 0 4px 0;font-size:22px}.header p{margin:2px 0;font-size:12px}.info-grid{display:table;width:100%;margin-bottom:10px}.info-row{display:table-row}.info-label{display:table-cell;padding:5px;font-weight:bold;width:40%;border-bottom:1px solid #F3F4F6;font-size:11px}.info-value{display:table-cell;padding:5px;border-bottom:1px solid #F3F4F6;font-size:11px}table{width:100%;border-collapse:collapse;margin:10px 0}th{background:#8B4513;color:white;padding:6px 3px;font-size:10px;border:1px solid #E5E7EB}td{padding:5px 3px;border:1px solid #E5E7EB;font-size:10px}.total-section{background:#F8F9FB;padding:12px;border-radius:4px;margin-top:12px}.total-row{display:flex;justify-content:space-between;padding:4px 0;font-size:11px}.grand-total{font-size:14px;font-weight:bold}.footer{text-align:center;margin-top:15px;padding-top:8px;border-top:1px solid #F3F4F6;color:#9CA3AF;font-size:9px}.section{page-break-inside:avoid;border:1px solid #eee;padding:12px;border-radius:4px;margin-bottom:12px}.section h2{color:#143F45;border-bottom:1px solid #143F45;padding-bottom:6px;margin:0 0 10px 0;font-size:16px}.section h3{background:#143F45;color:white;padding:5px 6px;font-size:12px;margin:10px 0 6px 0}</style></head><body><div class="header"><h1>Chandra Jewels</h1><p>Pricing Preview - ${clientName}</p><p>${currentDate}</p>
  </div>${sectionsHtml}<div class="footer"><p>Generated by Chandra Jewels Management App</p><p>This is a computer-generated document</p></div></body></html>`;
};

export default function PreviewScreen({ route, navigation }) {
  const {
    pricingEntries = [],
    clientName = 'Client',
    metalKt = '18K',
    showMessageFormat = true,
  } = route.params || {};
  const [copied, setCopied] = useState(false);
  const [isSharingPdf, setIsSharingPdf] = useState(false);
  const [combinedMessageFormat, setCombinedMessageFormat] = useState('');

  const combinedMessage = useMemo(() => {
    const messages = pricingEntries
      .map(entry => formatClientMessage(entry, metalKt))
      .filter(Boolean);
    if (messages.length === 0) return '';
    return messages.join('\n\n---\n\n');
    setCombinedMessageFormat(messages.join('\n\n---\n\n'));
  }, [pricingEntries, metalKt]);

  const combinedHtml = useMemo(
    () => buildCombinedHtml(pricingEntries, clientName, metalKt),
    [pricingEntries, clientName, metalKt],
  );

  const handleCopy = useCallback(() => {
    if (combinedMessage) {
      Clipboard.setString(combinedMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [combinedMessage]);

  const handleSharePdf = useCallback(async () => {
    if (!combinedHtml || isSharingPdf) return;
    try {
      setIsSharingPdf(true);
      if (typeof generatePDFModule !== 'function') {
        throw new Error('PDF library not available');
      }
      const pdf = await generatePDFModule({
        html: combinedHtml,
        fileName: `Pricing_${clientName.replace(/\s+/g, '_')}_${Date.now()}`,
        directory: 'Documents',
        base64: false,
        padding: 0,
      });
      const cachePath = `${
        RNFS.CachesDirectoryPath
      }/PricingReport_${Date.now()}.pdf`;
      await RNFS.copyFile(pdf.filePath, cachePath);
      await Share.open({
        title: 'Share Pricing Report',
        url: Platform.OS === 'android' ? `file://${cachePath}` : cachePath,
        type: 'application/pdf',
      });
      setTimeout(() => RNFS.unlink(cachePath).catch(() => {}), 5000);
    } catch (e) {
      if (e?.message && !e.message.includes('cancel')) {
        // silent fail on cancel
      }
    } finally {
      setIsSharingPdf(false);
    }
  }, [combinedHtml, clientName, isSharingPdf]);

  const totalPrice = useMemo(
    () => pricingEntries.reduce((sum, p) => sum + num(p.TotalPrice), 0),
    [pricingEntries],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.8}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="close" size={24} color="#151515" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Pricing Preview</Text>
          <Text style={styles.headerSub}>
            {pricingEntries.length} section
            {pricingEntries.length !== 1 ? 's' : ''} - {clientName}
          </Text>
        </View>
      </View>

        {showMessageFormat && combinedMessage && combinedMessage.trim() ? (
          <View style={styles.clientMsgCard}>
            <View style={styles.clientMsgHeader}>
              <Text style={styles.clientMsgLabel}>
                Copy pricing format for your client
              </Text>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={() => handleCopy(combinedMessage)}
                activeOpacity={0.8}
              >
                <Icon
                  name={copied ? 'check' : 'content-copy'}
                  size={15}
                  color={copied ? '#059669' : colors.primary}
                />
                <Text
                  style={[styles.copyBtnText, copied && { color: '#059669' }]}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.clientMsgInput}
              value={combinedMessage}
              onChangeText={() => {}}
              multiline
              placeholder="No pricing message saved yet..."
              placeholderTextColor={colors.textSecondary}
              textAlignVertical="top"
              scrollEnabled
              nestedScrollEnabled
            />
          </View>
        ) : null}

      <View style={styles.pdfContainer}>
        <PdfViewer html={combinedHtml} style={styles.pdfViewer} />
      </View>
      
      

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[
              styles.sharePdfBtn,
              isSharingPdf && styles.sharePdfBtnDisabled,
            ]}
            activeOpacity={0.8}
            onPress={handleSharePdf}
            disabled={isSharingPdf}
          >
            {isSharingPdf ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name="share" size={16} color="#fff" />
            )}
            <Text style={styles.sharePdfBtnText}>
              {isSharingPdf ? 'Sharing...' : 'Share PDF'}
            </Text>
          </TouchableOpacity>
        </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary || '#F5F5F5',
  },
  headerRow: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 10,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E1E3E6',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F3F5',
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    color: '#171717',
    fontSize: 17,
    fontWeight: '600',
  },
  headerSub: {
    color: '#8A8D93',
    fontSize: 12,
    marginTop: 2,
  },
  totalPriceBadge: {
    backgroundColor: colors.primary || '#143F45',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  totalPriceText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  pdfContainer: {
    flex: 3,
    backgroundColor: '#fff',
  },
  pdfViewer: {
    flex: 1,
  },
  bottomBar: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E1E3E6',
    alignItems: 'center',
    gap: 10,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.primary || '#143F45',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  copyBtnDone: {
    backgroundColor: colors.primary || '#143F45',
    borderColor: colors.primary || '#143F45',
  },
  copyBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary || '#143F45',
  },
  copyBtnTextDone: {
    color: '#fff',
  },
  sharePdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.primary || '#143F45',
  },
  sharePdfBtnDisabled: {
    opacity: 0.6,
  },
  sharePdfBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },

  clientMsgCard: {
    marginTop: 0,
    borderTopWidth: 1,
    borderWidth: 1,
    borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 12,
    padding: 14,
    backgroundColor: colors.backgroundSecondary || '#F8F9FA',
    height: 200,
  },
  clientMsgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  clientMsgLabel: {
    fontFamily: fonts.bold,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
    flex: 1,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  copyBtnText: {
    fontFamily: fonts.medium,
    fontSize: fonts.xs || 12,
    color: colors.primary,
  },
  clientMsgInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderLight || '#E0E0E0',
    borderRadius: 8,
    padding: 10,
    fontFamily: fonts.regular,
    fontSize: fonts.sm || 13,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
});
