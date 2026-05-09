/**
 * PDF Generator Utility
 * Generates HTML content for enquiry PDFs that can be saved/shared
 */

import Share from 'react-native-share';
import { Platform, Alert } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FILE_BASE_URL, API_BASE_URL } from '../config/apiConfig';
import { getUserName } from './userUtils';

// Import PDF generation library (react-native-html-to-pdf)
let generatePDF = null;
try {
  // Import the generatePDF function from react-native-html-to-pdf
  // The library exports { generatePDF } as a named export
  const htmlToPdfModule = require('react-native-html-to-pdf');
  
  // Try different ways to get the function
  generatePDF = htmlToPdfModule.generatePDF 
    || htmlToPdfModule.default?.generatePDF
    || htmlToPdfModule.default;
  
  // Debug: Log library status
  if (__DEV__) {
    console.log('Module keys:', htmlToPdfModule ? Object.keys(htmlToPdfModule) : 'no module');
  }
} catch (error) {
}

// Import alternative PDF library (react-native-print) for large documents
let RNPrint = null;
try {
  RNPrint = require('react-native-print');
  if (__DEV__) {
    console.log('✅ react-native-print loaded successfully');
  }
} catch (error) {
  if (__DEV__) {
    console.log('⚠️ react-native-print not available:', error.message);
  }
}

// Debug: Log when module loads


// Helper to convert string to base64 (for data URLs)
// Improved version that handles large strings and special characters better
const toBase64 = (str) => {
  try {
    if (!str || str.length === 0) {
      return '';
    }
    
    // For large strings, use chunked encoding to avoid memory issues
    const CHUNK_SIZE = 8192; // Process in 8KB chunks
    let result = '';
    
    // First, try btoa if available (some React Native environments have it)
    if (typeof btoa !== 'undefined') {
      try {
        // For large strings, encode in chunks
        if (str.length > CHUNK_SIZE) {
          for (let i = 0; i < str.length; i += CHUNK_SIZE) {
            const chunk = str.substring(i, Math.min(i + CHUNK_SIZE, str.length));
            const utf8Bytes = unescape(encodeURIComponent(chunk));
            result += btoa(utf8Bytes);
          }
          return result;
        } else {
          // Small string - encode directly
          const utf8Bytes = unescape(encodeURIComponent(str));
          return btoa(utf8Bytes);
        }
      } catch (e) {
      }
    }
    
    // More reliable manual implementation for large strings
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    result = '';
    
    // Convert string to UTF-8 bytes in chunks to avoid memory issues
    const utf8Bytes = [];
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 0x80) {
        utf8Bytes.push(code);
      } else if (code < 0x800) {
        utf8Bytes.push(0xc0 | (code >> 6));
        utf8Bytes.push(0x80 | (code & 0x3f));
      } else if (code < 0xd800 || code >= 0xe000) {
        utf8Bytes.push(0xe0 | (code >> 12));
        utf8Bytes.push(0x80 | ((code >> 6) & 0x3f));
        utf8Bytes.push(0x80 | (code & 0x3f));
      } else {
        // Surrogate pair
        if (i + 1 < str.length) {
          i++;
          const code2 = str.charCodeAt(i);
          const codePoint = 0x10000 + (((code & 0x3ff) << 10) | (code2 & 0x3ff));
          utf8Bytes.push(0xf0 | (codePoint >> 18));
          utf8Bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
          utf8Bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
          utf8Bytes.push(0x80 | (codePoint & 0x3f));
        } else {
          // Invalid surrogate pair - skip
          utf8Bytes.push(0xef, 0xbf, 0xbd); // Replacement character
        }
      }
    }
    
    // Convert bytes to base64
    let i = 0;
    while (i < utf8Bytes.length) {
      const a = utf8Bytes[i++];
      const b = i < utf8Bytes.length ? utf8Bytes[i++] : 0;
      const c = i < utf8Bytes.length ? utf8Bytes[i++] : 0;
      
      const bitmap = (a << 16) | (b << 8) | c;
      
      result += chars.charAt((bitmap >> 18) & 63);
      result += chars.charAt((bitmap >> 12) & 63);
      result += (i - 2 < utf8Bytes.length) ? chars.charAt((bitmap >> 6) & 63) : '=';
      result += (i - 1 < utf8Bytes.length) ? chars.charAt(bitmap & 63) : '=';
    }
    
    return result;
  } catch (error) {
    throw new Error(`Failed to encode to base64: ${error.message}`);
  }
};

/**
 * Fetch image and convert to base64 data URL
 * This is needed because PDF libraries can't load authenticated images
 */
const fetchImageAsBase64 = async (imageUrl) => {
  if (!imageUrl) {
    
    return '';
  }
  
  try {
    if (__DEV__) {
      console.log('🖼️ Fetching image for PDF:', imageUrl.substring(0, 100));
    }
    
    // Get auth token
    const token = await AsyncStorage.getItem('token');
    
    // Fetch image with auth headers
    const response = await fetch(imageUrl, {
      method: 'GET',
      headers: token ? {
        'Authorization': `Bearer ${token}`,
      } : {},
    });
    
    if (!response.ok) {
      
      return '';
    }
    
    // Check if response is JSON (API might return URL object)
    const contentType = response.headers.get('content-type') || '';
    
    
    if (contentType.includes('application/json')) {
      const jsonData = await response.json();
      const actualImageUrl = jsonData.url || jsonData.imageUrl || jsonData.src || jsonData.location;
      if (actualImageUrl) {
        if (__DEV__) {
          console.log('🔄 Found S3 URL in JSON response:', actualImageUrl.substring(0, 100));
        }
        // For large documents, return S3 URL directly (it's presigned and publicly accessible)
        // For small documents, convert to base64 for better reliability
        // Check if caller wants base64 (by checking if this is called from generateEnquiriesListHTML)
        // For now, return S3 URL - the caller will decide whether to convert to base64
        return actualImageUrl;
      }
      
      return '';
    }
    
    // Convert response to base64
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    
    
    // Convert to base64 string - improved method
    let base64 = '';
    
    // Try using Buffer if available (React Native polyfill)
    if (typeof Buffer !== 'undefined') {
      try {
        base64 = Buffer.from(bytes).toString('base64');
        
      } catch (e) {
        
      }
    }
    
    // Fallback: manual conversion
    if (!base64) {
      try {
        // Convert bytes to binary string in chunks
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
          // Use Array.from to avoid "Maximum call stack size exceeded" error
          binary += String.fromCharCode(...Array.from(chunk));
        }
        
        // Try btoa first
        if (typeof btoa !== 'undefined') {
          try {
            base64 = btoa(binary);
            
          } catch (e) {
            
            base64 = toBase64(binary);
          }
        } else {
          base64 = toBase64(binary);
        }
      } catch (error) {
        
        return '';
      }
    }
    
    if (!base64) {
      
      return '';
    }
    
    // Determine image type
    const imageType = contentType.split('/')[1] || 'jpeg';
    // Normalize image type
    const normalizedType = imageType.split(';')[0].toLowerCase();
    
    const dataUrl = `data:image/${normalizedType};base64,${base64}`;
    
    
    
    return dataUrl;
  } catch (error) {
    if (__DEV__) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        url: imageUrl.substring(0, 100),
      });
    }
    return '';
  }
};

/**
 * Format date for display
 */
const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch (error) {
    return dateString;
  }
};

/**
 * Format currency
 */
const formatCurrency = (amount) => {
  if (!amount || amount === 0) return '₹ 0';
  return `₹ ${parseFloat(amount).toLocaleString('en-IN')}`;
};

