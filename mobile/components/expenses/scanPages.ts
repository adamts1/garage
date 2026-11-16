/* Getting one page of a supplier invoice off paper and into a JPEG.

   The one place that knows how a page is captured. Today that is the camera
   the app already ships (expo-image-picker), with the system's crop step; a
   native document scanner — edge detection, perspective correction — can
   replace capturePage() without the screens noticing, once it has been tried
   on a real build. Picking from the library is here too: plenty of supplier
   invoices arrive as a photo on WhatsApp.

   Every page leaves shrunk: 1568 px on the long side, which is the largest the
   model reads at — anything bigger it scales down itself, so the extra pixels
   would only be a slower upload on the garage's cellular. */

import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** The model's own ceiling. Past this a page costs upload time and buys nothing. */
const MAX_EDGE = 1568;
/** Print on paper needs a little more than a photo of a bumper does. */
const QUALITY = 0.8;

export interface LocalPage {
  /** For the thumbnail. */
  uri: string;
  /** The JPEG to upload. */
  base64: string;
}

export type PageSource = 'camera' | 'library';

export type CaptureResult =
  | { kind: 'page'; page: LocalPage }
  | { kind: 'cancelled' }
  | { kind: 'denied' };

async function shrink(asset: ImagePicker.ImagePickerAsset): Promise<LocalPage> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_EDGE) {
    context.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await context.renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY, base64: true });
  return { uri: out.uri, base64: out.base64 ?? '' };
}

export async function capturePage(from: PageSource): Promise<CaptureResult> {
  const permission = from === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { kind: 'denied' };

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // Full quality off the camera: it is shrunk once, here, rather than
    // compressed twice.
    quality: 1,
    // The system crop: the nearest thing to a document outline the shipped
    // camera has, and it takes the table and the hand out of the picture.
    allowsEditing: true,
  };
  const result = from === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return { kind: 'cancelled' };
  return { kind: 'page', page: await shrink(asset) };
}
