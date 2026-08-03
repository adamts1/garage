// @vitest-environment jsdom
import type { Ticket, TicketWork } from '@garage/shared';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Everything this hook reaches for that is not the save path. The point of the
   file is what does and does not get written, so the rest is stubbed flat. */
vi.mock('@garage/shared', async (importActual) => ({
  ...(await importActual<typeof import('@garage/shared')>()),
  listTicketPhotos: vi.fn(async () => []),
  listInvoices: vi.fn(async () => []),
  subscribeToTicketPhotos: vi.fn(() => () => {}),
  subscribeToInvoices: vi.fn(() => () => {}),
  issueInvoice: vi.fn(async () => ({ id: 'i1', docnum: '1', total: 100 })),
  cancelInvoice: vi.fn(async () => {}),
}));

const confirmResult = vi.fn(async () => true);
const closeResult = vi.fn(async () => null as unknown);
vi.mock('../../store', () => ({
  useAppDispatch: () => vi.fn(),
  useConfirm: () => confirmResult,
  usePrompt: () => vi.fn(),
  useModalResult: () => vi.fn(async () => true),
  showError: (e: unknown) => ({ type: 'error', payload: e }),
  showErrorKey: (k: unknown) => ({ type: 'errorKey', payload: k }),
  showSuccess: (k: unknown) => ({ type: 'success', payload: k }),
}));
vi.mock('../../features/ticket/CloseTicketModal', () => ({
  useCloseTicket: () => closeResult,
}));

const { useTicketPage } = await import('./useTicketPage');

const work = (uid: string, over: Partial<TicketWork> = {}): TicketWork => ({
  uid, code: 'BR1', name: 'רפידות', labor: 400, items: [], ...over,
});

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  k: 'GAR-1', st: 'todo', type: 'job', epic: 'service', prio: 'med', pts: 3,
  who: null, job: 'W-1', title: 'x', plate: '-', car: '-', customer: 'דנה',
  amount: 0, done: 0, subtasks: [], due: '-', flags: [], works: [work('w1')],
  ...over,
} as Ticket);

const setup = (t: Ticket = ticket()) => {
  // Typed through the parameters, so the call assertions below can read them.
  const saveTicket = vi.fn(async (_next: Ticket, _worksChanged: boolean) => {});
  const setTickets = vi.fn();
  const hook = renderHook(() =>
    useTicketPage({ ticket: t, setTickets, saveTicket, onBack: vi.fn() }),
  );
  return { ...hook, saveTicket, setTickets };
};

beforeEach(() => {
  vi.clearAllMocks();
  confirmResult.mockResolvedValue(true);
  closeResult.mockResolvedValue(null);
});

/* The whole point: editing this screen used to persist on every keystroke,
   because it had no draft and setTickets writes through. */
describe('edits are held until saved', () => {
  it('writes nothing while the ticket is being edited', async () => {
    const { result, saveTicket, setTickets } = setup();

    await act(async () => { result.current.patch({ notes: 'שלב א' }); });
    await act(async () => { result.current.patch({ notes: 'שלב א ואז ב' }); });
    await act(async () => { result.current.setWorks([work('w1', { labor: 900 })]); });

    expect(saveTicket).not.toHaveBeenCalled();
    expect(setTickets).not.toHaveBeenCalled();
  });

  it('shows the edits back, so the screen renders what is in hand', async () => {
    const { result } = setup();
    await act(async () => { result.current.setWorks([work('w1', { labor: 900 })]); });
    expect(result.current.works[0].labor).toBe(900);
  });

  it('writes once when saved, and stops being dirty', async () => {
    const { result, saveTicket } = setup();

    await act(async () => { result.current.patch({ notes: 'הערה' }); });
    expect(result.current.dirty).toBe(true);

    await act(async () => { await result.current.save(); });

    expect(saveTicket).toHaveBeenCalledTimes(1);
    expect(saveTicket.mock.calls[0][0]).toMatchObject({ notes: 'הערה' });
    expect(result.current.dirty).toBe(false);
  });

  it('tells the save path whether the works changed, so parts are not rewritten for nothing', async () => {
    const { result, saveTicket } = setup();

    await act(async () => { result.current.patch({ notes: 'רק הערה' }); });
    await act(async () => { await result.current.save(); });
    expect(saveTicket.mock.calls[0][1]).toBe(false);

    await act(async () => { result.current.setWorks([work('w1', { labor: 900 })]); });
    await act(async () => { await result.current.save(); });
    expect(saveTicket.mock.calls[1][1]).toBe(true);
  });

  it('is not dirty when an edit is undone', async () => {
    const { result } = setup(ticket({ notes: 'מקורי' }));
    await act(async () => { result.current.patch({ notes: 'אחר' }); });
    expect(result.current.dirty).toBe(true);

    await act(async () => { result.current.patch({ notes: 'מקורי' }); });
    expect(result.current.dirty).toBe(false);
  });

  it('saves nothing when there is nothing to save', async () => {
    const { result, saveTicket } = setup();
    await act(async () => { await result.current.save(); });
    expect(saveTicket).not.toHaveBeenCalled();
  });
});

