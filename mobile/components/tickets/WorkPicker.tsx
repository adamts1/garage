/* Pick a work out of the garage's catalog — or, when nothing there fits, define
   one on the spot. The web's WorkModal does the same two things. */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  createWorkDef,
  fromCatalog,
  isDuplicateCodeError,
  listWorkDefs,
  toCatalogCode,
  type TicketWork,
  type WorkDef,
} from '@garage/shared';
import { KEYBOARD_BEHAVIOR } from '../../lib/keyboard';
import { C, s } from '../../lib/theme';
import { Checkbox, CreateRow, Field, FormActions, Sheet } from '../ui';
import { seedFromQuery, workUid } from './catalog';

export function WorkPicker({
  visible,
  taken,
  onClose,
  onPick,
}: {
  visible: boolean;
  /** Codes already on this ticket. A code identifies one work, so the ticket
   *  cannot carry it twice — see the note on `duplicate` below. */
  taken: string[];
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
  const [saving, setSaving] = useState(false);

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

  /* Both sides normalised before they are compared, so a code stored lowercase
     by an older build still matches what is typed now. Blanks filtered out:
     works saved before the code was required carry an empty one, and two of
     those are not "the same work twice". */
  const onTicket = new Set(taken.map(toCatalogCode).filter(Boolean));
  const inCatalog = new Set((defs ?? []).map((d) => toCatalogCode(d.code)).filter(Boolean));

  const startCreate = () => {
    const seed = seedFromQuery(q);
    setCode(seed.code);
    setName(seed.name);
    setPrice('');
    setKeep(true);
    setMode('create');
  };

  /* Uppercase Latin, always — the same rule the web modal applies, and the same
     reason: the fallback used to be the first six characters of the name, which
     for a Hebrew name produced a Hebrew code. The code is now asked for rather
     than invented, so the submit button waits for one. */
  const cleanCode = toCatalogCode(code);

  /* A code names exactly one work, so it is refused in both directions before
     anything is written: against the catalog, which the database enforces
     anyway, and against this ticket, which nothing else would catch.

     The ticket check applies even to a one-off work that never joins the
     catalog — two lines on one invoice reading EXH-01 for different work is
     the problem the code exists to prevent, whether or not either was saved. */
  const clash =
    !cleanCode ? null
    : onTicket.has(cleanCode) ? 'ticket'
    : inCatalog.has(cleanCode) ? 'catalog'
    : null;

  /* Filed in the catalog FIRST, then put on the ticket.

     This used to run the other way — onto the ticket, catalog write to follow —
     so the sheet could close without waiting. That bargain stops paying the
     moment a duplicate code is refusable: the write is the only place the answer
     is authoritative, and a work already sitting on the ticket when the answer
     comes back is a work whose code belongs to something else. One round trip
     with the button spinning is the price of never showing that state.

     A work that is NOT joining the catalog writes nothing, so it is still
     instant — which is the case somebody in a hurry picks anyway. */
  const submitCreate = async () => {
    if (!name.trim() || !cleanCode || clash || saving) return;

    const draft = {
      code: cleanCode,
      name: name.trim(),
      labor: Number(price) || 0,
      hours: 0,
      items: [] as WorkDef['items'], // parts are added on the ticket, where the work now lives
    };

    if (!keep) {
      onPick(fromCatalog({ id: `custom-${Date.now()}`, ...draft }, workUid()));
      setMode('search');
      return;
    }

    setSaving(true);
    try {
      const saved = await createWorkDef(draft);
      setDefs((prev) => [...(prev ?? []), saved]);
      onPick(fromCatalog(saved, workUid()));
      setMode('search');
    } catch (e: any) {
      // Somebody else took the code between the check above and this write.
      if (isDuplicateCodeError(e)) {
        // Refetch, so the form's own warning agrees with the alert from here on.
        listWorkDefs().then(setDefs).catch(() => {});
        Alert.alert(t('works.form.duplicateTitle'), t('works.form.duplicateCatalog'));
      } else {
        Alert.alert(t('works.form.failed'), t('works.form.failedBody', { message: e?.message ?? e }));
      }
    } finally {
      setSaving(false);
    }
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
                  {/* Normalised as it is typed, so what is on screen is what is
                      stored — lowercase becomes uppercase under the cursor and
                      Hebrew simply does not appear, which says the rule better
                      than a message after the fact would. */}
                  <TextInput
                    style={s.input}
                    value={code}
                    onChangeText={(v) => setCode(toCatalogCode(v))}
                    autoCapitalize="characters"
                    autoCorrect={false}
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
              {/* Said where the code is typed, not after the save is refused:
                  the whole point of catching it here is that nobody fills in
                  the rest of the form first. */}
              {clash ? (
                <Text style={{ ...s.dim, fontSize: 11, color: C.danger, fontWeight: '700' }}>
                  {clash === 'ticket'
                    ? t('works.form.duplicateTicket')
                    : t('works.form.duplicateCatalog')}
                </Text>
              ) : (
                <Text style={[s.dim, { fontSize: 11 }]}>{t('works.form.codeFormat')}</Text>
              )}
              <Checkbox checked={keep} onChange={setKeep} label={t('works.form.keep')} />
              <Text style={[s.dim, { fontSize: 11 }]}>
                {keep ? t('works.form.keepHint') : t('works.form.onceHint')}
              </Text>
            </View>
            <FormActions
              disabled={!name.trim() || !cleanCode || Boolean(clash)}
              busy={saving}
              onBack={() => setMode('search')}
              onSubmit={() => void submitCreate()}
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
            renderItem={({ item }) => {
              /* Already on the ticket: shown, greyed, and not selectable.
                 Dropping it from the list instead would read as a catalog that
                 has lost the work somebody is looking straight at. */
              const already = onTicket.has(toCatalogCode(item.code));
              return (
                <Pressable
                  style={[s.card, already && { opacity: 0.55, backgroundColor: C.bg }]}
                  disabled={already}
                  onPress={() => onPick(fromCatalog(item, workUid()))}
                >
                  <View style={s.rowBetween}>
                    <Text style={s.h2}>{item.name}</Text>
                    <Text style={s.dim}>{item.code}</Text>
                  </View>
                  <Text style={s.dim}>
                    {already
                      ? t('works.picker.taken')
                      : t('works.picker.meta', {
                          labor: item.labor,
                          hours: item.hours,
                          parts: item.items.length,
                        })}
                  </Text>
                </Pressable>
              );
            }}
          />
        </>
      )}
    </Sheet>
  );
}
