import styles from './Toggle.module.css';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Already translated: the switch's accessible name. */
  label: string;
  disabled?: boolean;
}

/** An on/off switch. It reports the wish to change; the caller decides
 *  whether (and after which confirmation) the change happens, so `checked`
 *  always shows what is true, not what was clicked. A click on it never
 *  reaches a clickable row underneath. */
export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`${styles.track} ${checked ? styles.on : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className={styles.knob} aria-hidden="true" />
    </button>
  );
}
