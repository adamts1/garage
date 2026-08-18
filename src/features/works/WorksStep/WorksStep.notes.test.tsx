// @vitest-environment jsdom
import type { TicketWork } from '@garage/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

/* The field lives in the work's own row. Two bugs are behind that: it used to
   render against the SELECTED work, so on a saved ticket — where nothing is
   selected — it was not on the page at all until somebody happened to click a
   row; and even once selected it showed one work's note at a time, off to the
   side of the list it belongs to. */
describe('the per-work notes field', () => {
  it('is on the page as soon as the ticket has a work, with no click', () => {
    render(<WorksStep works={[work('w1')]} setWorks={vi.fn()} combinedEmpty />);
    expect(notesField()).not.toBeNull();
  });

  it('shows the note already written against that work', () => {
    render(<WorksStep works={[work('w1', { notes: 'הוחלפו גם הדיסקים' })]} setWorks={vi.fn()} combinedEmpty />);
    expect((notesField() as HTMLInputElement).value).toBe('הוחלפו גם הדיסקים');
  });

  it('gives every work its own field, all of them readable at once', () => {
    render(
      <WorksStep
        works={[work('w1', { notes: 'ראשונה' }), work('w2', { notes: 'שנייה' })]}
        setWorks={vi.fn()}
        combinedEmpty
      />,
    );
    const fields = screen.getAllByPlaceholderText('works.notesPlaceholder') as HTMLInputElement[];
    expect(fields.map((f) => f.value)).toEqual(['ראשונה', 'שנייה']);
  });

  /* What the old marker existed to compensate for: a note against a work you
     had to click first. Nothing needs clicking now. */
  it('needs no row selected to show a note', () => {
    render(<WorksStep works={[work('w1'), work('w2', { notes: 'על השנייה' })]} setWorks={vi.fn()} combinedEmpty />);
    expect(screen.getByDisplayValue('על השנייה')).toBeTruthy();
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

/* On the ticket page every setWorks persists immediately, and the save wipes
   and re-inserts the ticket's whole works tree. Writing through on each
   keystroke made a sentence into thirty of those. */
describe('when the note is written back', () => {
  it('does not save while you are still typing', () => {
    const setWorks = vi.fn();
    render(<WorksStep works={[work('w1')]} setWorks={setWorks} combinedEmpty />);

    fireEvent.change(notesField()!, { target: { value: 'הוחלפו' } });
    fireEvent.change(notesField()!, { target: { value: 'הוחלפו גם' } });
    fireEvent.change(notesField()!, { target: { value: 'הוחלפו גם הדיסקים' } });

    expect(setWorks).not.toHaveBeenCalled();
  });

  it('saves once, on leaving the field', () => {
    const setWorks = vi.fn();
    render(<WorksStep works={[work('w1')]} setWorks={setWorks} combinedEmpty />);

    fireEvent.change(notesField()!, { target: { value: 'הוחלפו גם הדיסקים' } });
    fireEvent.blur(notesField()!);

    expect(setWorks).toHaveBeenCalledTimes(1);
    expect(setWorks.mock.calls[0][0][0]).toMatchObject({ uid: 'w1', notes: 'הוחלפו גם הדיסקים' });
  });

  it('does not save at all when the text was not changed', () => {
    const setWorks = vi.fn();
    render(<WorksStep works={[work('w1', { notes: 'כבר כתוב' })]} setWorks={setWorks} combinedEmpty />);

    notesField()!.focus();
    fireEvent.blur(notesField()!);

    expect(setWorks).not.toHaveBeenCalled();
  });

  /* Each row commits its own work, not whichever one happens to be selected. */
  it('writes the note back against the work whose row it is in', () => {
    const setWorks = vi.fn();
    render(<WorksStep works={[work('w1'), work('w2')]} setWorks={setWorks} combinedEmpty />);

    const second = screen.getAllByPlaceholderText('works.notesPlaceholder')[1];
    fireEvent.change(second, { target: { value: 'על השנייה' } });
    fireEvent.blur(second);

    expect(setWorks).toHaveBeenCalledTimes(1);
    expect(setWorks.mock.calls[0][0][1]).toMatchObject({ uid: 'w2', notes: 'על השנייה' });
    expect(setWorks.mock.calls[0][0][0].notes).toBeUndefined();
  });
});
