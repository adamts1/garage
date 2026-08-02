/* The new-ticket intake form — the native counterpart to the web app's two-step
   create form (src/App.tsx). Same three moves: find or type the customer, fill the
   car, add the works. Used both as a phone route (app/new.tsx) and, on a tablet,
   embedded in the master–detail right pane.

   It does NOT paint an optimistic row: the server assigns the real GAR-/W- numbers
   (see useTickets.addTicket), so on save we hand the returned key to onCreated and
   let the caller open the freshly-created ticket. */

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTicketsStore } from '../lib/TicketsProvider';
import {
  isUsablePhone, listCustomers, listVehicles, matchCustomers, modelsFor, phoneConflict,
  subscribeToTable, VEHICLE_MAKES, worksSummary,
  type Customer, type Ticket, type TicketWork, type Vehicle,
} from '@garage/shared';
import { C, s } from '../lib/theme';
import { Field, money, WorksSection } from './ticketUi';

interface Form {
  /** The record picked out of the search box, dropped the moment an identity
   *  field is typed over. Same rule as the web form's TicketForm.customerId. */
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  idNumber: string;
  address: string;
  email: string;
  city: string;
  licensePlate: string;
  vehicleCode: string;
  manufacturer: string;
  model: string;
  year: string;
  km: string;
  due: string;
  details: string;
  keyReceived: boolean;
}

const empty: Form = {
  customerId: null,
  customerName: '', customerPhone: '', idNumber: '', address: '', email: '', city: '',
  licensePlate: '', vehicleCode: '', manufacturer: '', model: '', year: '', km: '',
  due: '', details: '', keyReceived: false,
};

/* The phone's answer to the web form's <datalist>: a field that is a text input
   and a dropdown at once. React Native has neither, so this is both — type to
   filter, or tap ▾ to see the list; either way the value is whatever ends up in
   the input, so a make the catalog has never heard of is typed straight in and
   saved like any other. The list is an aid, never a gate.

   The panel is rendered inline rather than absolutely positioned: inside a
   ScrollView an absolute overlay is clipped by the card it sits in, and a
   modal is far too much ceremony for picking "טויוטה". */
const OPTION_LIMIT = 40;