/**
 * Generate HTML content for enquiry PDF
 * Now async to fetch images as base64
 */
export const generateEnquiryHTML = async (enquiry) => {
  const metal = enquiry?.Metal || enquiry?.metal || {};
  const metalColor = metal.Color || metal.color || 'N/A';
  const metalQuality = metal.Quality || metal.quality || '';
  const metalWeight = enquiry?.MetalWeight || enquiry?.metalWeight || {};
  const diamondWeight = enquiry?.DiamondWeight || enquiry?.diamondWeight || {};

  // Format metal weight
  let metalWeightText = 'N/A';
  if (metalWeight.Exact || metalWeight.exact) {
    metalWeightText = `${metalWeight.Exact || metalWeight.exact} gms`;
  } else if (metalWeight.From || metalWeight.from) {
    const from = metalWeight.From || metalWeight.from || '';
    const to = metalWeight.To || metalWeight.to || '';
    metalWeightText = `${from}${to ? ` - ${to}` : ''} gms`;
  }

  // Format diamond weight
  let diamondWeightText = 'N/A';
  if (diamondWeight.Exact || diamondWeight.exact) {
    diamondWeightText = `${diamondWeight.Exact || diamondWeight.exact} carats`;
  } else if (diamondWeight.From || diamondWeight.from) {
    const from = diamondWeight.From || diamondWeight.from || '';
    const to = diamondWeight.To || diamondWeight.to || '';
    diamondWeightText = `${from}${to ? ` - ${to}` : ''} carats`;
  }

  const statusColors = {
    pending: '#FFA500',
    completed: '#4CAF50',
    rejected: '#F44336',
  };

  const priorityColors = {
    high: '#F44336',
    medium: '#FF9800',
    low: '#4CAF50',
  };

  const status = (enquiry?.status || 'pending').toLowerCase();
  const priority = (enquiry?.priority || 'medium').toLowerCase();
  const statusColor = statusColors[status] || statusColors.pending;
  const priorityColor = priorityColors[priority] || priorityColors.medium;

  // Get images (first image URL if available) - improved to check all sources
  const getFirstImageUrlForSingle = (enquiry) => {
    if (!enquiry) return '';
    
    let referenceImages = [];
    
    // Priority 1: Check original data structure (before normalization) - most reliable
    if (enquiry?._originalData?.ReferenceImages && Array.isArray(enquiry._originalData.ReferenceImages)) {
      referenceImages = enquiry._originalData.ReferenceImages;
    }
    // Priority 2: Check direct ReferenceImages property
    else if (enquiry?.ReferenceImages && Array.isArray(enquiry.ReferenceImages)) {
      referenceImages = enquiry.ReferenceImages;
    }
    // Priority 3: Check normalized images (from API transform)
    else if (enquiry?.images && Array.isArray(enquiry.images) && enquiry.images.length > 0) {
      referenceImages = enquiry.images;
    }
    // Priority 4: Check Images property (fallback)
    else if (enquiry?.Images && Array.isArray(enquiry.Images)) {
      referenceImages = enquiry.Images;
    }
    
    if (referenceImages.length === 0) {
      return '';
    }
    
    const firstImage = referenceImages[0];
    
    // Handle string format
    if (typeof firstImage === 'string') {
      // If it's already a full URL, use it directly
      if (firstImage.startsWith('http://') || firstImage.startsWith('https://')) {
        return firstImage;
      }
      // If it starts with /, construct full URL
      if (firstImage.startsWith('/')) {
        return `${FILE_BASE_URL}${firstImage}`;
      }
      // Otherwise, treat as file key and construct URL
      return `${FILE_BASE_URL}/api/enquiries/files/${encodeURIComponent(firstImage)}`;
    }
    
    // Handle object format
    if (typeof firstImage === 'object' && firstImage !== null) {
      // Priority 1: Use Key property (most reliable)
      const imageKey = firstImage.Key || firstImage.key || firstImage.KeyName || firstImage.keyName || '';
      if (imageKey) {
        const encodedKey = encodeURIComponent(imageKey);
        return `${FILE_BASE_URL}/api/enquiries/files/${encodedKey}`;
      }
      
      // Priority 2: Use Id property as fallback
      const imageId = firstImage.Id || firstImage.id || firstImage._id || firstImage.FileId || firstImage.fileId || '';
      if (imageId) {
        return `${FILE_BASE_URL}/api/enquiries/files/${imageId}`;
      }
      
      // Priority 3: Check for URL properties
      const imageUrl = firstImage.Url || firstImage.url || firstImage.URI || firstImage.uri || 
                      firstImage.Location || firstImage.location || firstImage.UrlPath || firstImage.urlPath || '';
      if (imageUrl) {
        if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
          return imageUrl;
        }
        if (imageUrl.startsWith('/')) {
          return `${FILE_BASE_URL}${imageUrl}`;
        }
        return `${FILE_BASE_URL}/${imageUrl}`;
      }
    }
    
    return '';
  };
  
  let imageUrl = getFirstImageUrlForSingle(enquiry);
  
  // Resolve API endpoint to S3 URL if needed
  let finalImageUrl = imageUrl;
  if (imageUrl && !imageUrl.includes('amazonaws.com') && !imageUrl.includes('s3.')) {
    try {
      const token = await AsyncStorage.getItem('token');
      const response = await fetch(imageUrl, {
        method: 'GET',
        headers: token ? {
          'Authorization': `Bearer ${token}`,
        } : {},
      });
      
      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const jsonData = await response.json();
          const s3Url = jsonData.url || jsonData.imageUrl || jsonData.src || jsonData.location;
          if (s3Url) {
            finalImageUrl = s3Url;
            
          }
        }
      }
    } catch (error) {
      
    }
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enquiry: ${enquiry?.title || enquiry?.Name || 'Untitled'}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Arial', sans-serif;
      padding: 20px;
      color: #333;
      background: #fff;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #1976D2;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      color: #1976D2;
      font-size: 28px;
      margin-bottom: 10px;
    }
    .header .subtitle {
      color: #666;
      font-size: 14px;
    }
    .enquiry-title {
      font-size: 24px;
      font-weight: bold;
      color: #1976D2;
      margin-bottom: 20px;
      text-align: center;
      padding: 15px;
      background: #f5f5f5;
      border-radius: 8px;
    }
    .badges {
      display: flex;
      gap: 10px;
      justify-content: center;
      margin-bottom: 30px;
      flex-wrap: wrap;
    }
    .badge {
      padding: 8px 16px;
      border-radius: 20px;
      color: white;
      font-weight: bold;
      font-size: 12px;
      text-transform: uppercase;
    }
    .status-badge {
      background-color: ${statusColor};
    }
    .priority-badge {
      background-color: ${priorityColor};
    }
    .content-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 30px;
    }
    .section {
      margin-bottom: 30px;
      page-break-inside: avoid;
    }
    .section-title {
      font-size: 18px;
      font-weight: bold;
      color: #1976D2;
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 2px solid #1976D2;
    }
    .info-row {
      display: flex;
      padding: 10px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .info-label {
      font-weight: bold;
      color: #666;
      width: 40%;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
    }
    .info-value {
      width: 60%;
      color: #333;
      font-size: 14px;
    }
    .description {
      padding: 15px;
      background: #f9f9f9;
      border-radius: 8px;
      margin-top: 10px;
      line-height: 1.6;
      color: #555;
    }
    .image-section {
      text-align: center;
      margin: 30px 0;
    }
    .enquiry-image {
      max-width: 300px;
      max-height: 300px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e0e0e0;
      text-align: center;
      color: #666;
      font-size: 12px;
    }
    @media print {
      body {
        padding: 10px;
      }
      .section {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>CHANDRA JEWELLERY</h1>
    <div class="subtitle">Enquiry Details Report</div>
  </div>

  <div class="enquiry-title">
    ${enquiry?.title || enquiry?.Name || 'Untitled Enquiry'}
  </div>

  <div class="badges">
    <span class="badge status-badge">Status: ${(enquiry?.status || 'pending').toUpperCase()}</span>
    <span class="badge priority-badge">Priority: ${(enquiry?.priority || 'medium').toUpperCase()}</span>
  </div>

  ${finalImageUrl ? `
  <div class="image-section">
    <img src="${finalImageUrl}" alt="Enquiry Image" class="enquiry-image" />
  </div>
  ` : ''}

  <div class="content-grid">
    <div class="section">
      <div class="section-title">Basic Information</div>
      <div class="info-row">
        <div class="info-label">Client</div>
        <div class="info-value">${enquiry?.clientName || enquiry?.client || 'Unknown Client'}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Category</div>
        <div class="info-value">${enquiry?.category || enquiry?.Category || 'N/A'}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Quantity</div>
        <div class="info-value">${enquiry?.Quantity || 'N/A'}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Created Date</div>
        <div class="info-value">${formatDate(enquiry?.createdAt)}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Last Updated</div>
        <div class="info-value">${formatDate(enquiry?.updatedAt || enquiry?.createdAt)}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Shipping Date</div>
        <div class="info-value">${enquiry?.deadline || enquiry?.ShippingDate ? formatDate(enquiry.deadline || enquiry.ShippingDate) : 'Not set'}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Product Details</div>
      <div class="info-row">
        <div class="info-label">Style Number</div>
        <div class="info-value">${enquiry?.StyleNumber || 'N/A'}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Gati Order Number</div>
        <div class="info-value">${enquiry?.GatiOrderNumber || 'N/A'}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Stone Type</div>
        <div class="info-value">${enquiry?.stoneType || enquiry?.StoneType || 'N/A'}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Budget</div>
        <div class="info-value">${formatCurrency(enquiry?.estimatedPrice || enquiry?.budget || 0)}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Coral Code</div>
        <div class="info-value">${enquiry?.CoralCode || enquiry?.coralVersion || 'N/A'}</div>
      </div>
      <div class="info-row">
        <div class="info-label">CAD Code</div>
        <div class="info-value">${enquiry?.CadCode || enquiry?.cadVersion || 'N/A'}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Metal Details</div>
    <div class="info-row">
      <div class="info-label">Metal Color</div>
      <div class="info-value">${metalColor}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Metal Quality</div>
      <div class="info-value">${metalQuality || 'N/A'}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Metal Weight</div>
      <div class="info-value">${metalWeightText}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Diamond Weight</div>
      <div class="info-value">${diamondWeightText}</div>
    </div>
    <div class="info-row">
      <div class="info-label">Stamping</div>
      <div class="info-value">${enquiry?.Stamping || 'N/A'}</div>
    </div>
  </div>

  ${enquiry?.description || enquiry?.Remarks ? `
  <div class="section">
    <div class="section-title">Description / Remarks</div>
    <div class="description">
      ${(enquiry?.description || enquiry?.Remarks || '').replace(/\n/g, '<br>')}
    </div>
  </div>
  ` : ''}

  ${enquiry?.AssignedTo ? `
  <div class="section">
    <div class="section-title">Assignment Details</div>
    <div class="info-row">
      <div class="info-label">Assigned To</div>
      <div class="info-value">${getUserName(enquiry.AssignedTo)}</div>
    </div>
  </div>
  ` : ''}

  <div class="footer">
    <p>Generated on ${formatDate(new Date().toISOString())}</p>
    <p>Chandra Jewellery - Enquiry Management System</p>
  </div>
</body>
</html>
  `;

  return html;
};

/**
 * Share/Save enquiry as PDF
 */
export const downloadEnquiryPDF = async (enquiry) => {
  try {
    // Generate HTML content (now async to fetch images)
    const htmlContent = await generateEnquiryHTML(enquiry);

    // Create filename
    const enquiryName = (enquiry?.title || enquiry?.Name || 'Enquiry')
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase();
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${enquiryName}_${timestamp}`;
    
    // Try to generate PDF using react-native-html-to-pdf
    if (generatePDF && typeof generatePDF === 'function') {
      try {
        if (__DEV__) {
          console.log('========== ATTEMPTING PDF GENERATION (SINGLE) ==========');
        }
        
        // Don't specify directory - let library use its default
        // Or use a simple string like "Documents" to avoid path issues
        const options = {
          html: htmlContent,
          fileName: filename,
          // Don't specify directory on Android - library handles it better
          base64: false,
          width: 595, // A4 width in points
          height: 842, // A4 height in points
          paddingLeft: 10,
          paddingRight: 10,
          paddingTop: 10,
          paddingBottom: 10,
        };
        
        if (__DEV__) {
          console.log('PDF options:', JSON.stringify({ ...options, html: '[HTML content]' }, null, 2));
        }
        
        const file = await generatePDF(options);
        
        if (__DEV__) {
          console.log('========== PDF GENERATION SUCCESS (SINGLE) ==========');
          console.log('File exists:', file.filePath ? await RNFS.exists(file.filePath) : 'no path');
        }
        
        // Verify file exists and is not empty
        if (file && file.filePath) {
          let originalFilePath = file.filePath;
          
          // Fix malformed paths - the library sometimes creates paths like:
          // /storage/emulated/0/Android/data/.../files/data/user/0/.../cache/file.pdf
          // Extract the actual file location
          if (originalFilePath.includes('/data/user/0/')) {
            // Extract the cache path part
            const cacheMatch = originalFilePath.match(/\/data\/user\/0\/[^/]+\/cache\/([^/]+\.pdf)$/);
            if (cacheMatch) {
              // Use the app's cache directory
              originalFilePath = `${RNFS.CachesDirectoryPath}/${cacheMatch[1]}`;
            }
          }
          
          // Copy file to Downloads for easier access and sharing
          const downloadPath = `${RNFS.DownloadDirectoryPath}/${filename}.pdf`;
          let finalFilePath = downloadPath;
          
          try {
            // Verify original file exists
            if (await RNFS.exists(originalFilePath)) {
              // Copy to Downloads
              await RNFS.copyFile(originalFilePath, downloadPath);
              
              
            } else {
              // If original doesn't exist, try the file path as-is
              if (await RNFS.exists(file.filePath)) {
                await RNFS.copyFile(file.filePath, downloadPath);
              } else {
                throw new Error('Original PDF file not found');
              }
            }
          } catch (copyError) {
            // Use original path if copy fails
            finalFilePath = originalFilePath;
          }
          
          // Verify final file exists
          if (await RNFS.exists(finalFilePath)) {
            const fileStats = await RNFS.stat(finalFilePath);
            if (fileStats.size > 0) {
              
              
              // Share the PDF file - use content URI for Android
              await Share.open({
                title: 'Download Enquiry PDF',
                message: `Enquiry: ${enquiry?.title || enquiry?.Name || 'Untitled'}`,
                url: `file://${finalFilePath}`,
                type: 'application/pdf',
                filename: `${filename}.pdf`,
                subject: `Enquiry - ${enquiry?.title || enquiry?.Name || 'Untitled'}`,
              });
              
              return { success: true, filePath: finalFilePath, isPDF: true };
            } else {
              throw new Error('Generated PDF file is empty');
            }
          } else {
            throw new Error(`PDF file was not created at: ${finalFilePath}`);
          }
        } else {
          throw new Error('PDF generation returned invalid file path');
        }
      } catch (pdfError) {
        console.error('========== PDF GENERATION ERROR (SINGLE) ==========');
        // Fall through to HTML fallback
      }
    } else {
      if (__DEV__) {
        console.warn('PDF library not available or generatePDF function missing (single)');
      }
    }
    
    // Fallback: Save as HTML if PDF generation fails or library not available
    const htmlFilename = `${filename}.html`;
    const htmlFilePath = `${RNFS.DownloadDirectoryPath}/${htmlFilename}`;
    
    if (__DEV__) {
      console.log('Saving as HTML file (fallback):', htmlFilePath);
    }
    
    await RNFS.writeFile(htmlFilePath, htmlContent, 'utf8');
    
    const fileExists = await RNFS.exists(htmlFilePath);
    if (!fileExists) {
      throw new Error('Failed to save HTML file');
    }
    
    const fileStats = await RNFS.stat(htmlFilePath);
    if (fileStats.size === 0) {
      throw new Error('Saved HTML file is empty');
    }
    
    // Share the HTML file with instructions
    await Share.open({
      title: 'Download Enquiry',
      message: `Enquiry: ${enquiry?.title || enquiry?.Name || 'Untitled'}\n\n` +
               `File saved as HTML. To convert to PDF:\n` +
               `1. Open the file in a browser\n` +
               `2. Use browser's Print function\n` +
               `3. Choose "Save as PDF" as the destination`,
      url: `file://${htmlFilePath}`,
      type: 'text/html',
      filename: htmlFilename,
      subject: `Enquiry - ${enquiry?.title || enquiry?.Name || 'Untitled'}`,
    });
    
    return { success: true, filePath: htmlFilePath, isHTML: true };
  } catch (error) {
    if (error.message !== 'User did not share') {
      throw error;
    }
    return { success: false, cancelled: true };
  }
};

// Helper function to generate empty HTML (defined outside to be accessible)
const generateEmptyHTML = (message) => {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enquiries List - No Data</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 40px;
      text-align: center;
      color: #666;
    }
    .error-message {
      font-size: 18px;
      color: #F44336;
      margin-top: 100px;
    }
  </style>
</head>
<body>
  <div class="error-message">${message}</div>
</body>
</html>
  `;
};

/**
 * Generate HTML content for multiple enquiries PDF (table format)
 * Now async to fetch images as base64
 */
export const generateEnquiriesListHTML = async (enquiries) => {
  // Validate input
  if (!enquiries) {
    return generateEmptyHTML('No enquiries data provided');
  }
  
  if (!Array.isArray(enquiries)) {
    return generateEmptyHTML('Invalid enquiries data format');
  }
  
  if (enquiries.length === 0) {
    return generateEmptyHTML('No enquiries available');
  }
  
  // Debug: Log enquiry data structure
  if (__DEV__) {
    console.log('Is array:', Array.isArray(enquiries));
    if (enquiries.length > 0) {
      console.log('First enquiry structure:', {
        keys: Object.keys(enquiries[0]),
        hasOriginalData: !!enquiries[0]._originalData,
        title: enquiries[0].title || enquiries[0].Name,
        clientName: enquiries[0].clientName || enquiries[0].client,
        status: enquiries[0].status || enquiries[0].Status,
        category: enquiries[0].category || enquiries[0].Category,
        fullEnquiry: JSON.stringify(enquiries[0]).substring(0, 500),
      });
      if (enquiries[0]._originalData) {
        console.log('Original data keys:', Object.keys(enquiries[0]._originalData));
        console.log('Original data sample:', JSON.stringify(enquiries[0]._originalData).substring(0, 500));
      }
    }
  }
  // Get first image URL for each enquiry - improved to check all sources
  const getFirstImageUrl = (enquiry) => {
    if (!enquiry) return '';
    
    let referenceImages = [];
    
    // Priority 1: Check original data structure (before normalization) - most reliable
    if (enquiry?._originalData?.ReferenceImages && Array.isArray(enquiry._originalData.ReferenceImages)) {
      referenceImages = enquiry._originalData.ReferenceImages;
    }
    // Priority 2: Check direct ReferenceImages property
    else if (enquiry?.ReferenceImages && Array.isArray(enquiry.ReferenceImages)) {
      referenceImages = enquiry.ReferenceImages;
    }
    // Priority 3: Check normalized images (from API transform)
    else if (enquiry?.images && Array.isArray(enquiry.images) && enquiry.images.length > 0) {
      referenceImages = enquiry.images;
    }
    // Priority 4: Check Images property (fallback)
    else if (enquiry?.Images && Array.isArray(enquiry.Images)) {
      referenceImages = enquiry.Images;
    }
    
    if (referenceImages.length === 0) {
      return '';
    }
    
    // Get the first image (or latest if preferred)
    const firstImage = referenceImages[0];
    
    // Handle string format
    if (typeof firstImage === 'string') {
      // If it's already a full URL, use it directly
      if (firstImage.startsWith('http://') || firstImage.startsWith('https://')) {
        return firstImage;
      }
      // If it starts with /, construct full URL
      if (firstImage.startsWith('/')) {
        return `${FILE_BASE_URL}${firstImage}`;
      }
      // Otherwise, treat as file key and construct URL
      return `${FILE_BASE_URL}/api/enquiries/files/${encodeURIComponent(firstImage)}`;
    }
    
    // Handle object format
    if (typeof firstImage === 'object' && firstImage !== null) {
      // Priority 1: Use Key property (most reliable)
      const imageKey = firstImage.Key || firstImage.key || firstImage.KeyName || firstImage.keyName || '';
      if (imageKey) {
        const encodedKey = encodeURIComponent(imageKey);
        return `${FILE_BASE_URL}/api/enquiries/files/${encodedKey}`;
      }
      
      // Priority 2: Use Id property as fallback
      const imageId = firstImage.Id || firstImage.id || firstImage._id || firstImage.FileId || firstImage.fileId || '';
      if (imageId) {
        return `${FILE_BASE_URL}/api/enquiries/files/${imageId}`;
      }
      
      // Priority 3: Check for URL properties
      const imageUrl = firstImage.Url || firstImage.url || firstImage.URI || firstImage.uri || 
                      firstImage.Location || firstImage.location || firstImage.UrlPath || firstImage.urlPath || '';
      if (imageUrl) {
        if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
          return imageUrl;
        }
        if (imageUrl.startsWith('/')) {
          return `${FILE_BASE_URL}${imageUrl}`;
        }
        return `${FILE_BASE_URL}/${imageUrl}`;
      }
    }
    
    return '';
  };

  // Get assigned date (if available in enquiry data)
  const getAssignedDate = (enquiry) => {
    // Try to find assigned date from StatusHistory or other fields
    if (enquiry?._originalData?.StatusHistory && Array.isArray(enquiry._originalData.StatusHistory)) {
      const assignedStatus = enquiry._originalData.StatusHistory.find(
        s => s.Status?.toLowerCase().includes('assigned') || s.status?.toLowerCase().includes('assigned')
      );
      if (assignedStatus) {
        return formatDate(assignedStatus.Timestamp || assignedStatus.timestamp);
      }
    }
    return '';
  };

  const getStatusColor = (status) => {
    const statusLower = (status || '').toLowerCase();
    if (statusLower === 'pending') return '#FFA500';
    if (statusLower === 'completed') return '#4CAF50';
    if (statusLower === 'rejected') return '#F44336';
    return '#9CA3AF';
  };

  const getPriorityColor = (priority) => {
    const priorityLower = (priority || '').toLowerCase();
    if (priorityLower === 'high' || priorityLower === 'urgent' || priorityLower.includes('super')) return '#F44336';
    if (priorityLower === 'medium') return '#FF9800';
    if (priorityLower === 'low') return '#4CAF50';
    return '#9CA3AF';
  };

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enquiries List - ${enquiries.length} Enquiries</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Arial', sans-serif;
      padding: 20px;
      color: #333;
      background: #fff;
      font-size: 10px;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #1976D2;
      padding-bottom: 20px;
      margin-bottom: 20px;
    }
    .header h1 {
      color: #1976D2;
      font-size: 24px;
      margin-bottom: 8px;
    }
    .header .subtitle {
      color: #666;
      font-size: 12px;
    }
    .summary {
      margin-bottom: 20px;
      padding: 12px;
      background: #f5f5f5;
      border-radius: 8px;
      font-size: 11px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 9px;
    }
    thead {
      background-color: #1976D2;
      color: white;
    }
    th {
      padding: 8px 4px;
      text-align: left;
      font-weight: bold;
      border: 1px solid #1565C0;
      font-size: 9px;
    }
    td {
      padding: 6px 4px;
      border: 1px solid #e0e0e0;
      font-size: 8px;
      vertical-align: top;
    }
    tbody tr:nth-child(even) {
      background-color: #f9f9f9;
    }
    tbody tr:hover {
      background-color: #f0f0f0;
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 7px;
      font-weight: bold;
      text-transform: uppercase;
      color: white;
    }
    .status-badge {
      background-color: #9CA3AF;
    }
    .priority-badge {
      background-color: #9CA3AF;
    }
    .image-cell {
      text-align: center;
      width: 50px;
    }
    .enquiry-image {
      max-width: 40px;
      max-height: 40px;
      border-radius: 4px;
    }
    .text-truncate {
      max-width: 100px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .footer {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 2px solid #e0e0e0;
      text-align: center;
      color: #666;
      font-size: 9px;
    }
    @media print {
      body {
        padding: 10px;
      }
      table {
        page-break-inside: auto;
      }
      tr {
        page-break-inside: avoid;
        page-break-after: auto;
      }
      thead {
        display: table-header-group;
      }
      tfoot {
        display: table-footer-group;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>CHANDRA JEWELLERY</h1>
    <div class="subtitle">Enquiries List Report</div>
  </div>

  <div class="summary">
    <strong>Total Enquiries:</strong> ${enquiries.length} | 
    <strong>Generated:</strong> ${formatDate(new Date().toISOString())}
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 3%;">#</th>
        <th style="width: 12%;">Name</th>
        <th style="width: 8%;">Category</th>
        <th style="width: 8%;">Status</th>
        <th style="width: 8%;">Client</th>
        <th style="width: 5%;">Image</th>
        <th style="width: 8%;">Assigned To</th>
        <th style="width: 8%;">Assigned Date</th>
        <th style="width: 8%;">Created Date</th>
        <th style="width: 8%;">Priority</th>
        <th style="width: 12%;">Metal</th>
        <th style="width: 8%;">Stone Type</th>
        <th style="width: 8%;">Shipping Date</th>
      </tr>
    </thead>
    <tbody>
      ${await (async () => {
        // Generate table rows with async image fetching
        if (!enquiries || enquiries.length === 0) {
          return '<tr><td colspan="13" style="text-align: center; padding: 20px;">No enquiries data available</td></tr>';
        }
        
        // Helper function to escape HTML
        const escapeHtml = (text) => {
          if (!text) return '';
          return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        };
        
        // Get image URLs (S3 URLs) - use them directly instead of converting to base64
        
        
        const imageUrls = enquiries.map((enquiry, idx) => {
          const originalData = enquiry?._originalData || {};
          const normalizedEnquiry = enquiry || {};
          const imageUrl = getFirstImageUrl(normalizedEnquiry) || getFirstImageUrl(originalData);
          
          if (imageUrl) {
            if (__DEV__) {
              console.log(`📸 [${idx + 1}/${enquiries.length}] Image URL:`, imageUrl.substring(0, 80));
            }
            // Fetch to get S3 URL if API endpoint
            return imageUrl;
          }
          return '';
        });
        
        // For large documents, use S3 URLs directly (they're presigned and publicly accessible)
        // For small documents, convert to base64 for better reliability
        // This prevents HTML from becoming too large (170MB+ with base64 images)
        const isLargeDocument = enquiries.length > 100;
        const USE_DIRECT_URLS = isLargeDocument; // Use URLs for large docs to avoid huge HTML
        
        const resolvedImageUrls = await Promise.all(imageUrls.map(async (imageUrl, idx) => {
          if (!imageUrl) return '';
          
          // For large documents, prefer using S3 URLs directly
          // S3 presigned URLs are publicly accessible and work in PDFs
          if (USE_DIRECT_URLS) {
            // If it's already an S3 URL, use it directly
            if (imageUrl.includes('amazonaws.com') || imageUrl.includes('s3.')) {
              if (__DEV__ && idx < 5) {
                console.log(`✅ Using S3 URL directly for image ${idx + 1} (large document mode)`);
              }
              return imageUrl;
            }
            
            // If it's an API endpoint, get S3 URL and use it directly
            try {
              const token = await AsyncStorage.getItem('token');
              const response = await fetch(imageUrl, {
                method: 'GET',
                headers: token ? {
                  'Authorization': `Bearer ${token}`,
                } : {},
              });
              
              if (response.ok) {
                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                  const jsonData = await response.json();
                  const s3Url = jsonData.url || jsonData.imageUrl || jsonData.src || jsonData.location;
                  if (s3Url && (s3Url.includes('amazonaws.com') || s3Url.includes('s3.'))) {
                    if (__DEV__ && idx < 5) {
                      console.log(`✅ Got S3 URL, using directly:`, s3Url.substring(0, 60));
                    }
                    return s3Url;
                  }
                }
              }
            } catch (error) {
              // Ignore errors, fall through to base64 conversion
            }
          }
          
          // For small documents OR if URL approach failed, convert to base64
          // This ensures images work even if URLs don't
          try {
            if (__DEV__ && !USE_DIRECT_URLS) {
              const progress = idx < 10 || idx % 20 === 0 || idx === imageUrls.length - 1;
              if (progress) {
                console.log(`🔄 Converting image ${idx + 1}/${imageUrls.length} to base64:`, imageUrl.substring(0, 60));
              }
            }
            
            const base64Image = await fetchImageAsBase64(imageUrl);
            if (base64Image) {
              if (__DEV__ && !USE_DIRECT_URLS) {
                const progress = idx < 10 || idx % 20 === 0 || idx === imageUrls.length - 1;
                if (progress) {
                  console.log(`✅ Image ${idx + 1} converted to base64 (${(base64Image.length / 1024).toFixed(1)}KB)`);
                }
              }
              return base64Image;
            }
          } catch (error) {
            if (__DEV__ && idx < 5) {
              console.warn(`⚠️ Failed to convert image ${idx + 1} to base64:`, error.message);
            }
          }
          
          // Final fallback: return original URL
          return imageUrl;
        }));
        
        if (__DEV__) {
          const successCount = resolvedImageUrls.filter(img => img !== '').length;
        }
        
        let rowsGenerated = 0;
        const rows = enquiries.map((enquiry, index) => {
          // Safety check: skip invalid enquiries
          if (!enquiry || typeof enquiry !== 'object') {
            
            return '';
          }
          
          try {
            // Handle both normalized and original data structures
            const originalData = enquiry?._originalData || {};
            const normalizedEnquiry = enquiry || {};
            
            // Get metal info - check both structures
            const metal = normalizedEnquiry?.Metal || originalData?.Metal || normalizedEnquiry?.metal || originalData?.metal || {};
            const metalColor = metal.Color || metal.color || '';
            const metalQuality = metal.Quality || metal.quality || '';
            const metalType = metalColor ? `${metalColor}${metalQuality ? ` (${metalQuality})` : ''}` : 'N/A';
            
            // Get status - check both structures
            const statusValue = normalizedEnquiry?.status || originalData?.Status || normalizedEnquiry?.Status || 'pending';
            const status = (statusValue || 'pending').toString().toUpperCase();
            const statusColor = getStatusColor(statusValue);
            
            // Get priority - check both structures
            const priorityValue = normalizedEnquiry?.priority || originalData?.Priority || normalizedEnquiry?.Priority || 'medium';
            const priority = (priorityValue || 'medium').toString().toUpperCase();
            const priorityColor = getPriorityColor(priorityValue);
            
            // Get title/name - check both structures
            const title = normalizedEnquiry?.title || originalData?.Name || normalizedEnquiry?.Name || 'Untitled';
            
            // Get category - check both structures
            const category = normalizedEnquiry?.category || originalData?.Category || normalizedEnquiry?.Category || 'N/A';
            
            // Get client name - check both structures
            const clientName = normalizedEnquiry?.clientName || originalData?.ClientName || normalizedEnquiry?.client || 'Unknown';
            
            // Get stone type - check both structures
            const stoneType = normalizedEnquiry?.stoneType || originalData?.StoneType || normalizedEnquiry?.StoneType || 'N/A';
            
            // Get dates - check both structures
            const createdAt = normalizedEnquiry?.createdAt || originalData?.createdAt || originalData?.CreatedDate || '';
            const shippingDate = normalizedEnquiry?.deadline || normalizedEnquiry?.ShippingDate || originalData?.ShippingDate || originalData?.deadline || '';
            
            const imageUrl = resolvedImageUrls[index] || '';
            const assignedDate = getAssignedDate(normalizedEnquiry) || getAssignedDate(originalData);
            const assignedToId = normalizedEnquiry?.AssignedTo || originalData?.AssignedTo || normalizedEnquiry?.assignedTo || '';
            // Resolve user ID to name
            const assignedToName = assignedToId ? getUserName(assignedToId) : 'N/A';
            
            rowsGenerated++;
            
            return `
        <tr>
          <td>${index + 1}</td>
          <td class="text-truncate">${escapeHtml(title)}</td>
          <td>${escapeHtml(category)}</td>
          <td>
            <span class="badge status-badge" style="background-color: ${statusColor}">${escapeHtml(status)}</span>
          </td>
          <td>${escapeHtml(clientName)}</td>
          <td class="image-cell">
            ${imageUrl ? (imageUrl.startsWith('data:image/') 
              ? `<img src="${imageUrl}" alt="Enquiry Image" class="enquiry-image" />` 
              : `<img src="${escapeHtml(imageUrl)}" alt="Enquiry Image" class="enquiry-image" />`) : '-'}
          </td>
          <td>${escapeHtml(assignedToName)}</td>
          <td>${escapeHtml(assignedDate) || 'N/A'}</td>
          <td>${formatDate(createdAt)}</td>
          <td>
            <span class="badge priority-badge" style="background-color: ${priorityColor}">${escapeHtml(priority)}</span>
          </td>
          <td class="text-truncate">${escapeHtml(metalType)}</td>
          <td>${escapeHtml(stoneType)}</td>
          <td>${shippingDate ? formatDate(shippingDate) : 'Not set'}</td>
        </tr>
            `;
          } catch (rowError) {
            
            return ''; // Skip this row if there's an error
          }
        }).filter(row => row !== '').join('');
        
        
        
        if (rows.length === 0) {
          return '<tr><td colspan="13" style="text-align: center; padding: 20px; color: red;">Error: Failed to generate table rows from enquiry data</td></tr>';
        }
        
        return rows;
      })()}
    </tbody>
  </table>

  <div class="footer">
    <p>Generated on ${formatDate(new Date().toISOString())}</p>
    <p>Chandra Jewellery - Enquiry Management System</p>
    <p>Total Records: ${enquiries.length}</p>
  </div>
</body>
</html>
  `;

  return html;
};

