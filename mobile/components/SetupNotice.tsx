/* What the app shows instead of an empty list when mobile/.env has not been
   filled in. Developer-facing, and the only screen that reaches someone who has
   never had a working build. */

import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, s } from '../lib/theme';

export default function SetupNotice() {
  const { t } = useTranslation();

  return (
    <View style={[s.screen, { padding: 24, justifyContent: 'center', gap: 12 }]}>
      <Text style={s.h1}>{t('setup.title')}</Text>
      <Text style={s.body}>{t('setup.body')}</Text>
      <View style={[s.card, { backgroundColor: C.ink }]}>
        <Text style={{ color: C.sand, fontFamily: 'Courier', fontSize: 12 }}>
          EXPO_PUBLIC_SUPABASE_URL=…{'\n'}EXPO_PUBLIC_SUPABASE_ANON_KEY=…
        </Text>
      </View>
      <Text style={s.dim}>{t('setup.restart')}</Text>
    </View>
  );
}
