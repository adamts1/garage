// @vitest-environment jsdom
import type { Staff } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* An admin may not change their own role.

   The last-admin rule already stopped a garage ending up with nobody in charge.
   This is the case it does not cover: a garage with two admins, where one of
   them picks "עובד" on their own row. That write succeeds, the page redirects
   the moment it lands — it is admin-only — and the person who just gave up the
   keys has no screen left to take them back. Someone else has to.

   The rule lives in the manage-staff function, which is the boundary; what is
   pinned here is that the screen does not offer the move at all. */

const listStaff = vi.fn();
const setStaffRole = vi.fn();
const getCurrentUserId = vi.fn();

vi.mock('@garage/shared', async (importActual) => {
  const actual = await importActual<typeof import('@garage/shared')>();
  return {
    ...actual,
    isGarageAdmin: () => true,
    getCurrentUserId: () => getCurrentUserId(),
    listStaff: (...a: unknown[]) => listStaff(...a),
    setStaffRole: (...a: unknown[]) => setStaffRole(...a),
    subscribeToTable: vi.fn(() => () => {}),
  };
});

await import('../../i18n');
const { default: WorkersPage } = await import('./WorkersPage');
const { default: modal } = await import('../../store/modalSlice');
const { default: toast } = await import('../../store/toastSlice');

const staff = (over: Partial<Staff>): Staff =>
  ({
    id: 'x', code: 'x', name: 'x', initials: 'XX', color: '#3e5c76',
    position: 1, active: true, userId: null, email: null, role: 'member',
    ...over,
  }) as Staff;

const ME = 'user-me';

const TEAM = [
  staff({ id: '1', code: 'me', name: 'אדם', initials: 'אד', userId: ME, email: 'me@x.com', role: 'admin' }),
  staff({ id: '2', code: 'dani', name: 'דני כהן', initials: 'דכ', userId: 'user-dani', email: 'dani@x.com', role: 'admin', position: 2 }),
];

const renderPage = async () => {
  const store = configureStore({ reducer: { toast, modal } });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <WorkersPage />
      </MemoryRouter>
    </Provider>,
  );
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  listStaff.mockReset().mockResolvedValue(TEAM);
  setStaffRole.mockReset().mockResolvedValue(undefined);
  getCurrentUserId.mockReset().mockReturnValue(ME);
});

afterEach(cleanup);

describe('the role column', () => {
  it('shows your own role as text, marked as yours', async () => {
    await renderPage();

    // One person on this screen is the reader. Their role is stated, not offered.
    expect(screen.getByText('אתה')).toBeTruthy();
    expect(screen.getAllByLabelText('תפקיד')).toHaveLength(1);
  });

  it('still lets an admin change a colleague', async () => {
    await renderPage();
    const [select] = screen.getAllByLabelText('תפקיד') as HTMLSelectElement[];
    await act(async () => { fireEvent.change(select, { target: { value: 'member' } }); });

    expect(setStaffRole).toHaveBeenCalledWith('user-dani', 'member');
  });

  it('refuses a self-demotion that reaches the hook anyway', async () => {
    /* Belt and braces: the control is not on the screen, so this is the path a
       future caller would take. It must not reach the server. */
    const { useWorkers } = await import('./useWorkers');
    let hook: ReturnType<typeof useWorkers> | null = null;

    function Probe() {
      hook = useWorkers();
      return null;
    }

    const store = configureStore({ reducer: { toast, modal } });
    render(<Provider store={store}><Probe /></Provider>);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await hook!.setRole(TEAM[0], 'member'); });

    expect(setStaffRole).not.toHaveBeenCalled();
    expect(store.getState().toast.items?.length ?? 0).toBeGreaterThan(0);
  });
});
