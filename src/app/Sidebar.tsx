import { garageName, signOut } from '@garage/shared';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import {
  IconBoard, IconBox, IconCard, IconClock, IconCustomers, IconDoc, IconParts,
  IconPin, IconReports, IconWrench,
} from '../icons';

/* The sidebar and the routing table are the same list. A page that is not here
   has no way in, which is the point — one place to add a screen. */
export const NAV_ITEMS = [
  { key: 'nav.board', path: '/', Icon: IconBoard },
  { key: 'nav.invoices', path: '/invoices', Icon: IconDoc },
  { key: 'nav.expenses', path: '/expenses', Icon: IconCard },
  { key: 'nav.suppliers', path: '/suppliers', Icon: IconBox },
  { key: 'nav.customers', path: '/customers', Icon: IconCustomers },
  { key: 'nav.workers', path: '/workers', Icon: IconWrench },
  { key: 'nav.items', path: '/items', Icon: IconParts },
  { key: 'nav.reports', path: '/reports', Icon: IconReports },
  { key: 'nav.archive', path: '/archive', Icon: IconClock },
];

/** A ticket lives under the board, so the board stays lit while one is open. */
export const isNavActive = (path: string, pathname: string) =>
  path === '/'
    ? pathname === '/' || pathname.startsWith('/tickets')
    : pathname.startsWith(path);

export interface SidebarProps {
  /** Shown in the footer — the count the garage actually watches. */
  activeCount: number;
  /* Both flags live in the shell: its grid is narrow or wide depending on the
     result, so it cannot be told after the fact. */
  expanded: boolean;
  pinned: boolean;
  onPinToggle: () => void;
  onHoverChange: (hovered: boolean) => void;
}

export default function Sidebar({
  activeCount, expanded, pinned, onPinToggle, onHoverChange,
}: SidebarProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
    <aside
      className={`sidebar${expanded ? '' : ' is-rail'}`}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div className="brand">
        <div className="brand-logo">מ</div>
        {expanded && (
          <>
            <div>
              {/* This garage's own name, from onboarding. App renders only once
                  AuthGate has a membership, so it is always resolved. */}
              <div className="brand-name">{garageName()}</div>
              <div className="brand-subtitle">{t('nav.subtitle')}</div>
            </div>
            <button
              className={`pin${pinned ? ' on' : ''}`}
              onClick={onPinToggle}
              title={t(pinned ? 'nav.unpin' : 'nav.pin')}
            >
              <IconPin filled={pinned} />
            </button>
          </>
        )}
      </div>

      <nav className="nav-list">
        {NAV_ITEMS.map((item) => (
          /* A real <a href>, not a button: middle-click and "open in new tab"
             work, and the browser shows where each item goes. */
          <Link
            key={item.key}
            to={item.path}
            className={isNavActive(item.path, pathname) ? 'nav-item active' : 'nav-item'}
            title={t(item.key)}
          >
            <span className="nav-icon"><item.Icon /></span>
            {expanded && <span className="nav-label">{t(item.key)}</span>}
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        {expanded ? (
          <>
            <div className="status-badge">{t('nav.open')}</div>
            <div className="footer-note">{t('nav.activeTickets', { count: activeCount })}</div>
            <button className="sign-out" onClick={() => void signOut()}>{t('nav.signOut')}</button>
          </>
        ) : (
          <>
            <div className="status-dot" title={t('nav.activeTickets', { count: activeCount })} />
            <button
              className="sign-out icon-only"
              onClick={() => void signOut()}
              title={t('nav.signOut')}
            >
              ⏻
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
