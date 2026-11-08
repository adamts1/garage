// @vitest-environment jsdom
import type { Ticket } from '@garage/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* saveTicket is the save that callers wait on — close-and-charge issues a tax
   document straight after it, from the stored row. So it must not resolve
   before the write has landed, and it must not resolve at all when it failed. */

const stored: Ticket = { k: 'GAR-1', st: 'done', paid: false, notes: 'old' } as unknown as Ticket;

const updateTicket = vi.fn();
const listTickets = vi.fn();

vi.mock('./supabase', () => ({ isConfigured: true }));
vi.mock('./prefetch', () => ({ takePrefetched: async () => [stored] }));
vi.mock('@garage/shared', () => ({
  listTickets: () => listTickets(),
  updateTicket: (...a: unknown[]) => updateTicket(...a),
  createTicket: vi.fn(),
  cancelTicket: vi.fn(),
  subscribeToTickets: () => () => {},
}));

const { useTickets } = await import('./useTickets');

const mount = async () => {
  const hook = renderHook(() => useTickets());
  await waitFor(() => expect(hook.result.current.tickets).toEqual([stored]));
  return hook;
};

beforeEach(() => {
  updateTicket.mockReset().mockResolvedValue(undefined);
  listTickets.mockReset().mockResolvedValue([stored]);
});

describe('saveTicket', () => {
  it('resolves only once the write has landed', async () => {
    let land!: () => void;
    updateTicket.mockImplementation(() => new Promise<void>((r) => { land = r; }));
    const { result } = await mount();

    let done = false;
    let saving!: Promise<void>;
    act(() => { saving = result.current.saveTicket({ ...stored, notes: 'new' }).then(() => { done = true; }); });
    await act(async () => { await Promise.resolve(); });
    expect(done).toBe(false);

    await act(async () => { land(); await saving; });
    expect(done).toBe(true);
  });

  it('paints the edit before the write, like setTickets', async () => {
    const { result } = await mount();
    await act(async () => { await result.current.saveTicket({ ...stored, notes: 'new' }); });
    expect(result.current.tickets[0].notes).toBe('new');
  });

  it('rejects when the write fails, and pulls the stored row back', async () => {
    updateTicket.mockRejectedValue(new Error('network down'));
    const { result } = await mount();

    await act(async () => {
      await expect(result.current.saveTicket({ ...stored, notes: 'new' })).rejects.toThrow('network down');
    });
    expect(listTickets).toHaveBeenCalled();
    expect(result.current.tickets[0].notes).toBe('old');
    // The caller reports it; the page-wide banner stays out of it.
    expect(result.current.error).toBeNull();
  });

  it('writes nothing when nothing changed', async () => {
    const { result } = await mount();
    await act(async () => { await result.current.saveTicket({ ...stored }); });
    expect(updateTicket).not.toHaveBeenCalled();
  });
});
