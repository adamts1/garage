import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCard, IconCheck, IconDoc } from './icons';
import type { Ticket } from './board-data';

const shekel = (n: number) =>
  n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₪';

export interface CloseResult {
  paid: boolean;
  method: string;
  doc: string;
  reference?: string;
}

interface Props {
  ticket: Ticket;
  total: number;
  onClose: () => void;
  onConfirm: (result: CloseResult) => void;
}

interface Method {
  id: string;
  label: string;
  icon: string;
  hint: string;
  /** what the reference field asks for, if anything */
  ref?: string;
  paid: boolean;
}

const METHODS: Method[] = [
  { id: 'cash', label: 'מזומן', icon: '💵', hint: 'תשלום במזומן בקופה', paid: true },
  { id: 'card', label: 'כרטיס אשראי', icon: '💳', hint: 'סליקה בטרמינל', ref: '4 סאי-תןת אחרונות', paid: true },
  { id: 'bit', label: 'ביט / פייבוקס', icon: '📱', hint: 'העברה מיידית', ref: 'מספר אסמכתא', paid: true },
  { id: 'transfer', label: 'העברה בנקאית', icon: '🏦', hint: 'העברה לחשבון המוסך', ref: 'מספר אסמכתא', paid: true },
  { id: 'check', label: 'צ׳ק', icon: '🧾', hint: 'צ׳ק לפקודת המוסך', ref: 'מספר צ׳ק', paid: true },
  { id: 'open', label: 'חיוב פתוח', icon: '🕓', hint: 'תשלום בהמשך - יתרה פתוחה', paid: false },
];

const STEPS = ['אמצעי תשלום', 'גבייה', 'סיכום'];

