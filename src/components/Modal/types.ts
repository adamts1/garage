import type { ModalProps as StoredProps } from '../../store/modalSlice';

/** What ModalHost hands each registered modal. The modal's own configuration
 *  arrives in `props`, straight from the store, so it is serialisable and
 *  nothing more. */
export interface ModalComponentProps {
  /** This modal's id in the stack. Pass it to `modalClosed` to close exactly
   *  this one rather than whatever happens to be on top. */
  id: string;
  props: StoredProps;
  isTop: boolean;
  stacked: boolean;
  /** Closes this modal. Does not settle anything — a modal that owes its caller
   *  an answer settles it first. */
  onClose: () => void;
}
