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
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useTranslation } from 'react-i18next';
import {
  deleteTicketPhoto, isPhotoLimitError, listTicketPhotos, PHOTO_LIMIT, uploadTicketPhoto,
  type TicketPhoto,
} from '@garage/shared';

/** A photo of a scratched bumper does not need 12MP, and the mechanic is usually on cellular. */
const QUALITY = 0.7;

/* The longest edge an uploaded photo is allowed to have.

   `quality` above is compression, not size — it re-encodes the twelve
   megapixels the camera produced and hands over two to four megabytes anyway.
   On the wifi in a garage that is ten to thirty seconds of the mechanic holding
   a phone up, and it is why uploading felt broken.

   1600 is well above what any screen here shows: the grid draws thumbnails a
   third of a phone wide, and the viewer is one phone wide. It is also above
   what the photos are for — a scratch, a dent, an odometer — while being about
   a tenth of the bytes.

   Downscaling only. resize() enlarges just as willingly, and a small photo blown
   up to 1600 is a bigger upload than the one that was picked. */
const MAX_EDGE = 1600;

const shrink = async (asset: ImagePicker.ImagePickerAsset) => {
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_EDGE) {
    context.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await context.renderAsync();
  /* Base64 is produced here rather than by the picker. The picker's own
     `base64: true` encoded the full-size original — a four-megabyte string
     across the bridge, and a hand-written decoder walking every character of it
     on the other side — for an image we were about to throw away. */
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY, base64: true });
  return { base64: out.base64 ?? '', mime: 'image/jpeg', ext: 'jpg' };
};

export type PhotoSource = 'camera' | 'library';

export function useTicketPhotos(ticketKey: string) {
  const { t } = useTranslation();

  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  /* The local files of photos still going up, so the grid can show them at once.
     Even a fast upload is a second or two of a screen that looks like it ignored
     the shutter; the tile appearing immediately is the difference between
     waiting and wondering whether it worked. */
  const [pending, setPending] = useState<string[]>([]);

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

  /* How many more this ticket will take.
     A ticket holds at most PHOTO_LIMIT photos — the database enforces it, this
     is what lets the screen say so before the camera opens rather than after an
     upload comes back rejected. Never negative: a ticket photographed before the
     limit existed can be over it, and it simply accepts nothing new. */
  const remaining = Math.max(0, PHOTO_LIMIT - photos.length);

  const add = async (from: PhotoSource) => {
    if (remaining === 0) {
      Alert.alert(t('ticket.photos.limitTitle'), t('ticket.photos.limitBody', { count: PHOTO_LIMIT }));
      return;
    }

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
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: QUALITY })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: QUALITY,
            allowsMultipleSelection: remaining > 1,
            // Only as many as the ticket can still take, so the picker refuses a
            // third rather than the upload doing it one photo too late.
            selectionLimit: remaining,
          });
    if (result.canceled) return;

    const chosen = result.assets.slice(0, remaining);
    setPending(chosen.map((a) => a.uri));
    setUploading(true);
    try {
      // Sequential: parallel uploads on a garage's wifi is how you get timeouts.
      for (const asset of chosen) {
        const file = await shrink(asset);
        if (!file.base64) continue;
        const photo = await uploadTicketPhoto(ticketKey, file);
        setPhotos((prev) => [...prev, photo]); // each one appears as it lands
        // Its placeholder goes as the real tile arrives, so neither blinks.
        setPending((prev) => prev.filter((uri) => uri !== asset.uri));
      }
    } catch (e: any) {
      // The cap refused it — from the count above, or from the trigger when
      // another device filled the ticket while this one was picking. Not a
      // failure to report as one.
      if (isPhotoLimitError(e)) {
        Alert.alert(t('ticket.photos.limitTitle'), t('ticket.photos.limitBody', { count: PHOTO_LIMIT }));
      } else {
        Alert.alert(t('ticket.photos.uploadFailed'), e?.message ?? t('ticket.photos.uploadFailedBody'));
      }
    } finally {
      setUploading(false);
      // Whatever is left never made it — an error already said so, and a tile
      // stuck mid-upload forever would claim otherwise.
      setPending([]);
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

  return { photos, pending, loading, uploading, remaining, add, confirmRemove };
}

export type TicketPhotos = ReturnType<typeof useTicketPhotos>;
