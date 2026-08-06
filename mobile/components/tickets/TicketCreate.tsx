/* The new-ticket intake form — the native counterpart to the web app's two-step
   create form. Same three moves: find or type the customer, fill the car, add the
   works. Used both as a phone route (app/new.tsx) and, on a tablet, embedded in
   the master–detail right pane.

   It does NOT paint an optimistic row: the server assigns the real GAR-/W-
   numbers (see useTickets.addTicket), so on save we hand the returned key to
   onCreated and let the caller open the freshly-created ticket.

   The shape of what gets saved lives in newTicket.ts, the two halves of the form
   in CustomerSection / VehicleSection. What is left here is the wiring. */

import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { listCustomers, listVehicles, money, subscribeToTable, worksSummary } from '@garage/shared';
import type { Customer, TicketWork, Vehicle } from '@garage/shared';
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

  const { customers, vehicles } = useCustomerDirectory();

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

    const owned = vehicles.filter((v) => v.customer_id === c.id);
    if (owned.length === 1) {
      fillVehicle(owned[0]);
      setVehicleChoices([]);
    } else {
      setVehicleChoices(owned); // 0 -> nothing to pick; >1 -> let them choose
    }
  };

  const pickVehicle = (v: Vehicle) => {
    fillVehicle(v);
    setVehicleChoices([]);
  };

  const missing = missingFields(form);
  const canSave = missing.length === 0;
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
          vehicleChoices={vehicleChoices}
          onPickCustomer={pickCustomer}
          onPickVehicle={pickVehicle}
          search={search}
          onSearch={setSearch}
        />

        <VehicleSection form={form} onSet={set} />

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
          {/* Why the button is dimmed, next to the button. */}
          {missing.length > 0 && (
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.danger }}>
              {t('create.missing', {
                fields: missing.map((f) => t(`create.required.${f}`)).join(', '),
              })}
            </Text>
          )}
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

/* The garage's customers and their cars.

   Subscribed, not loaded once. The customer list is no longer just autofill: it
   is what the phone-taken check is judged against, so a stale copy means the
   phone reads as free and the duplicate the check exists to prevent gets created
   anyway. Somebody opening a customer at the counter while this form is open on
   the phone is the ordinary case, not a corner one. */
function useCustomerDirectory() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  useEffect(() => {
    const loadCustomers = () => listCustomers().then(setCustomers).catch(() => {});
    const loadVehicles = () => listVehicles().then(setVehicles).catch(() => {});

    loadCustomers();
    loadVehicles();

    const offCustomers = subscribeToTable('customers', loadCustomers);
    const offVehicles = subscribeToTable('vehicles', loadVehicles);
    return () => {
      offCustomers();
      offVehicles();
    };
  }, []);

  return { customers, vehicles };
}
