/* Which car. Make and model come from the catalog through a combo field — pick
   from the list or type your own, the same bargain the web form's <datalist>
   makes. The models follow the make above, and a make the catalog does not carry
   simply offers none. */

import { TextInput, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { VEHICLE_MAKES, modelsFor } from '@garage/shared';
import { s } from '../../lib/theme';
import { Checkbox, ComboField, Field } from '../ui';
import type { TicketForm } from './newTicket';

export function VehicleSection({
  form,
  onSet,
}: {
  form: TicketForm;
  onSet: <K extends keyof TicketForm>(key: K, value: TicketForm[K]) => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={[s.card, { gap: 10 }]}>
      <Text style={s.h2}>{t('create.vehicleSection')}</Text>

      <Field label={t('create.fields.plate')}>
        <TextInput
          style={s.input}
          value={form.licensePlate}
          onChangeText={(v) => onSet('licensePlate', v)}
        />
      </Field>

      <ComboField
        label={t('create.fields.manufacturer')}
        value={form.manufacturer}
        options={VEHICLE_MAKES}
        onChange={(v) => onSet('manufacturer', v)}
        placeholder={t('create.comboPlaceholder')}
      />
      <ComboField
        label={t('create.fields.model')}
        value={form.model}
        options={modelsFor(form.manufacturer)}
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