export default function CloseTicketDrawer({ ticket, total, onClose, onConfirm }: Props) {
  const [step, setStep] = useState(1);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [state, setState] = useState<'form' | 'charging' | 'done'>('form');

  const method = METHODS.find((m) => m.id === methodId) ?? null;
  const doc = method?.paid ? 'חשבונית מס-קבלה' : 'חשבונית מס (חיוב פתוח)';

  /* success → hand the result back to the page, which raises the toast */
  useEffect(() => {
    if (state !== 'done' || !method) return;
    const t = setTimeout(() => {
      onConfirm({ paid: method.paid, method: method.label, doc, reference: reference || undefined });
    }, 1500);
    return () => clearTimeout(t);
  }, [state, method, doc, reference, onConfirm]);

  const charge = () => {
    setState('charging');
    setTimeout(() => setState('done'), 900);   // stand-in for the terminal / provider call
  };

  const next = () => (step < 3 ? setStep(step + 1) : charge());

  /* ---------------- success screen ---------------- */
  if (state === 'done' && method) {
    return createPortal(
      <div className="close-scrim">
        <aside className="close-drawer">
          <div className="cd-success">
            <div className="cd-burst">
              <span className="cd-ring" />
              <span className="cd-tick"><IconCheck /></span>
            </div>
            <h3>{method.paid ? 'התשלום התקבל!' : 'הכרטיס נסגר'}</h3>
            <p className="cd-amount">{shekel(total)}</p>
            <p className="cd-doc">
              {method.paid ? `שולם ב${method.label}` : 'יתרה פתוחה לגבייה'} · הופק {doc}
            </p>
          </div>
        </aside>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="close-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="close-drawer" role="dialog" aria-modal="true">
        <header className="cd-head">
          <button className="cd-x" onClick={onClose} aria-label="סגור">✕</button>
          <h3>סגירת כרטיס וחיוב לקוח</h3>
        </header>

        <ol className="cd-steps" style={{ '--p': (step - 1) / (STEPS.length - 1) } as React.CSSProperties}>
          {STEPS.map((label, i) => {
            const n = i + 1;
            return (
              <li key={label} className={n === step ? 'on' : n < step ? 'done' : ''}>
                <span className="cd-dot">{n < step ? '✓' : n}</span>
                <span className="cd-label">{label}</span>
              </li>
            );
          })}
        </ol>

        <div className="cd-body">
          {/* ---------- 1. which payment method ---------- */}
          {step === 1 && (
            <>
              <div className="cd-card cd-summary">
                <div>
                  <span className="cd-k">מספר כרטיס</span>
                  <b>#{ticket.k.split('-')[1]}</b>
                  <span className="cd-k">לקוח</span>
                  <b>{ticket.customer}</b>
                </div>
                <div className="cd-total">
                  <span className="cd-k">סה״כ לתשלום</span>
                  <b>{shekel(total)}</b>
                </div>
              </div>

              <div className="cd-card">
                <h4>איך הלקוח משלם?</h4>
                <p className="cd-hint">בחר אמצעי תשלום כדי להמשיך</p>

                <div className="pay-grid">
                  {METHODS.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      className={`pay-card${methodId === m.id ? ' on' : ''}${m.paid ? '' : ' open'}`}
                      onClick={() => setMethodId(m.id)}
                    >
                      <span className="pay-ic">{m.icon}</span>
                      <b>{m.label}</b>
                      <span className="cd-sub">{m.hint}</span>
                      <span className="cd-radio" />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ---------- 2. collect ---------- */}
          {step === 2 && method && (
            <div className="cd-card">
              <h4>{method.paid ? `גבייה · ${method.label}` : 'חיוב פתוח'}</h4>
              <p className="cd-hint">
                {method.paid ? 'אשר את סכום הגבייה' : 'הכרטיס ייסגר עם יתרה פתוחה לגבייה'}
              </p>

              <div className="pay-amount">
                <span>סכום לגבייה</span>
                <b>{shekel(total)}</b>
              </div>

              {method.ref && (
                <div className="form-group">
                  <label>{method.ref} (אופציונלי)</label>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method.ref} />
                </div>
              )}

              <div className={`cd-info${method.paid ? ' ok' : ''}`}>
                <span className="cd-info-ic">{method.paid ? <IconCard /> : 'i'}</span>
                <div>
                  <b>{method.paid ? `יופק ${doc}` : 'יופק חשבונית מס - ללא קבלה'}</b>
                  <p>
                    {method.paid
                      ? 'המסמך יישלח ללקוח בסיום התהליך'
                      : 'ניתן לקלוט את התשלום ולהפיק קבלה מאוחר יותר מתוך הכרטיס'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ---------- 3. confirm ---------- */}
          {step === 3 && method && (
            <div className="cd-card">
              <h4>סיכום</h4>
              <p className="cd-hint">בדוק את הפרטים לפני סגירת הכרטיס</p>

              <dl className="kv cd-kv">
                <dt>כרטיס</dt><dd>#{ticket.k.split('-')[1]}</dd>
                <dt>לקוח</dt><dd>{ticket.customer}</dd>
                <dt>רכב</dt><dd>{ticket.car} · {ticket.plate}</dd>
                <dt>אמצעי תשלום</dt><dd>{method.icon} {method.label}</dd>
                {reference && (<><dt>{method.ref}</dt><dd>{reference}</dd></>)}
                <dt>מסמך להפקה</dt><dd>{doc}</dd>
                <dt>סה״כ</dt><dd><b className="cd-big">{shekel(total)}</b></dd>
              </dl>

              <div className={`cd-info${method.paid ? ' ok' : ''}`}>
                <span className="cd-info-ic">{method.paid ? <IconCheck /> : 'i'}</span>
                <div>
                  <b>{method.paid ? 'הכרטיס ייסגר וייחשב כשולם' : 'הכרטיס ייסגר עם יתרה פתוחה'}</b>
                  <p>יופק מסמך: {doc}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="cd-foot">
          <button
            className="btn ghost"
            onClick={step === 1 ? onClose : () => setStep(step - 1)}
            disabled={state === 'charging'}
          >
            {step === 1 ? 'ביטול' : 'הקודם'}
          </button>
          <button
            className="btn primary cd-next"
            onClick={next}
            disabled={(step === 1 && !method) || state === 'charging'}
          >
            {state === 'charging'
              ? <><span className="spinner" /> מבצע גבייה…</>
              : step === 3
                ? (method?.paid ? `גבה ${shekel(total)}` : 'סגור כרטיס')
                : 'המשך'}
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
