/* A full-height modal with a navy header and a close button — what the catalog
   pickers open into. */

import { Modal, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, s } from '../../lib/theme';

export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Pinned under the content, above the home indicator — where a picker's
   *  "add the selected" button stays in reach however long the list is. */
  footer?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <View style={s.screen}>
        <View style={[s.rowBetween, { padding: 14, backgroundColor: C.ink }]}>
          <Text style={{ color: C.onInk, fontSize: 16, fontWeight: '700' }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={{ color: C.onInk, fontSize: 15 }}>{t('common.close')}</Text>
          </Pressable>
        </View>
        {children}
        {footer ? (
          <View
            style={{
              padding: 12,
              paddingBottom: 12 + insets.bottom,
              borderTopWidth: 1,
              borderTopColor: C.line,
              backgroundColor: C.card,
            }}
          >
            {footer}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
