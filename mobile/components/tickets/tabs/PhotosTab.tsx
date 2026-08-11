/* The photos tab: two ways to add one, a grid of what is there, and a
   full-screen viewer. All the work happens in useTicketPhotos — this decides
   only what it looks like. */

import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PHOTO_LIMIT, type TicketPhoto } from '@garage/shared';
import { C, s } from '../../../lib/theme';
import { Button, SectionHead } from '../../ui';
import type { TicketPhotos } from '../useTicketPhotos';

/** Three to a row, with the gap taken out of the width. */
const TILE_WIDTH = '31.9%';

export function PhotosTab({ photos: store }: { photos: TicketPhotos }) {
  const { t } = useTranslation();
  const { photos, loading, uploading, remaining, add, confirmRemove } = store;
  const [viewing, setViewing] = useState<TicketPhoto | null>(null);

  const full = remaining === 0;

  return (
    <>
      <SectionHead title={t('ticket.tabs.photos')} count={photos.length} />

      {/* Disabled rather than hidden. A button that vanishes leaves the mechanic
          wondering where the camera went; one that is greyed out with the rule
          written under it answers that before it is asked. */}
      <View style={[s.row, { gap: 10 }]}>
        <Button
          label={t('ticket.photos.camera')}
          onPress={() => add('camera')}
          variant="outline"
          disabled={uploading || full}
          style={{ flex: 1 }}
        />
        <Button
          label={t('ticket.photos.library')}
          onPress={() => add('library')}
          variant="outline"
          disabled={uploading || full}
          style={{ flex: 1 }}
        />
      </View>

      <Text style={[s.dim, { textAlign: 'center' }]}>
        {t('ticket.photos.limitHint', { count: PHOTO_LIMIT })}
      </Text>

      {uploading && (
        <View style={[s.row, { justifyContent: 'center', gap: 8, paddingVertical: 4 }]}>
          <Text style={s.dim}>{t('ticket.photos.uploading')}</Text>
          <ActivityIndicator color={C.ink} />
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={C.ink} style={{ marginTop: 20 }} />
      ) : photos.length === 0 ? (
        <View style={[s.card, { alignItems: 'center', paddingVertical: 28 }]}>
          <Text style={s.dim}>{t('ticket.photos.empty')}</Text>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
            {photos.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setViewing(p)}
                onLongPress={() => confirmRemove(p)} // long-press to delete, as everywhere else on the card
                style={{ width: TILE_WIDTH, aspectRatio: 1 }}
                accessibilityRole="imagebutton"
              >
                <Image
                  source={{ uri: p.url }}
                  style={{ width: '100%', height: '100%', borderRadius: 10, backgroundColor: C.line }}
                />
              </Pressable>
            ))}
          </View>
          <Text style={[s.dim, { textAlign: 'center' }]}>{t('ticket.photos.deleteHint')}</Text>
        </>
      )}

      <PhotoViewer
        photo={viewing}
        onClose={() => setViewing(null)}
        onDelete={(p) => confirmRemove(p, () => setViewing(null))}
      />
    </>
  );
}

function PhotoViewer({
  photo,
  onClose,
  onDelete,
}: {
  photo: TicketPhoto | null;
  onClose: () => void;
  onDelete: (photo: TicketPhoto) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={Boolean(photo)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose}>
          {photo && <Image source={{ uri: photo.url }} style={{ flex: 1 }} resizeMode="contain" />}
        </Pressable>
        <View
          style={[
            s.rowBetween,
            { paddingHorizontal: 18, paddingTop: 12, paddingBottom: insets.bottom + 12 },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={{ color: C.onInk, fontSize: 15, fontWeight: '700' }}>
              {t('common.close')}
            </Text>
          </Pressable>
          <Text style={{ color: C.onOverlay, fontSize: 12 }}>{photo?.createdAt}</Text>
          <Pressable
            onPress={() => photo && onDelete(photo)}
            hitSlop={12}
            accessibilityRole="button"
          >
            <Text style={{ color: C.danger, fontSize: 15, fontWeight: '700' }}>
              {t('common.delete')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