/* An invoice is frozen at issue and cannot be deleted, only credited. Issuing
   it against works still sitting in a draft would put lines on a tax document
   that do not match the database. */
describe('actions that write, with edits pending', () => {
  it('saves before issuing an invoice', async () => {
    const { result, saveTicket } = setup();
    const { issueInvoice } = await import('@garage/shared');

    await act(async () => { result.current.setWorks([work('w1', { labor: 900 })]); });
    await act(async () => { await result.current.issue(); });

    expect(saveTicket).toHaveBeenCalledTimes(1);
    expect(vi.mocked(issueInvoice).mock.invocationCallOrder[0])
      .toBeGreaterThan(saveTicket.mock.invocationCallOrder[0]);
  });

  it('does not issue at all when the save failed', async () => {
    const { result, saveTicket } = setup();
    const { issueInvoice } = await import('@garage/shared');
    saveTicket.mockRejectedValueOnce(new Error('offline'));

    await act(async () => { result.current.setWorks([work('w1', { labor: 900 })]); });
    await act(async () => { await result.current.issue(); });

    expect(issueInvoice).not.toHaveBeenCalled();
  });

  it('closes and saves in a single write, carrying the pending edits', async () => {
    const { result, saveTicket } = setup();
    closeResult.mockResolvedValue({ paid: true, method: 'מזומן', doc: 'D1', reference: 'R1' });

    await act(async () => { result.current.setWorks([work('w1', { labor: 900 })]); });
    await act(async () => { await result.current.close(); });

    expect(saveTicket).toHaveBeenCalledTimes(1);
    const saved = saveTicket.mock.calls[0][0];
    expect(saved.st).toBe('paid');
    expect(saved.paid).toBe(true);
    expect(saved.works?.[0].labor).toBe(900);   // the edit went with the close
  });
});

describe('leaving with edits in hand', () => {
  it('asks first', async () => {
    const { result } = setup();
    await act(async () => { result.current.patch({ notes: 'הערה' }); });

    await act(async () => { expect(await result.current.confirmLeave()).toBe(true); });
    expect(confirmResult).toHaveBeenCalled();
  });

  it('stays put when the answer is no', async () => {
    const { result } = setup();
    confirmResult.mockResolvedValue(false);
    await act(async () => { result.current.patch({ notes: 'הערה' }); });

    await act(async () => { expect(await result.current.confirmLeave()).toBe(false); });
  });

  it('does not ask when nothing changed', async () => {
    const { result } = setup();
    await act(async () => { expect(await result.current.confirmLeave()).toBe(true); });
    expect(confirmResult).not.toHaveBeenCalled();
  });
});

describe('moving to another ticket', () => {
  it('does not carry the previous draft over', async () => {
    const saveTicket = vi.fn(async () => {});
    const { result, rerender } = renderHook(
      ({ t }) => useTicketPage({ ticket: t, setTickets: vi.fn(), saveTicket, onBack: vi.fn() }),
      { initialProps: { t: ticket({ k: 'GAR-1', notes: 'של הראשון' }) } },
    );

    await act(async () => { result.current.patch({ notes: 'טיוטה' }); });
    expect(result.current.dirty).toBe(true);

    await act(async () => {
      rerender({ t: ticket({ k: 'GAR-2', notes: 'של השני' }) });
    });

    expect(result.current.dirty).toBe(false);
    expect(result.current.ticket.notes).toBe('של השני');
  });
});
