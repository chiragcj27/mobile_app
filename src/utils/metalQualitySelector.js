const selectors = new Map();

export const selectQuality = (key, quality, seedCurrent) => {
  const k = String(key);
  const existing = selectors.get(k);

  if (!existing) {
    selectors.set(k, { current: seedCurrent || quality, updated: quality });
  } else if (quality && quality !== existing.updated) {
    selectors.set(k, { current: existing.updated, updated: quality });
  }

  return selectors.get(k);
};

export const getSelectedQuality = (key) => selectors.get(String(key)) || null;

export const commitQuality = (key) => {
  const k = String(key);
  const existing = selectors.get(k);
  if (existing) selectors.set(k, { current: existing.updated, updated: existing.updated });
};

export const resetSelectedQuality = (key) => {
  if (key === undefined) selectors.clear();
  else selectors.delete(String(key));
};
