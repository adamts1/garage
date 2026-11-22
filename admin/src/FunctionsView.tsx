import { useState } from 'react';
import type { DriftReply, Environment, FunctionsReply } from './api';
import { Badge, day } from './ui';
import { useLoad } from './useLoad';

export function FunctionsView({ envs }: { envs: Environment[] }) {
  const load = useLoad<FunctionsReply>('/api/functions');
  const remote = envs.filter((e) => e.ref);
  const f = load.data;

  return (
    <>
      <section className="card">
        <div className="env-head">
          <h2>פריסה לפי סביבה</h2>
          <span className="muted">השוואה לפי חתימת הקוד שרץ בפועל</span>
          <button className="ghost" onClick={load.reload} disabled={load.loading}>{load.loading ? 'טוען…' : 'רענון'}</button>
        </div>
        {load.error && <p className="error">{load.error}</p>}
        {f && Object.entries(f.errors).map(([id, msg]) => (
          <p key={id} className="error">לא הצלחתי לקרוא את {envs.find((e) => e.id === id)?.label}: {msg}</p>
        ))}
        {f && (
          <table>
            <thead>
              <tr>
                <th>פונקציה</th>
                {remote.map((e) => <th key={e.id}>{e.label}</th>)}
                <th>בין הסביבות</th>
              </tr>
            </thead>
            <tbody>
              {f.rows.map((r) => (
                <tr key={r.name}>
                  <td>
                    <code>{r.name}</code>
                    {!r.inRepo && <> <Badge tone="warn">אין קוד במאגר</Badge></>}
                  </td>
                  {remote.map((e) => {
                    const d = r.deployed[e.id];
                    if (d === undefined) return <td key={e.id} className="muted">לא ידוע</td>;
                    if (d === null) return <td key={e.id}><Badge tone="bad">לא נפרסה</Badge></td>;
                    return (
                      <td key={e.id}>
                        v{d.version} · {day(d.updatedAt)} <code className="muted">{d.hash?.slice(0, 8)}</code>
                      </td>
                    );
                  })}
                  <td>
                    {r.sameEverywhere === true && <Badge tone="ok">אותו קוד</Badge>}
                    {r.sameEverywhere === false && <Badge tone="warn">קוד שונה</Badge>}
                    {r.sameEverywhere === null && <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {remote.map((e) => <Drift key={e.id} env={e} />)}
    </>
  );
}

/** The slow check: download what runs and compare it byte for byte with git.
 *  Only on request — it is one download per function. */
function Drift({ env }: { env: Environment }) {
  const [asked, setAsked] = useState(false);
  const load = useLoad<DriftReply>(asked ? `/api/functions/drift?env=${env.id}` : null);
  const d = load.data;
  const off = d?.results.filter((r) => !r.deployed || r.noSource || r.error || r.sameAsRef === false) ?? [];

  return (
    <section className="card">
      <div className="env-head">
        <h2><span className={`env-dot ${env.id}`} />{env.label} מול {env.gitRef}</h2>
        <span className="muted">הורדה של הקוד שרץ והשוואה בייט מול בייט · לוקח כדקה</span>
        <button className="ghost" onClick={() => (asked ? load.reload() : setAsked(true))} disabled={load.loading}>
          {load.loading ? 'בודק…' : asked ? 'בדיקה מחדש' : 'בדיקה'}
        </button>
      </div>
      {load.error && <p className="error">{load.error}</p>}
      {d && off.length === 0 && <p><Badge tone="ok">כל הפונקציות זהות ל־{d.gitRef}</Badge></p>}
      {d && off.length > 0 && (
        <ul className="plain">
          {off.map((r) => (
            <li key={r.name}>
              <code>{r.name}</code>{' '}
              {!r.deployed && <Badge tone="bad">לא נפרסה</Badge>}
              {r.noSource && <Badge tone="warn">רצה, אבל אין לה קוד במאגר</Badge>}
              {r.error && <Badge tone="bad" title={r.error}>לא הצלחתי להוריד</Badge>}
              {r.sameAsRef === false && (
                <>
                  <Badge tone="warn">שונה מ־{d.gitRef}</Badge>
                  {r.matchesTree && <span className="muted"> (זהה לקבצים אצלך)</span>}
                  <span className="muted mono"> {r.offRef?.join(', ')}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {d && off.length > 0 && (
        <>
          <p className="muted">לפרוס את הקוד של {d.gitRef}:</p>
          <pre className="cmd">npm run functions:push{env.id === 'production' ? ':prod' : ''} &lt;name&gt;</pre>
        </>
      )}
    </section>
  );
}
