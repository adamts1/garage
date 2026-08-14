// @vitest-environment jsdom

/* The pairing is the whole contract: a task that starts and never ends leaves
   the app looking permanently busy, and the only branch that reliably runs when
   the work throws is the `finally`. So the failing case is the one worth
   pinning, not the happy one. */

import { configureStore } from '@reduxjs/toolkit';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';
import busy, { selectBusyKey } from './busySlice';
import { useBusyRun } from './useBusy';

const setup = () => {
  const store = configureStore({ reducer: { busy } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const { result } = renderHook(() => useBusyRun(), { wrapper });
  return { store, run: () => result.current };
};

describe('useBusyRun', () => {
  it('holds the task up for as long as the work runs', async () => {
    const { store, run } = setup();
    let release: (() => void) | undefined;
    const work = new Promise<void>((resolve) => { release = resolve; });

    let done: Promise<unknown>;
    await act(async () => {
      done = run()('busy.issuingInvoice', () => work);
      await Promise.resolve();
    });
    expect(selectBusyKey(store.getState())).toBe('busy.issuingInvoice');

    await act(async () => { release!(); await done; });
    expect(selectBusyKey(store.getState())).toBeNull();
  });

  it('returns what the work returned', async () => {
    const { run } = setup();

    let value: unknown;
    await act(async () => { value = await run()('busy.collecting', async () => 'receipt-42'); });

    expect(value).toBe('receipt-42');
  });

  it('takes the task down when the work throws, and re-throws', async () => {
    const { store, run } = setup();

    let caught: unknown;
    await act(async () => {
      try {
        await run()('busy.crediting', async () => { throw new Error('iCount refused'); });
      } catch (e) {
        caught = e;
      }
    });

    expect((caught as Error).message).toBe('iCount refused');
    expect(selectBusyKey(store.getState())).toBeNull();
  });
});
