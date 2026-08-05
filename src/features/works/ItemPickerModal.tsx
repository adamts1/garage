import { shekel, toCatalogCode, type PartDef } from '@garage/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Field';
import Modal from '../../components/Modal/Modal';
import type { ModalComponentProps } from '../../components/Modal/types';
import { PickerModal } from '../../components/PickerModal';
import { settleModal } from '../../store/useModalResult';
import { useCatalog } from '../catalog/CatalogProvider';
import styles from './pickers.module.css';

const norm = (s: string) => s.trim().toLowerCase();

/** Reached through `usePickPart()`. Resolves the chosen part, or null. */
export default function ItemPickerModal({ props, isTop, stacked, onClose }: ModalComponentProps) {
  const { t } = useTranslation();
  const { parts, addPart } = useCatalog();

  const resultId = String(props.resultId ?? '');
  const initialQuery = String(props.initialQuery ?? '');
  /* SKUs already on the work. Serialised as a comma-joined string, because the
     store carries only flat values. */
  const taken = useMemo(
    () => String(props.taken ?? '').split(',').filter(Boolean),
    [props.taken],
  );

  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');

  const available = useMemo(() => parts.filter((p) => !taken.includes(p.sku)), [parts, taken]);

  const answer = (part: PartDef | null) => {
    settleModal(resultId, part);
    onClose();
  };

  /** Whatever was typed seeds the form: a code-shaped string is a SKU, anything
   *  else is a name. */
  const startCreate = (typed: string) => {
    const looksLikeSku = /^[A-Za-z0-9\-_]+$/.test(typed);
    setSku(looksLikeSku ? toCatalogCode(typed) : '');
    setName(looksLikeSku ? '' : typed);
    setPrice('');
    setMode('create');
  };

  /* Uppercase Latin, like a work's code — and asked for rather than derived
     from the name, which for a Hebrew part produced a Hebrew מק״ט. */
  const cleanSku = toCatalogCode(sku);

  const submit = () => {
    if (!name.trim() || !cleanSku) return;
    const part: PartDef = {
      sku: cleanSku,
      name: name.trim(),
      price: Number(price) || 0,
    };
    addPart(part);   // joins the parts catalogue
    answer(part);
  };

  if (mode === 'search') {
    return (
      <PickerModal<PartDef>
        title="picker.part.title"
        searchPlaceholder="picker.part.search"
        items={available}
        itemKey={(p) => p.sku}
        match={(p, q) => norm(p.sku).includes(norm(q)) || norm(p.name).includes(norm(q))}
        emptyKey="picker.part.empty"
        createLabel="picker.part.create"
        initialQuery={initialQuery}
        isTop={isTop}
        stacked={stacked}
        onPick={answer}
        onCreate={startCreate}
        onClose={() => answer(null)}
        renderRow={(p) => (
          <>
            <span className={styles.code}>{p.sku}</span>
            <span className={styles.name}>{p.name}</span>
            <span />
            <span className={styles.price}>{shekel(p.price)}</span>
          </>
        )}
      />
    );
  }

  return (
    <Modal
      title="picker.part.newTitle"
      isTop={isTop}
      stacked={stacked}
      onClose={() => answer(null)}
      actions={
        <>
          <Button onClick={() => setMode('search')}>→ {t('picker.backToSearch')}</Button>
          <Button variant="primary" disabled={!name.trim() || !cleanSku} onClick={submit}>
            {t('picker.part.submit')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <TextField
          label="items.fields.sku"
          required
          hint="works.codeFormat"
          value={sku}
          onChange={(e) => setSku(toCatalogCode(e.target.value))}
        />
        <TextField
          label="items.fields.name"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        />
        <TextField
          label="items.fields.price"
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
    </Modal>
  );
}
