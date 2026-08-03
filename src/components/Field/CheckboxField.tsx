import type { InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './CheckboxField.module.css';
import { useField } from './useField';

export type CheckboxFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'type' | 'className'
> & {
  /** i18n key. */
  label: string;
  hint?: string;
  /** Final text, not a key — same contract as Field's. A checkbox can be a
   *  required answer too: the intake form will not open a ticket until the key
   *  has been received. */
  error?: string;
  required?: boolean;
};

/**
 * The one control whose label does NOT go above it. A checkbox is read as
 * "[box] paid", so the label sits beside the box and the whole thing is one
 * click target; stacking it above would leave the box captioned by nothing.
 */
export function CheckboxField({
  label, hint, error, required, disabled, ...input
}: CheckboxFieldProps) {
  const { t } = useTranslation();
  const field = useField({ hint, error, required, disabled });

  return (
    <div className={styles.wrap}>
      <label className={`${styles.row}${error ? ` ${styles.invalid}` : ''}`} htmlFor={field.id}>
        <input type="checkbox" {...field.controlProps} {...input} className={styles.box} />
        <span>{t(label)}{required && <span aria-hidden="true"> *</span>}</span>
      </label>
      {/* The error replaces the hint rather than stacking under it — same rule
          as Field, for the same reason: two lines of small text is where people
          stop reading. */}
      {error ? (
        <p id={field.errorId} className={styles.error} role="alert">{error}</p>
      ) : hint ? (
        <p id={field.hintId} className={styles.hint}>{t(hint)}</p>
      ) : null}
    </div>
  );
}
