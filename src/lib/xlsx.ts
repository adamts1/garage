/* A spreadsheet a Hebrew-speaking bookkeeper can read: real .xlsx, laid out
   right to left.

   WHY NOT CSV, WHICH THIS REPLACED

   A .csv is a text file. It has no sheet, so it has no direction — Excel opens
   it left to right whatever is in it, and a Hebrew report arrives with its first
   column against the wrong edge and its numbers running away from the labels.
   There is no flag, no delimiter and no encoding that changes that: direction is
   a property of a worksheet, and a text file does not have one.

   Three other things came free with the format:

   - Numbers are numbers. The old export wrote `net.toFixed(2)`, so every money
     column arrived as text and a bookkeeper who selected it got no sum. Here a
     number is written as a number and formatted by the sheet.
   - Commas stop breaking rows. Nothing here quoted its fields, so a customer
     called "כהן, דנה" shifted every column after it by one for that row alone —
     a silent corruption in a financial report, on exactly the rows that most
     needed reading.
   - No byte-order-mark folklore. Encoding is declared, not guessed.

   WHY IT IS WRITTEN OUT BY HAND

   An .xlsx is a zip of XML parts. The zip here is stored, not deflated — a
   report is a few dozen kilobytes and CompressionStream would make this async
   for no gain — which leaves a CRC and two headers as the only real work. That
   is ~80 lines against a spreadsheet dependency measured in hundreds of
   kilobytes, in a bundle a garage loads over cellular.

   Everything below is the minimum an .xlsx needs: the content types, the two
   relationship parts, a workbook, one worksheet and a style sheet. */

export type XlsxValue = string | number | null | undefined;

export interface XlsxColumn {
  /** Already translated — this module holds no i18n. */
  header: string;
  /** Width in characters. Excel's default of 8.43 truncates a Hebrew name. */
  width?: number;
  /** How a numeric cell is displayed. Text cells ignore it. */
  format?: 'money' | 'int';
}

export interface XlsxSheet {
  /** The tab's name. Sanitised — Excel refuses []:*?/\ and anything over 31. */
  name: string;
  columns: XlsxColumn[];
  rows: XlsxValue[][];
}

/* ---------------- XML ---------------- */

const xml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string),
  )
  // XML 1.0 forbids most control characters outright, and a stray one makes the
  // whole file unopenable rather than the one cell wrong.
  // Tab, newline and carriage return are the three XML allows, and are kept.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** 0 → A, 25 → Z, 26 → AA. Column letters are base-26 with no zero digit. */
const columnLetter = (index: number): string => {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
};

