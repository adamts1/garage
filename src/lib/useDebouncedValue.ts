import { useEffect, useState } from 'react';

/** How long typing has to pause before a search goes to the server. */
export const SEARCH_DEBOUNCE_MS = 300;

/** `value`, once it has stopped changing for `ms`. The box keeps up with every
 *  keystroke; the query behind it is sent once per pause, not once per letter. */
export function useDebouncedValue<T>(value: T, ms = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
