// @vitest-environment jsdom
import type { TicketWork } from '@garage/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorksStep from './WorksStep';

/* The pickers reach the Redux registry; nothing here picks. */
vi.mock('../usePickers', () => ({
  usePickWork: () => vi.fn(),
  usePickPart: () => vi.fn(),
}));

/* Admin, so the priced cells render as inputs — the notes field is open to
   everyone either way, which is the point of the last case below. */
const isGarageAdmin = vi.fn(() => true);
vi.mock('@garage/shared', async (importActual) => ({
  ...(await importActual<typeof import('@garage/shared')>()),
  isGarageAdmin: () => isGarageAdmin(),
}));

/* i18next is not initialised here, so t() returns the key — which is what the
   queries below look for, and is stable regardless of the Hebrew copy. */
const work = (uid: string, over: Partial<TicketWork> = {}): TicketWork => ({
  uid, code: 'BR1', name: `עבודה ${uid}`, labor: 100, items: [], ...over,
});

const notesField = () => screen.queryByPlaceholderText('works.notesPlaceholder');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

/* This is the bug that shipped: the field renders against the SELECTED work,
   and on a saved ticket nothing was selected, so it was not on the page at all
   until somebody happened to click a row. */
describe('the per-work notes field', () => {
  it('is on the page as soon as the ticket has a work, with no click', () => {
    render(<WorksStep works={[work('w1')]} setWorks={vi.fn()} combinedEmpty />);
    expect(notesField()).not.toBeNull();
  });

  it('shows the note already written against that work', () => {
    render(<WorksStep works={[work('w1', { notes: 'הוחלפו גם הדיסקים' })]} setWorks={vi.fn()} combinedEmpty />);
    expect((notesField() as HTMLTextAreaElement).value).toBe('הוחלפו גם הדיסקים');
  });

  it('marks the rows that carry a note, since the field itself is off to the side', () => {
    render(
      <WorksStep
        works={[work('w1', { notes: 'משהו' }), work('w2')]}
        setWorks={vi.fn()}
        combinedEmpty
      />,
    );
    // The marker itself, not the field's own label — both carry works.notes.
    expect(screen.getAllByText('✎')).toHaveLength(1);
  });

  it('is absent only when the ticket has no works to annotate', () => {
    render(<WorksStep works={[]} setWorks={vi.fn()} combinedEmpty />);
    expect(notesField()).toBeNull();
  });

  it('stays available to a member, who may annotate but not reprice', () => {
    isGarageAdmin.mockReturnValue(false);
    render(<WorksStep works={[work('w1')]} setWorks={vi.fn()} combinedEmpty />);
    expect(notesField()).not.toBeNull();
  });
});