/** Excel refuses these outright, and silently mangles a name over 31 characters. */
const sheetName = (name: string): string =>
  (name.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet1').slice(0, 31);

/* Style indices, matching cellXfs below in order:
   0 general · 1 bold (the header) · 2 money · 3 whole numbers. */
const STYLE = { plain: 0, header: 1, money: 2, int: 3 } as const;

const styleFor = (col: XlsxColumn | undefined): number =>
  col?.format === 'money' ? STYLE.money : col?.format === 'int' ? STYLE.int : STYLE.plain;

const cell = (ref: string, value: XlsxValue, style: number): string => {
  if (value === null || value === undefined || value === '') {
    // An empty cell still carries its style, so a blank in a money column does
    // not break the column's formatting for the rows below it.
    return `<c r="${ref}" s="${style}"/>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  /* Inline strings rather than a shared-strings table. A shared table pays off
     when the same text repeats thousands of times; a report of customer names
     is the case where it does not, and it costs a whole extra part.

     Carries the column's style like any other cell. It used to be forced to
     `plain` to keep a number format off a text cell — which also stripped the
     bold off every header, since a header is a string. A number format has no
     effect on text anyway: Excel shows it as typed. */
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
};

const worksheet = (sheet: XlsxSheet): string => {
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`)
    .join('');

  const header = sheet.columns
    .map((c, i) => cell(`${columnLetter(i)}1`, c.header, STYLE.header))
    .join('');

  const body = sheet.rows
    .map((row, r) =>
      `<row r="${r + 2}">${row
        .map((v, i) => cell(`${columnLetter(i)}${r + 2}`, v, styleFor(sheet.columns[i])))
        .join('')}</row>`,
    )
    .join('');

  const lastColumn = columnLetter(Math.max(sheet.columns.length - 1, 0));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView rightToLeft="1" tabSelected="1" workbookViewId="0">
<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData><row r="1">${header}</row>${body}</sheetData>
<autoFilter ref="A1:${lastColumn}${sheet.rows.length + 1}"/>
</worksheet>`;
};

/* `rightToLeft="1"` above is the whole point of this module. It is a property of
   the sheet VIEW: column A sits at the right edge, the columns run leftwards,
   and the freeze and the filter follow. It cannot be expressed in a text file,
   which is why the export changed format rather than gaining an option. */

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
// The <cellStyles> entry names the default style. Excel copes without it;
// stricter readers warn that the workbook has none and substitute their own.
// numFmtId 4 is Excel's built-in #,##0.00 and 3 is #,##0. Built-ins need no
// <numFmts> declaration, which is one fewer part to get wrong.

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const workbook = (name: string): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

/* ---------------- the zip ---------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A zip with every entry stored uncompressed. See the note at the top for why. */
const zip = (files: Array<{ name: string; text: string }>): Blob => {
  const encoder = new TextEncoder();
  const entries = files.map((f) => {
    const data = encoder.encode(f.text);
    return { name: encoder.encode(f.name), data, crc: crc32(data) };
  });

  const localSize = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((n, e) => n + 46 + e.name.length, 0);
  const buffer = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(buffer.buffer);
  let at = 0;

  const u16 = (v: number) => { view.setUint16(at, v, true); at += 2; };
  const u32 = (v: number) => { view.setUint32(at, v, true); at += 4; };
  const bytes = (v: Uint8Array) => { buffer.set(v, at); at += v.length; };

  // 1980-01-01. A zero date is technically invalid and some readers complain.
  const DOS_DATE = 0x0021;

  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(at);
    u32(0x04034b50);          // local file header
    u16(20);                  // version needed
    u16(0);                   // flags
    u16(0);                   // method: stored
    u16(0); u16(DOS_DATE);    // time, date
    u32(e.crc);
    u32(e.data.length);       // compressed == uncompressed
    u32(e.data.length);
    u16(e.name.length);
    u16(0);                   // extra field length
    bytes(e.name);
    bytes(e.data);
  }

  const centralStart = at;
  entries.forEach((e, i) => {
    u32(0x02014b50);          // central directory header
    u16(20); u16(20);         // version made by, version needed
    u16(0); u16(0);           // flags, method
    u16(0); u16(DOS_DATE);
    u32(e.crc);
    u32(e.data.length); u32(e.data.length);
    u16(e.name.length);
    u16(0); u16(0);           // extra, comment
    u16(0);                   // disk number
    u16(0); u32(0);           // internal, external attributes
    u32(offsets[i]);
    bytes(e.name);
  });

  /* Taken BEFORE the record below is written. `at` moves as the record is
     written, so measuring the directory from inside it makes it 12 bytes too
     long — and a reader that trusts the size (Python's zipfile does, to detect
     a zip appended to something else) then looks for the directory 12 bytes
     early and reports the whole file as corrupt. */
  const centralEnd = at;

  u32(0x06054b50);            // end of central directory
  u16(0); u16(0);             // this disk, disk holding the directory
  u16(entries.length); u16(entries.length);
  u32(centralEnd - centralStart);
  u32(centralStart);
  u16(0);                     // no zip comment

  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

/* ---------------- what the reports call ---------------- */

/** The workbook as a Blob. Separate from the download so it can be tested. */
export const xlsxBlob = (sheet: XlsxSheet): Blob => {
  const name = sheetName(sheet.name);
  return zip([
    { name: '[Content_Types].xml', text: CONTENT_TYPES },
    { name: '_rels/.rels', text: ROOT_RELS },
    { name: 'xl/workbook.xml', text: workbook(name) },
    { name: 'xl/_rels/workbook.xml.rels', text: WORKBOOK_RELS },
    { name: 'xl/styles.xml', text: STYLES },
    { name: 'xl/worksheets/sheet1.xml', text: worksheet(sheet) },
  ]);
};

/** Build the workbook and hand it to the browser. `filename` gains .xlsx. */
export const downloadXlsx = (filename: string, sheet: XlsxSheet): void => {
  const url = URL.createObjectURL(xlsxBlob(sheet));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
};
