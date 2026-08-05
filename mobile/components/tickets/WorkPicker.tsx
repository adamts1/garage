/* Pick a work out of the garage's catalog — or, when nothing there fits, define
   one on the spot. The web's WorkModal does the same two things. */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { createWorkDef, fromCatalog, listWorkDefs, type TicketWork, type WorkDef } from '@garage/shared';
import { KEYBOARD_BEHAVIOR } from '../../lib/keyboard';
import { C, s } from '../../lib/theme';
import { Checkbox, CreateRow, Field, FormActions, Sheet } from '../ui';
import { seedFromQuery, workUid } from './catalog';

export function WorkPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (w: TicketWork) => void;
}) {
  const { t } = useTranslation();

  /* This garage's catalog, not a constant compiled into the app. Fetched when
     the sheet first opens, then kept. An empty catalog is a real state — a
     garage onboarded without a starter catalog has none — so it gets its own
     message; defining a work right here is the way out either way. */
  const [defs, setDefs] = useState<WorkDef[] | null>(null);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'search' | 'create'>('search');

  // the new-work form
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [keep, setKeep] = useState(true); // also file it in the garage's catalog

  useEffect(() => {
    if (visible && !defs) listWorkDefs().then(setDefs).catch(() => setDefs([]));
  }, [visible, defs]);

  // Reopening the sheet starts on the list again, not on a half-typed form.
  useEffect(() => {
    if (!visible) {
      setMode('search');
      setQ('');
    }
  }, [visible]);

  const query = q.trim();
  const shown = (defs ?? []).filter(
    (d) => !query || d.name.includes(query) || d.code.toLowerCase().includes(query.toLowerCase()),
  );

  const startCreate = () => {
    const seed = seedFromQuery(q);
    setCode(seed.code);
    setName(seed.name);
    setPrice('');
    setKeep(true);
    setMode('create');
  };

  /* The work goes onto the ticket immediately and the catalog write follows.
     Optimistic on purpose: the sheet closes onto the works list, and a work that
     appeared only after a round trip reads as one that was lost. If the catalog
     write fails the entry is rolled back out of the list — but the work stays on
     the ticket, which is the copy the mechanic actually needs. Same bargain the
     web makes in App.tsx's addToCatalog. */
  const submitCreate = () => {
    if (!name.trim()) return;
    const def: WorkDef = {
      id: `custom-${Date.now()}`,
      code: (code.trim() || name.trim().slice(0, 6)).toUpperCase(),
      name: name.trim(),
      labor: Number(price) || 0,
      hours: 0,
      items: [], // parts are added on the ticket, where the work now lives
    };
    onPick(fromCatalog(def, workUid()));
    setMode('search');
    if (!keep) return;

    setDefs((prev) => [...(prev ?? []), def]);
    createWorkDef({ code: def.code, name: def.name, labor: def.labor, hours: def.hours, items: [] })
      .then((saved) => setDefs((prev) => (prev ?? []).map((d) => (d.id === def.id ? saved : d))))
      .catch((e: any) => {
        setDefs((prev) => (prev ?? []).filter((d) => d.id !== def.id));
        Alert.alert(t('works.form.failed'), t('works.form.failedBody', { message: e?.message ?? e }));
      });
  };

  const title = mode === 'create' ? t('works.form.title') : t('works.picker.title');

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {mode === 'create' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={KEYBOARD_BEHAVIOR}>
          <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }} keyboardShouldPersistTaps="handled">
            <View style={[s.card, { gap: 10 }]}>
              <Field label={t('works.form.name')}>
                <TextInput
                  style={s.input}
                  value={name}
                  onChangeText={setName}
                  autoFocus
                  placeholder={t('works.form.namePlaceholder')}
                  placeholderTextColor={C.dim}
                />
              </Field>
              <View style={s.row}>
                <Field label={t('works.form.code')} flex>
                  <TextInput
                    style={s.input}
                    value={code}
                    onChangeText={setCode}
                    autoCapitalize="characters"
                    placeholder={t('works.form.codePlaceholder')}
                    placeholderTextColor={C.dim}
                  />
                </Field>
                <Field label={t('works.form.price')} flex>
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
              <Checkbox checked={keep} onChange={setKeep} label={t('works.form.keep')} />
              <Text style={[s.dim, { fontSize: 11 }]}>
                {keep ? t('works.form.keepHint') : t('works.form.onceHint')}
              </Text>
            </View>
            <FormActions
              disabled={!name.trim()}
              onBack={() => setMode('search')}
              onSubmit={submitCreate}
              submitLabel={t('works.form.submit')}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      ) : defs === null ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <ActivityIndicator color={C.ink} />
        </View>
      ) : (
        <>
          <View style={{ padding: 12 }}>
            <TextInput
              style={s.input}
              value={q}
              onChangeText={setQ}
              placeholder={t('works.picker.search')}
              placeholderTextColor={C.dim}
            />
          </View>
          <FlatList
            data={shown}
            keyExtractor={(w) => w.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 8, padding: 12, paddingTop: 0 }}
            ListEmptyComponent={
              <Text style={[s.dim, { paddingVertical: 16, textAlign: 'center' }]}>
                {query ? t('works.picker.noMatch', { query }) : t('works.picker.empty')}
              </Text>
            }
            ListFooterComponent={
              <CreateRow
                label={query ? t('works.picker.createNamed', { query }) : t('works.picker.create')}
                onPress={startCreate}
              />
            }
            renderItem={({ item }) => (
              <Pressable style={s.card} onPress={() => onPick(fromCatalog(item, workUid()))}>
                <View style={s.rowBetween}>
                  <Text style={s.h2}>{item.name}</Text>
                  <Text style={s.dim}>{item.code}</Text>
                </View>
                <Text style={s.dim}>
                  {t('works.picker.meta', {
                    labor: item.labor,
                    hours: item.hours,
                    parts: item.items.length,
                  })}
                </Text>
              </Pressable>
            )}
          />
        </>
      )}
    </Sheet>
  );
}
