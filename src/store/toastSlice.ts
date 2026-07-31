import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  /** i18n key, resolved at render time rather than at dispatch time — a toast
   *  that outlives a language switch then re-renders in the new language. */
  key?: string;
  values?: Record<string, string | number>;
  /** Already-final text, for messages that come from outside the app and have
   *  no key to resolve: a Supabase error, a provider's rejection reason.
   *  Ignored when `key` is set. */
  text?: string;
  /** ms before it dismisses itself. 0 keeps it until the user closes it. */
  ttl: number;
}

export type ToastInput = Omit<Toast, 'id' | 'ttl'> & { ttl?: number };

/** Long enough to read a confirmation without being in the way. */
export const DEFAULT_TTL = 4000;
/** Errors get longer: they are usually the thing you need to write down. */
export const ERROR_TTL = 8000;
/** Beyond this the stack covers the screen it is reporting on. Oldest goes. */
export const MAX_TOASTS = 4;

export interface ToastState {
  items: Toast[];
}

const initialState: ToastState = { items: [] };

const toastSlice = createSlice({
  name: 'toast',
  initialState,
  reducers: {
    toastShown: {
      reducer(state, action: PayloadAction<Toast>) {
        state.items.push(action.payload);
        if (state.items.length > MAX_TOASTS) {
          state.items.splice(0, state.items.length - MAX_TOASTS);
        }
      },
      prepare(input: ToastInput) {
        return {
          payload: {
            ...input,
            id: nanoid(),
            ttl: input.ttl ?? (input.kind === 'error' ? ERROR_TTL : DEFAULT_TTL),
          },
        };
      },
    },

    toastDismissed(state, action: PayloadAction<string>) {
      state.items = state.items.filter((t) => t.id !== action.payload);
    },

    /* For a caller that wants the stack empty before it starts — a bulk action
       reporting its own result, sign-out clearing the previous session's
       messages. Not wired to navigation: toasts expire on their own in seconds,
       and clearing on every route change loses the confirmation of the action
       that caused the navigation. */
    toastsCleared(state) {
      state.items = [];
    },
  },
});

export const { toastShown, toastDismissed, toastsCleared } = toastSlice.actions;

/* The three shapes that actually get dispatched. Callers reach for these rather
   than toastShown directly, so the ttl rules stay in one place. */
export const showSuccess = (key: string, values?: Toast['values']) =>
  toastShown({ kind: 'success', key, values });

export const showInfo = (key: string, values?: Toast['values']) =>
  toastShown({ kind: 'info', key, values });

/** `e` is whatever landed in a catch block. Errors carry their own text — there
 *  is no key for "duplicate key value violates unique constraint". */
export const showError = (e: unknown) =>
  toastShown({ kind: 'error', text: e instanceof Error ? e.message : String(e) });

/** For the failures we do have words for: a constraint we recognise, a rule the
 *  app enforces itself. Takes a key, so it reads in the user's language rather
 *  than the database's. */
export const showErrorKey = (key: string, values?: Toast['values']) =>
  toastShown({ kind: 'error', key, values });

export default toastSlice.reducer;
