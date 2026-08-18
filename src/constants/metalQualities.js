// Quality must always be a plain string. Pickers hand back a bare value or a
// { label, value } option, and an API response can carry a { Quality } object.
export const toQualityString = v => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return String(v.value ?? v.Quality ?? v.label ?? '');
  return String(v);
};

export const METAL_QUALITY_OPTIONS = [
  { label: '3K', value: '3K' },
  { label: '9K', value: '9K' },
  { label: '10K', value: '10K' },
  { label: '14K', value: '14K' },
  { label: '18K', value: '18K' },
  { label: '22K', value: '22K' },
  { label: 'Silver 925', value: 'Silver 925' },
  { label: 'Platinum', value: 'Platinum' },
];
