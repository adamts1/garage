import type { Environment, Migration, MigrationsReply } from './api';
import { Badge, EnvHeader, versionDate } from './ui';
import { useLoad } from './useLoad';

export function MigrationsView({ envs }: { envs: Environment[] }) {
  return (
    <>
      <p className="muted intro">
        כל סביבה מושווית לענף שממנו היא נפרסת, ולקבצים שאצלך עכשיו. כדי שההשוואה לענף תהיה עדכנית, הרץ קודם
      </p>
      <pre className="cmd">git fetch origin</pre>
      {envs.map((env) => <EnvMigrations key={env.id} env={env} />)}
    </>
  );
}

function List({ items }: { items: Migration[] }) {
  return (
    <ul className="plain mono">
      {items.map((m) => (
        <li key={m.version}>
          {m.version} <span className="muted">({versionDate(m.version)})</span> {m.name}
        </li>
      ))}
    </ul>
  );
}

function EnvMigrations({ env }: { env: Environment }) {
  const load = useLoad<MigrationsReply>(`/api/migrations?env=${env.id}`);
  const m = load.data;
  const clean = m && m.pendingFromBranch.length === 0 && m.pendingFromTree.length === 0 && m.unknown.length === 0;

  return (
    <section className="card">
      <EnvHeader env={env} loading={load.loading} onReload={load.reload}>
        {m && <span className="muted">{m.applied.length} הוחלו · אחרונה {m.applied[m.applied.length - 1] ?? '—'}</span>}
        {clean && <Badge tone="ok">מעודכן</Badge>}
      </EnvHeader>
      {load.error && <p className="error">{load.error}</p>}
      {m && !m.branchKnown && m.gitRef && (
        <p className="warn-line">הענף {m.gitRef} לא קיים אצלך מקומית, אז אין השוואה אליו.</p>
      )}
      {m && m.pendingFromBranch.length > 0 && (
        <>
          <h4><Badge tone="bad">ממוזגות ל־{m.gitRef} ולא הוחלו</Badge></h4>
          <List items={m.pendingFromBranch} />
        </>
      )}
      {m && m.pendingFromTree.length > 0 && (
        <>
          <h4><Badge tone="warn">{env.id === 'local' ? 'בקבצים אצלך ולא הוחלו' : 'רק בענף שלך, לא הוחלו'}</Badge></h4>
          <List items={m.pendingFromTree} />
        </>
      )}
      {m && m.unknown.length > 0 && (
        <>
          <h4><Badge tone="bad">הוחלו, אבל אין להן קובץ בענף שלך</Badge></h4>
          <List items={m.unknown} />
        </>
      )}
    </section>
  );
}
