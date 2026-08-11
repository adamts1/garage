/* The account bottom sheet, opened from the header menu. Shows who is signed in
   and offers sign-out. It replaced a header button next to the back arrow —
   sign-out is now one deliberate step behind the menu rather than a mistap. */

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { listWorkers, signedInAs, signOut, type Worker } from '@garage/shared';
import { useAuth } from '../../lib/useAuth';
import { C, s } from '../../lib/theme';
import { PowerIcon } from '../ui';

export function UserSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const auth = useAuth();

  /* The staff list, only to turn the account into a person: the sheet showed
     "dani@garage.co.il" where every other screen in the app calls them דני כהן.
     Fetched when the sheet opens rather than held by the app — it is one row's
     worth of answer, wanted about once a shift. An empty list is fine; the
     fallback below is the address, which is what this showed before. */
  const [workers, setWorkers] = useState<Worker[]>([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    listWorkers()
      .then((team) => { if (live) setWorkers(team); })
      .catch(() => {});
    return () => { live = false; };
  }, [open]);

  const email = auth.session?.user?.email ?? '';
  const garage = auth.garages[0]?.name ?? '';
  const me = signedInAs(workers);
  const title = me?.name || email || t('auth.user');
  const initial = (me?.initials || email.trim()[0] || '👤').toUpperCase();

  const doSignOut = () => {
    onClose();
    void signOut();
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel={t('common.close')}
        />

        <View
          style={{
            backgroundColor: C.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingTop: 10,
            paddingBottom: insets.bottom + 12,
          }}
        >
          {/* grabber */}
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: C.line,
              marginBottom: 8,
            }}
          />

          <View style={[s.row, { gap: 12, paddingHorizontal: 20, paddingVertical: 12 }]}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: C.ink,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: C.onInk, fontSize: 18, fontWeight: '700' }}>{initial}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ fontSize: 15, fontWeight: '700', color: C.ink, textAlign: 'right' }}
                numberOfLines={1}
              >
                {title}
              </Text>
              {/* The address stays, under the name: a nickname two people answer
                  to is not what you check when you want to know whose session
                  this is. Dropped when it IS the title, so it is not printed
                  twice. */}
              {!!email && email !== title && (
                <Text
                  style={{ fontSize: 12.5, color: C.dim, textAlign: 'right', marginTop: 2 }}
                  numberOfLines={1}
                >
                  {email}
                </Text>
              )}
              {!!garage && (
                <Text
                  style={{ fontSize: 12.5, color: C.dim, textAlign: 'right', marginTop: 2 }}
                  numberOfLines={1}
                >
                  {garage}
                </Text>
              )}
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: C.line, marginVertical: 4 }} />

          <Pressable
            onPress={doSignOut}
            style={({ pressed }) => ({
              flexDirection: 'row-reverse',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 20,
              paddingVertical: 15,
              backgroundColor: pressed ? C.dangerPress : 'transparent',
            })}
            accessibilityRole="button"
          >
            <View style={{ width: 44, alignItems: 'center' }}>
              <PowerIcon />
            </View>
            <Text style={{ fontSize: 15, fontWeight: '600', color: C.danger, textAlign: 'right' }}>
              {t('auth.signOut')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
