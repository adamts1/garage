import { errorMessage } from '@garage/shared';
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

/* A constraint a person can actually trip, in words they can act on.
 *
 * Every screen that writes one of these should catch it before the database
 * does — and each of them names the customer, which an error message cannot.
 * This is the floor: a race between two counters, a path nobody thought of, a
 * screen written next year. What it must never do is put
 * "customers_garage_id_number_key" in front of somebody at a service desk. */
const CONSTRAINT_KEYS: Record<string, string> = {
  customers_garage_id_number_key: 'errors.idNumberTaken',
};

/** `e` is whatever landed in a catch block. Errors carry their own text — there
 *  is usually no key for what a database has to say.
 *
 *  Not `String(e)`: Supabase rejects with a PostgrestError, which is a plain
 *  object with a `message` and not an Error, so stringifying one produced
 *  "[object Object]" — every database failure in the app reported itself as
 *  that. errorMessage knows the shape; see @garage/shared/auth. */
export const showError = (e: unknown) => {
  const text = errorMessage(e);
  const known = Object.keys(CONSTRAINT_KEYS).find((name) => text.includes(name));
  return known
    ? toastShown({ kind: 'error', key: CONSTRAINT_KEYS[known] })
    : toastShown({ kind: 'error', text });
};

/** For the failures we do have words for: a constraint we recognise, a rule the
 *  app enforces itself. Takes a key, so it reads in the user's language rather
 *  than the database's. */
export const showErrorKey = (key: string, values?: Toast['values']) =>
  toastShown({ kind: 'error', key, values });

export default toastSlice.reducer;
