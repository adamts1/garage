import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnvironmentInfo } from './api/types';
import styles from './App.module.css';
import { LoadState, TabPanel, Tabs, type TabDef } from './components';
import { FunctionsPage } from './features/functions/FunctionsPage';
import { GaragesPage } from './features/garages/GaragesPage';
import { MigrationsPage } from './features/migrations/MigrationsPage';
import { MobilePage } from './features/mobile/MobilePage';
import { OnboardingPage } from './features/onboarding/OnboardingPage';
import { useLoad } from './hooks/useLoad';

type TabId = 'garages' | 'onboard' | 'migrations' | 'functions' | 'mobile';

const TABS: readonly TabDef<TabId>[] = [
  { id: 'garages', label: 'console.tabs.garages' },
  { id: 'onboard', label: 'console.tabs.onboard' },
  { id: 'migrations', label: 'console.tabs.migrations' },
  { id: 'functions', label: 'console.tabs.functions' },
  { id: 'mobile', label: 'console.tabs.mobile' },
];

const isTab = (v: string): v is TabId => TABS.some((tab) => tab.id === v);
const tabFromHash = (): TabId => {
  const h = window.location.hash.slice(1);
  return isTab(h) ? h : 'garages';
};

export function App() {
  const { t } = useTranslation();
  /* The tab lives in the address (#onboard), so a refresh — or the dev
     server's own reload after an edit — keeps you where you were. */
  const [tab, setTab] = useState<TabId>(tabFromHash);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const select = (id: TabId) => {
    window.location.hash = id;
    setTab(id);
  };
  const envs = useLoad<EnvironmentInfo[]>('/api/environments');

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <h1 className={styles.title}>{t('console.title')}</h1>
        <Tabs tabs={TABS} selected={tab} onSelect={select} label="console.tabs.label" />
        <span className={styles.hint}>{t('console.localOnly')}</span>
      </header>

      <LoadState load={envs}>
        {(list) => (
          <TabPanel id={tab}>
            {tab === 'garages' && <GaragesPage envs={list} />}
            {tab === 'onboard' && <OnboardingPage envs={list} />}
            {tab === 'migrations' && <MigrationsPage envs={list} />}
            {tab === 'functions' && <FunctionsPage envs={list} />}
            {tab === 'mobile' && <MobilePage />}
          </TabPanel>
        )}
      </LoadState>
    </div>
  );
}