function ComboField({
  label, value, options, onChange, placeholder,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);

  const q = value.trim().toLowerCase();
  // Typing filters; an exact hit means the field is settled, so show the whole
  // list again rather than the one option already chosen.
  const exact = q.length > 0 && options.some((o) => o.toLowerCase() === q);
  const shown = (q && !exact ? options.filter((o) => o.toLowerCase().includes(q)) : options)
    .slice(0, OPTION_LIMIT);

  return (
    <View style={{ gap: 6 }}>
      <Field label={label}>
        <View style={{ position: 'relative', justifyContent: 'center' }}>
          <TextInput
            style={[s.input, { paddingLeft: 40 }]}
            value={value}
            placeholder={placeholder}
            placeholderTextColor={C.dim}
            autoCorrect={false}
            onChangeText={(v) => { onChange(v); setOpen(true); }}
            onFocus={() => setOpen(true)}
          />
          {options.length > 0 && (
            <Pressable
              onPress={() => setOpen((v) => !v)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`${label} — פתח רשימה`}
              style={{ position: 'absolute', left: 10, padding: 4 }}
            >
              <Text style={{ fontSize: 13, color: C.dim }}>{open ? '▲' : '▼'}</Text>
            </Pressable>
          )}
        </View>
      </Field>

      {open && shown.length > 0 && (
        <View style={[s.card, { padding: 0, overflow: 'hidden', maxHeight: 220 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {shown.map((o, i) => (
              <Pressable
                key={o}
                onPress={() => { onChange(o); setOpen(false); }}
                style={{
                  paddingVertical: 11, paddingHorizontal: 12,
                  borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line,
                }}
              >
                <Text style={{ fontSize: 13.5, fontWeight: '600', color: C.ink, textAlign: 'right' }}>
                  {o}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Said plainly, because a list that offers nothing looks broken until you
          know the field takes anything. */}
      {open && shown.length === 0 && value.trim().length > 0 && (
        <Text style={[s.dim, { fontSize: 11.5, paddingHorizontal: 2 }]}>
          לא ברשימה — ייווצר חדש בשם שהוקלד
        </Text>
      )}
    </View>
  );
}

const IDENTITY_FIELDS = new Set<keyof Form>(['customerName', 'customerPhone', 'idNumber']);

export default function TicketCreate({ onClose, onCreated, embedded = false }: {
  onClose: () => void;
  /** the server-assigned key of the new ticket, so the caller can open it */
  onCreated: (key: string) => void;
  embedded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { tickets, addTicket } = useTicketsStore();

  const [form, setForm] = useState<Form>(empty);
  const [works, setWorks] = useState<TicketWork[]>([]);
  const [saving, setSaving] = useState(false);

  // known customers + their vehicles, for search + autofill (same as the web form)
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [search, setSearch] = useState('');
  const [showMatches, setShowMatches] = useState(false);
  const [vehicleChoices, setVehicleChoices] = useState<Vehicle[]>([]);

  /* Subscribed, not loaded once. The customer list is no longer just autofill:
     it is what the phone-taken check is judged against, so a stale copy means
     the phone is silently free and the duplicate the check exists to prevent
     gets created anyway. Somebody opening a customer at the counter while this
     form is open on the phone is the ordinary case, not a corner one.
     Matches the web form, which has subscribed since it gained the search. */
  useEffect(() => {
    const loadCustomers = () => listCustomers().then(setCustomers).catch(() => {});
    const loadVehicles = () => listVehicles().then(setVehicles).catch(() => {});
    loadCustomers();
    loadVehicles();
    const offCustomers = subscribeToTable('customers', loadCustomers);
    const offVehicles = subscribeToTable('vehicles', loadVehicles);
    return () => { offCustomers(); offVehicles(); };
  }, []);

  /* Typing over name / phone / ת״ז drops the picked customer — the form no
     longer describes the record that was chosen. Address and the car do not. */
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(IDENTITY_FIELDS.has(key) ? { customerId: null } : null),
    }));

  // Customer search — the shared rule, not a second copy of it.
  const query = search.trim();
  const matches = useMemo(() => matchCustomers(customers, query), [customers, query]);

  const fillVehicle = (v: Vehicle) =>
    setForm((prev) => ({
      ...prev,
      licensePlate: v.plate ?? '',
      manufacturer: v.manufacturer ?? '',
      model: v.model ?? '',
      year: v.year ?? '',
      km: v.km ?? '',
      vehicleCode: v.vehicle_code ?? '',
    }));

  const pickCustomer = (c: Customer) => {
    setForm((prev) => ({
      ...prev,
      customerId: c.id,
      customerName: c.name,
      customerPhone: c.phone ?? '',
      idNumber: c.id_number ?? '',
      email: c.email ?? '',
      address: c.address ?? '',
      city: c.city ?? '',
    }));
    setSearch('');
    setShowMatches(false);

    const owned = vehicles.filter((v) => v.customer_id === c.id);
    if (owned.length === 1) { fillVehicle(owned[0]); setVehicleChoices([]); }
    else setVehicleChoices(owned);   // 0 -> nothing to pick; >1 -> let them choose
  };

  const pickVehicle = (v: Vehicle) => { fillVehicle(v); setVehicleChoices([]); };

  const total = worksSummary(works).total;

  /* Same rule as the web form (useNewTicket.missingRequired): name, phone and
     plate are all required. The phone is what create_ticket resolves the
     customer by, so a ticket saved without one opens a new customer record
     every visit. */
  const missing = [
    !form.customerName.trim() && 'שם',
    !isUsablePhone(form.customerPhone) && 'טלפון',
    !form.licensePlate.trim() && 'מספר רישוי',
  ].filter(Boolean) as string[];
  const canSave = missing.length === 0;

  /* The number is the customer's identity, so one already on file means this
     ticket is about to be attached to whoever holds it. Same rule as the web
     form — see phoneConflict in @garage/shared. */
  const conflict = useMemo(
    () => phoneConflict(customers, {
      phone: form.customerPhone,
      name: form.customerName,
      pickedId: form.customerId,
    }),
    [customers, form.customerPhone, form.customerName, form.customerId],
  );

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);

    // temporary GAR-/W- numbers, the same client-side guess the web form makes;
    // create_ticket assigns the real ones and addTicket resyncs to pull them back.
    const maxKey = tickets.reduce((m, t) => Math.max(m, Number(t.k.split('-')[1]) || 0), 0);
    const maxJob = tickets.reduce((m, t) => Math.max(m, Number(t.job.split('-')[1]) || 0), 0);

    const ticket: Ticket = {
      k: `GAR-${maxKey + 1}`,
      st: 'todo',
      type: 'job',
      epic: 'service',
      prio: 'med',
      pts: 3,
      /* Nobody, not 'dk'. That code was one of four mechanics hardcoded in
         shared/types.ts, and it survived here after the workers became each
         garage's own — so every ticket this form made claimed a person the
         garage may not employ, and in a garage with no workers yet it is a
         code that does not exist at all: the (garage_id, assignee) foreign key
         rejects the insert and the phone cannot open a ticket.

         Unassigned is a real state, which is why assignee is nullable and the
         key is MATCH SIMPLE. The web create form already sends null; the
         "אחראי" picker on the ticket editor is where somebody is chosen. */
      who: null,
      job: `W-${maxJob + 1}`,
      title: works.length ? works.map((w) => w.name).join(' + ') : 'כרטיס חדש',
      plate: form.licensePlate || '-',
      car: [form.manufacturer, form.model, form.year].filter(Boolean).join(' ') || '-',
      customer: form.customerName || 'לקוח מזדמן',
      amount: total,
      done: 0,
      subtasks: works.map((w) => w.name),
      due: form.due.trim() || '-',
      flags: [...(form.keyReceived ? ['מפתח התקבל'] : []), 'חדש'],
      works,
      phone: form.customerPhone,
      // Both ride to the customer record, not to a ticket column: the id says
      // which record, the ת״ז fills one that has none.
      customerId: form.customerId,
      idNumber: form.idNumber,
      email: form.email,
      address: [form.address, form.city].filter(Boolean).join(', '),
      km: form.km,
      year: form.year,
      manufacturer: form.manufacturer,   // in transit to the vehicles table
      model: form.model,
      vehicleCode: form.vehicleCode,
      notes: form.details || undefined,
      createdAt: new Date().toLocaleDateString('he-IL'),
    };

    try {
      const key = await addTicket(ticket);
      onCreated(key);
    } catch (e: any) {
      Alert.alert('שמירה נכשלה', e?.message ?? 'לא ניתן ליצור את הכרטיס.');
      setSaving(false);
    }
  };

  const confirmLeave = () => {
    /* Anything typed at all, not canSave — that now means "valid", and a
       half-filled form is exactly the one worth warning about. */
    const dirty =
      Boolean(form.customerName.trim() || form.customerPhone.trim() || form.licensePlate.trim()) ||
      works.length > 0 || search.trim().length > 0 || form.details.trim().length > 0;
    if (!dirty) return onClose();
    Alert.alert('לצאת בלי לשמור?', 'הכרטיס החדש לא נשמר.', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'צא בלי לשמור', style: 'destructive', onPress: onClose },
    ]);
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* ---------- header ---------- */}
      <View style={{ backgroundColor: C.card, paddingTop: embedded ? 12 : insets.top + 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <View style={[s.row, { justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 10 }]}>
          <View style={{ width: 22 }} />
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>כרטיס עבודה חדש</Text>
          <Pressable onPress={confirmLeave} hitSlop={10}>
            <Text style={{ fontSize: 22, color: C.ink }}>{embedded ? '✕' : '›'}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        {/* ---------- customer search ---------- */}
        <View style={{ gap: 8 }}>
          <TextInput
            style={s.input}
            value={search}
            onChangeText={(v) => { setSearch(v); setShowMatches(true); }}
            onFocus={() => setShowMatches(true)}
            placeholder="חיפוש לקוח קיים לפי שם או טלפון"
            placeholderTextColor={C.dim}
            autoCorrect={false}
          />
          {showMatches && query.length >= 1 && (
            <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
              {matches.length ? matches.map((c, i) => (
                <Pressable
                  key={c.id}
                  onPress={() => pickCustomer(c)}
                  style={{ padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line }}
                >
                  <Text style={[s.h2, { textAlign: 'right' }]}>{c.name}</Text>
                  <Text style={[s.dim, { marginTop: 2 }]}>
                    {[c.phone, c.city].filter(Boolean).join(' · ')}
                    {c.kind === 'עסקי' ? '  · עסקי' : ''}
                  </Text>
                </Pressable>
              )) : (
                <Text style={[s.dim, { padding: 12 }]}>לא נמצא לקוח תואם</Text>
              )}
            </View>
          )}
          {vehicleChoices.length > 0 && (
            <View style={[s.card, { gap: 8 }]}>
              <Text style={s.label}>בחר רכב ללקוח:</Text>
              <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
                {vehicleChoices.map((v) => (
                  <Pressable
                    key={v.id}
                    onPress={() => pickVehicle(v)}
                    style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}
                  >
                    <Text style={{ fontWeight: '700', color: C.ink, textAlign: 'right' }}>
                      {[v.manufacturer, v.model].filter(Boolean).join(' ') || v.plate}
                    </Text>
                    <Text style={[s.dim, { fontSize: 11 }]}>
                      {[v.plate, v.year, v.km && `${v.km} ק״מ`].filter(Boolean).join(' · ')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* ---------- customer details ---------- */}
        <View style={[s.card, { gap: 10 }]}>
          <Text style={s.h2}>פרטי לקוח</Text>
          <View style={s.row}>
            <Field label="שם *" flex>
              <TextInput style={s.input} value={form.customerName} onChangeText={(v) => set('customerName', v)} />
            </Field>
            <Field label="טלפון *" flex>
              <TextInput style={s.input} keyboardType="phone-pad" value={form.customerPhone} onChangeText={(v) => set('customerPhone', v)} />
            </Field>
          </View>
          <View style={s.row}>
            <Field label="ת״ז" flex>
              <TextInput style={s.input} keyboardType="numeric" value={form.idNumber} onChangeText={(v) => set('idNumber', v)} />
            </Field>
            <Field label="דוא״ל" flex>
              <TextInput style={s.input} keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={(v) => set('email', v)} />
            </Field>
          </View>
          <Field label="כתובת">
            <TextInput style={s.input} value={form.address} onChangeText={(v) => set('address', v)} />
          </Field>
          <Field label="עיר">
            <TextInput style={s.input} value={form.city} onChangeText={(v) => set('city', v)} />
          </Field>

          {/* The number is already on file. Said out loud rather than resolved
              quietly: the ticket is about to be attached to whoever holds it. */}
          {conflict && (
            <View style={{
              gap: 8, padding: 10, borderRadius: 10, borderWidth: 1,
              borderColor: conflict.differentName ? C.danger : C.line,
              backgroundColor: C.card,
            }}>
              <Text style={{
                fontSize: 12.5, fontWeight: '700',
                color: conflict.differentName ? C.danger : C.ink,
              }}>
                {conflict.differentName
                  ? `מספר הטלפון הזה שמור אצל ${conflict.customer.name}. הכרטיס ייפתח על הלקוח הזה, לא על השם שהוקלד.`
                  : `הטלפון הזה כבר רשום אצל ${conflict.customer.name} — הכרטיס ייפתח על הלקוח הקיים.`}
              </Text>
              <Pressable
                onPress={() => pickCustomer(conflict.customer)}
                style={{
                  alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8,
                  borderRadius: 9, borderWidth: 1, borderColor: C.line,
                }}
              >
                <Text style={{ fontSize: 12.5, fontWeight: '800', color: C.ink }}>פתח על הלקוח הזה</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* ---------- vehicle details ---------- */}
        <View style={[s.card, { gap: 10 }]}>
          <Text style={s.h2}>פרטי רכב</Text>
          <View style={s.row}>
            <Field label="מספר רישוי *" flex>
              <TextInput style={s.input} value={form.licensePlate} onChangeText={(v) => set('licensePlate', v)} />
            </Field>
          </View>

          {/* Pick from the list or type your own — the same bargain the web
              form's <datalist> makes. The models follow the make above, and a
              make the catalog does not carry simply offers none. */}
          <ComboField
            label="יצרן"
            value={form.manufacturer}
            options={VEHICLE_MAKES}
            onChange={(v) => set('manufacturer', v)}
            placeholder="בחר מהרשימה או הקלד"
          />
          <ComboField
            label="דגם"
            value={form.model}
            options={modelsFor(form.manufacturer)}
            onChange={(v) => set('model', v)}
            placeholder={form.manufacturer ? 'בחר מהרשימה או הקלד' : 'הקלד דגם'}
          />

          <View style={s.row}>
            <Field label="שנה" flex>
              <TextInput style={s.input} keyboardType="numeric" value={form.year} onChangeText={(v) => set('year', v)} />
            </Field>
            <Field label="קילומטר" flex>
              <TextInput style={s.input} keyboardType="numeric" value={form.km} onChangeText={(v) => set('km', v.replace(/\D/g, ''))} />
            </Field>
            <Field label="קוד רכב" flex>
              <TextInput style={s.input} value={form.vehicleCode} onChangeText={(v) => set('vehicleCode', v)} />
            </Field>
          </View>
          <Pressable onPress={() => set('keyReceived', !form.keyReceived)} style={[s.row, { paddingVertical: 4, gap: 10 }]}>
            <View style={{
              width: 22, height: 22, borderRadius: 6, borderWidth: 2,
              borderColor: form.keyReceived ? C.ok : C.line,
              backgroundColor: form.keyReceived ? C.ok : 'transparent',
              alignItems: 'center', justifyContent: 'center',
            }}>
              {form.keyReceived ? <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>✓</Text> : null}
            </View>
            <Text style={s.body}>מפתח התקבל</Text>
          </Pressable>
        </View>

        {/* ---------- details ---------- */}
        <View style={[s.card, { gap: 10 }]}>
          <Field label="פרטים / תיאור התקלה">
            <TextInput style={[s.input, { minHeight: 70 }]} multiline value={form.details} onChangeText={(v) => set('details', v)} />
          </Field>
          <Field label="יעד (תאריך סיום)">
            <TextInput style={s.input} value={form.due} onChangeText={(v) => set('due', v)} placeholder="לדוגמה 15/08/2026" placeholderTextColor={C.dim} />
          </Field>
        </View>

        {/* ---------- works ---------- */}
        <WorksSection works={works} onChange={setWorks} />
      </ScrollView>

      {/* ---------- action bar ---------- */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
        padding: 12, paddingBottom: insets.bottom + 10,
        backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line,
      }}>
        <View style={{ flex: 1 }}>
          <Text style={[s.dim, { fontSize: 11 }]}>סה״כ כולל מע״מ</Text>
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{money(total)}</Text>
          {/* Why the button is dimmed, next to the button. */}
          {missing.length > 0 && (
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.danger }}>
              חסר: {missing.join(', ')}
            </Text>
          )}
        </View>
        <Pressable
          onPress={save}
          disabled={!canSave || saving}
          style={{
            paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
            backgroundColor: C.ink, opacity: canSave && !saving ? 1 : 0.5,
          }}
        >
          {saving ? <ActivityIndicator color="#fff" />
            : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>שמור כרטיס</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
