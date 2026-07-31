import type { ComponentType } from 'react';
import ConfirmModal from './ConfirmModal';
import type { ModalComponentProps } from './types';

/* Every modal the app can open, by name. `dispatch(modalOpened({ name }))` from
   anywhere puts one on screen — no state threaded down through the page that
   happens to contain the trigger, which is how a delete confirm used to need
   three components to know about it.

   A name with no entry renders nothing rather than throwing: a stale action
   from a previous session should not take the app down. */
export const MODAL_REGISTRY: Record<string, ComponentType<ModalComponentProps>> = {
  confirm: ConfirmModal,
};

export type { ModalComponentProps };
