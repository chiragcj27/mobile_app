export const isNonKaratMetal = quality => /silver|platinum/i.test(String(quality || ''));

export const getMetalRateLabel = quality => {
  const q = String(quality || '');
  if (/silver/i.test(q)) return 'Silver Rate ($/g)';
  if (/platinum/i.test(q)) return 'Platinum Rate ($/g)';
  return '24K Rate ($/g)';
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
