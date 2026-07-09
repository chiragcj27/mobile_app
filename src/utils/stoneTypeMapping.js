const STONE_CATEGORY_MAP = {
  NaturalRegular: 'Natural',
  NaturalLower: 'Natural',
  NaturalHigher: 'Natural',
  Natural: 'Natural',
  type1: 'Natural',
  type2: 'Natural',
  type3: 'Natural',
  Diamond: 'Natural',
  Moissanite: 'Natural',
  Other: 'Natural',
  CVDLabGrown: 'LabGrown',
  HPHTLabGrown: 'LabGrown',
  LabGrown: 'LabGrown',
  CVD: 'LabGrown',
};

const LAB_PATTERNS = [/lab/i, /cvd/i, /hpht/i];

export const getStoneCategory = (type) => {
  if (!type) return 'Unknown';
  const mapped = STONE_CATEGORY_MAP[type];
  if (mapped) return mapped;
  for (const pattern of LAB_PATTERNS) {
    if (pattern.test(type)) return 'LabGrown';
  }
  return 'Natural';
};

export const getStoneCategoryLabel = (category) => {
  switch (category) {
    case 'Natural': return 'Natural';
    case 'LabGrown': return 'Lab Grown';
    default: return category;
  }
};
