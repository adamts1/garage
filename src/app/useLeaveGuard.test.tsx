// @vitest-environment jsdom
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { Provider } from 'react-redux';
import { createMemoryRouter, Link, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ModalHost } from '../components/Modal';
import '../i18n';
import modal from '../store/modalSlice';
import toast from '../store/toastSlice';
import { useLeaveGuard } from './useLeaveGuard';

/* An open ticket with unsaved edits asks before ANY way out throws them away.
   It used to ask only from its own close button; the sidebar, the browser's
   Back and signing out all left silently. StrictMode throughout, for the same
   reason as useConfirm.test.tsx — a dialog answered by its own teardown passes
   every test that runs without it. */

afterEach(cleanup);

let guard: ReturnType<typeof useLeaveGuard>;

function Shell() {
  guard = useLeaveGuard();
  return (
    <>
      <Link to="/other">go</Link>
      <Routes>
        <Route path="/ticket" element={<div>ticket page</div>} />
        <Route path="/other" element={<div>other page</div>} />
      </Routes>
    </>
  );
}

function setup(initialEntries = ['/ticket'], initialIndex = 0) {
  const router = createMemoryRouter([{ path: '*', element: <Shell /> }], {
    initialEntries, initialIndex,
  });
  render(
    <StrictMode>
      <Provider store={configureStore({ reducer: { toast, modal } })}>
        <RouterProvider router={router} />
        <ModalHost />
      </Provider>
    </StrictMode>,
  );
  return router;
}

const flush = () => act(async () => { await Promise.resolve(); });
const click = (text: string) => act(async () => { screen.getByText(text).click(); });

describe('useLeaveGuard', () => {
  it('lets a clean page go without asking', async () => {
    setup();
    await click('go');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('other page')).toBeTruthy();
  });

  it('holds a link while there are unsaved edits, and stays on cancel', async () => {
    setup();
    guard.setUnsaved(true);
    await click('go');
    await flush();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('ticket page')).toBeTruthy();

    await click('ביטול');
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('ticket page')).toBeTruthy();
  });

  it('leaves once the user agrees to lose the edits', async () => {
    setup();
    guard.setUnsaved(true);
    await click('go');
    await click('אישור');
    await flush();

    expect(screen.getByText('other page')).toBeTruthy();
  });

  it('asks in the words of whatever is being lost', async () => {
    setup();
    guard.setUnsaved(true, 'newTicket.confirmLeave');
    await click('go');
    await flush();

    expect(screen.getByText(/התחלת לפתוח כרטיס חדש/)).toBeTruthy();
    expect(screen.getByText('ticket page')).toBeTruthy();
  });

  it('lets go once the page reports itself clean again', async () => {
    setup();
    guard.setUnsaved(true, 'newTicket.confirmLeave');
    guard.setUnsaved(false, 'newTicket.confirmLeave');
    await click('go');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('other page')).toBeTruthy();
  });

  it("holds the browser's Back button too", async () => {
    const router = setup(['/other', '/ticket'], 1);
    guard.setUnsaved(true);
    await act(async () => { await router.navigate(-1); });
    await flush();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('ticket page')).toBeTruthy();

    await click('אישור');
    await flush();
    expect(screen.getByText('other page')).toBeTruthy();
  });

  it('asks before signing out, and only when there is something to lose', async () => {
    setup();
    let answer: boolean | undefined;
    await act(async () => { answer = await guard.confirmDiscard(); });
    expect(answer).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();

    guard.setUnsaved(true);
    let pending!: Promise<boolean>;
    await act(async () => { pending = guard.confirmDiscard(); });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await click('ביטול');
    expect(await pending).toBe(false);
  });
});
