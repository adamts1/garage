// @vitest-environment jsdom
import type { Ticket } from '@garage/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

/* An imported card (RB-…) is not in the board's list, so its page fetches it by
   key and shows it read-only, with its lines and links to its customer and car. */

const legacyCard = {
  k: 'RB-1660', st: 'done', title: 'טיפול', plate: '9058956', customer: 'אבי מרוקוס', amount: 1883.61,
  customerId: 'cust-1', carId: 'car-1', km: '140752', createdAt: '5.4.2022',
  legacy: { source: 'ricbi', number: '1660' },
  works: [{ uid: 'legacy', code: '', name: 'טיפול', labor: 0, notes: 'ניקוי מסנן אויר', items: [
    { sku: '90915-YZZN2', name: 'מסנן שמן מקורי', qty: 1, price: 82 },
    { sku: '', name: 'הנחת לקוח', qty: -1, price: 76.92 },
  ] }],
} as unknown as Ticket;

const getTicketByKey = vi.fn(async (key: string) => (key === 'RB-1660' ? legacyCard : null));
vi.mock('../../lib/supabase', () => ({ isConfigured: true }));
vi.mock('@garage/shared', async (importActual) => ({
  ...(await importActual<typeof import('@garage/shared')>()),
  getTicketByKey: (key: string) => getTicketByKey(key),
}));

await import('../../i18n');
const { default: LegacyTicketPage } = await import('./LegacyTicketPage');

const renderKey = async (key: string) => {
  render(<MemoryRouter><LegacyTicketPage ticketKey={key} /></MemoryRouter>);
  await act(async () => { await Promise.resolve(); });
};

afterEach(cleanup);

describe('an imported card', () => {
  it('shows its lines, notes and links, read-only', async () => {
    await renderKey('RB-1660');
    expect(screen.getByText('RB-1660')).toBeTruthy();
    expect(screen.getByText('מערכת קודמת')).toBeTruthy();
    expect(screen.getByText('מסנן שמן מקורי')).toBeTruthy();
    expect(screen.getByText('ניקוי מסנן אויר')).toBeTruthy();
    expect(screen.getByText('אבי מרוקוס').closest('a')?.getAttribute('href')).toBe('/customers/cust-1');
    expect(screen.getByText('9058956').closest('a')?.getAttribute('href')).toBe('/cars/car-1');
    // Nothing on the page edits it.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says so for a key that is nobody\'s', async () => {
    await renderKey('RB-9');
    expect(screen.getByText(/RB-9/).textContent).toContain('לא נמצא');
  });
});
