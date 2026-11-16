/* Collecting the pages: photograph or pick up to five, put them in order, take
   one again, drop one. Nothing leaves the phone until סיום. */

import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SCAN_MAX_PAGES } from '@garage/shared';
import { C, s } from '../../lib/theme';
import { Button, TrashIcon } from '../ui';
import { capturePage, type LocalPage, type PageSource } from './scanPages';

export function ScanCapture({
  pages,
  onAdd,
  onReplace,
  onRemove,
  onMove,
  onDone,
}: {
  pages: LocalPage[];
  onAdd: (p: LocalPage) => void;
  onReplace: (i: number, p: LocalPage) => void;
  onRemove: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const full = pages.length >= SCAN_MAX_PAGES;

  const take = async (from: PageSource, replaceAt?: number) => {
    const r = await capturePage(from);
    if (r.kind === 'denied') {
      Alert.alert(
        t('scan.capture.permissionTitle'),
        from === 'camera' ? t('scan.capture.cameraPermission') : t('scan.capture.libraryPermission'),
      );
      return;
    }
    if (r.kind !== 'page') return;
    if (replaceAt != null) onReplace(replaceAt, r.page);
    else onAdd(r.page);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={[s.body, { color: C.slate }]}>{t('scan.capture.hint')}</Text>

        {pages.map((p, i) => (
          <View key={p.uri} style={[s.card, s.row, { gap: 12, padding: 10 }]}>
            <Image
              source={{ uri: p.uri }}
              style={{ width: 64, height: 86, borderRadius: 6, backgroundColor: C.tint }}
              resizeMode="cover"
              accessibilityLabel={t('scan.capture.page', { n: i + 1 })}
            />
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={s.h2}>{t('scan.capture.page', { n: i + 1 })}</Text>
              <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                <Button size="sm" variant="secondary" label={t('scan.capture.retake')} onPress={() => void take('camera', i)} />
                {i > 0 && (
                  <Button size="sm" variant="outline" label={t('scan.capture.moveEarlier')} onPress={() => onMove(i, -1)} />
                )}
                {i < pages.length - 1 && (
                  <Button size="sm" variant="outline" label={t('scan.capture.moveLater')} onPress={() => onMove(i, 1)} />
                )}
              </View>
            </View>
            <Pressable
              onPress={() => onRemove(i)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('scan.capture.remove')}
              style={{ padding: 6 }}
            >
              <TrashIcon />
            </Pressable>
          </View>
        ))}

        {full ? (
          <Text style={[s.dim, { textAlign: 'center' }]}>{t('scan.capture.full')}</Text>
        ) : (
          <View style={{ gap: 8 }}>
            <Button
              variant={pages.length === 0 ? 'primary' : 'accent'}
              label={pages.length === 0
                ? t('scan.capture.camera')
                : `${t('scan.capture.camera')} · ${t('scan.capture.pageOf', { n: pages.length + 1, max: SCAN_MAX_PAGES })}`}
              onPress={() => void take('camera')}
            />
            <Button variant="outline" label={t('scan.capture.library')} onPress={() => void take('library')} />
          </View>
        )}
      </ScrollView>

      {pages.length > 0 && (
        <View style={{ padding: 16, paddingBottom: 24, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card }}>
          <Button label={t('scan.capture.done', { count: pages.length })} onPress={onDone} />
        </View>
      )}
    </View>
  );
}
