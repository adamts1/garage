import { useEffect } from 'react';
import { useAppDispatch } from '../../store';
import { toastDismissed, type Toast } from '../../store/toastSlice';

/** One timer per toast, owned by the toast's own component so it is cancelled
 *  when that toast unmounts. Owning them centrally meant a toast dismissed by
 *  hand left a timer that later dismissed whatever had taken its place. */
export function useToastTimer(toast: Toast, paused: boolean) {
  const dispatch = useAppDispatch();
  const { id, ttl } = toast;

  useEffect(() => {
    if (ttl <= 0 || paused) return;
    const timer = window.setTimeout(() => dispatch(toastDismissed(id)), ttl);
    return () => window.clearTimeout(timer);
    /* `paused` in the deps restarts the countdown when the pointer leaves,
       rather than resuming a few milliseconds short of it. Erring long is right
       here — the reason it was paused is that someone was reading it. */
  }, [dispatch, id, ttl, paused]);
}
