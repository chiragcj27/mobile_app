// Quality must always be a plain string in one of the values the backend
// matches on: 3K/9K/10K/14K/18K/22K, Silver 925, Platinum. Pickers hand back a
// bare value or a { label, value } option, an API response can carry a
// { Quality } object, and stored enquiries can hold loose forms like SILVER or
// 18KT.
export const toQualityString = v => {
  if (v == null) return '';
  const raw =
    typeof v === 'string'
      ? v
      : typeof v === 'object'
        ? String(v.value ?? v.Quality ?? v.label ?? '')
        : String(v);

  const t = raw.trim();
  if (!t) return '';
  if (/silver/i.test(t)) return 'Silver 925';
  if (/plat/i.test(t)) return 'Platinum';
  const karat = t.match(/(\d+)\s*K/i) || t.match(/^(\d+)$/);
  return karat ? `${karat[1]}K` : t;
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
