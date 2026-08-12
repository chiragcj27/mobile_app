
const LAB_PATTERNS = [/lab/i, /cvd/i, /hpht/i];

const classifyType = (type) => {
  for (const pattern of LAB_PATTERNS) {
    if (pattern.test(type)) return 'LabGrown';
  }
  return 'Natural';
};

export const buildStoneCategoryMap = (applicableStoneTypes = []) =>
  applicableStoneTypes.reduce((map, type) => {
    map[type] = classifyType(type);
    return map;
  }, {});

export const getStoneCategory = (type, categoryMap = {}) => {
  if (!type) return 'Unknown';
  if (categoryMap[type]) return categoryMap[type];
  return classifyType(type);
};

export const getStoneCategoryLabel = (category) => {
  switch (category) {
    case 'Natural': return 'Natural';
    case 'LabGrown': return 'Lab Grown';
    default: return category;
  }
};

export const getClientStoneOptions = (stoneTypesData = [], selectedClient = null) => {
  const applicable = selectedClient?.ApplicableStoneTypes || [];
  return stoneTypesData
    .filter(st => applicable.length === 0 || applicable.includes(st.value))
    .map(st => ({ label: st.label, value: st.value }));
};
