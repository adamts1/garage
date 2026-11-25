import type { EnvId, EnvironmentInfo } from '../../api/types';
import { EnvName } from '../EnvSection/EnvSection';
import styles from './EnvPicker.module.css';

export interface EnvPickerProps {
  envs: readonly EnvironmentInfo[];
  selected: EnvId;
  onSelect: (id: EnvId) => void;
  /** A number (or text) per environment, shown after its name. */
  counts?: Partial<Record<EnvId, string | number | null>>;
  /** i18n-free accessible name for the group. */
  label: string;
}

/** One environment at a time: a segmented control with each one's colour. */
export function EnvPicker({ envs, selected, onSelect, counts, label }: EnvPickerProps) {
  return (
    <div className={styles.group} role="radiogroup" aria-label={label}>
      {envs.map((env) => (
        <button
          key={env.id}
          type="button"
          role="radio"
          aria-checked={env.id === selected}
          className={`${styles.option} ${env.id === selected ? styles.selected : ''}`}
          onClick={() => onSelect(env.id)}
        >
          <EnvName env={env} />
          {counts?.[env.id] != null && <span className={styles.count}>{counts[env.id]}</span>}
        </button>
      ))}
    </div>
  );
}
