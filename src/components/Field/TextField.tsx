import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import Field, { fieldStyles as styles, type FieldProps } from './Field';

type Shared = Omit<FieldProps, 'children'>;

/* `className` on these components dresses the wrapper, not the control — the
   control's look is the component's job. */
const controlClass = (error?: string) =>
  [styles.control, error ? styles.invalid : null].filter(Boolean).join(' ');

export type TextFieldProps = Shared &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'required' | 'disabled' | 'className'>;

/** The common case: a label above a single-line input. */
export function TextField({
  label, labelValues, hint, error, required, disabled, dense, className, ...input
}: TextFieldProps) {
  return (
    <Field {...{ label, labelValues, hint, error, required, disabled, dense, className }}>
      {(f) => <input {...f.controlProps} {...input} className={controlClass(error)} />}
    </Field>
  );
}

export type TextAreaFieldProps = Shared &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'required' | 'disabled' | 'className'>;

export function TextAreaField({
  label, labelValues, hint, error, required, disabled, dense, className, ...area
}: TextAreaFieldProps) {
  return (
    <Field {...{ label, labelValues, hint, error, required, disabled, dense, className }}>
      {(f) => <textarea {...f.controlProps} {...area} className={controlClass(error)} />}
    </Field>
  );
}

export type SelectFieldProps = Shared &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'required' | 'disabled' | 'className'>;

export function SelectField({
  label, labelValues, hint, error, required, disabled, dense, className, children, ...select
}: SelectFieldProps) {
  return (
    <Field {...{ label, labelValues, hint, error, required, disabled, dense, className }}>
      {(f) => (
        <select {...f.controlProps} {...select} className={controlClass(error)}>
          {children}
        </select>
      )}
    </Field>
  );
}
