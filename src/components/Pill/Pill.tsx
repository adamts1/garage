import type { ReactNode } from 'react';
import styles from './Pill.module.css';

export type PillTone = 'neutral' | 'ok' | 'warn' | 'danger';

export interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  title?: string;
  /** Makes it a real <button>. The old code styled a clickable span as a pill,
   *  so retrying a failed sync was reachable by mouse only. */
  onClick?: () => void;
}

export default function Pill({ children, tone = 'neutral', title, onClick }: PillProps) {
  const className = [
    styles.pill,
    tone !== 'neutral' ? styles[tone] : null,
    onClick ? styles.interactive : null,
  ].filter(Boolean).join(' ');

  if (onClick) {
    return (
      <button type="button" className={className} title={title} onClick={onClick}>
        {children}
      </button>
    );
  }

  return <span className={className} title={title}>{children}</span>;
}
