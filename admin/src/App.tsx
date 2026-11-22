import { useState } from 'react';
import type { Environment } from './api';
import { FunctionsView } from './FunctionsView';
import { GaragesView } from './GaragesView';
import { MigrationsView } from './MigrationsView';
import { useLoad } from './useLoad';

const TABS = [
  { id: 'garages', label: 'מוסכים' },
  { id: 'migrations', label: 'מיגרציות' },
  { id: 'functions', label: 'פונקציות' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<Tab>('garages');
  const envs = useLoad<Environment[]>('/api/environments');

  return (
    <div className="shell">
      <header className="top">
        <h1>קונסול ניהול</h1>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={t.id === tab ? 'tab on' : 'tab'} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <span className="hint">רץ מקומית בלבד · קריאה בלבד</span>
      </header>

      <main>
        {envs.error && <p className="error">{envs.error}</p>}
        {envs.data && tab === 'garages' && <GaragesView envs={envs.data} />}
        {envs.data && tab === 'migrations' && <MigrationsView envs={envs.data} />}
        {envs.data && tab === 'functions' && <FunctionsView envs={envs.data} />}
      </main>
    </div>
  );
}
