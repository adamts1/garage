/* Who the ticket is for: find them, or type them in.

   Three things happen here that look like one. Searching picks an existing
   record (and pre-fills the car it owns). The fields below can be typed over,
   which drops the picked record. And the two numbers are checked against every
   customer on file — the phone because it may be somebody else's and the
   advisor should know, the ת״ז because it may not be somebody else's at all.
   Both conflicts are worked out by the screen above (TicketCreate), which needs
   the ת״ז one for its save button; this draws them. */

import { useMemo } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  isBusinessCustomer, matchCustomers, matchVehiclesByPlate,
  type Customer, type PhoneConflict, type Vehicle,
} from '@garage/shared';
import { C, rtl, s } from '../../lib/theme';
import { Button, Field } from '../ui';
import type { TicketForm } from './newTicket';

export function CustomerSection({
  form,
  onSet,
  customers,
  vehicles,
  conflict,
  idConflict,
  vehicleChoices,
  onPickCustomer,
  onPickVehicle,
  onPickPlate,
  search,
  onSearch,
}: {
  form: TicketForm;
  onSet: <K extends keyof TicketForm>(key: K, value: TicketForm[K]) => void;
  customers: Customer[];
  /** Every customer↔car link on file, for finding a car by its plate. */
  vehicles: Vehicle[];
  /** Somebody already answers this number — an offer, not a verdict. */
  conflict: PhoneConflict<Customer> | null;
  /** Somebody already holds this ת״ז — which is a verdict: it blocks the save. */
  idConflict: PhoneConflict<Customer> | null;
  /** More than one car on file for the picked customer — they choose. */
  vehicleChoices: Vehicle[];
  onPickCustomer: (c: Customer) => void;
  onPickVehicle: (v: Vehicle) => void;
  /** A plate picked out of the search: its owner, and that car. */
  onPickPlate: (c: Customer, v: Vehicle) => void;
  search: string;
  onSearch: (v: string) => void;
}) {
  const { t } = useTranslation();

  const query = search.trim();
  // The shared rule, not a second copy of it.
  const matches = useMemo(() => matchCustomers(customers, query), [customers, query]);

  /* The car half of the same box, as on the web: a known plate and whose it
     is. A car several people drive is offered once per driver — picking the
     row says which of them brought it in. */
  const plateMatches = useMemo(() => {
    const byId = new Map(customers.map((c) => [c.id, c]));
    return matchVehiclesByPlate(vehicles, query).flatMap((vehicle) => {
      const owner = byId.get(vehicle.customer_id);
      return owner ? [{ vehicle, customer: owner }] : [];
    });
  }, [customers, vehicles, query]);

  return (
    <>
      <View style={{ gap: 8 }}>
        <TextInput
          style={s.input}
          value={search}
          onChangeText={onSearch}
          placeholder={t('create.searchPlaceholder')}
          placeholderTextColor={C.dim}
          autoCorrect={false}
        />

        {query.length >= 1 && (
          <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
            {plateMatches.map(({ vehicle: v, customer: c }, i) => (
              <Pressable
                key={`v:${v.id}`}
                onPress={() => onPickPlate(c, v)}
                style={{ padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.line }}
              >
                <Text style={[s.h2, { textAlign: 'right' }]}>{`${v.plate} · ${c.name}`}</Text>
                <Text style={[s.dim, { marginTop: 2 }]}>
                  {[[v.manufacturer, v.model].filter(Boolean).join(' '), c.phone].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
            ))}
            {matches.length ? (
              matches.map((c, i) => (
                <Pressable
                  key={c.id}
                  onPress={() => onPickCustomer(c)}
                  style={{ padding: 12, borderTopWidth: i === 0 && !plateMatches.length ? 0 : 1, borderTopColor: C.line }}
                >
                  <Text style={[s.h2, { textAlign: 'right' }]}>{c.name}</Text>
                  <Text style={[s.dim, { marginTop: 2 }]}>
                    {[c.phone, c.city].filter(Boolean).join(' · ')}
                    {isBusinessCustomer(c.kind) ? `  · ${t('create.business')}` : ''}
                  </Text>
                </Pressable>
              ))
            ) : plateMatches.length ? null : (
              <Text style={[s.dim, { padding: 12 }]}>{t('create.noCustomerMatch')}</Text>
            )}
          </View>
        )}

        {vehicleChoices.length > 0 && (
          <View style={[s.card, { gap: 8 }]}>
            <Text style={s.label}>{t('create.pickVehicle')}</Text>
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
              {vehicleChoices.map((v) => (
                <Pressable
                  key={v.id}
                  onPress={() => onPickVehicle(v)}
                  style={{
                    borderWidth: 1,
                    borderColor: C.line,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                  }}
                >
                  <Text style={{ fontWeight: '700', color: C.ink, textAlign: 'right' }}>
                    {[v.manufacturer, v.model].filter(Boolean).join(' ') || v.plate}
                  </Text>
                  <Text style={[s.dim, { fontSize: 11 }]}>
                    {[v.plate, v.year, v.km && t('create.kmSuffix', { km: v.km })]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </View>

      <View style={[s.card, { gap: 10 }]}>
        <Text style={s.h2}>{t('create.customerSection')}</Text>
        <View style={s.row}>
          <Field label={t('create.fields.name')} flex>
            <TextInput
              style={s.input}
              value={form.customerName}
              onChangeText={(v) => onSet('customerName', v)}
            />
          </Field>
          <Field label={t('create.fields.phone')} flex>
            <TextInput
              style={s.input}
              keyboardType="phone-pad"
              value={form.customerPhone}
              onChangeText={(v) => onSet('customerPhone', v)}
            />
          </Field>
        </View>
        <View style={s.row}>
          <Field label={t('create.fields.idNumber')} flex>
            <TextInput
              style={s.input}
              keyboardType="numeric"
              value={form.idNumber}
              onChangeText={(v) => onSet('idNumber', v)}
            />
          </Field>
          <Field label={t('create.fields.email')} flex>
            <TextInput
              style={s.input}
              keyboardType="email-address"
              autoCapitalize="none"
              value={form.email}
              onChangeText={(v) => onSet('email', v)}
            />
          </Field>
        </View>
        <Field label={t('create.fields.address')}>
          <TextInput style={s.input} value={form.address} onChangeText={(v) => onSet('address', v)} />
        </Field>
        <Field label={t('create.fields.city')}>
          <TextInput style={s.input} value={form.city} onChangeText={(v) => onSet('city', v)} />
        </Field>

        {/* The ת״ז is on somebody else's file, and unlike the phone below that
            is not something to wave past: it is unique per garage, so it cannot
            be written onto a second person, and the ticket would carry a number
            belonging to somebody it is not about. The save waits for an answer
            — attach the ticket to the holder, or fix the number. */}
        {idConflict && (
          <ConflictBox
            danger
            message={t('create.idConflict.taken', { name: idConflict.customer.name })}
            action={t('create.conflict.attach')}
            onAction={() => onPickCustomer(idConflict.customer)}
          />
        )}

        {/* Said out loud and left to the advisor: a line is shared by a couple,
            by a company, by a parent paying for a student's car. Attaching is
            one option; carrying on opens a second customer on the same number. */}
        {conflict && (
          <ConflictBox
            danger={conflict.differentName}
            message={
              conflict.differentName
                ? t('create.conflict.differentName', { name: conflict.customer.name })
                : t('create.conflict.sameName', { name: conflict.customer.name })
            }
            action={t('create.conflict.attach')}
            onAction={() => onPickCustomer(conflict.customer)}
          />
        )}
      </View>
    </>
  );
}

/** A number that is already somebody's, and the one button that resolves it.
 *  Both cases render the same way on purpose — what differs is whether the
 *  screen will save without an answer, which is not a visual distinction. */
function ConflictBox({
  message,
  action,
  onAction,
  danger,
}: {
  message: string;
  action: string;
  onAction: () => void;
  danger?: boolean;
}) {
  return (
    <View
      style={{
        gap: 8,
        padding: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: danger ? C.danger : C.line,
        backgroundColor: danger ? C.dangerBg : C.card,
      }}
    >
      <Text style={{ fontSize: 12.5, fontWeight: '700', color: danger ? C.danger : C.ink, ...rtl }}>
        {message}
      </Text>
      <Button
        label={action}
        onPress={onAction}
        variant="outline"
        size="sm"
        style={{ alignSelf: 'flex-start' }}
      />
    </View>
  );
}
