/* A value that is shown but not typed into.

   Deliberately shaped like the input it replaces — same box, same height, same
   alignment — because a field that silently ignores taps reads as broken. The
   muted fill and colour are the whole message: this is a fact, not a control.

   An empty value renders the em dash rather than an empty box, so "nothing was
   recorded" and "the app failed to load it" do not look the same. */

import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C, rtl } from '../../lib/theme';

export function ReadOnly({ value }: { value: string | null | undefined }) {
  const { t } = useTranslation();
  const shown = value?.trim();

  return (
    /* The box is written out rather than reusing s.input: that style carries
       text-only keys — colour, size, alignment — and a View is not where those
       belong. The numbers are the input's, so the two stay the same shape. */
    <View
      style={{
        backgroundColor: C.tint,
        borderWidth: 1,
        borderColor: C.line,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Text style={[rtl, { fontSize: 15, color: shown ? C.slate : C.dim }]} numberOfLines={2}>
        {shown || t('common.none')}
      </Text>
    </View>
  );
}
