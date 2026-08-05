import { describe, expect, it } from 'vitest';
import { showError } from './toastSlice';

/* Every database failure in the app reached the screen through here, and every
   one of them said "[object Object]".
 *
 * Supabase rejects with a PostgrestError: a plain object carrying `message`,
 * `code`, `details` and `hint` — and NOT an instance of Error. The old
 * `e instanceof Error ? e.message : String(e)` therefore took the second branch
 * for exactly the errors that matter, and String() on an object gives the
 * useless string above. The operator saw it instead of "ת״ז זו כבר רשומה".
 */

const postgrest = {
  code: '23505',
  details: null,
  hint: null,
  message: 'duplicate key value violates unique constraint "customers_garage_id_number_key"',
};

describe('showError', () => {
  it('reads the message off a Supabase error, which is not an Error', () => {
    expect(postgrest instanceof Error).toBe(false);

    const { payload } = showError({ ...postgrest, message: 'permission denied for table customers' });
    expect(payload.text).toBe('permission denied for table customers');
  });

  it('still reads a real Error', () => {
    const { payload } = showError(new Error('נפילה'));
    expect(payload.text).toBe('נפילה');
  });

  it('falls back to the string form for anything else', () => {
    const { payload } = showError('לא ניתן להתחבר');
    expect(payload.text).toBe('לא ניתן להתחבר');
  });

  /* Three screens write a ת״ז and each checks before it writes, naming the
     customer who holds it. This is the floor under all of them: a race, or a
     path written next year, must still not put a constraint name in front of
     somebody at a service desk. */
  it('turns the duplicate-ת״ז constraint into words', () => {
    const { payload } = showError(postgrest);
    expect(payload.key).toBe('errors.idNumberTaken');
    expect(payload.text).toBeUndefined();
  });
});
