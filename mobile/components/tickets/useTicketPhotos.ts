/* A ticket's photos: loading them, adding them, deleting them.

   Photos are their own table and their own bytes, so they save on their own too —
   uploading is immediate and never rides along on the ticket's dirty/save flow.

   This is a controller hook, not a data hook: the alerts live here rather than in
   PhotosTab because every one of them reports on an OS-level step — a permission
   the user declined, a camera that returned nothing, an upload that timed out —
   and the message belongs next to the step that failed. What comes back is a
   list and three functions, which leaves PhotosTab purely presentational. */

import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { deleteTicketPhoto, listTicketPhotos, uploadTicketPhoto, type TicketPhoto } from '@garage/shared';

/** A photo of a scratched bumper does not need 12MP, and the mechanic is usually on cellular. */
const QUALITY = 0.7;
const SELECTION_LIMIT = 10;

export type PhotoSource = 'camera' | 'library';

export function useTicketPhotos(ticketKey: string) {
  const { t } = useTranslation();

  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!ticketKey) return;
    let alive = true;
    setLoading(true);
    listTicketPhotos(ticketKey)
      .then((p) => alive && setPhotos(p))
      .catch(() => alive && setPhotos([])) // an empty gallery beats blocking the screen
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [ticketKey]);

  const add = async (from: PhotoSource) => {
    const permission =
      from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        t('ticket.photos.permissionTitle'),
        from === 'camera' ? t('ticket.photos.cameraPermission') : t('ticket.photos.libraryPermission'),
      );
      return;
    }

    const result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: QUALITY, base64: true })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: QUALITY,
            base64: true,
            allowsMultipleSelection: true,
            selectionLimit: SELECTION_LIMIT,
          });
    if (result.canceled) return;

    setUploading(true);
    try {
      // Sequential: ten parallel uploads on a garage's wifi is how you get timeouts.
      for (const asset of result.assets) {
        if (!asset.base64) continue;
        const ext = (asset.fileName?.split('.').pop() ?? asset.uri.split('.').pop() ?? 'jpg').toLowerCase();
        const photo = await uploadTicketPhoto(ticketKey, {
          base64: asset.base64,
          mime: asset.mimeType ?? 'image/jpeg',
          ext,
        });
        setPhotos((prev) => [...prev, photo]); // each one appears as it lands
      }
    } catch (e: any) {
      Alert.alert(t('ticket.photos.uploadFailed'), e?.message ?? t('ticket.photos.uploadFailedBody'));
    } finally {
      setUploading(false);
    }
  };

  /** Asks first — a photo is the only record of what the car looked like on arrival. */
  const confirmRemove = (photo: TicketPhoto, onRemoved?: () => void) =>
    Alert.alert(t('ticket.photos.deleteTitle'), t('ticket.photos.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTicketPhoto(photo);
            setPhotos((prev) => prev.filter((x) => x.id !== photo.id));
            onRemoved?.();
          } catch (e: any) {
            Alert.alert(t('ticket.photos.deleteFailed'), e?.message ?? t('ticket.photos.deleteFailedBody'));
          }
        },
      },
    ]);

  return { photos, loading, uploading, add, confirmRemove };
}

export type TicketPhotos = ReturnType<typeof useTicketPhotos>;
