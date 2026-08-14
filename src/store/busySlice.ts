import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';

/* Work the user is waiting on, held centrally so the thing that reports it does
   not have to be the thing that started it.

   Every screen already kept its own `busy` boolean and used it to grey out the
   button that had just been pressed. That is enough when the wait is short and
   the button is on screen — and it is nothing at all when a tax document is
   being issued at a provider over a network that may take five seconds, because
   a disabled button says "not now" and never says "working". People pressed
   again, navigated away mid-issue, and asked whether anything had happened.

   So a task here is a claim that the app is doing something on the user's
   behalf, and it carries the words for it. The local booleans stay: disabling
   the button that started the work is still right. This is the other half. */

export interface BusyTask {
  id: string;
  /** i18n key naming the work. Resolved at render, like a toast's — so a task
   *  that outlives a language switch redraws in the new language. */
  key: string;
}

export interface BusyState {
  tasks: BusyTask[];
}

const initialState: BusyState = { tasks: [] };

const busySlice = createSlice({
  name: 'busy',
  initialState,
  reducers: {
    /* A list rather than a flag, because two of these genuinely overlap: closing
       a ticket saves it and then issues its document, and an advisor can start
       something else while the provider is still answering. A boolean would be
       cleared by whichever finished first and leave the rest running silently —
       the exact failure the overlay exists to prevent. */
    busyStarted: {
      reducer(state, action: PayloadAction<BusyTask>) {
        state.tasks.push(action.payload);
      },
      prepare(key: string) {
        return { payload: { id: nanoid(), key } };
      },
    },

    busyEnded(state, action: PayloadAction<string>) {
      state.tasks = state.tasks.filter((task) => task.id !== action.payload);
    },

    /* Signing out, and the error boundary. Nothing else should need it: a task
       that ends by being cleared rather than by finishing is a leak, and this
       is the mop, not the plumbing. */
    busyCleared(state) {
      state.tasks = [];
    },
  },
});

export const { busyStarted, busyEnded, busyCleared } = busySlice.actions;

/** What to say while waiting. The newest task wins — it is the one the user
 *  just triggered, and the one they are looking for a response to. */
export const selectBusyKey = (state: { busy: BusyState }): string | null =>
  state.busy.tasks.length ? state.busy.tasks[state.busy.tasks.length - 1].key : null;

export default busySlice.reducer;
