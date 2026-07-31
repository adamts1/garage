import { describe, expect, it } from 'vitest';
import modalReducer, { modalClosed, modalOpened, modalsCleared } from './modalSlice';
import toastReducer, {
  DEFAULT_TTL, ERROR_TTL, MAX_TOASTS,
  showError, showErrorKey, showSuccess,
  toastDismissed, toastShown, toastsCleared,
} from './toastSlice';

const toastState = (...actions: { type: string; payload?: unknown }[]) =>
  actions.reduce((s, a) => toastReducer(s, a as never), toastReducer(undefined, { type: '@@init' }));

const modalState = (...actions: { type: string; payload?: unknown }[]) =>
  actions.reduce((s, a) => modalReducer(s, a as never), modalReducer(undefined, { type: '@@init' }));

describe('toastSlice', () => {
  it('gives every toast its own id, so two identical messages both show', () => {
    const s = toastState(showSuccess('suppliers.created'), showSuccess('suppliers.created'));
    expect(s.items).toHaveLength(2);
    expect(s.items[0].id).not.toBe(s.items[1].id);
  });

  it('keeps errors up longer than confirmations', () => {
    const s = toastState(showSuccess('a'), showError(new Error('boom')));
    expect(s.items[0].ttl).toBe(DEFAULT_TTL);
    expect(s.items[1].ttl).toBe(ERROR_TTL);
  });

  it('carries an Error’s message as text, since there is no key for it', () => {
    const s = toastState(showError(new Error('duplicate key value')));
    expect(s.items[0].text).toBe('duplicate key value');
    expect(s.items[0].key).toBeUndefined();
  });

  it('stringifies a rejection that is not an Error', () => {
    const s = toastState(showError('plain string'));
    expect(s.items[0].text).toBe('plain string');
  });

  it('carries a key when the failure is one we have words for', () => {
    const s = toastState(showErrorKey('suppliers.deleteBlocked'));
    expect(s.items[0].key).toBe('suppliers.deleteBlocked');
    expect(s.items[0].kind).toBe('error');
  });

  it('drops the oldest once the stack would cover the screen', () => {
    const s = toastState(
      ...Array.from({ length: MAX_TOASTS + 2 }, (_, i) => showSuccess(`k${i}`)),
    );
    expect(s.items).toHaveLength(MAX_TOASTS);
    expect(s.items[0].key).toBe('k2');
    expect(s.items[s.items.length - 1].key).toBe(`k${MAX_TOASTS + 1}`);
  });

  it('dismisses exactly the one asked for', () => {
    const first = toastState(showSuccess('a'), showSuccess('b'));
    const after = toastReducer(first, toastDismissed(first.items[0].id));
    expect(after.items.map((t) => t.key)).toEqual(['b']);
  });

  it('ignores a dismiss for a toast that already went', () => {
    const first = toastState(showSuccess('a'));
    const after = toastReducer(first, toastDismissed('does-not-exist'));
    expect(after.items).toHaveLength(1);
  });

  it('honours an explicit ttl of 0, meaning "until dismissed"', () => {
    const s = toastState(toastShown({ kind: 'error', key: 'a', ttl: 0 }));
    expect(s.items[0].ttl).toBe(0);
  });

  it('clears the stack', () => {
    const s = toastState(showSuccess('a'), showSuccess('b'));
    expect(toastReducer(s, toastsCleared()).items).toEqual([]);
  });
});

describe('modalSlice', () => {
  it('stacks, so a confirm over an editor leaves the editor open', () => {
    const s = modalState(
      modalOpened({ name: 'workEditor' }),
      modalOpened({ name: 'confirm' }),
    );
    expect(s.stack.map((m) => m.name)).toEqual(['workEditor', 'confirm']);
  });

  it('closes the top one when given no id — what Escape means', () => {
    const s = modalState(modalOpened({ name: 'a' }), modalOpened({ name: 'b' }));
    expect(modalReducer(s, modalClosed(undefined)).stack.map((m) => m.name)).toEqual(['a']);
  });

  it('closes a specific modal even when something opened over it', () => {
    const s = modalState(modalOpened({ name: 'a' }), modalOpened({ name: 'b' }));
    const bottomId = s.stack[0].id;
    expect(modalReducer(s, modalClosed(bottomId)).stack.map((m) => m.name)).toEqual(['b']);
  });

  it('closing an empty stack is a no-op, not a crash', () => {
    const empty = modalState();
    expect(modalReducer(empty, modalClosed(undefined)).stack).toEqual([]);
  });

  it('defaults props to an object, so a modal can read them unguarded', () => {
    const s = modalState(modalOpened({ name: 'a' }));
    expect(s.stack[0].props).toEqual({});
  });

  it('keeps the props it was given', () => {
    const s = modalState(modalOpened({ name: 'confirm', props: { bodyKey: 'x', danger: true } }));
    expect(s.stack[0].props).toEqual({ bodyKey: 'x', danger: true });
  });

  it('clears the stack', () => {
    const s = modalState(modalOpened({ name: 'a' }), modalOpened({ name: 'b' }));
    expect(modalReducer(s, modalsCleared()).stack).toEqual([]);
  });
});
