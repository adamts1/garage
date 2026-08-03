// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* The catalog screen's own rules: what the search matches, and what a duplicate
   code says out loud. The CRUD calls themselves are @garage/shared's and are
   exercised against a real database by supabase/tests/tenancy.mjs. */

const listWorkDefs = vi.fn();
const createWorkDef = vi.fn();
const updateWorkDef = vi.fn();
const deleteWorkDef = vi.fn();
const subscribeToTable = vi.fn(() => () => {});

vi.mock('@garage/shared', () => ({
  listWorkDefs, createWorkDef, updateWorkDef, deleteWorkDef, subscribeToTable,
}));

const dispatch = vi.fn();
const confirm = vi.fn(async () => true);
vi.mock('../../store', () => ({
  useAppDispatch: () => dispatch,
  useConfirm: () => confirm,
  showError: (e: unknown) => ({ type: 'error', payload: e }),
  showSuccess: (k: unknown) => ({ type: 'success', payload: k }),
}));

const { useWorks } = await import('./useWorks');

const def = (over: Record<string, unknown>) => ({
  id: 'w1', code: 'BR1', name: 'החלפת רפידות', labor: 400, hours: 1, items: [], ...over,
});

const rows = [
  def({ id: 'w1', code: 'BR1', name: 'החלפת רפידות' }),
  def({ id: 'w2', code: 'OIL', name: 'החלפת שמן' }),
];

beforeEach(() => {
  listWorkDefs.mockResolvedValue(rows);
});

afterEach(() => {
  vi.clearAllMocks();
});

const setup = async () => {
  const hook = renderHook(() => useWorks());
  await waitFor(() => expect(hook.result.current.rows).toHaveLength(2));
  return hook;
};

describe('useWorks', () => {
  it('loads the catalog and subscribes to it', async () => {
    await setup();
    expect(subscribeToTable).toHaveBeenCalledWith('work_defs', expect.any(Function));
  });

  it('searches by code as well as by name', async () => {
    const { result } = await setup();

    act(() => result.current.setQuery('שמן'));
    expect(result.current.shown.map((w) => w.id)).toEqual(['w2']);

    act(() => result.current.setQuery('br1'));
    expect(result.current.shown.map((w) => w.id)).toEqual(['w1']);
  });

  it('shows everything again when the search is cleared', async () => {
    const { result } = await setup();
    act(() => result.current.setQuery('שמן'));
    act(() => result.current.setQuery('   '));
    expect(result.current.shown).toHaveLength(2);
  });

  it('refuses to create a work with no code or no name', async () => {
    const { result } = await setup();
    await act(async () => {
      expect(await result.current.create({ code: '', name: 'x', labor: 0, hours: 0, items: [] })).toBe(false);
      expect(await result.current.create({ code: 'x', name: '  ', labor: 0, hours: 0, items: [] })).toBe(false);
    });
    expect(createWorkDef).not.toHaveBeenCalled();
  });

  /* work_defs is unique on (garage_id, code). Postgres says "duplicate key
     value violates unique constraint", which tells a service advisor nothing
     about what to do next. */
  it('turns a duplicate code into a sentence about the code', async () => {
    const { result } = await setup();
    createWorkDef.mockRejectedValueOnce({ code: '23505' });

    await act(async () => {
      expect(await result.current.create(def({ id: undefined }) as never)).toBe(false);
    });

    expect(dispatch).toHaveBeenCalledWith({ type: 'error', payload: 'works.duplicateCode' });
  });

  it('passes any other failure through as itself', async () => {
    const { result } = await setup();
    const boom = { code: '08006', message: 'connection failed' };
    createWorkDef.mockRejectedValueOnce(boom);

    await act(async () => {
      await result.current.create(def({ id: undefined }) as never);
    });

    expect(dispatch).toHaveBeenCalledWith({ type: 'error', payload: boom });
  });

  it('asks before deleting, and does not delete when refused', async () => {
    const { result } = await setup();
    confirm.mockResolvedValueOnce(false);

    await act(async () => { await result.current.remove(rows[0] as never); });

    expect(deleteWorkDef).not.toHaveBeenCalled();
  });

  it('deletes once confirmed', async () => {
    const { result } = await setup();
    await act(async () => { await result.current.remove(rows[0] as never); });
    expect(deleteWorkDef).toHaveBeenCalledWith('w1');
  });
});