/**
 * Download all enquiries as PDF
 */
export const downloadAllEnquiriesPDF = async (enquiries) => {
  try {
    // Generate HTML content (now async to fetch images)
    const htmlContent = await generateEnquiriesListHTML(enquiries);
    
    if (__DEV__) {
      console.log('HTML preview (first 500 chars):', htmlContent.substring(0, 500));
      // Check if table has rows
      const tableRowsMatch = htmlContent.match(/<tr>/g);
    }

    // Create filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `All_Enquiries_${timestamp}`;
    
    // Check document size to determine best PDF generation method
    const htmlSizeKB = htmlContent.length / 1024;
    const htmlSizeMB = (htmlContent.length / 1024 / 1024).toFixed(2);
    const MAX_HTML_SIZE = 5000000; // 5MB limit
    const WARN_HTML_SIZE = 200000; // 200KB - warn but still try
    const LARGE_DOCUMENT_THRESHOLD = 150; // Use alternative method for >150 enquiries
    
    // For large documents, try react-native-print first (uses native print, handles large docs better)
    const isLargeDocument = enquiries.length > LARGE_DOCUMENT_THRESHOLD || htmlContent.length > WARN_HTML_SIZE;
    
    if (isLargeDocument && RNPrint) {
      if (__DEV__) {
        console.log('========== USING react-native-print FOR LARGE DOCUMENT ==========');
        console.log(`Number of enquiries: ${enquiries.length}, HTML size: ${htmlSizeKB.toFixed(0)}KB`);
      }
      
      try {
        // Use react-native-print to print HTML (user can save as PDF through print dialog)
        const printResult = await RNPrint.print({
          html: htmlContent,
          fileName: filename,
        });
        
        if (printResult) {
          if (__DEV__) {
            console.log('✅ Print dialog opened successfully');
          }
          
          // Return success - user will save as PDF through print dialog
          return { 
            success: true, 
            filePath: null, 
            isPDF: true,
            method: 'print',
            message: 'Print dialog opened. Please select "Save as PDF" to save the file.'
          };
        }
      } catch (printError) {
        if (__DEV__) {
          console.warn('⚠️ react-native-print failed, falling back to html-to-pdf:', printError.message);
        }
        // Fall through to html-to-pdf method
      }
    }
    
    // Try to generate PDF using react-native-html-to-pdf
    // Check if generatePDF is available
    if (!generatePDF) {
      if (__DEV__) {
        console.error('❌ PDF library not available! generatePDF is null/undefined');
      }
      throw new Error('PDF generation library is not available. The file will be saved as HTML instead.');
    }
    
    if (typeof generatePDF !== 'function') {
      if (__DEV__) {
        console.error('❌ PDF library not available! generatePDF is not a function:', typeof generatePDF, generatePDF);
      }
      throw new Error('PDF generation library is not available. The file will be saved as HTML instead.');
    }
    
    // generatePDF is available and is a function - proceed with PDF generation
    try {
      if (__DEV__) {
        console.log('========== ATTEMPTING PDF GENERATION (ALL ENQUIRIES) ==========');
        console.log('Number of enquiries:', enquiries.length);
        console.log('HTML content length:', htmlContent.length, 'characters');
        console.log('generatePDF type:', typeof generatePDF);
        console.log('generatePDF available:', !!generatePDF);
        console.log('generatePDF is function:', typeof generatePDF === 'function');
      }
        
        if (htmlContent.length > MAX_HTML_SIZE) {
          const sizeMB = (htmlContent.length / 1024 / 1024).toFixed(2);
          throw new Error(`HTML content is too large (${sizeMB}MB). Please export fewer enquiries at once (max ~150 enquiries recommended).`);
        }
        
        if (htmlContent.length > WARN_HTML_SIZE) {
          if (__DEV__) {
            console.warn(`⚠️ HTML content is large (${htmlSizeKB.toFixed(0)}KB / ${htmlSizeMB}MB). PDF generation may take longer or timeout.`);
            console.warn(`⚠️ Consider exporting fewer enquiries (${enquiries.length} enquiries may be too many).`);
          }
        }
        
        // Log image statistics
        if (__DEV__) {
          const imageCount = (htmlContent.match(/<img[^>]*>/gi) || []).length;
          const base64ImageCount = (htmlContent.match(/data:image\//gi) || []).length;
          const s3UrlCount = (htmlContent.match(/amazonaws\.com/gi) || []).length;
          const isUsingUrls = enquiries.length > 100;
          
          console.log(`📊 HTML contains ${imageCount} image tags`);
          if (isUsingUrls) {
            console.log(`✅ Using S3 URLs directly (${s3UrlCount} S3 URLs detected) - HTML size optimized`);
            console.log(`💡 S3 presigned URLs are publicly accessible and work in PDFs`);
            console.log(`📏 HTML size: ${htmlSizeKB.toFixed(0)}KB (would be ~170MB+ with base64)`);
          } else {
            console.log(`✅ ${base64ImageCount} images embedded as base64 data URLs`);
          }
        }
        
        // Don't specify directory - let library use its default
        // Or use a simple string like "Documents" to avoid path issues
        const options = {
          html: htmlContent,
          fileName: filename,
          // Don't specify directory on Android - library handles it better
          base64: false,
          width: 595, // A4 width in points
          height: 842, // A4 height in points
          paddingLeft: 10,
          paddingRight: 10,
          paddingTop: 10,
          paddingBottom: 10,
        };
        
        if (__DEV__) {
          console.log('PDF options:', JSON.stringify({ ...options, html: `[HTML content - ${htmlContent.length} chars / ${htmlSizeKB.toFixed(0)}KB]` }, null, 2));
        }
        
        // Add timeout wrapper for PDF generation
        const PDF_TIMEOUT = 60000; // 60 seconds timeout
        const pdfGenerationPromise = generatePDF(options);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('PDF conversion timed out after 60 seconds. The HTML content may be too large. Try exporting fewer enquiries.'));
          }, PDF_TIMEOUT);
        });
        
        const file = await Promise.race([pdfGenerationPromise, timeoutPromise]);
        
        if (__DEV__) {
          console.log('========== PDF GENERATION SUCCESS (ALL ENQUIRIES) ==========');
          console.log('File exists:', file.filePath ? await RNFS.exists(file.filePath) : 'no path');
          console.log('File path:', file.filePath);
        }
        
        // Verify file exists and is not empty
        if (file && file.filePath) {
          let originalFilePath = file.filePath;
          
          // Fix malformed paths - the library sometimes creates paths like:
          // /storage/emulated/0/Android/data/.../files/data/user/0/.../cache/file.pdf
          // Extract the actual file location
          if (originalFilePath.includes('/data/user/0/')) {
            // Extract the cache path part
            const cacheMatch = originalFilePath.match(/\/data\/user\/0\/[^/]+\/cache\/([^/]+\.pdf)$/);
            if (cacheMatch) {
              // Use the app's cache directory
              originalFilePath = `${RNFS.CachesDirectoryPath}/${cacheMatch[1]}`;
            }
          }
          
          // Copy file to Downloads for easier access and sharing
          const downloadPath = `${RNFS.DownloadDirectoryPath}/${filename}.pdf`;
          let finalFilePath = downloadPath;
          
          try {
            // Verify original file exists
            if (await RNFS.exists(originalFilePath)) {
              // Copy to Downloads
              await RNFS.copyFile(originalFilePath, downloadPath);
              
              
            } else {
              // If original doesn't exist, try the file path as-is
              if (await RNFS.exists(file.filePath)) {
                await RNFS.copyFile(file.filePath, downloadPath);
              } else {
                throw new Error('Original PDF file not found');
              }
            }
          } catch (copyError) {
            // Use original path if copy fails
            finalFilePath = originalFilePath;
          }
          
          // Verify final file exists
          if (await RNFS.exists(finalFilePath)) {
            const fileStats = await RNFS.stat(finalFilePath);
            if (fileStats.size > 0) {
              
              
              // Share the PDF file - use content URI for Android
              await Share.open({
                title: 'Download All Enquiries PDF',
                message: `Enquiries List - ${enquiries.length} enquiries`,
                url: `file://${finalFilePath}`,
                type: 'application/pdf',
                filename: `${filename}.pdf`,
                subject: `All Enquiries - ${timestamp}`,
              });
              
              return { success: true, filePath: finalFilePath, isPDF: true };
            } else {
              throw new Error('Generated PDF file is empty');
            }
          } else {
            throw new Error(`PDF file was not created at: ${finalFilePath}`);
          }
        } else {
          throw new Error('PDF generation returned invalid file path');
        }
      } catch (pdfError) {
        // Log the error so we can debug why PDF generation is failing
        if (__DEV__) {
          console.error('========== PDF GENERATION ERROR (ALL ENQUIRIES) ==========');
          console.error('Error:', pdfError);
          console.error('Error message:', pdfError?.message);
          console.error('Error stack:', pdfError?.stack);
          console.error('HTML content length:', htmlContent?.length || 0);
          console.error('Number of enquiries:', enquiries?.length || 0);
        }
        
        // Check if it's a timeout error
        const isTimeoutError = pdfError?.message?.toLowerCase().includes('timeout') || 
                               pdfError?.message?.toLowerCase().includes('timed out');
        
        if (isTimeoutError) {
          // Timeout error - log warning and fall through to HTML fallback
          const htmlSizeMB = htmlContent ? (htmlContent.length / 1024 / 1024).toFixed(2) : 'unknown';
          if (__DEV__) {
            console.warn(`⚠️ PDF generation timed out for ${enquiries.length} enquiries (${htmlSizeMB}MB HTML). Falling back to HTML.`);
            console.warn(`💡 Tip: Export fewer enquiries at once (recommended: 50-100 enquiries per PDF) for better performance.`);
          }
          // Don't throw - let it fall through to HTML fallback below
        } else {
          // Other errors - log and fall through to HTML fallback
          if (__DEV__) {
            console.warn(`⚠️ PDF generation failed: ${pdfError?.message || pdfError?.toString()}. Falling back to HTML.`);
          }
        }
        // Fall through to HTML fallback instead of throwing
      }
    
    // Fallback: Save as HTML if PDF generation fails or library not available
    const htmlFilename = `${filename}.html`;
    const htmlFilePath = `${RNFS.DownloadDirectoryPath}/${htmlFilename}`;
    
    try {
      if (__DEV__) {
        console.warn('⚠️ Falling back to HTML format (PDF generation failed)');
        console.log('Saving as HTML file (fallback):', htmlFilePath);
        console.log('HTML content size:', htmlContent?.length || 0, 'characters');
      }
      
      await RNFS.writeFile(htmlFilePath, htmlContent, 'utf8');
      
      const fileExists = await RNFS.exists(htmlFilePath);
      if (!fileExists) {
        throw new Error('Failed to save HTML file');
      }
      
      const fileStats = await RNFS.stat(htmlFilePath);
      if (fileStats.size === 0) {
        throw new Error('Saved HTML file is empty');
      }
      
      // Determine the reason for HTML fallback
      const htmlSizeMB = htmlContent ? (htmlContent.length / 1024 / 1024).toFixed(2) : 'unknown';
      let fallbackReason = 'PDF generation unavailable';
      let conversionTip = '';
      
      // Check if it was a timeout (we can infer this from size/number of enquiries)
      if (enquiries.length > 100 || htmlContent.length > 200000) {
        fallbackReason = `PDF generation timed out (${enquiries.length} enquiries, ${htmlSizeMB}MB)`;
        conversionTip = `\n💡 Tip: For faster PDF generation, export fewer enquiries at once (50-100 recommended).\n\n`;
      }
      
      // Share the HTML file with instructions
      await Share.open({
        title: 'Download All Enquiries',
        message: `Enquiries List - ${enquiries.length} enquiries\n\n` +
                 `Note: File saved as HTML (${fallbackReason}).${conversionTip}` +
                 `To convert to PDF:\n` +
                 `1. Open the file in a browser\n` +
                 `2. Use browser's Print function (Ctrl+P / Cmd+P)\n` +
                 `3. Choose "Save as PDF" as the destination`,
        url: `file://${htmlFilePath}`,
        type: 'text/html',
        filename: htmlFilename,
        subject: `All Enquiries - ${timestamp}`,
      });
      
      return { success: true, filePath: htmlFilePath, isHTML: true };
    } catch (error) {
      throw error;
    }
  } catch (error) {
    if (error.message !== 'User did not share') {
      throw error;
    }
    return { success: false, cancelled: true };
  }
};

