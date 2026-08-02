import type { ComponentType } from 'react';
import ItemPickerModal from '../../features/works/ItemPickerModal';
import WorkPickerModal from '../../features/works/WorkPickerModal';
import ConfirmModal from './ConfirmModal';
import type { ModalComponentProps } from './types';

/* Every modal the app can open, by name. `dispatch(modalOpened({ name }))` from
   anywhere puts one on screen — no state threaded down through the page that
   happens to contain the trigger, which is how a delete confirm used to need
   three components to know about it.

   A name with no entry renders nothing rather than throwing: a stale action
   from a previous session should not take the app down.

   The pickers live under features/ because they know what a work and a part
   are. Only their names are known here. */
export const MODAL_REGISTRY: Record<string, ComponentType<ModalComponentProps>> = {
  confirm: ConfirmModal,
  workPicker: WorkPickerModal,
  partPicker: ItemPickerModal,
};

export type { ModalComponentProps };
