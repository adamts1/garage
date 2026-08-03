// @vitest-environment jsdom
import type { TicketWork } from '@garage/shared';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorksStep } from './useWorksStep';

/* The pickers open modals through the Redux registry; nothing here picks. */
vi.mock('../usePickers', () => ({
  usePickWork: () => vi.fn(),
  usePickPart: () => vi.fn(),
}));

const work = (uid: string, over: Partial<TicketWork> = {}): TicketWork => ({
  uid, code: 'BR1', name: `עבודה ${uid}`, labor: 100, items: [], ...over,
});

/* `current` is what the right-hand pane renders — the parts of a work and,
   since the notes landed, the note written against it. A ticket that opened
   with nothing selected therefore hid the notes field completely. */
describe('the selected work', () => {
  it('is the first one when nothing has been clicked', () => {
    const { result } = renderHook(() =>
      useWorksStep({ works: [work('w1'), work('w2')], setWorks: vi.fn() }),
    );
    expect(result.current.current?.uid).toBe('w1');
  });

  /* The regression this exists for: on a saved ticket the first render happens
     before the works come back from the database, so a value captured then is
     captured from an empty array. */
  it('lands on a work that arrived after the first render', () => {
    const { result, rerender } = renderHook(
      ({ works }) => useWorksStep({ works, setWorks: vi.fn() }),
      { initialProps: { works: [] as TicketWork[] } },
    );
    expect(result.current.current).toBeNull();

    rerender({ works: [work('w1'), work('w2')] });
    expect(result.current.current?.uid).toBe('w1');
  });

  it('follows a click', () => {
    const { result } = renderHook(() =>
      useWorksStep({ works: [work('w1'), work('w2')], setWorks: vi.fn() }),
    );
    act(() => result.current.setSelectedUid('w2'));
    expect(result.current.current?.uid).toBe('w2');
  });

  it('falls back rather than emptying the pane when the selected work is removed', () => {
    const { result, rerender } = renderHook(
      ({ works }) => useWorksStep({ works, setWorks: vi.fn() }),
      { initialProps: { works: [work('w1'), work('w2')] } },
    );
    act(() => result.current.setSelectedUid('w2'));
    rerender({ works: [work('w1')] });
    expect(result.current.current?.uid).toBe('w1');
  });

  it('is null only when there are no works at all', () => {
    const { result } = renderHook(() => useWorksStep({ works: [], setWorks: vi.fn() }));
    expect(result.current.current).toBeNull();
  });
});

describe('patchWork', () => {
  it('writes a note onto one work and leaves the others alone', () => {
    const setWorks = vi.fn();
    const works = [work('w1'), work('w2')];
    const { result } = renderHook(() => useWorksStep({ works, setWorks }));

    act(() => result.current.patchWork('w1', { notes: 'הוחלפו גם הדיסקים' }));

    const next = setWorks.mock.calls[0][0] as TicketWork[];
    expect(next[0]).toMatchObject({ uid: 'w1', notes: 'הוחלפו גם הדיסקים' });
    expect(next[1].uid).toBe('w2');
    expect(next[1].notes).toBeUndefined();
  });
});
