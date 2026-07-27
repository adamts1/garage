import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createExpense, deleteExpense, listExpenses, listSuppliers, setExpensePaid,
  subscribeToExpenses, syncExpense,
  type Supplier, type SupplierExpense, type ExpenseSyncStatus,
} from '@garage/shared';

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (iso: string) => new Date(iso).toLocaleDateString('he-IL');
const today = () => new Date().toISOString().slice(0, 10);

const SYNC_LABEL: Record<ExpenseSyncStatus, string> = { pending: 'ממתין לסנכרון', synced: 'סונכרן', error: 'שגיאת סנכרון' };

/* Print a supplier-expense record from our own stored data. iCount issues no
   printable document for an expense (it is not a document it creates — the
   printable original is the supplier's own invoice), so we format the record. */
const printExpense = (e: SupplierExpense) => {
  const w = window.open('', '_blank', 'width=720,height=900');
  if (!w) return;
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const row = (label: string, val: string) => `<tr><th>${label}</th><td>${esc(val)}</td></tr>`;
  w.document.write(`<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>הוצאת ספק ${esc(e.reference ?? '')}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;padding:36px;color:#111}
      h1{font-size:20px;margin:0 0 4px} .sub{color:#666;font-size:13px;margin-bottom:24px}
      table{width:100%;border-collapse:collapse}
      th,td{text-align:right;padding:9px 6px;border-bottom:1px solid #eee;font-size:14px}
      th{width:190px;color:#555;font-weight:600}
      .grand th,.grand td{font-size:18px;font-weight:800;border-top:2px solid #333}
      button{margin-top:28px;padding:9px 18px;font-size:14px;cursor:pointer}
      @media print{button{display:none}}
    </style></head><body>
    <h1>רישום הוצאת ספק</h1>
    <div class="sub">הופק ${new Date().toLocaleDateString('he-IL')}</div>
    <table>
      ${row('ספק', e.supplierName ?? '-')}
      ${row('תאריך', fmt(e.date))}
      ${row('מספר מסמך הספק', e.reference ?? '-')}
      ${row('קטגוריה', e.category ?? '-')}
      ${row('תיאור', e.description ?? '-')}
      ${row('סכום לפני מע״מ', shekel(e.subtotal))}
      ${row('מע״מ', shekel(e.vat))}
      <tr class="grand"><th>סה״כ</th><td>${esc(shekel(e.total))}</td></tr>
      ${row('תשלום', e.paid ? 'שולם' : 'טרם שולם')}
      ${e.providerExpenseId ? row('אסמכתא iCount', '#' + e.providerExpenseId) : ''}
    </table>
    <button onclick="window.print()">הדפס</button>
    </body></html>`);
  w.document.close();
};

type Draft = {
  supplierId: string; date: string; description: string; category: string;
  reference: string; subtotal: string; vatRate: string; paid: boolean;
};
const blank: Draft = { supplierId: '', date: today(), description: '', category: '', reference: '', subtotal: '', vatRate: '0.18', paid: false };

