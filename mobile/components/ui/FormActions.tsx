/* Submit and go-back, at the foot of a form that was reached from a list.
   Submit takes the width it can, back takes what it needs. */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { s } from '../../lib/theme';
import { Button } from './Button';

export function FormActions({
  disabled,
  onBack,
  onSubmit,
  submitLabel,
}: {
  disabled: boolean;
  onBack: () => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  const { t } = useTranslation();

  return (
    <View style={[s.row, { gap: 10, marginTop: 4 }]}>
      <Button label={submitLabel} onPress={onSubmit} disabled={disabled} style={{ flex: 1 }} />
      <Button label={t('ui.backToSearch')} onPress={onBack} variant="outline" />
    </View>
  );
}
