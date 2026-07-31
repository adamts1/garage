import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Field.module.css';
import { useField, type FieldIds } from './useField';

export interface FieldProps {
  /** i18n key. Never raw text — that is the whole point of the component. */
  label: string;
  labelValues?: Record<string, string | number>;
  /** i18n key for the helper line under the control. */
  hint?: string;
  /** Final text, not a key: validation messages usually come from the server. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Tighter spacing for the intake form, which has to fit on one screen. */
  dense?: boolean;
  className?: string;
  /** A plain node, or a function handed the id and aria to spread on the
   *  control. Use the function form for anything the label must point at. */
  children: ReactNode | ((field: FieldIds) => ReactNode);
}

export default function Field({
  label,
  labelValues,
  hint,
  error,
  required,
  disabled,
  dense,
  className,
  children,
}: FieldProps) {
  const { t } = useTranslation();
  const field = useField({ hint, error, required, disabled });

  const classes = [styles.field, dense ? styles.dense : null, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <label
        htmlFor={field.id}
        className={`${styles.label}${required ? ` ${styles.required}` : ''}`}
      >
        {t(label, labelValues)}
      </label>

      {typeof children === 'function' ? children(field) : children}

      {/* The error takes the place of the hint rather than stacking under it —
          two lines of small text below a field is where people stop reading. */}
      {error ? (
        <p id={field.errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={field.hintId} className={styles.hint}>
          {t(hint)}
        </p>
      ) : null}
    </div>
  );
}

export { styles as fieldStyles };
