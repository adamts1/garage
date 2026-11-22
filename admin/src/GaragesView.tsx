import { Fragment, useState } from 'react';
import type { Environment, Garage, GaragesReply } from './api';
import { Badge, day, EnvHeader } from './ui';
import { useLoad } from './useLoad';

const PROVIDERS: Record<string, string> = { icount: 'iCount', pelecard: 'Pelecard' };
const SOFTWARE: Record<string, string> = { rivhit: 'ריווחית', hashavshevet: 'חשבשבת' };

export function GaragesView({ envs }: { envs: Environment[] }) {
  return (
    <>
      {envs.map((env) => (
        <EnvGarages key={env.id} env={env} />
      ))}
    </>
  );
}

function EnvGarages({ env }: { env: Environment }) {
  const load = useLoad<GaragesReply>(`/api/garages?env=${env.id}`);
  const [open, setOpen] = useState<string | null>(null);
  const garages = load.data?.garages ?? [];

  return (
    <section className="card">
      <EnvHeader env={env} loading={load.loading} onReload={load.reload}>
        {load.data && <span className="muted">{garages.length} מוסכים</span>}
      </EnvHeader>
      {load.error && <p className="error">{load.error}</p>}
      {load.data && load.data.missingTables.length > 0 && (
        <p className="warn-line">חסרות טבלאות בסביבה הזו (מיגרציה לא הוחלה): {load.data.missingTables.join(', ')}</p>
      )}
      {load.data && garages.length === 0 && <p className="muted">אין מוסכים.</p>}
      {garages.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>מוסך</th>
              <th>נוצר</th>
              <th>מנהלים</th>
              <th>משתמשים</th>
              <th>חשבוניות</th>
              <th>סליקה</th>
              <th>הנהלת חשבונות</th>
            </tr>
          </thead>
          <tbody>
            {garages.map((g) => (
              <Fragment key={g.id}>
                <tr className="clickable" onClick={() => setOpen(open === g.id ? null : g.id)}>
                  <td><strong>{g.name}</strong></td>
                  <td>{day(g.createdAt)}</td>
                  <td>{g.members.filter((m) => m.role === 'admin').map((m) => m.email).join(', ') || <Badge tone="bad">אין מנהל</Badge>}</td>
                  <td>{g.members.length}</td>
                  <td><InvoicingBadge g={g} /></td>
                  <td><PaymentsBadge g={g} /></td>
                  <td><BookkeepingBadge g={g} /></td>
                </tr>
                {open === g.id && (
                  <tr className="details-row">
                    <td colSpan={7}><GarageDetails g={g} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function InvoicingBadge({ g }: { g: Garage }) {
  const b = g.invoicing;
  if (!b) return <Badge tone="off">לא מחובר</Badge>;
  const name = PROVIDERS[b.provider] ?? b.provider;
  if (!b.credentials) return <Badge tone="bad" title="יש הגדרות אבל אין פרטי התחברות">{name} · בלי פרטי התחברות</Badge>;
  return b.active ? <Badge tone="ok">{name} · פעיל</Badge> : <Badge tone="warn">{name} · כבוי</Badge>;
}

function PaymentsBadge({ g }: { g: Garage }) {
  const p = g.payments;
  if (!p) return <Badge tone="off">לא מחובר</Badge>;
  const name = PROVIDERS[p.provider] ?? p.provider;
  if (p.authFailedAt) return <Badge tone="bad" title={p.authError ?? ''}>{name} · הושעה</Badge>;
  if (!p.credentials) return <Badge tone="off" title="רק הגדרות תשלומים, בלי ספק סליקה">בלי ספק · עד {p.maxInstallments} תשלומים</Badge>;
  return p.active
    ? <Badge tone="ok">{name} · פעיל{p.shopNo ? ' · מסוף' : ''}</Badge>
    : <Badge tone="warn">{name} · כבוי</Badge>;
}

function BookkeepingBadge({ g }: { g: Garage }) {
  const k = g.bookkeeping;
  if (!k) return <Badge tone="off">—</Badge>;
  if (k.software === undefined) return <Badge tone="off" title="העמודה לא קיימת בסביבה הזו">לא ידוע</Badge>;
  if (!k.software) return <Badge tone="warn" title="ייצוא נחסם עד שנבחרת תוכנה">לא נבחרה תוכנה</Badge>;
  return <Badge tone="ok">{SOFTWARE[k.software] ?? k.software}</Badge>;
}

const LETTERHEAD_LABELS: Record<string, string> = {
  printName: 'שם להדפסה', motto: 'מוטו', services: 'שירותים', address: 'כתובת',
  phone: 'טלפון', fax: 'פקס', licenseNo: 'מספר רישיון', taxId: 'ח״פ / ע״מ',
};

function GarageDetails({ g }: { g: Garage }) {
  return (
    <div className="details">
      <div>
        <h4>מזהה</h4>
        <code className="select">{g.id}</code>

        <h4>משתמשים</h4>
        <ul className="plain">
          {g.members.map((m) => (
            <li key={m.email}>
              {m.email} · {m.role === 'admin' ? 'מנהל' : 'משתמש'}
              <span className="muted"> · כניסה אחרונה {day(m.lastSignIn)}</span>
            </li>
          ))}
          {g.members.length === 0 && <li className="muted">אין משתמשים</li>}
        </ul>
      </div>

      <div>
        <h4>נייר מכתבים</h4>
        <dl>
          {Object.entries(LETTERHEAD_LABELS).map(([k, label]) => (
            <Fragment key={k}>
              <dt>{label}</dt>
              <dd>{g.letterhead[k] ?? <span className="muted">—</span>}</dd>
            </Fragment>
          ))}
        </dl>
      </div>

      <div>
        <h4>חשבוניות</h4>
        {g.invoicing ? (
          <dl>
            <dt>ספק</dt><dd>{PROVIDERS[g.invoicing.provider] ?? g.invoicing.provider}</dd>
            <dt>פעיל</dt><dd>{g.invoicing.active ? 'כן' : 'לא'}</dd>
            <dt>פרטי התחברות</dt><dd>{g.invoicing.credentials ? 'שמורים' : 'חסרים'}</dd>
            <dt>סוג מסמך</dt><dd>{g.invoicing.docType === 'tax_invoice' ? 'חשבונית מס' : 'חשבונית מס קבלה'}</dd>
            <dt>מע״מ</dt><dd>{Math.round(g.invoicing.vatRate * 100)}%</dd>
            <dt>מייל רו״ח</dt><dd>{g.bookkeeping?.accountantEmail ?? <span className="muted">—</span>}</dd>
            <dt>עודכן</dt><dd>{day(g.invoicing.updatedAt)}</dd>
          </dl>
        ) : <p className="muted">לא מחובר</p>}

        <h4>סליקה</h4>
        {g.payments ? (
          <dl>
            <dt>ספק</dt><dd>{g.payments.credentials ? (PROVIDERS[g.payments.provider] ?? g.payments.provider) : 'אין'}</dd>
            <dt>פעיל</dt><dd>{g.payments.active ? 'כן' : 'לא'}</dd>
            <dt>מסוף</dt><dd>{g.payments.shopNo ?? <span className="muted">אין (הקלדת כרטיס בלבד)</span>}</dd>
            <dt>תשלומים</dt><dd>עד {g.payments.maxInstallments}, מ־₪{g.payments.installmentsMin}</dd>
            {g.payments.authFailedAt && (<><dt>הושעה</dt><dd className="error">{day(g.payments.authFailedAt)} · {g.payments.authError}</dd></>)}
          </dl>
        ) : <p className="muted">לא מחובר</p>}
      </div>
    </div>
  );
}
