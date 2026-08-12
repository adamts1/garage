// @vitest-environment jsdom

/* The export is a file that leaves the building. Nobody here can open Excel, so
   what is checked is the container: that it is a real zip, that every part an
   .xlsx needs is in it, and that the parts say what they should. A file Excel
   refuses is indistinguishable from a broken button, and the person who finds
   out is the bookkeeper.

   The zip is read back through a minimal central-directory walk rather than
   through the writer's own internals, so a header written wrong is caught here
   rather than in Excel. */

import { describe, expect, it } from 'vitest';
import { xlsxBlob, type XlsxSheet } from './xlsx';

/* ---------------- a small zip reader ---------------- */

const u16 = (b: DataView, at: number) => b.getUint16(at, true);
const u32 = (b: DataView, at: number) => b.getUint32(at, true);

/** name → text, walked from the end-of-central-directory record. */
const unzip = (bytes: Uint8Array): Map<string, string> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The EOCD is the last 22 bytes when there is no zip comment, which is our case.
  const eocd = bytes.length - 22;
  expect(u32(view, eocd)).toBe(0x06054b50);

  const count = u16(view, eocd + 10);
  const size = u32(view, eocd + 12);
  let at = u32(view, eocd + 16);

  /* The invariant a lenient reader skips and a strict one enforces: the
     directory must end exactly where its own record begins. Getting this wrong
     is invisible to a reader that trusts the offset alone — which is how a file
     that unzipped here was rejected by Python and by Excel. */
  expect(at + size).toBe(eocd);

  const decoder = new TextDecoder();
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(u32(view, at)).toBe(0x02014b50);          // central directory header
    const method = u16(view, at + 10);
    expect(method).toBe(0);                           // stored, so no inflate here
    const size = u32(view, at + 24);
    const nameLength = u16(view, at + 28);
    const extraLength = u16(view, at + 30);
    const commentLength = u16(view, at + 32);
    const localAt = u32(view, at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    // The local header repeats the name and may carry its own extra field.
    expect(u32(view, localAt)).toBe(0x04034b50);
    const localNameLength = u16(view, localAt + 26);
    const localExtraLength = u16(view, localAt + 28);
    const dataAt = localAt + 30 + localNameLength + localExtraLength;
    out.set(name, decoder.decode(bytes.subarray(dataAt, dataAt + size)));

    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
};

const read = async (sheet: XlsxSheet) =>
  unzip(new Uint8Array(await xlsxBlob(sheet).arrayBuffer()));

const sheet = (over: Partial<XlsxSheet> = {}): XlsxSheet => ({
  name: 'הכנסות',
  columns: [
    { header: 'לקוח', width: 28 },
    { header: 'כרטיסים', format: 'int' },
    { header: 'סה״כ', format: 'money' },
  ],
  rows: [['דנה כהן', 3, 1180.5]],
  ...over,
});

describe('the workbook container', () => {
  it('carries every part an .xlsx needs', async () => {
    const parts = await read(sheet());
    for (const name of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      expect(parts.has(name), `missing ${name}`).toBe(true);
    }
  });

  it('is a zip whose entries are intact', async () => {
    // unzip() asserts both signatures and the stored method for every entry;
    // reaching here with content means the offsets and sizes line up too.
    const parts = await read(sheet());
    expect(parts.get('xl/workbook.xml')).toContain('<sheets>');
  });

  it('has a media type Excel will accept', () => {
    expect(xlsxBlob(sheet()).type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });
});

/* The reason this module exists. */
describe('direction', () => {
  it('opens the sheet right to left', async () => {
    const parts = await read(sheet());
    expect(parts.get('xl/worksheets/sheet1.xml')).toContain('rightToLeft="1"');
  });
});

describe('the sheet itself', () => {
  it('writes numbers as numbers, not as text', async () => {
    const xmlText = (await read(sheet())).get('xl/worksheets/sheet1.xml')!;

    // A money cell is a bare <v>: selecting the column in Excel gives a sum.
    expect(xmlText).toContain('<v>1180.5</v>');
    // and it is not wrapped as an inline string anywhere
    expect(xmlText).not.toContain('<t xml:space="preserve">1180.5</t>');
  });

  it('gives money and counts different formats', async () => {
    const xmlText = (await read(sheet())).get('xl/worksheets/sheet1.xml')!;
    expect(xmlText).toContain('<c r="B2" s="3"><v>3</v></c>');        // whole numbers
    expect(xmlText).toContain('<c r="C2" s="2"><v>1180.5</v></c>');   // two decimals
  });

  /* A header is a string, and strings used to be forced to the plain style —
     which quietly dropped the bold from every heading in every report. */
  it('sets the header row in the bold style', async () => {
    const xmlText = (await read(sheet())).get('xl/worksheets/sheet1.xml')!;
    expect(xmlText).toContain('<c r="A1" s="1"');
    expect(xmlText).toContain('<c r="C1" s="1"');
  });

  /* The bug the CSV had: nothing quoted its fields, so one comma in a customer
     name shifted every column after it for that row. */
  it('survives a comma, a quote and an ampersand in a name', async () => {
    const parts = await read(sheet({ rows: [['כהן, דנה & בניו "בע״מ"', 1, 2]] }));
    const xmlText = parts.get('xl/worksheets/sheet1.xml')!;

    expect(xmlText).toContain('כהן, דנה &amp; בניו &quot;בע״מ&quot;');
    // one row of three cells, whatever it contained
    expect(xmlText.match(/<row r="2">/g)).toHaveLength(1);
    expect(xmlText.match(/<c r="[A-C]2"/g)).toHaveLength(3);
  });

  it('keeps Hebrew readable rather than escaping it away', async () => {
    const parts = await read(sheet());
    expect(parts.get('xl/worksheets/sheet1.xml')).toContain('דנה כהן');
    expect(parts.get('xl/workbook.xml')).toContain('הכנסות');
  });

  it('names the tab, within what Excel allows', async () => {
    const parts = await read(sheet({ name: 'דוח/הכנסות[2026]' }));
    const book = parts.get('xl/workbook.xml')!;
    expect(book).toContain('name="דוח הכנסות 2026"');
  });

  it('writes an empty sheet without inventing rows', async () => {
    const xmlText = (await read(sheet({ rows: [] }))).get('xl/worksheets/sheet1.xml')!;
    expect(xmlText).toContain('<row r="1">');   // the header still stands
    expect(xmlText).not.toContain('<row r="2">');
  });

  it('leaves a blank cell blank rather than writing the word undefined', async () => {
    const xmlText = (await read(sheet({ rows: [['דנה', null, undefined]] }))).get('xl/worksheets/sheet1.xml')!;
    expect(xmlText).toContain('<c r="B2" s="3"/>');
    expect(xmlText).not.toContain('undefined');
  });

  /* Past column Z the letters carry, and a report that grows a column would
     otherwise write a cell reference Excel rejects. */
  it('numbers columns past Z correctly', async () => {
    const columns = Array.from({ length: 28 }, (_, i) => ({ header: `c${i}` }));
    const xmlText = (await read(sheet({ columns, rows: [columns.map((_, i) => i)] })))
      .get('xl/worksheets/sheet1.xml')!;

    expect(xmlText).toContain('<c r="Z1"');
    expect(xmlText).toContain('<c r="AA1"');
    expect(xmlText).toContain('<c r="AB1"');
  });
});
