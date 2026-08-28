import { colors, fonts } from '../constants';

export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(amount);
};

export const formatDate = (dateString) => {
  if (!dateString) {
    return 'No date';
  }
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    if (date.getFullYear() < 2000) {
      return 'No date';
    }
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch (error) {
    return 'Invalid date';
  }
};

export const formatDateTime = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Enquiries have no stored CreatedDate at the top level; the real creation
// timestamp lives in the Mongo ObjectId (its first 4 bytes are a Unix time).
export const objectIdToDate = (id) => {
  const hex = String(id || '');
  if (!/^[0-9a-fA-F]{24}$/.test(hex)) return null;
  const seconds = parseInt(hex.substring(0, 8), 16);
  if (isNaN(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
};

export const excelSerialToDate = (serial) => {
  if (serial == null || isNaN(serial)) return null;
  return new Date((Number(serial) - 25569) * 86400 * 1000);
};

export const formatChatDate = (dateString) => {
  if (!dateString) return "";

  const date = new Date(dateString);
  const now = new Date();
  // Create simple date values without time
  const d = date.toDateString();
  const n = now.toDateString();

  // ---- TODAY ----
  if (d === n) {
    return date.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }

  // ---- YESTERDAY ----
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  if (d === yesterday.toDateString()) {
    return "Yesterday";
  }

  // ---- OTHER DATES ----
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
};


export const getStatusColor = (status) => {
  const statusColors = {
    pending: colors.warning,
    completed: colors.success,
    rejected: colors.error,
  };
  return statusColors[status] || colors.textSecondary;
};

/** Color for load/percentage bars — multi-stop heat map */
export const getLoadColor = (pct) => {
  if (pct >= 85) return colors.error;
  if (pct >= 70) return colors.orange;
  if (pct >= 50) return colors.warning;
  if (pct >= 25) return colors.info;
  return colors.success;
};

export const getPriorityColor = (priority) => {
  const priorityLower = (priority || '').toLowerCase().trim();
  const priorityColors = {
    'normal': colors.success,
    'high': colors.error,
    'super high': colors.error,
    // Legacy support
    'low': colors.success,
    'medium': colors.warning,
    'urgent': colors.error,
    'super urgent': colors.error,
  };
  return priorityColors[priorityLower] || colors.textSecondary;
};

export const getRoleDisplayName = (role) => {
  const roleNames = {
    admin: 'Administrator',
    client: 'Client',
    coral: 'Coral Designer',
    cad: 'CAD Designer',
    client_handler: 'Client Handler',
  };
  return roleNames[role] || role;
};

export const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePassword = (password) => {
  return password.length >= 6;
};

export const truncateText = (text, maxLength) => {
  if (text.length <= maxLength) return text;
  return text.substr(0, maxLength) + '...';
};

export const formatCount = (count) => {
  const num = parseInt(count) || 0;
  
  if (num >= 10000000) { // 1 Crore
    return (num / 10000000).toFixed(1).replace(/\.0$/, '') + 'Cr';
  } else if (num >= 100000) { // 1 Lac
    return (num / 100000).toFixed(1).replace(/\.0$/, '') + 'L';
  } else if (num >= 1000) { // 1 Thousand
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  
  return num.toString();
};

// Base64 decode function for React Native (no atob available)
const base64Decode = (str) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  
  str = str.replace(/[^A-Za-z0-9\+\/\=]/g, '');
  
  for (let i = 0; i < str.length; i += 4) {
    const enc1 = chars.indexOf(str.charAt(i));
    const enc2 = chars.indexOf(str.charAt(i + 1));
    const enc3 = chars.indexOf(str.charAt(i + 2));
    const enc4 = chars.indexOf(str.charAt(i + 3));
    
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    
    output += String.fromCharCode(chr1);
    
    if (enc3 !== 64) {
      output += String.fromCharCode(chr2);
    }
    if (enc4 !== 64) {
      output += String.fromCharCode(chr3);
    }
  }
  
  return output;
};

// Decode JWT token without verification (client-side only)
export const decodeJWT = (token) => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }
    
    const base64Url = parts[1];
    if (!base64Url) {
      throw new Error('Invalid token format');
    }
    
    // Replace URL-safe base64 characters
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    
    // Add padding if needed
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    
    // Decode base64
    const decoded = base64Decode(padded);
    
    // Convert to JSON
    const jsonPayload = decodeURIComponent(
      decoded
        .split('')
        .map((c) => {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join('')
    );
    
    return JSON.parse(jsonPayload);
  } catch (error) {
    return null;
  }
};

// Role cache for dynamic role mapping from API
let rolesCache = [];
let rolesMapCache = {};

// Fallback role map (hardcoded for backward compatibility)
const FALLBACK_ROLE_MAP = {
    1: 'admin',
    2: 'coral',
    3: 'cad',
    4: 'client',
    5: 'client_handler',
    6: 'order_placement',
};

/**
 * Set roles cache from API response
 * @param {Array} roles - Array of role objects from API
 */
export const setRolesCache = (roles) => {
  if (!Array.isArray(roles) || roles.length === 0) {
    
    return;
  }

  rolesCache = roles;
  
  // Build map cache: { roleNumber: roleString }
  rolesMapCache = {};
  roles.forEach(role => {
    const roleNumber = role.id || role.Id;
    const roleCode = (role.code || role.Code || '').toLowerCase();
    
    if (roleNumber) {
      // Map role code to role string
      let roleString = null;
      if (roleCode === 'ad') {
        roleString = 'admin';
      } else if (roleCode === 'co') {
        roleString = 'coral';
      } else if (roleCode === 'cd') {
        roleString = 'cad';
      } else if (roleCode === 'cl') {
        roleString = 'client';
      } else if (roleCode === 'ch') {
        roleString = 'client_handler';
      } else if (roleNumber === 5) {
        roleString = 'client_handler';
      }
      
      if (roleString) {
        rolesMapCache[roleNumber] = roleString;
      }
    }
  });

  if (__DEV__) {
    console.log('✅ Roles cache updated:', {
      rolesCount: rolesCache.length,
      mapCache: rolesMapCache,
    });
  }
};

// Map role number from API to role string
export const mapRoleNumberToString = (roleNumber) => {
  // First try dynamic cache from API
  if (rolesMapCache[roleNumber]) {
    
    return rolesMapCache[roleNumber];
  }
  
  // Fallback to hardcoded map
  if (FALLBACK_ROLE_MAP[roleNumber]) {
    
    return FALLBACK_ROLE_MAP[roleNumber];
  }
  
  
  return null;
};

/**
 * Format enquiry history details for display
 * Parses "from X to Y" patterns and formats JSON objects
 * @param {string} details - Raw details string from history
 * @returns {string} Formatted, user-friendly details
 */
export const formatHistoryDetails = (details) => {
  if (!details || details === '-') return '-';
  
  // Handle simple messages (no "from/to" pattern)
  if (!details.includes('from') && !details.includes('to')) {
    return details;
  }
  
  try {
    // Extract quoted values that may contain JSON
    const extractQuotedString = (str, startIndex) => {
      if (str[startIndex] !== '"') return null;
      
      let i = startIndex + 1;
      let braceCount = 0;
      
      while (i < str.length) {
        const char = str[i];
        const prevChar = i > 0 ? str[i - 1] : '';
        
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        
        // Found closing quote - but only if we're not inside JSON braces
        // or if the JSON is complete (braceCount === 0)
        if (char === '"' && prevChar !== '\\') {
          // Check if this is the closing quote for the entire value
          // Look ahead to see if there's a "to" keyword
          const remaining = str.substring(i + 1).trim();
          if (braceCount === 0 || remaining.startsWith('to') || remaining.startsWith(',') || remaining === '') {
            return {
              value: str.substring(startIndex + 1, i),
              endIndex: i + 1
            };
          }
        }
        
        i++;
      }
      
      return null;
    };
    
    // Parse a single change: "FieldName: from "value" to "value""
    const parseChange = (text, startPos = 0) => {
      const fromIndex = text.indexOf('from', startPos);
      if (fromIndex === -1) return null;
      
      // Get field name (everything before "from" up to the last colon)
      const beforeFrom = text.substring(0, fromIndex);
      const colonIndex = beforeFrom.lastIndexOf(':');
      if (colonIndex === -1) return null;
      
      // Get field name - handle comma-separated fields
      const commaIndex = beforeFrom.lastIndexOf(',', colonIndex);
      const fieldNameStart = commaIndex >= 0 ? commaIndex + 1 : 0;
      const fieldName = text.substring(fieldNameStart, colonIndex).trim();
      
      // Extract "from" value
      const fromQuoteIndex = text.indexOf('"', fromIndex);
      if (fromQuoteIndex === -1) return null;
      
      const fromResult = extractQuotedString(text, fromQuoteIndex);
      if (!fromResult) return null;
      
      // Find "to"
      const toIndex = text.indexOf('to', fromResult.endIndex);
      if (toIndex === -1) return null;
      
      // Extract "to" value
      const toQuoteIndex = text.indexOf('"', toIndex);
      if (toQuoteIndex === -1) return null;
      
      const toResult = extractQuotedString(text, toQuoteIndex);
      if (!toResult) return null;
      
      return {
        fieldName,
        fromValue: fromResult.value,
        toValue: toResult.value,
        endIndex: toResult.endIndex
      };
    };
    
    // Parse all changes in the string
    const changes = [];
    let pos = 0;
    
    while (pos < details.length) {
      const change = parseChange(details, pos);
      if (!change) break;
      
      changes.push(change);
      pos = change.endIndex;
      
      // Skip to next potential change (after comma if present)
      const nextComma = details.indexOf(',', pos);
      if (nextComma !== -1) {
        pos = nextComma + 1;
      } else {
        break;
      }
    }
    
    if (changes.length > 0) {
      return changes.map(({ fieldName, fromValue, toValue }) => 
        formatFieldChange(fieldName, fromValue, toValue)
      ).join('\n');
    }
    
    return details;
  } catch (error) {
    return details;
  }
};

/**
 * Format a single field change
 * @param {string} fieldName - Name of the field
 * @param {string} fromValue - Old value
 * @param {string} toValue - New value
 * @returns {string} Formatted change description
 */
const formatFieldChange = (fieldName, fromValue, toValue) => {
  // Try to parse JSON values
  let formattedFrom = fromValue;
  let formattedTo = toValue;
  
  // Check if values are JSON objects
  try {
    if (fromValue.startsWith('{') && fromValue.endsWith('}')) {
      const parsed = JSON.parse(fromValue);
      formattedFrom = formatJsonValue(parsed);
    }
  } catch (e) {
    // Not valid JSON, use as-is
  }
  
  try {
    if (toValue.startsWith('{') && toValue.endsWith('}')) {
      const parsed = JSON.parse(toValue);
      formattedTo = formatJsonValue(parsed);
    }
  } catch (e) {
    // Not valid JSON, use as-is
  }
  
  // Handle empty/null values
  if (!formattedFrom || formattedFrom === 'null' || formattedFrom === '""') {
    formattedFrom = '(empty)';
  }
  if (!formattedTo || formattedTo === 'null' || formattedTo === '""') {
    formattedTo = '(empty)';
  }
  
  return `${fieldName}: ${formattedFrom} → ${formattedTo}`;
};

/**
 * Format JSON object to readable string
 * @param {object} obj - JSON object
 * @returns {string} Formatted string
 */
const formatJsonValue = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return String(obj || '(empty)');
  }
  
  // Handle common object structures
  if (obj.Color && obj.Quality) {
    // Metal object
    const color = obj.Color || '';
    const quality = obj.Quality || '';
    if (color && quality) {
      return `${color} ${quality}`;
    } else if (color) {
      return color;
    } else if (quality) {
      return quality;
    }
    return '(empty)';
  }
  
  if (obj.From !== undefined || obj.To !== undefined || obj.Exact !== undefined) {
    // Weight object
    const parts = [];
    if (obj.Exact) {
      parts.push(`Exact: ${obj.Exact}`);
    } else {
      if (obj.From) parts.push(`From: ${obj.From}`);
      if (obj.To) parts.push(`To: ${obj.To}`);
    }
    return parts.length > 0 ? parts.join(', ') : '(empty)';
  }
  
  // Generic object - format key-value pairs
  const pairs = Object.entries(obj)
    .filter(([_, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${value}`);
  
  return pairs.length > 0 ? pairs.join(', ') : '(empty)';
};
