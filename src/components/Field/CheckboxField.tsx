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
};

/**
 * The one control whose label does NOT go above it. A checkbox is read as
 * "[box] paid", so the label sits beside the box and the whole thing is one
 * click target; stacking it above would leave the box captioned by nothing.
 */
export function CheckboxField({ label, hint, disabled, ...input }: CheckboxFieldProps) {
  const { t } = useTranslation();
  const field = useField({ hint, disabled });

  return (
    <div className={styles.wrap}>
      <label className={styles.row} htmlFor={field.id}>
        <input type="checkbox" {...field.controlProps} {...input} className={styles.box} />
        <span>{t(label)}</span>
      </label>
      {hint && <p id={field.hintId} className={styles.hint}>{t(hint)}</p>}
    </div>
  );
}
