export const colors = {
  primary: '#143F45', // Brand color - Dark teal  
  primaryDark: '#0F3236', // Darker shade
  primaryLight: '#235A63', // Lighter shade
  secondary: '#8B4513', // Brown (complementary)
  accent: '#D4AF37', // Gold accent
  primaryExtraLight: '#E6F0F1',
  
  // Background colors
  background: '#FFFFFF',
  /** Catalog / secondary screen canvas (behind white cards) */
  backgroundSecondary: '#F8F9FB',
  backgroundDark: '#1A1A1A',
  
  // Text colors
  textPrimary: '#1A1A1A',
  textSecondary: '#6B7280',
  textLight: '#9CA3AF',
  textWhite: '#FFFFFF',
  textBlack: '#000000',
  
  // Status colors
  success: '#47b02c',
  error: '#EF4444',
  warning: '#ffbb34',
  orange: '#F59E0B',
  info: '#3B82F6',
  
  // Border colors
  border: '#E5E7EB',
  borderLight: '#F3F4F6',
  
  // Card colors
  cardBackground: '#FFFFFF',
  cardShadow: 'rgba(0, 0, 0, 0.1)',
  
  // Tab colors
  tabActive: '#103534', // Using brand color
  tabInactive: '#9CA3AF',
  
  // Modal colors
  modalOverlay: 'rgba(0, 0, 0, 0.5)',
  modalBackground: '#FFFFFF',
};

export const stoneColorMap = {
  'white': '#F5F5F5', 'diamond': '#F5F5F5', 'clear': '#F5F5F5',
  'green': '#E8F5E9', 'emerald': '#E8F5E9',
  'red': '#FFEBEE', 'ruby': '#FFEBEE',
  'blue': '#E3F2FD', 'sapphire': '#E3F2FD',
  'yellow': '#FFF8E1', 'canary': '#FFF8E1',
  'pink': '#FCE4EC', 'rose': '#FCE4EC',
  'purple': '#F3E5F5', 'amethyst': '#F3E5F5',
  'orange': '#FFF3E0', 'padparadscha': '#FFF3E0',
  'black': '#ECEFF1', 'brown': '#EFEBE9', 'champagne': '#EFEBE9',
  'peach': '#FDEBD0', 'mint': '#E0F2F1',
  'grey': '#ECEFF1', 'gray': '#ECEFF1',
  'lilac': '#EDE7F6', 'coral': '#FBE9E7',
};

export const getStoneBg = (color) => {
  const key = (color || '').trim().toLowerCase();
  return stoneColorMap[key] || '';
};
