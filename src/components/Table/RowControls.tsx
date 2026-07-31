import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import styles from './RowControls.module.css';

export interface RowActionsProps {
  children: ReactNode;
}

/** The buttons at the end of a row. Every CRUD screen had its own copy of this
 *  flex rule, and they had drifted to three different gaps. */
export function RowActions({ children }: RowActionsProps) {
  return <div className={styles.actions}>{children}</div>;
}

export type CellInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Required. A cell has no visible label, so without this the field is
   *  unnamed to anyone not looking at the column header — which a screen
   *  reader is not. */
  'aria-label': string;
};

/** An input sized to live inside a table cell: no block margin, no label. Use
 *  `Field` anywhere the label can actually be shown. */
export function CellInput({ className, ...rest }: CellInputProps) {
  return <input className={[styles.cell, className].filter(Boolean).join(' ')} {...rest} />;
}

export type CellSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  'aria-label': string;
};

export function CellSelect({ className, ...rest }: CellSelectProps) {
  return <select className={[styles.cell, className].filter(Boolean).join(' ')} {...rest} />;
}
