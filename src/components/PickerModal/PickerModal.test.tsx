// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PickerModal from './PickerModal';

/* i18next is not initialised here, so t() returns the key — stable whatever
   the Hebrew copy says. */

interface Item { id: string; name: string }
const ITEMS: Item[] = [
  { id: 'a', name: 'רפידות' },
  { id: 'b', name: 'דיסקים' },
  { id: 'c', name: 'נוזל בלמים' },
];

afterEach(cleanup);

function open(over: Partial<Parameters<typeof PickerModal<Item>>[0]> = {}) {
  const onPick = vi.fn();
  const onCreate = vi.fn();
  render(
    <PickerModal<Item>
      title="picker.part.title"
      searchPlaceholder="picker.part.search"
      items={ITEMS}
      itemKey={(i) => i.id}
      match={(i, q) => i.name.includes(q)}
      renderRow={(i) => <span>{i.name}</span>}
      emptyKey="picker.part.empty"
      createLabel="picker.part.create"
      onPick={onPick}
      onCreate={onCreate}
      onClose={vi.fn()}
      {...over}
    />,
  );
  return { onPick, onCreate, search: screen.getByPlaceholderText('picker.part.search') };
}

const row = (name: string) => screen.getByText(name).closest('button')!;
const addButton = () => screen.getByText('picker.addPicked');

describe('picking several at once', () => {
  it('a click ticks a row instead of taking it', () => {
    const { onPick } = open();
    fireEvent.click(row('רפידות'));
    expect(onPick).not.toHaveBeenCalled();
    expect(row('רפידות').getAttribute('aria-checked')).toBe('true');
  });

  it('a second click unticks it', () => {
    open();
    fireEvent.click(row('רפידות'));
    fireEvent.click(row('רפידות'));
    expect(row('רפידות').getAttribute('aria-checked')).toBe('false');
  });

  it('the add button takes every ticked row, in the order ticked', () => {
    const { onPick } = open();
    fireEvent.click(row('נוזל בלמים'));
    fireEvent.click(row('רפידות'));
    fireEvent.click(addButton());
    expect(onPick).toHaveBeenCalledWith([ITEMS[2], ITEMS[0]]);
  });

  it('is disabled with nothing ticked', () => {
    open();
    expect((addButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps a row ticked when the search filters it out', () => {
    const { onPick, search } = open();
    fireEvent.click(row('רפידות'));
    fireEvent.change(search, { target: { value: 'דיסק' } });
    fireEvent.click(row('דיסקים'));
    fireEvent.click(addButton());
    expect(onPick).toHaveBeenCalledWith([ITEMS[0], ITEMS[1]]);
  });
});

describe('the keyboard', () => {
  it('Enter with nothing ticked takes the highlighted row on its own', () => {
    const { onPick, search } = open();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith([ITEMS[1]]);
  });

  it('Enter with rows ticked takes the ticked rows', () => {
    const { onPick, search } = open();
    fireEvent.click(row('דיסקים'));
    fireEvent.click(row('נוזל בלמים'));
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith([ITEMS[1], ITEMS[2]]);
  });
});

describe('creating a new one', () => {
  it('hands over what is ticked so far, so the new one joins them', () => {
    const { onCreate, search } = open();
    fireEvent.click(row('רפידות'));
    fireEvent.change(search, { target: { value: 'צמיג' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith('צמיג', [ITEMS[0]]);
  });

  it('comes back from the form with those rows still ticked', () => {
    open({ initialPicked: [ITEMS[0]] });
    expect(row('רפידות').getAttribute('aria-checked')).toBe('true');
  });
});
