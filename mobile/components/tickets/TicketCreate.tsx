/* The new-ticket intake form — the native counterpart to the web app's two-step
   create form. Same three moves: find or type the customer, fill the car, add the
   works. Used both as a phone route (app/new.tsx) and, on a tablet, embedded in
   the master–detail right pane.

   It does NOT paint an optimistic row: the server assigns the real GAR-/W-
   numbers (see useTickets.addTicket), so on save we hand the returned key to
   onCreated and let the caller open the freshly-created ticket.

   The shape of what gets saved lives in newTicket.ts, the two halves of the form
   in CustomerSection / VehicleSection. What is left here is the wiring. */

import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  customerHoldingIdNumber,
  customersWithPhone,
  getCustomer,
  idNumberConflict,
  isUsablePhone,
  money,
  phoneConflict,
  searchCustomers,
  subscribeToTable,
  vehiclesForPlate,
  worksSummary,
} from '@garage/shared';
import type { Customer, CustomerWithVehicles, TicketWork, Vehicle } from '@garage/shared';
import { KEYBOARD_BEHAVIOR } from '../../lib/keyboard';
import { useTicketsStore } from '../../lib/TicketsProvider';
import { C, s } from '../../lib/theme';
import { Button, Field } from '../ui';
import { CustomerSection } from './CustomerSection';
import { VehicleSection } from './VehicleSection';
import { WorksSection } from './WorksSection';
import {
  buildNewTicket,
  EMPTY_FORM,
  fillFromKnownPlate,
  IDENTITY_FIELDS,
  isDirty,
  missingFields,
  type TicketForm,
} from './newTicket';

