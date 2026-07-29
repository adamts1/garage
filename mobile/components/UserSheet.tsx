/* The account bottom sheet, opened from the header menu. Shows who is signed in
   and offers Log Out. Replaces the old header "יציאה" button — sign-out is now
   one deliberate step behind the menu rather than a mistap-prone header button
   next to the back arrow. */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signOut } from '@garage/shared';
import { useAuth } from '../lib/useAuth';
import { C } from '../lib/theme';

/** Universal power/log-out mark, drawn so it needs no icon font. */
function PowerIcon({ color = C.danger }: { color?: string }) {
  return (
    <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: color, marginTop: 3 }} />
      <View style={{ position: 'absolute', top: 0, width: 2, height: 9, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
}

export function UserSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const email = auth.session?.user?.email ?? '';
  const garage = auth.garages[0]?.name ?? '';
  const initial = (email.trim()[0] ?? '👤').toUpperCase();

  const doSignOut = () => { onClose(); void signOut(); };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="סגור" />

        <View style={{
          backgroundColor: '#fff',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          paddingTop: 10, paddingBottom: insets.bottom + 12,
        }}>
          {/* grabber */}
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 8 }} />

          {/* user */}
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>{initial}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.ink, textAlign: 'right' }} numberOfLines={1}>
                {email || 'משתמש'}
              </Text>
              {!!garage && (
                <Text style={{ fontSize: 12.5, color: C.dim, textAlign: 'right', marginTop: 2 }} numberOfLines={1}>
                  {garage}
                </Text>
              )}
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: C.line, marginVertical: 4 }} />

          {/* log out */}
          <Pressable
            onPress={doSignOut}
            style={({ pressed }) => ({
              flexDirection: 'row-reverse', alignItems: 'center', gap: 12,
              paddingHorizontal: 20, paddingVertical: 15,
              backgroundColor: pressed ? '#faf0ef' : 'transparent',
            })}
            accessibilityRole="button" accessibilityLabel="התנתקות"
          >
            <View style={{ width: 44, alignItems: 'center' }}><PowerIcon /></View>
            <Text style={{ fontSize: 15, fontWeight: '600', color: C.danger, textAlign: 'right' }}>התנתקות</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
