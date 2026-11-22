import type { ReactNode } from 'react';
import type { Environment } from './api';

export function EnvHeader({ env, loading, onReload, children }: {
  env: Environment;
  loading: boolean;
  onReload: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="env-head">
      <h2>
        <span className={`env-dot ${env.id}`} />
        {env.label}
        {env.ref && <code className="muted">{env.ref}</code>}
      </h2>
      {children}
      <button className="ghost" onClick={onReload} disabled={loading}>
        {loading ? 'טוען…' : 'רענון'}
      </button>
    </div>
  );
}

export function Badge({ tone, children, title }: { tone: 'ok' | 'warn' | 'bad' | 'off'; children: ReactNode; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

export const day = (v: string | number | null | undefined) =>
  v == null ? '—' : new Date(v).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** 20261124090000 → 24.11.2026 09:00, for reading a migration version at a glance. */
export const versionDate = (v: string) =>
  `${v.slice(6, 8)}.${v.slice(4, 6)}.${v.slice(0, 4)} ${v.slice(8, 10)}:${v.slice(10, 12)}`;