/**
 * Download enquiries PDF from backend endpoint
 * This function downloads PDF directly from the backend API, which handles
 * large datasets (100-200+ enquiries) more efficiently than client-side generation
 * 
 * @param {Object} filters - Query parameters/filters to pass to the backend
 * @param {Object} options - Additional options
 * @param {Function} options.onProgress - Optional progress callback
 * @returns {Promise<Object>} Result object with success status and file path
 */
export const downloadEnquiriesPDFFromBackend = async (filters = {}, options = {}) => {
  try {
    if (__DEV__) {
      console.log('========== DOWNLOADING PDF FROM BACKEND ==========');
      console.log('Filters:', filters);
    }

    // Get authentication token
    const token = await AsyncStorage.getItem('token');
    if (!token) {
      throw new Error('Authentication token not found. Please log in again.');
    }

    // Build query string from filters
    const queryParams = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '' && value !== 'all' && value !== 'All') {
        queryParams.append(key, String(value));
      }
    });

    const queryString = queryParams.toString();
    const url = `${API_BASE_URL}/api/enquiries/export-pdf${queryString ? `?${queryString}` : ''}`;

    if (__DEV__) {
      console.log('PDF Download URL:', url);
    }

    // Call progress callback if provided
    if (options.onProgress) {
      options.onProgress({ status: 'downloading', message: 'Downloading PDF from server...' });
    }

    // Make GET request with authentication
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/pdf',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Failed to download PDF';
      
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorJson.error || errorMessage;
      } catch (e) {
        // If response is not JSON, use status text
        errorMessage = response.statusText || errorMessage;
      }

      if (__DEV__) {
        console.log('PDF error response (first 500 chars):', (errorText || '').slice(0, 500));
      }

      throw new Error(`${errorMessage} (Status: ${response.status})`);
    }

    // Get the PDF as arrayBuffer (React Native compatible)
    const arrayBuffer = await response.arrayBuffer();

    if (options.onProgress) {
      options.onProgress({ status: 'processing', message: 'Processing PDF file...' });
    }

    // Convert arrayBuffer to base64 (React Native compatible approach)
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    
    // Convert bytes to binary string in chunks to avoid memory issues
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      // Use Array.from to avoid "Maximum call stack size exceeded" error
      binary += String.fromCharCode(...Array.from(chunk));
    }
    
    // Convert binary string to base64
    let base64;
    try {
      // Try btoa first (available in some React Native environments)
      if (typeof btoa !== 'undefined') {
        base64 = btoa(binary);
      } else if (typeof Buffer !== 'undefined') {
        // Fallback to Buffer (Node.js compatible)
        base64 = Buffer.from(binary, 'binary').toString('base64');
      } else {
        // Fallback to manual base64 encoding
        base64 = toBase64(binary);
      }
    } catch (e) {
      // If btoa fails, try Buffer or manual encoding
      if (typeof Buffer !== 'undefined') {
        base64 = Buffer.from(binary, 'binary').toString('base64');
      } else {
        base64 = toBase64(binary);
      }
    }

    // Create filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `Enquiries_Report_${timestamp}`;
    // iOS doesn't expose a public "Downloads" directory via react-native-fs.
    // Use DocumentDirectoryPath on iOS, Downloads on Android (fallback to Documents if missing).
    const baseDir =
      Platform.OS === 'ios'
        ? RNFS.DocumentDirectoryPath
        : (RNFS.DownloadDirectoryPath || RNFS.DocumentDirectoryPath);
    const fileUri = `${baseDir}/${filename}.pdf`;
    // Save file using react-native-fs
    await RNFS.writeFile(fileUri, base64, 'base64');

    // Verify file exists and is not empty
    const fileExists = await RNFS.exists(fileUri);
    if (!fileExists) {
      throw new Error('PDF file was not saved successfully');
    }

    const fileStats = await RNFS.stat(fileUri);
    if (fileStats.size === 0) {
      throw new Error('Saved PDF file is empty');
    }

    if (__DEV__) {
      console.log('✅ PDF downloaded successfully');
      console.log('File path:', fileUri);
      console.log('File size:', fileStats.size, 'bytes');
    }

    if (options.onProgress) {
      options.onProgress({ status: 'sharing', message: 'Opening share dialog...' });
    }

    // Share/open the PDF
    await Share.open({
      title: 'Download Enquiries PDF',
      message: `Enquiries Report - ${timestamp}`,
      url: `file://${fileUri}`,
      type: 'application/pdf',
      filename: filename,
      subject: `Enquiries Report - ${timestamp}`,
    });

    return {
      success: true,
      filePath: fileUri,
      filename: `${filename}.pdf`,
    };
  } catch (error) {
    if (__DEV__) {
      console.error('❌ PDF download error:', error);
    }

    // Handle user cancellation
    if (error.message === 'User did not share' || error.message?.includes('User did not share')) {
      return { success: false, cancelled: true };
    }

    // Re-throw other errors
    throw error;
  }
};

// Debug: Verify export is available
if (__DEV__) {
  console.log('pdfGenerator.js module fully loaded. Exports available:', {
    downloadAllEnquiriesPDF: typeof downloadAllEnquiriesPDF !== 'undefined' ? 'YES' : 'NO',
    downloadEnquiryPDF: typeof downloadEnquiryPDF !== 'undefined' ? 'YES' : 'NO',
    generateEnquiryHTML: typeof generateEnquiryHTML !== 'undefined' ? 'YES' : 'NO',
    generateEnquiriesListHTML: typeof generateEnquiriesListHTML !== 'undefined' ? 'YES' : 'NO',
    downloadEnquiriesPDFFromBackend: typeof downloadEnquiriesPDFFromBackend !== 'undefined' ? 'YES' : 'NO',
  });
}

