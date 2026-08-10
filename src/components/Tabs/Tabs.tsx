import { useTranslation } from 'react-i18next';
import styles from './Tabs.module.css';

/**
 * A row of tabs over one panel.
 *
 * Real buttons in a real tablist, wired the way the pattern says: arrow keys
 * move between tabs, only the selected one is in the tab order, and each panel
 * names the tab that controls it. A row of styled divs would look identical and
 * be unreachable without a mouse.
 *
 * It owns nothing. The selected id lives in the page, because on the reports
 * page it decides which data gets loaded at all — a tab strip that kept its own
 * secret would have the page guessing what is on screen.
 */
export interface TabDef<Id extends string = string> {
  id: Id;
  /** i18n key. */
  label: string;
}

export interface TabsProps<Id extends string = string> {
  tabs: readonly TabDef<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
  /** Names the strip for a screen reader — "reports", not "tabs". */
  label: string;
}

export default function Tabs<Id extends string = string>({
  tabs, selected, onSelect, label,
}: TabsProps<Id>) {
  const { t } = useTranslation();

  /* Arrow keys move the selection, wrapping at both ends. Home and End jump to
     the edges, which is the difference between four tabs and forty. */
  const onKeyDown = (e: React.KeyboardEvent, at: number) => {
    const last = tabs.length - 1;
    const to =
      e.key === 'ArrowRight' ? (at === last ? 0 : at + 1)
      : e.key === 'ArrowLeft' ? (at === 0 ? last : at - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (to === null) return;
    e.preventDefault();
    onSelect(tabs[to].id);
  };

  return (
    <div className={styles.tabs} role="tablist" aria-label={t(label)}>
      {tabs.map((tab, at) => {
        const active = tab.id === selected;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`panel-${tab.id}`}
            /* Only the selected tab is tabbable: Tab enters the strip and then
               leaves it for the panel, and the arrows move within. */
            tabIndex={active ? 0 : -1}
            className={active ? `${styles.tab} ${styles.active}` : styles.tab}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(e) => onKeyDown(e, at)}
          >
            {t(tab.label)}
          </button>
        );
      })}
    </div>
  );
}

/** The panel a tab controls. Focusable, so Tab out of the strip lands on the
 *  content it just selected rather than skipping past it. */
export function TabPanel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0}>
      {children}
    </div>
  );
}
