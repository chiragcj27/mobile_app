import React, { useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';

/**
 * PdfViewer
 *
 * Props (pick one):
 *   html  {string}  — Raw HTML string. Rendered directly in WebView (no internet needed,
 *                     works on both iOS & Android for locally-generated content).
 *   url   {string}  — A REMOTE https:// URL to a PDF. Loaded natively on iOS; wrapped in
 *                     Google Docs Viewer on Android. Local file:// URLs are NOT supported
 *                     via this prop — use `html` for local content.
 *
 * When `html` is provided it takes priority over `url`.
 */
const PdfViewer = ({ url, html, style }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(false);

  // ── HTML mode: render markup directly (local / generated content) ──────────
  if (html) {
    return (
      <View style={[styles.container, style]}>
        {loading && !error && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors?.primary || '#D4AF37'} />
            <Text style={styles.loadingText}>Loading preview…</Text>
          </View>
        )}
        {error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Failed to render preview</Text>
            <Text style={styles.errorSubText}>The content could not be displayed.</Text>
          </View>
        ) : (
          <WebView
            source={{ html, baseUrl: '' }}
            style={styles.webview}
            onLoadEnd={() => setLoading(false)}
            onError={() => { setLoading(false); setError(true); }}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={false}
            scalesPageToFit={false}
            originWhitelist={['*']}
          />
        )}
      </View>
    );
  }

  // ── URL mode: remote PDF only ──────────────────────────────────────────────
  // Google Docs Viewer only works for publicly-accessible https:// URLs.
  // Local file:// URLs will always fail via this path.
  const targetUrl = url || 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
  const viewerUrl = Platform.OS === 'android'
    ? `https://docs.google.com/viewer?url=${encodeURIComponent(targetUrl)}&embedded=true`
    : targetUrl;

  return (
    <View style={[styles.container, style]}>
      {loading && !error && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors?.primary || '#D4AF37'} />
          <Text style={styles.loadingText}>Loading PDF…</Text>
        </View>
      )}
      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load PDF</Text>
          <Text style={styles.errorSubText}>The document might be unavailable or restricted.</Text>
        </View>
      ) : (
        <WebView
          source={{ uri: viewerUrl }}
          style={styles.webview}
          onLoadEnd={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true); }}
          onHttpError={() => { setLoading(false); setError(true); }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={false}
          scalesPageToFit={true}
          originWhitelist={['*']}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    zIndex: 1,
  },
  loadingText: {
    marginTop: 10,
    color: colors?.primary || '#D4AF37',
    fontFamily: fonts?.medium,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
  },
  errorText: {
    color: colors?.error || '#EF4444',
    fontFamily: fonts?.bold,
    fontSize: 18,
    marginBottom: 8,
  },
  errorSubText: {
    color: colors?.textSecondary || '#666',
    fontFamily: fonts?.regular,
    fontSize: 14,
    textAlign: 'center',
  },
});

export default PdfViewer;