export default function TicketCreate({
  onClose,
  onCreated,
  embedded = false,
}: {
  onClose: () => void;
  /** The server-assigned key of the new ticket, so the caller can open it. */
  onCreated: (key: string) => void;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { tickets, addTicket } = useTicketsStore();

  const [form, setForm] = useState<TicketForm>(EMPTY_FORM);
  const [works, setWorks] = useState<TicketWork[]>([]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [vehicleChoices, setVehicleChoices] = useState<Vehicle[]>([]);

  const { customers, vehicles } = useCustomerDirectory(search, form.customerPhone, form.idNumber);

  const set = <K extends keyof TicketForm>(key: K, value: TicketForm[K]) =>
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(IDENTITY_FIELDS.has(key) ? { customerId: null } : null),
    }));

  const fillVehicle = (v: Vehicle) =>
    setForm((prev) => ({
      ...prev,
      licensePlate: v.plate ?? '',
      manufacturer: v.manufacturer ?? '',
      model: v.model ?? '',
      year: v.year ?? '',
      /* Blank, not the car's last reading: km is this visit's odometer, and a
         stale figure looks filled in and gets saved unread (2026-11-11). */
      km: '',
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

    const offer = (owned: Vehicle[]) => {
      if (owned.length === 1) {
        fillVehicle(owned[0]);
        setVehicleChoices([]);
      } else {
        setVehicleChoices(owned); // 0 -> nothing to pick; >1 -> let them choose
      }
    };
    /* Their cars came with the search; a customer reached by the phone or ת״ז
       warning is asked for them. */
    const known = (c as Partial<CustomerWithVehicles>).vehicles;
    if (known) offer(known);
    else getCustomer(c.id).then((full) => offer(full?.vehicles ?? [])).catch(() => {});
  };

  const pickVehicle = (v: Vehicle) => {
    fillVehicle(v);
    setVehicleChoices([]);
  };

  /** Picked by plate: the owner, and that car — not a question about which of
   *  their cars it was. */
  const pickPlate = (c: Customer, v: Vehicle) => {
    pickCustomer(c);
    pickVehicle(v);
  };

  const fillKnownPlate = () => {
    if (!form.licensePlate.trim()) return;
    vehiclesForPlate(form.licensePlate)
      .then((onFile) => setForm((prev) => fillFromKnownPlate(prev, onFile)))
      .catch(() => {});
  };

  /* The two numbers, checked against everybody on file. The phone may be
     shared — a couple, a company, a parent paying for a student's car — so a
     match is an offer to attach the ticket to that customer and nothing more.
     The ת״ז may not be shared: it is unique per garage, so a match has to be
     answered before the ticket can be saved, or the ticket would carry a number
     that belongs to somebody else. Same rule as the web intake form. */
  const conflict = phoneConflict(customers, {
    phone: form.customerPhone,
    name: form.customerName,
    pickedId: form.customerId,
  });

  const idConflict = idNumberConflict(customers, {
    idNumber: form.idNumber,
    name: form.customerName,
    ownerId: form.customerId,
  });

  const missing = missingFields(form);
  const canSave = missing.length === 0 && !idConflict;
  const total = worksSummary(works).total;

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const key = await addTicket(buildNewTicket({ form, works, existing: tickets }));
      onCreated(key);
    } catch (e: any) {
      Alert.alert(t('create.saveFailed'), e?.message ?? t('create.saveFailedBody'));
      setSaving(false);
    }
  };

  const confirmLeave = () => {
    if (!isDirty(form, works, search)) return onClose();
    Alert.alert(t('create.leave.title'), t('create.leave.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('ticket.leave.confirm'), style: 'destructive', onPress: onClose },
    ]);
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={KEYBOARD_BEHAVIOR}>
      <View
        style={{
          backgroundColor: C.card,
          paddingTop: embedded ? 12 : insets.top + 6,
          borderBottomWidth: 1,
          borderBottomColor: C.line,
        }}
      >
        <View style={[s.rowBetween, { paddingHorizontal: 14, paddingBottom: 10 }]}>
          <View style={{ width: 22 }} />
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{t('create.title')}</Text>
          <Pressable
            onPress={confirmLeave}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Text style={{ fontSize: 22, color: C.ink }}>{embedded ? '✕' : '›'}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        <CustomerSection
          form={form}
          onSet={set}
          customers={customers}
          vehicles={vehicles}
          conflict={conflict}
          idConflict={idConflict}
          vehicleChoices={vehicleChoices}
          onPickCustomer={pickCustomer}
          onPickVehicle={pickVehicle}
          onPickPlate={pickPlate}
          search={search}
          onSearch={setSearch}
        />

        <VehicleSection form={form} onSet={set} onPlateDone={fillKnownPlate} />

        <View style={[s.card, { gap: 10 }]}>
          <Field label={t('create.fields.details')}>
            <TextInput
              style={[s.input, { minHeight: 70 }]}
              multiline
              value={form.details}
              onChangeText={(v) => set('details', v)}
            />
          </Field>
        </View>

        <WorksSection works={works} onChange={setWorks} />
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          flexDirection: 'row-reverse',
          alignItems: 'center',
          gap: 10,
          padding: 12,
          paddingBottom: insets.bottom + 10,
          backgroundColor: C.card,
          borderTopWidth: 1,
          borderTopColor: C.line,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[s.dim, { fontSize: 11 }]}>{t('create.totalLabel')}</Text>
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{money(total)}</Text>
          {/* Why the button is dimmed, next to the button. A ת״ז held by
              somebody else refuses the save just as a blank field does, and is
              named the same way — the difference is that it is answered up in
              the customer block rather than by typing here. */}
          {missing.length > 0 ? (
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.danger }}>
              {t('create.missing', {
                fields: missing.map((f) => t(`create.required.${f}`)).join(', '),
              })}
            </Text>
          ) : idConflict ? (
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.danger }}>
              {t('create.idConflict.blocks')}
            </Text>
          ) : null}
        </View>
        <Button
          label={t('create.submit')}
          onPress={save}
          busy={saving}
          disabled={!canSave}
          style={{ paddingHorizontal: 28 }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

/* The customers this form can be talking about, asked of the database: the ones
   the search box finds (with their cars), and whoever already holds the phone
   or ת״ז being typed — which is what the two warnings are judged against.

   It used to load every customer and every car and work over those — capped at
   1000 rows each by PostgREST, so on a large garage most customers could not
   be found and a taken phone could read as free. Each question is sent once
   typing pauses; a reply to an older question is dropped. Re-asked when
   somebody else adds or edits a customer, as before. */
const PAUSE_MS = 300;
const SEARCH_FETCH = 20;

function useSettled(value: string) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), PAUSE_MS);
    return () => clearTimeout(id);
  }, [value]);
  return settled;
}

function useCustomerDirectory(search: string, phone: string, idNumber: string) {
  const q = useSettled(search.trim());
  const digits = useSettled(isUsablePhone(phone) ? phone.replace(/\D/g, '') : '');
  const id = useSettled(idNumber.trim());
  const [found, setFound] = useState<CustomerWithVehicles[]>([]);
  const [holders, setHolders] = useState<Customer[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const off = subscribeToTable('customers', () => setTick((n) => n + 1));
    const offVehicles = subscribeToTable('vehicles', () => setTick((n) => n + 1));
    return () => { off(); offVehicles(); };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!q) { setFound([]); return; }
    searchCustomers({ query: q, pageSize: SEARCH_FETCH })
      .then((p) => { if (alive) setFound(p.rows); })
      .catch(() => {});
    return () => { alive = false; };
  }, [q, tick]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      digits ? customersWithPhone(digits) : Promise.resolve([] as Customer[]),
      id ? customerHoldingIdNumber(id).then((c) => (c ? [c] : [])) : Promise.resolve([] as Customer[]),
    ])
      .then(([byPhone, byId]) => { if (alive) setHolders([...byPhone, ...byId]); })
      .catch(() => {});
    return () => { alive = false; };
  }, [digits, id, tick]);

  return useMemo(() => {
    const seen = new Set(found.map((c) => c.id));
    return {
      customers: [...found, ...holders.filter((c) => !seen.has(c.id))] as Customer[],
      vehicles: found.flatMap((c) => c.vehicles ?? []),
    };
  }, [found, holders]);
}
