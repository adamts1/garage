import {
  createItem, deleteItem, isDuplicateCodeError, listItems, subscribeToTable, toCatalogCode,
  updateItem, type Item,
} from '@garage/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { showError, showSuccess, useAppDispatch, useConfirm } from '../../store';

export type ItemDraft = Omit<Item, 'id'>;

export const blankItem: ItemDraft = { sku: '', name: '', price: 0, stock: 0 };

export const toDraft = (i: Item): ItemDraft => ({
  sku: i.sku, name: i.name, price: i.price, stock: i.stock,
});

export function useItems() {
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Item[]>([]);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    listItems().then(setRows).catch((e) => dispatch(showError(e)));
  }, [dispatch]);

  useEffect(() => {
    load();
    return subscribeToTable('items', load);
  }, [load]);

  /* Search covers מק״ט and name — the two things anyone knows about a part when
     they come looking for it. A garage's list runs to hundreds of rows, and
     scrolling was the only way to find one. */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (i) => i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q),
    );
  }, [rows, query]);

  /* Uppercase Latin, whoever is calling. The screens normalise as you type;
     this is the same rule at the write, so a code cannot arrive in Hebrew from
     a caller that forgot — the pickers used to invent exactly that. */
  const clean = (draft: ItemDraft): ItemDraft => ({ ...draft, sku: toCatalogCode(draft.sku) });

  /* `items` is unique on (garage_id, sku). The refusal used to reach the toast
     as Postgres wrote it — an index name and the word "constraint" — which
     tells whoever is standing at the counter nothing about what to do next.
     Same treatment as the works catalog's duplicate code. */
  const fail = useCallback(
    (e: unknown) => {
      dispatch(showError(isDuplicateCodeError(e) ? 'items.duplicateSku' : e));
      return false;
    },
    [dispatch],
  );

  const create = useCallback(
    async (raw: ItemDraft) => {
      const draft = clean(raw);
      if (!draft.sku || !draft.name.trim()) return false;
      try {
        await createItem(draft);
        dispatch(showSuccess('items.created'));
        load();
        return true;
      } catch (e) {
        return fail(e);
      }
    },
    [dispatch, fail, load],
  );

  const update = useCallback(
    async (id: string, raw: ItemDraft) => {
      const draft = clean(raw);
      if (!draft.sku) return false;
      try {
        await updateItem(id, draft);
        dispatch(showSuccess('items.updated'));
        load();
        return true;
      } catch (e) {
        return fail(e);
      }
    },
    [dispatch, fail, load],
  );

  const remove = useCallback(
    async (item: Item) => {
      const ok = await confirm({
        bodyKey: 'items.confirmDelete',
        values: { name: item.name },
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteItem(item.id);
        dispatch(showSuccess('items.deleted'));
        load();
      } catch (e) {
        dispatch(showError(e));
      }
    },
    [confirm, dispatch, load],
  );

  return { rows, shown, query, setQuery, create, update, remove };
}
