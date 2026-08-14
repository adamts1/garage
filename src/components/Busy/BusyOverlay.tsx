import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { selectBusyKey, useAppSelector } from '../../store';
import styles from './BusyOverlay.module.css';

/* How long work has to run before it is worth saying so.
 *
 * Most of what goes through here answers in well under this and the user sees
 * nothing, which is correct: an overlay that flashes for 80ms reads as a glitch,
 * and doing it on every save teaches people to distrust it. What it is for is
 * the wait that is long enough to wonder about — a document being issued at a
 * provider, an expense being pushed to the books. */
const SHOW_AFTER_MS = 350;

/** Mounted once, at the root. Anything anywhere can run work through
 *  `useBusyRun()` without threading a spinner prop to it. */
export default function BusyOverlay() {
  const { t } = useTranslation();
  const key = useAppSelector(selectBusyKey);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!key) {
      /* Down immediately. The delay is there to avoid announcing a wait that
         was not worth announcing — dragging out the end of one that was would
         just be a second wait, on top of work that has already finished. */
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [key]);

  if (!key || !shown) return null;

  return (
    /* aria-live rather than a dialog role: this announces itself and takes no
       focus. Work is already in flight and there is nothing here to act on, so
       moving focus would only cost the user their place when it goes. */
    <div className={styles.scrim} role="status" aria-live="polite">
      <div className={styles.card}>
        <span className={styles.spinner} />
        <span>{t(key)}</span>
      </div>
    </div>
  );
}
