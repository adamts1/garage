import type { PartDef, PartRow, WorkDef } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Field';
import Modal from '../../components/Modal/Modal';
import type { ModalComponentProps } from '../../components/Modal/types';
import { PickerModal } from '../../components/PickerModal';
import { CellInput, RowActions, Table, type Column } from '../../components/Table';
import { settleModal } from '../../store/useModalResult';
import { useCatalog } from '../catalog/CatalogProvider';
import { usePickPart } from './usePickers';
import styles from './pickers.module.css';

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');
const norm = (s: string) => s.trim().toLowerCase();

/** Reached through `usePickWork()`. Resolves the chosen work, or null. */
export default function WorkPickerModal({ props, isTop, stacked, onClose }: ModalComponentProps) {
  const { t } = useTranslation();
  const { works, addWork } = useCatalog();
  const pickPart = usePickPart();

  const resultId = String(props.resultId ?? '');
  const initialQuery = String(props.initialQuery ?? '');

  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [items, setItems] = useState<PartRow[]>([]);

  const answer = (def: WorkDef | null) => {
    settleModal(resultId, def);
    onClose();
  };

  const startCreate = (typed: string) => {
    const looksLikeCode = /^[A-Za-z0-9\-_]+$/.test(typed);
    setCode(looksLikeCode ? typed.toUpperCase() : '');
    setName(looksLikeCode ? '' : typed);
    setPrice('');
    setItems([]);
    setMode('create');
  };

  /* Opens the part picker over this dialog. The modal stack is what makes that
     work: this one stays mounted underneath, so the half-built work survives. */
  const addItem = async () => {
    const part = await pickPart({ taken: items.map((i) => i.sku) });
    if (!part) return;
    setItems((prev) => (prev.some((i) => i.sku === part.sku) ? prev : [...prev, { ...part, qty: 1 }]));
  };

  const patch = (sku: string, next: Partial<PartRow>) =>
    setItems((prev) => prev.map((i) => (i.sku === sku ? { ...i, ...next } : i)));

  const submit = () => {
    if (!name.trim()) return;
    const def: WorkDef = {
      id: `custom-${Date.now()}`,
      code: (code.trim() || name.trim().slice(0, 6)).toUpperCase(),
      name: name.trim(),
      labor: Number(price) || 0,
      hours: 0,
      items,
    };
    addWork(def);   // joins the catalogue
    answer(def);
  };

  if (mode === 'search') {
    return (
      <PickerModal<WorkDef>
        title="picker.work.title"
        searchPlaceholder="picker.work.search"
        items={works}
        itemKey={(w) => w.id}
        match={(w, q) => norm(w.code).includes(norm(q)) || norm(w.name).includes(norm(q))}
        emptyKey="picker.work.empty"
        createLabel="picker.work.create"
        initialQuery={initialQuery}
        isTop={isTop}
        stacked={stacked}
        onPick={answer}
        onCreate={startCreate}
        onClose={() => answer(null)}
        renderRow={(w) => (
          <>
            <span className={styles.code}>{w.code}</span>
            <span className={styles.name}>
              {w.name}
              {w.id.startsWith('custom-') && <span className={styles.badge}>{t('picker.work.new')}</span>}
            </span>
            <span className={styles.parts}>
              {w.items.length ? t('picker.work.partCount', { count: w.items.length }) : t('picker.work.noParts')}
            </span>
            <span className={styles.price}>{shekel(w.labor)}</span>
          </>
        )}
      />
    );
  }

  const columns: Column<PartRow>[] = [
    { key: 'sku', header: 'items.fields.sku', width: 130, cellClassName: styles.muted, render: (i) => i.sku },
    { key: 'name', header: 'items.fields.name', render: (i) => i.name },
    {
      key: 'qty',
      header: 'picker.work.qty',
      width: 90,
      render: (i) => (
        <CellInput
          type="number"
          min={1}
          value={i.qty}
          aria-label={t('picker.work.qty')}
          onChange={(e) => patch(i.sku, { qty: Number(e.target.value) || 0 })}
        />
      ),
    },
    {
      key: 'price',
      header: 'items.fields.price',
      width: 110,
      render: (i) => (
        <CellInput
          type="number"
          min={0}
          value={i.price}
          aria-label={t('items.fields.price')}
          onChange={(e) => patch(i.sku, { price: Number(e.target.value) || 0 })}
        />
      ),
    },
    {
      key: 'actions',
      width: 60,
      render: (i) => (
        <RowActions>
          <Button
            variant="ghostDanger"
            size="sm"
            aria-label={t('common.delete')}
            onClick={() => setItems((prev) => prev.filter((x) => x.sku !== i.sku))}
          >
            ✕
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <Modal
      title="picker.work.newTitle"
      isTop={isTop}
      stacked={stacked}
      onClose={() => answer(null)}
      actions={
        <>
          <Button onClick={() => setMode('search')}>→ {t('picker.backToSearch')}</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={submit}>
            {t('picker.work.submit')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <TextField label="picker.work.code" value={code} onChange={(e) => setCode(e.target.value)} />
        <TextField
          label="picker.work.name"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="picker.work.labor"
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>

      <h4 className={styles.sectionTitle}>{t('picker.work.parts')}</h4>
      {items.length === 0 ? (
        <p className={styles.noParts}>{t('picker.work.noPartsYet')}</p>
      ) : (
        <Table columns={columns} rows={items} rowKey={(i) => i.sku} />
      )}

      <button type="button" className={styles.addPart} onClick={() => void addItem()}>
        ＋ {t('picker.work.addPart')}
      </button>
    </Modal>
  );
}
