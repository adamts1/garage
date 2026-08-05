/* Pick a part out of the items table — or invent one, the way WorkPicker does
   for works. Opens for one work at a time; `workUid` is both the target and the
   visibility flag. */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { createItem, listItems, type Item, type PartRow } from '@garage/shared';
import { KEYBOARD_BEHAVIOR } from '../../lib/keyboard';
import { C, s } from '../../lib/theme';
import { Checkbox, CreateRow, Field, FormActions, Sheet } from '../ui';
import { seedFromQuery } from './catalog';

export function PartPicker({
  workUid,
  onClose,
  onPick,
}: {
  /** The work the part is going onto, or null when the sheet is shut. */
  workUid: string | null;
  onClose: () => void;
  onPick: (p: PartRow) => void;
}) {
  const { t } = useTranslation();

  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'search' | 'create'>('search');

  // the new-part form
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [keep, setKeep] = useState(true); // also file it in the items table

  // The parts list comes from the items table, so prices and stock are the real ones.
  useEffect(() => {
    if (workUid && !items) listItems().then(setItems).catch(() => setItems([]));
  }, [workUid, items]);

  useEffect(() => {
    if (!workUid) {
      setMode('search');
      setQ('');
    }
  }, [workUid]);

  const query = q.trim();
  const shown = (items ?? []).filter(
    (i) => !query || i.name.includes(query) || i.sku.toLowerCase().includes(query.toLowerCase()),
  );

  const startCreate = () => {
    const seed = seedFromQuery(q);
    setSku(seed.code);
    setName(seed.name);
    setPrice('');
    setKeep(true);
    setMode('create');
  };

  /* Onto the work first, into the items table after — and rolled back out of the
     list if that write fails, exactly as WorkPicker does with the work catalog.
     Stock starts at 0: a part invented mid-ticket is one nobody has counted. */
  const submitCreate = () => {
    if (!name.trim()) return;
    const part = {
      sku: (sku.trim() || name.trim().slice(0, 6)).toUpperCase(),
      name: name.trim(),
      price: Number(price) || 0,
    };
    onPick({ ...part, qty: 1 });
    setMode('search');
    if (!keep) return;

    const temp: Item = { id: `custom-${Date.now()}`, ...part, stock: 0 };
    setItems((prev) => [...(prev ?? []), temp]);
    createItem({ sku: part.sku, name: part.name, price: part.price, stock: 0 })
      .then((saved) => setItems((prev) => (prev ?? []).map((i) => (i.id === temp.id ? saved : i))))
      .catch((e: any) => {
        setItems((prev) => (prev ?? []).filter((i) => i.id !== temp.id));
        Alert.alert(t('parts.form.failed'), t('parts.form.failedBody', { message: e?.message ?? e }));
      });
  };

  if (mode === 'create') {
    return (
      <Sheet visible={Boolean(workUid)} onClose={onClose} title={t('parts.form.title')}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD_BEHAVIOR}>
          <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }} keyboardShouldPersistTaps="handled">
            <View style={[s.card, { gap: 10 }]}>
              <Field label={t('parts.form.name')}>
                <TextInput
                  style={s.input}
                  value={name}
                  onChangeText={setName}
                  autoFocus
                  placeholder={t('parts.form.namePlaceholder')}
                  placeholderTextColor={C.dim}
                />
              </Field>
              <View style={s.row}>
                <Field label={t('parts.form.sku')} flex>
                  <TextInput
                    style={s.input}
                    value={sku}
                    onChangeText={setSku}
                    autoCapitalize="characters"
                    placeholder={t('parts.form.skuPlaceholder')}
                    placeholderTextColor={C.dim}
                  />
                </Field>
                <Field label={t('parts.form.price')} flex>
                  <TextInput
                    style={s.input}
                    value={price}
                    onChangeText={setPrice}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={C.dim}
                  />
                </Field>
              </View>
              <Checkbox checked={keep} onChange={setKeep} label={t('parts.form.keep')} />
              <Text style={[s.dim, { fontSize: 11 }]}>
                {keep ? t('parts.form.keepHint') : t('parts.form.onceHint')}
              </Text>
            </View>
            <FormActions
              disabled={!name.trim()}
              onBack={() => setMode('search')}
              onSubmit={submitCreate}
              submitLabel={t('parts.form.submit')}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Sheet>
    );
  }

  return (
    <Sheet visible={Boolean(workUid)} onClose={onClose} title={t('parts.picker.title')}>
      <View style={{ padding: 12 }}>
        <TextInput
          style={s.input}
          value={q}
          onChangeText={setQ}
          placeholder={t('parts.picker.search')}
          placeholderTextColor={C.dim}
        />
      </View>
      {!items ? (
        <ActivityIndicator color={C.ink} style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 8, padding: 12, paddingTop: 0 }}
          ListEmptyComponent={
            <Text style={[s.dim, { textAlign: 'center' }]}>
              {query ? t('parts.picker.noMatch', { query }) : t('parts.picker.empty')}
            </Text>
          }
          ListFooterComponent={
            <CreateRow
              label={query ? t('parts.picker.createNamed', { query }) : t('parts.picker.create')}
              onPress={startCreate}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              style={s.card}
              onPress={() => onPick({ sku: item.sku, name: item.name, qty: 1, price: item.price })}
            >
              <View style={s.rowBetween}>
                <Text style={[s.h2, { flex: 1 }]}>{item.name}</Text>
                <Text style={[s.dim, { fontWeight: '700', color: C.ink }]}>₪{item.price}</Text>
              </View>
              <Text style={[s.dim, { color: item.stock === 0 ? C.danger : C.dim }]}>
                {item.sku} ·{' '}
                {item.stock === 0
                  ? t('parts.picker.outOfStock')
                  : t('parts.picker.inStock', { stock: item.stock })}
              </Text>
            </Pressable>
          )}
        />
      )}
    </Sheet>
  );
}
