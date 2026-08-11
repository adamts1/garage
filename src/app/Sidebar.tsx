import { garageName, isGarageAdmin, signedInAs, signOut, type Worker } from '@garage/shared';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import {
  IconBoard, IconBox, IconCard, IconClock, IconCustomers, IconDoc, IconParts,
  IconPin, IconReports, IconToolbox, IconWrench,
} from '../icons';

/* The sidebar and the routing table are the same list. A page that is not here
   has no way in, which is the point — one place to add a screen. */
export const NAV_ITEMS = [
  { key: 'nav.board', path: '/', Icon: IconBoard },
  { key: 'nav.invoices', path: '/invoices', Icon: IconDoc },
  { key: 'nav.expenses', path: '/expenses', Icon: IconCard },
  { key: 'nav.suppliers', path: '/suppliers', Icon: IconBox },
  { key: 'nav.customers', path: '/customers', Icon: IconCustomers },
  /* The staff screen shows every colleague's email and is the only place a role
     is changed, so it is an admin's. The page redirects as well — hiding a link
     does nothing about an address somebody types. */
  { key: 'nav.workers', path: '/workers', Icon: IconWrench, adminOnly: true },
  { key: 'nav.works', path: '/works', Icon: IconToolbox },
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
  /* The staff list, only so the footer can name the person at the keyboard.
     Passed in rather than fetched: the shell already keeps it live for the
     board's avatars, and a rename on the staff screen has to reach here too. */
  workers: Worker[];
  /* Both flags live in the shell: its grid is narrow or wide depending on the
     result, so it cannot be told after the fact. */
  expanded: boolean;
  pinned: boolean;
  onPinToggle: () => void;
  onHoverChange: (hovered: boolean) => void;
}

export default function Sidebar({
  activeCount, workers, expanded, pinned, onPinToggle, onHoverChange,
}: SidebarProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  /* Who is signed in. Two people share a counter and one browser more often than
     anyone admits, and until now the only thing on screen that changed with the
     account was which links the sidebar drew — so "am I still logged in as
     Dani?" had no answer short of signing out to find out. */
  const me = signedInAs(workers);

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
        {NAV_ITEMS.filter((item) => !item.adminOnly || isGarageAdmin()).map((item) => (
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
            {me && (
              /* Above the sign-out button on purpose: the two questions are one
                 question — who is this, and get me out. */
              <div className="who">
                <span
                  className="who-avatar"
                  /* Their own colour off the staff palette, so the initials here
                     match the chip this person leaves on every ticket. */
                  style={me.color ? { background: me.color } : undefined}
                  aria-hidden
                >
                  {me.initials}
                </span>
                <span className="who-text">
                  <span className="who-name">{me.name}</span>
                  {/* The name can be a nickname two people answer to; the address
                      is the account. Both, when the rail is open to hold them. */}
                  {me.email && me.email !== me.name && (
                    <span className="who-email" title={me.email}>{me.email}</span>
                  )}
                </span>
              </div>
            )}
            <div className="status-badge">{t('nav.open')}</div>
            <div className="footer-note">{t('nav.activeTickets', { count: activeCount })}</div>
            <button className="sign-out" onClick={() => void signOut()}>{t('nav.signOut')}</button>
          </>
        ) : (
          <>
            {/* The rail has room for two letters and a tooltip, which is enough
                to answer "who am I" without pinning the sidebar open. */}
            {me && (
              <span
                className="who-avatar"
                style={me.color ? { background: me.color } : undefined}
                title={t('nav.signedInAs', { name: me.name })}
              >
                {me.initials}
              </span>
            )}
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
