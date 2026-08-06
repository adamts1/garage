/* Pick a part out of the items table — or invent one, the way WorkPicker does
   for works. Opens for one work at a time; `workUid` is both the target and the
   visibility flag. */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  createItem,
  isDuplicateCodeError,
  listItems,
  toCatalogCode,
  type Item,
  type PartRow,
} from '@garage/shared';
import { KEYBOARD_BEHAVIOR } from '../../lib/keyboard';
import { C, s } from '../../lib/theme';
import { Checkbox, CreateRow, Field, FormActions, Sheet } from '../ui';
import { seedFromQuery } from './catalog';

export function PartPicker({
  workUid,
  taken,
  onClose,
  onPick,
}: {
  /** The work the part is going onto, or null when the sheet is shut. */
  workUid: string | null;
  /** מק״טים already on that work. Scoped to the work rather than the whole
   *  ticket: two jobs on one car can each legitimately need the same bolt, and
   *  each carries its own quantity. Adding it twice to ONE work is the mistake
   *  — that is the stepper's job. */
  taken: string[];
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
  const [saving, setSaving] = useState(false);

  // The parts list comes from the items table, so the prices are the real ones.
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

  // Normalised on both sides, as in WorkPicker.
  const onWork = new Set(taken.map(toCatalogCode).filter(Boolean));
  const inCatalog = new Set((items ?? []).map((i) => toCatalogCode(i.sku)).filter(Boolean));

  const startCreate = () => {
    const seed = seedFromQuery(q);
    setSku(seed.code);
    setName(seed.name);
    setPrice('');
    setKeep(true);
    setMode('create');
  };

  /* A מק״ט is a catalog code like a work's, so it obeys the same rule and is
     asked for rather than sliced off a Hebrew name. See WorkPicker. */
  const cleanSku = toCatalogCode(sku);

  /* Refused against the items table and against this work, for the reasons
     spelled out in WorkPicker — one מק״ט, one part. */
  const clash =
    !cleanSku ? null
    : onWork.has(cleanSku) ? 'work'
    : inCatalog.has(cleanSku) ? 'catalog'
    : null;

  /* Into the items table first, onto the work after — the ordering WorkPicker
     explains. Stock starts at 0: a part invented mid-ticket is one nobody has
     counted. */
  const submitCreate = async () => {
    if (!name.trim() || !cleanSku || clash || saving) return;

    const part = { sku: cleanSku, name: name.trim(), price: Number(price) || 0 };

    if (!keep) {
      onPick({ ...part, qty: 1 });
      setMode('search');
      return;
    }

    setSaving(true);
    try {
      const saved = await createItem({ ...part, stock: 0 });
      setItems((prev) => [...(prev ?? []), saved]);
      onPick({ sku: saved.sku, name: saved.name, price: saved.price, qty: 1 });
      setMode('search');
    } catch (e: any) {
      if (isDuplicateCodeError(e)) {
        listItems().then(setItems).catch(() => {});
        Alert.alert(t('parts.form.duplicateTitle'), t('parts.form.duplicateCatalog'));
      } else {
        Alert.alert(t('parts.form.failed'), t('parts.form.failedBody', { message: e?.message ?? e }));
      }
    } finally {
      setSaving(false);
    }
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
                  {/* Normalised under the cursor, as in WorkPicker. */}
                  <TextInput
                    style={s.input}
                    value={sku}
                    onChangeText={(v) => setSku(toCatalogCode(v))}
                    autoCapitalize="characters"
                    autoCorrect={false}
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
              {clash ? (
                <Text style={{ ...s.dim, fontSize: 11, color: C.danger, fontWeight: '700' }}>
                  {clash === 'work'
                    ? t('parts.form.duplicateWork')
                    : t('parts.form.duplicateCatalog')}
                </Text>
              ) : (
                <Text style={[s.dim, { fontSize: 11 }]}>{t('parts.form.codeFormat')}</Text>
              )}
              <Checkbox checked={keep} onChange={setKeep} label={t('parts.form.keep')} />
              <Text style={[s.dim, { fontSize: 11 }]}>
                {keep ? t('parts.form.keepHint') : t('parts.form.onceHint')}
              </Text>
            </View>
            <FormActions
              disabled={!name.trim() || !cleanSku || Boolean(clash)}
              busy={saving}
              onBack={() => setMode('search')}
              onSubmit={() => void submitCreate()}
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
          renderItem={({ item }) => {
            const already = onWork.has(toCatalogCode(item.sku));
            return (
              <Pressable
                style={[s.card, already && { opacity: 0.55, backgroundColor: C.bg }]}
                disabled={already}
                onPress={() => onPick({ sku: item.sku, name: item.name, qty: 1, price: item.price })}
              >
                <View style={s.rowBetween}>
                  <Text style={[s.h2, { flex: 1 }]}>{item.name}</Text>
                  <Text style={[s.dim, { fontWeight: '700', color: C.ink }]}>₪{item.price}</Text>
                </View>
                {/* The מק״ט, and whether it is already on this work.

                    What used to be here as well was the stock count, in red
                    when it read zero — and zero is what every part created from
                    the phone starts at, because nobody counts a part while a
                    car is on the lift. So the alarm fired on the parts that
                    were most obviously present: the one just added, sitting in
                    somebody's hand. Stock is maintained on the web, and this
                    list is for finding a part, not for auditing the shelf. */}
                <Text style={s.dim}>
                  {already ? `${item.sku} · ${t('parts.picker.taken')}` : item.sku}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}
