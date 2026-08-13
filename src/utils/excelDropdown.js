import JSZip from 'jszip';

// SheetJS (community) can't write Excel data-validation dropdowns, so we
// post-process the generated .xlsx: inject a <dataValidations> list on the
// given column, sourced from a (hidden) "Lists" sheet's column A.
export const injectStockTypeDropdown = async (
  base64,
  { sheetFile = 'xl/worksheets/sheet1.xml', column = 'J', firstRow = 2, lastRow = 200, options = [] },
) => {
  if (!options || options.length === 0) return base64;
  const zip = await JSZip.loadAsync(base64, { base64: true });
  const file = zip.file(sheetFile);
  if (!file) return base64;

  let xml = await file.async('string');
  const sqref = `${column}${firstRow}:${column}${lastRow}`;
  // Inline list (no cross-sheet reference) — safest for Excel. Escape XML-special chars.
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Excel caps formula1 at 255 chars — keep the first options (default first) that fit.
  let opts = options.slice();
  let list = opts.map(esc).join(',');
  while (list.length > 250 && opts.length > 1) {
    opts = opts.slice(0, -1);
    list = opts.map(esc).join(',');
  }
  const dv =
    `<dataValidations count="1">` +
    `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${sqref}">` +
    `<formula1>"${list}"</formula1>` +
    `</dataValidation></dataValidations>`;

  // Per the OOXML schema, <dataValidations> must appear AFTER sheetData/mergeCells/
  // conditionalFormatting but BEFORE hyperlinks/printOptions/pageMargins/…/ignoredErrors.
  // Insert it right before whichever of those trailing elements appears first.
  const anchors = [
    '<hyperlinks', '<printOptions', '<pageMargins', '<pageSetup',
    '<headerFooter', '<rowBreaks', '<colBreaks', '<ignoredErrors', '<drawing', '<extLst',
  ];
  let pos = -1;
  for (const a of anchors) {
    const i = xml.indexOf(a);
    if (i !== -1 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos !== -1) {
    xml = xml.slice(0, pos) + dv + xml.slice(pos);
  } else {
    xml = xml.replace('</worksheet>', `${dv}</worksheet>`);
  }

  zip.file(sheetFile, xml);
  return zip.generateAsync({ type: 'base64' });
};
