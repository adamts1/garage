import type { FormEvent, ReactNode } from 'react';
import styles from './CrudForm.module.css';

export interface CrudFormProps {
  children: ReactNode;
  /** Save / cancel. Kept out of `children` so they land after the fields
   *  whatever order the caller writes them in. */
  actions?: ReactNode;
  /** Runs on submit — which now includes pressing Enter in any field, the
   *  thing the old div-with-a-button version could not do. */
  onSubmit?: () => void;
}

/** The "add a row" panel the CRUD screens open above their table. */
export default function CrudForm({ children, actions, onSubmit }: CrudFormProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      {children}
      {actions && <div className={styles.actions}>{actions}</div>}
    </form>
  );
}
