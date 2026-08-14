import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import busy, { busyCleared, busyEnded, busyStarted, selectBusyKey } from './busySlice';

const freshStore = () => configureStore({ reducer: { busy } });

describe('busy', () => {
  it('says nothing is happening when nothing is', () => {
    expect(selectBusyKey(freshStore().getState())).toBeNull();
  });

  it('names the work while it runs', () => {
    const store = freshStore();
    store.dispatch(busyStarted('busy.issuingInvoice'));

    expect(selectBusyKey(store.getState())).toBe('busy.issuingInvoice');
  });

  /* The reason this holds a list. A boolean would be cleared by whichever task
     finished first, and the overlay would come down over work still running —
     which is the failure it exists to prevent. */
  it('stays up until the last of several finishes', () => {
    const store = freshStore();
    const first = store.dispatch(busyStarted('busy.savingExpense'));
    const second = store.dispatch(busyStarted('busy.syncingExpense'));

    store.dispatch(busyEnded(first.payload.id));
    expect(selectBusyKey(store.getState())).toBe('busy.syncingExpense');

    store.dispatch(busyEnded(second.payload.id));
    expect(selectBusyKey(store.getState())).toBeNull();
  });

  /* The newest is the one the user just triggered and is waiting on. */
  it('reports the most recent task', () => {
    const store = freshStore();
    store.dispatch(busyStarted('busy.savingExpense'));
    store.dispatch(busyStarted('busy.syncingExpense'));

    expect(selectBusyKey(store.getState())).toBe('busy.syncingExpense');
  });

  it('ignores an id it does not hold', () => {
    const store = freshStore();
    store.dispatch(busyStarted('busy.crediting'));
    store.dispatch(busyEnded('not-a-task'));

    expect(selectBusyKey(store.getState())).toBe('busy.crediting');
  });

  it('empties on clear', () => {
    const store = freshStore();
    store.dispatch(busyStarted('busy.collecting'));
    store.dispatch(busyStarted('busy.crediting'));
    store.dispatch(busyCleared());

    expect(selectBusyKey(store.getState())).toBeNull();
  });
});
