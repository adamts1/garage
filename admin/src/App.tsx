import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnvironmentInfo } from './api/types';
import styles from './App.module.css';
import { LoadState } from './components';
import { IconCar, IconCode, IconLayers, IconLogo, IconPhone, IconPlusSquare } from './components/icons';
import { FunctionsPage } from './features/functions/FunctionsPage';
import { GaragesPage } from './features/garages/GaragesPage';
import { MigrationsPage } from './features/migrations/MigrationsPage';
import { MobilePage } from './features/mobile/MobilePage';
import { OnboardingPage } from './features/onboarding/OnboardingPage';
import { useLoad } from './hooks/useLoad';
import type { PageId } from './lib/nav';


const PAGES: readonly { id: PageId; label: string; icon: ReactNode }[] = [
  { id: 'garages', label: 'console.tabs.garages', icon: <IconCar /> },
  { id: 'onboard', label: 'console.tabs.onboard', icon: <IconPlusSquare /> },
  { id: 'migrations', label: 'console.tabs.migrations', icon: <IconLayers /> },
  { id: 'functions', label: 'console.tabs.functions', icon: <IconCode /> },
  { id: 'mobile', label: 'console.tabs.mobile', icon: <IconPhone /> },
];

const isPage = (v: string): v is PageId => PAGES.some((p) => p.id === v);
const pageFromHash = (): PageId => {
  const h = window.location.hash.slice(1);
  return isPage(h) ? h : 'garages';
};

export function App() {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageId>(pageFromHash);
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const envs = useLoad<EnvironmentInfo[]>('/api/environments');
  const current = PAGES.find((p) => p.id === page);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand} dir="ltr">
          <IconLogo />
          <span>Garagiox</span>
        </div>
        <nav className={styles.nav} aria-label={t('console.tabs.label')}>
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={`#${p.id}`}
              className={`${styles.navItem} ${p.id === page ? styles.active : ''}`}
              aria-current={p.id === page ? 'page' : undefined}
            >
              {p.icon}
              <span>{t(p.label)}</span>
            </a>
          ))}
        </nav>
        <div className={styles.footer}>
          <strong>{t('console.title')}</strong>
          <span>{t('console.localOnly')}</span>
        </div>
      </aside>

      <main className={styles.main}>
        <LoadState load={envs}>
          {(list) => (
            <>
              {page === 'garages' && <GaragesPage envs={list} />}
              {page !== 'garages' && <h1 className={styles.pageTitle}>{current && t(current.label)}</h1>}
              {page === 'onboard' && <OnboardingPage envs={list} />}
              {page === 'migrations' && <MigrationsPage envs={list} />}
              {page === 'functions' && <FunctionsPage envs={list} />}
              {page === 'mobile' && <MobilePage />}
            </>
          )}
        </LoadState>
      </main>
    </div>
  );
}
