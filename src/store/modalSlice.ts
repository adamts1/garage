import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';

/** Props are held in the store, so they must survive being serialised — no
 *  callbacks, no class instances, no React elements. A modal that needs to hand
 *  an answer back does it the way `useConfirm` does: an id in the props and a
 *  resolver held outside the store. */
export type ModalProps = Record<string, string | number | boolean | null | undefined>;

export interface OpenModal {
  id: string;
  /** A key in the ModalHost registry. An unknown name renders nothing. */
  name: string;
  props: ModalProps;
}

export interface ModalState {
  /* A stack, not a single slot. Deleting a row from inside an editor opens a
     confirm over the editor, and the editor has to still be there underneath
     when the confirm closes. */
  stack: OpenModal[];
}

const initialState: ModalState = { stack: [] };

const modalSlice = createSlice({
  name: 'modal',
  initialState,
  reducers: {
    modalOpened: {
      reducer(state, action: PayloadAction<OpenModal>) {
        state.stack.push(action.payload);
      },
      prepare(input: { name: string; props?: ModalProps }) {
        return { payload: { id: nanoid(), name: input.name, props: input.props ?? {} } };
      },
    },

    /** No id closes the top one — what Escape and the backdrop mean. */
    modalClosed(state, action: PayloadAction<string | undefined>) {
      const id = action.payload;
      if (!id) {
        state.stack.pop();
        return;
      }
      state.stack = state.stack.filter((m) => m.id !== id);
    },

    modalsCleared(state) {
      state.stack = [];
    },
  },
});

export const { modalOpened, modalClosed, modalsCleared } = modalSlice.actions;

export default modalSlice.reducer;