export default function ExpensesPage() {
  const [rows, setRows] = useState<SupplierExpense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    listExpenses().then(setRows).catch((e) => setErr(e.message));
    listSuppliers().then(setSuppliers).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    return subscribeToExpenses(load);
  }, [load]);

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(null), 5000); };

  // live VAT preview in the form
  const sub = Number(draft.subtotal) || 0;
  const rate = Number(draft.vatRate) || 0;
  const previewVat = Math.round(sub * rate * 100) / 100;
  const previewTotal = Math.round((sub + previewVat) * 100) / 100;

  const add = async () => {
    if (!draft.supplierId || !(Number(draft.subtotal) > 0)) return;
    setBusy(true); setErr(null);
    try {
      const created = await createExpense({
        supplierId: draft.supplierId, date: draft.date,
        description: draft.description, category: draft.category, reference: draft.reference,
        subtotal: Number(draft.subtotal), vatRate: Number(draft.vatRate), paid: draft.paid,
      });
      // native + sync together — the record exists regardless; report sync outcome.
      try {
        const synced = await syncExpense(created.id);
        flash(synced.syncStatus === 'synced' ? 'ההוצאה נשמרה וסונכרנה ל-iCount' : `נשמר, אך הסנכרון נכשל: ${synced.syncError ?? ''}`);
      } catch (e: any) {
        flash(`ההוצאה נשמרה, אך הסנכרון ל-iCount נכשל: ${e.message}`);
      }
      setDraft({ ...blank, date: draft.date }); setAdding(false); load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const retry = async (id: string) => {
    try { await syncExpense(id); load(); } catch (e: any) { setErr(e.message); }
  };
  const togglePaid = async (e: SupplierExpense) => {
    try { await setExpensePaid(e.id, !e.paid); load(); } catch (x: any) { setErr(x.message); }
  };
  const remove = async (e: SupplierExpense) => {
    if (!confirm('למחוק את ההוצאה? (הרישום ב-iCount, אם קיים, לא יימחק)')) return;
    try { await deleteExpense(e.id); load(); } catch (x: any) { setErr(x.message); }
  };

  const totals = useMemo(() => ({
    total: rows.reduce((s, e) => s + e.total, 0),
    unpaid: rows.filter((e) => !e.paid).reduce((s, e) => s + e.total, 0),
    unsynced: rows.filter((e) => e.syncStatus !== 'synced').length,
  }), [rows]);

  return (
    <>
      <div className="panel-header">
        <h2>הוצאות ספקים <span className="count-pill">{rows.length}</span></h2>
        <button className="btn primary" onClick={() => setAdding((v) => !v)} disabled={suppliers.length === 0}>
          {adding ? 'ביטול' : 'הוסף הוצאה'}
        </button>
      </div>

      {suppliers.length === 0 && <div className="db-error">יש להוסיף ספק אחד לפחות לפני רישום הוצאה (בעמוד ספקים).</div>}
      {err && <div className="db-error">{err}</div>}
      {note && <div className="bill-note ok">{note}</div>}

      <div className="inv-kpis">
        <div className="card inv-kpi"><div><b className="inv-kpi-val navy" dir="ltr">{shekel(totals.total)}</b><span className="inv-kpi-label">סה״כ הוצאות</span></div></div>
        <div className="card inv-kpi"><div><b className="inv-kpi-val warn" dir="ltr">{shekel(totals.unpaid)}</b><span className="inv-kpi-label">טרם שולם</span></div></div>
        <div className="card inv-kpi"><div><b className="inv-kpi-val danger" dir="ltr">{totals.unsynced}</b><span className="inv-kpi-label">לא סונכרנו</span></div></div>
      </div>

      {adding && (
        <div className="crud-form">
          <select value={draft.supplierId} onChange={(e) => setDraft({ ...draft, supplierId: e.target.value })} autoFocus>
            <option value="">בחר ספק…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          <input placeholder="תיאור" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <input placeholder="קטגוריה" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          <input placeholder="מספר מסמך הספק" value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} />
          <input placeholder="סכום לפני מע״מ" inputMode="decimal" value={draft.subtotal} onChange={(e) => setDraft({ ...draft, subtotal: e.target.value })} />
          <select value={draft.vatRate} onChange={(e) => setDraft({ ...draft, vatRate: e.target.value })}>
            <option value="0.18">מע״מ 18%</option>
            <option value="0">ללא מע״מ</option>
          </select>
          <label className="chk"><input type="checkbox" checked={draft.paid} onChange={(e) => setDraft({ ...draft, paid: e.target.checked })} /> שולם</label>
          <span className="exp-preview">מע״מ {shekel(previewVat)} · סה״כ {shekel(previewTotal)}</span>
          <button className="btn primary" onClick={add} disabled={busy || !draft.supplierId || !(Number(draft.subtotal) > 0)}>
            {busy ? 'שומר…' : 'שמור וסנכרן'}
          </button>
        </div>
      )}

      <section className="card rep-table-card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>תאריך</th><th>ספק</th><th>תיאור</th><th>אסמכתא</th>
                <th>לפני מע״מ</th><th>מע״מ</th><th>סה״כ</th><th>תשלום</th><th>סנכרון</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="muted-cell">{fmt(e.date)}</td>
                  <td><strong>{e.supplierName ?? '-'}</strong></td>
                  <td>{e.description || '-'}</td>
                  <td className="muted-cell">{e.reference || '-'}</td>
                  <td>{shekel(e.subtotal)}</td>
                  <td className="muted-cell">{shekel(e.vat)}</td>
                  <td><strong>{shekel(e.total)}</strong></td>
                  <td>
                    <button className={`status-pill${e.paid ? ' ok' : ''}`} onClick={() => togglePaid(e)} title="החלף מצב תשלום">
                      {e.paid ? 'שולם' : 'לתשלום'}
                    </button>
                  </td>
                  <td><SyncPill e={e} onRetry={() => retry(e.id)} /></td>
                  <td className="row-actions">
                    <button className="btn ghost sm" onClick={() => printExpense(e)}>הדפס</button>
                    <button className="btn ghost sm danger" onClick={() => remove(e)}>מחק</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={10} className="empty-note">לא נרשמו הוצאות</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function SyncPill({ e, onRetry }: { e: SupplierExpense; onRetry: () => void }) {
  if (e.syncStatus === 'synced') return <span className="inv-pill paid" title={`iCount #${e.providerExpenseId ?? ''}`}>{SYNC_LABEL.synced}</span>;
  if (e.syncStatus === 'error') return <button className="inv-pill overdue" onClick={onRetry} title={e.syncError ?? 'לחץ לניסיון חוזר'}>{SYNC_LABEL.error} · נסה שוב</button>;
  return <button className="inv-pill" onClick={onRetry} title="לחץ לסנכרון">{SYNC_LABEL.pending}</button>;
}
