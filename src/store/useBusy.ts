import { useCallback } from 'react';
import { useAppDispatch } from './index';
import { busyEnded, busyStarted } from './busySlice';

/** Runs `work` with the overlay up, and takes it down however the work ends.
 *
 *  The pairing is the whole point: a started task that is never ended leaves the
 *  app looking permanently busy, and the one place that reliably runs is a
 *  `finally`. Callers should never dispatch busyStarted themselves.
 *
 *  Errors are re-thrown, not swallowed. The caller already has a catch that
 *  knows what the failure means and which words to put on it — this only owns
 *  the spinner.
 *
 *      const run = useBusyRun();
 *      await run('busy.issuingInvoice', () => issueInvoice(key, docType));
 */
export function useBusyRun() {
  const dispatch = useAppDispatch();

  return useCallback(
    async <T>(key: string, work: () => Promise<T>): Promise<T> => {
      const { payload } = dispatch(busyStarted(key));
      try {
        return await work();
      } finally {
        dispatch(busyEnded(payload.id));
      }
    },
    [dispatch],
  );
}
