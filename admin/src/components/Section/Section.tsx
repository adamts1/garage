import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Section.module.css';

export interface SectionProps {
  /** i18n key, or a node when the title carries more than text. */
  title: string | ReactNode;
  titleValues?: Record<string, string | number>;
  /** Next to the title: counts, a status pill. */
  aside?: ReactNode;
  /** At the far end of the header: buttons. */
  actions?: ReactNode;
  children?: ReactNode;
}

/** A white card with a header row. Every block on every console page is one. */
export function Section({ title, titleValues, aside, actions, children }: SectionProps) {
  const { t } = useTranslation();
  return (
    <section className={styles.section}>
      <header className={styles.head}>
        <h3 className={styles.title}>{typeof title === 'string' ? t(title, titleValues) : title}</h3>
        {aside && <div className={styles.aside}>{aside}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** A line of text inside a section, in one of the status tones. */
export function Note({ tone = 'muted', children }: { tone?: 'muted' | 'warn' | 'danger'; children: ReactNode }) {
  return <p className={`${styles.note} ${styles[tone]}`}>{children}</p>;
}
