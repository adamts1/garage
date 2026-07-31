import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

/* The four that exist in the stylesheet today, named rather than assembled from
   modifiers. `btn ghost sm danger` was a string you had to know the cascade to
   read; these are a closed set the compiler checks.

   'danger' is the standalone bordered one (delete on the ticket page).
   'ghostDanger' is the quieter inline one used in table row actions. */
export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'ghostDanger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export default function Button({
  variant = 'ghost',
  size = 'md',
  className,
  /* Defaulted, because the intake form has a dozen buttons inside a <form> and
     the browser's default of "submit" made every one of them save the ticket.
     They each carried type="button" by hand; forgetting it was a live bug. */
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [styles.btn, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes} {...rest} />;
}
