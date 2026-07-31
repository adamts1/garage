import { useAppDispatch, useAppSelector } from '../../store';
import { modalClosed } from '../../store/modalSlice';
import { MODAL_REGISTRY } from './registry';

/** Mounted once, at the root. Every modal in the app renders from here, which
 *  is what lets any component open one without owning it. */
export default function ModalHost() {
  const stack = useAppSelector((s) => s.modal.stack);
  const dispatch = useAppDispatch();

  if (stack.length === 0) return null;

  return (
    <>
      {stack.map((entry, i) => {
        const Component = MODAL_REGISTRY[entry.name];
        if (!Component) return null;
        return (
          <Component
            key={entry.id}
            id={entry.id}
            props={entry.props}
            isTop={i === stack.length - 1}
            stacked={i > 0}
            /* By id, not "the top one": a modal that closes itself while
               something has already opened over it must still close itself. */
            onClose={() => dispatch(modalClosed(entry.id))}
          />
        );
      })}
    </>
  );
}
