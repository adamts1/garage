/* Which car. Make and model come from the catalog through a combo field — pick
   from the list or type your own, the same bargain the web form's <datalist>
   makes. The models follow the make above, and a make the catalog does not carry
   simply offers none. Both lists also carry what this garage has already saved
   on its cars — see useVehicleSuggestions. */

import { Pressable, TextInput, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type PlateOwner } from '@garage/shared';
import { useVehicleSuggestions } from '../../lib/useVehicleSuggestions';
import { C, rtl, s } from '../../lib/theme';
import { Button, Checkbox, ComboField, Field } from '../ui';
import type { TicketForm } from './newTicket';

export function VehicleSection({
  form,
  onSet,
  onPlateDone,
  ownerChoices = [],
  onPickOwner,
  openTicketKey,
  onGoToOpenTicket,
}: {
  form: TicketForm;
  onSet: <K extends keyof TicketForm>(key: K, value: TicketForm[K]) => void;
  /** The plate field was left — a plate already on file fills the car's blanks. */
  onPlateDone: () => void;
  /** A known plate several customers share, typed with the customer still
   *  blank — they choose who brought it in. */
  ownerChoices?: PlateOwner[];
  onPickOwner?: (o: PlateOwner) => void;
  /** A work order already open on this car for this customer. */
  openTicketKey?: string | null;
  onGoToOpenTicket?: (key: string) => void;
}) {
  const { t } = useTranslation();
  const vehicles = useVehicleSuggestions();

  return (
    <View style={[s.card, { gap: 10 }]}>
      <Text style={s.h2}>{t('create.vehicleSection')}</Text>

      <Field label={t('create.fields.plate')}>
        <TextInput
          style={s.input}
          value={form.licensePlate}
          onChangeText={(v) => onSet('licensePlate', v)}
          onEndEditing={onPlateDone}
        />
      </Field>

      {ownerChoices.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={s.label}>{t('create.pickOwner')}</Text>
          <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
            {ownerChoices.map((o) => (
              <Pressable
                key={o.vehicle.id}
                onPress={() => onPickOwner?.(o)}
                style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}
              >
                <Text style={{ fontWeight: '700', color: C.ink, textAlign: 'right' }}>{o.customer.name}</Text>
                <Text style={[s.dim, { fontSize: 11 }]}>
                  {[o.customer.phone, o.customer.city].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* Said as soon as it is known, and asked again on save. */}
      {openTicketKey ? (
        <View
          style={{
            gap: 8, padding: 10, borderRadius: 10, borderWidth: 1,
            borderColor: C.danger, backgroundColor: C.dangerBg,
          }}
        >
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: C.danger, ...rtl }}>
            {t('create.openTicket.exists', { key: openTicketKey })}
          </Text>
          {onGoToOpenTicket && (
            <Button
              label={t('create.openTicket.goTo')}
              onPress={() => onGoToOpenTicket(openTicketKey)}
              variant="outline"
              size="sm"
              style={{ alignSelf: 'flex-start' }}
            />
          )}
        </View>
      ) : null}

      <ComboField
        label={t('create.fields.manufacturer')}
        value={form.manufacturer}
        options={vehicles.makes}
        onChange={(v) => onSet('manufacturer', v)}
        placeholder={t('create.comboPlaceholder')}
      />
      <ComboField
        label={t('create.fields.model')}
        value={form.model}
        options={vehicles.modelsFor(form.manufacturer)}
        onChange={(v) => onSet('model', v)}
        placeholder={form.manufacturer ? t('create.comboPlaceholder') : t('create.modelPlaceholder')}
      />

      <View style={s.row}>
        <Field label={t('create.fields.year')} flex>
          <TextInput
            style={s.input}
            keyboardType="numeric"
            value={form.year}
            onChangeText={(v) => onSet('year', v)}
          />
        </Field>
        <Field label={t('create.fields.km')} flex>
          <TextInput
            style={s.input}
            keyboardType="numeric"
            value={form.km}
            // Digits only: an odometer reading with a comma in it is a string the
            // vehicles table cannot compare against the last one.
            onChangeText={(v) => onSet('km', v.replace(/\D/g, ''))}
          />
        </Field>
        <Field label={t('create.fields.vehicleCode')} flex>
          <TextInput
            style={s.input}
            value={form.vehicleCode}
            onChangeText={(v) => onSet('vehicleCode', v)}
          />
        </Field>
      </View>

      <Checkbox
        checked={form.keyReceived}
        onChange={(v) => onSet('keyReceived', v)}
        label={t('create.keyReceived')}
      />
    </View>
  );
}
