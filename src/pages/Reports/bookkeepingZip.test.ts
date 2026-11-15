import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { collectFiles, makeZip, zipName } from './bookkeepingZip';

const bytes = (n: number) => new Uint8Array(n).fill(65);
const ready = {
  status: 'ready' as const,
  files: ['movein.dat', 'heshin.dat', 'heshin.prm'] as ('movein.dat' | 'heshin.dat' | 'heshin.prm')[],
  fileSizes: { 'movein.dat': 10, 'heshin.dat': 5, 'heshin.prm': 3 },
};
const fetchOk = async (f: string) => bytes(ready.fileSizes[f as keyof typeof ready.fileSizes]);

describe('zipName', () => {
  it('names the garage, the software and the period', () => {
    expect(zipName('testing', 'ריווחית', { startDate: '2026-10-01', endDate: '2026-10-31' }))
      .toBe('testing_ריווחית_2026-10-01_2026-10-31.zip');
  });
  it('makes a garage name safe for a file system', () => {
    expect(zipName('מוסך א/ב: "תל אביב"', null, { startDate: '2026-10-01', endDate: '2026-10-31' }))
      .toBe('מוסך-א-ב-תל-אביב_2026-10-01_2026-10-31.zip');
  });
});

describe('collectFiles', () => {
  it('collects every file of a ready export', async () => {
    const files = await collectFiles(ready, fetchOk);
    expect(Object.keys(files)).toEqual(['movein.dat', 'heshin.dat', 'heshin.prm']);
  });
  it('refuses an export that is not ready', async () => {
    await expect(collectFiles({ ...ready, status: 'requested' }, fetchOk)).rejects.toThrow(/not ready/);
  });
  it('stops on a file that cannot be downloaded', async () => {
    const failing = async (f: string) => {
      if (f === 'heshin.dat') throw new Error('heshin.dat: download failed (404)');
      return fetchOk(f);
    };
    await expect(collectFiles(ready, failing)).rejects.toThrow(/heshin\.dat/);
  });
  it('stops on an empty file', async () => {
    const empty = async (f: string) => (f === 'heshin.prm' ? bytes(0) : fetchOk(f));
    await expect(collectFiles(ready, empty)).rejects.toThrow(/heshin\.prm is empty/);
  });
  it('stops on a file whose size differs from what was stored', async () => {
    const short = async (f: string) => (f === 'movein.dat' ? bytes(9) : fetchOk(f));
    await expect(collectFiles(ready, short)).rejects.toThrow(/movein\.dat is 9 bytes but 10/);
  });
  it('accepts an old export with no recorded sizes', async () => {
    const old = { status: 'ready' as const, files: ['movein.dat' as const], fileSizes: null };
    await expect(collectFiles(old, async () => bytes(7))).resolves.toHaveProperty('movein.dat');
  });
});

describe('makeZip', () => {
  it('holds exactly the files, under their exact names, byte for byte', async () => {
    const files = await collectFiles(ready, fetchOk);
    const back = unzipSync(await makeZip(files));
    expect(Object.keys(back).sort()).toEqual(['heshin.dat', 'heshin.prm', 'movein.dat']);
    expect(back['movein.dat']).toEqual(files['movein.dat']);
  });
});
