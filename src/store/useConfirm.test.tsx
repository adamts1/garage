// @vitest-environment jsdom
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it } from 'vitest';
import { ModalHost } from '../components/Modal';
import '../i18n';
import modal from './modalSlice';
import toast from './toastSlice';
import { useConfirm } from './useConfirm';

/* This is here because of a bug that shipped: every delete in the app silently
   did nothing.

   ConfirmModal used to answer "no" from its unmount cleanup, so a dialog
   dismissed by Escape could not leave its caller hanging. React StrictMode
   mounts, runs effects, tears them down and mounts again — and that teardown
   ran while the dialog was still on screen. The promise resolved false before
   anyone could click, the caller took its `if (!ok) return`, and the row stayed
   put with no error to show for it.

   Nothing in a node-environment suite could see that. Hence jsdom, and hence
   StrictMode in every case below: without it these tests pass against the
   broken version. */

/* Testing Library only registers its own afterEach when vitest runs with
   globals enabled, which this project does not — without this, each render
   stacks on the last one's DOM and every query finds two of everything. */
afterEach(cleanup);

const makeStore = () => configureStore({ reducer: { toast, modal } });

function Subject({ onAnswer }: { onAnswer: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={() => {
        void confirm({ bodyKey: 'suppliers.confirmDelete', values: { name: 'x' } }).then(onAnswer);
      }}
    >
      ask
    </button>
  );
}

function setup() {
  const answers: boolean[] = [];
  const store = makeStore();
  render(
    <StrictMode>
      <Provider store={store}>
        <Subject onAnswer={(v) => answers.push(v)} />
        <ModalHost />
      </Provider>
    </StrictMode>,
  );
  return { answers, store };
}

const flush = () => act(async () => { await Promise.resolve(); });

describe('useConfirm under StrictMode', () => {
  it('does not answer before the user does', async () => {
    const { answers } = setup();
    await act(async () => { screen.getByText('ask').click(); });
    await flush();

    // The dialog is up and nothing has been decided.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(answers).toEqual([]);
  });

  it('resolves true when the confirming button is pressed', async () => {
    const { answers } = setup();
    await act(async () => { screen.getByText('ask').click(); });
    await act(async () => { screen.getByText('אישור').click(); });
    await flush();

    expect(answers).toEqual([true]);
  });

  it('resolves false when cancelled', async () => {
    const { answers } = setup();
    await act(async () => { screen.getByText('ask').click(); });
    await act(async () => { screen.getByText('ביטול').click(); });
    await flush();

    expect(answers).toEqual([false]);
  });

  it('resolves false when dismissed by Escape', async () => {
    const { answers } = setup();
    await act(async () => { screen.getByText('ask').click(); });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();

    // The reason the unmount cleanup existed at all: a dismissed dialog still
    // has to answer, or the caller waits forever.
    expect(answers).toEqual([false]);
  });

  it('closes the dialog once answered', async () => {
    setup();
    await act(async () => { screen.getByText('ask').click(); });
    await act(async () => { screen.getByText('אישור').click(); });
    await flush();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('answers exactly once', async () => {
    const { answers } = setup();
    await act(async () => { screen.getByText('ask').click(); });
    await act(async () => { screen.getByText('אישור').click(); });
    await flush();
    // Any later store activity must not settle it a second time.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();

    expect(answers).toEqual([true]);
  });
});
