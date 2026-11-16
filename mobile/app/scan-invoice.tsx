/* The phone route for scanning a supplier invoice: pages → reading → review →
   saved, on one screen whose body changes with the stage. The work lives in
   components/expenses; this is the header, the in-between screens, and the
   way out. */

import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { C, s } from '../lib/theme';
import { Button } from '../components/ui';
import { ScanCapture } from '../components/expenses/ScanCapture';
import { ScanReview } from '../components/expenses/ScanReview';
import { useInvoiceScan } from '../components/expenses/useInvoiceScan';

export default function ScanInvoiceRoute() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scan = useInvoiceScan();

  const leave = () => {
    if (scan.stage === 'capture' && scan.pages.length > 0) {
      Alert.alert(t('scan.capture.discardTitle'), t('scan.capture.discardBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('scan.capture.discard'), style: 'destructive', onPress: () => router.back() },
      ]);
      return;
    }
    if (scan.stage === 'review') {
      Alert.alert(t('scan.review.leaveTitle'), t('scan.review.leaveBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('scan.review.discardDraft'), style: 'destructive', onPress: () => { void scan.discard().then(() => router.back()); } },
        { text: t('scan.review.leave'), onPress: () => router.back() },
      ]);
      return;
    }
    void scan.discard().then(() => router.back());
  };

  return (
    <View style={s.screen}>
      <View style={[s.row, { backgroundColor: C.ink, paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 8 }]}>
        <Pressable onPress={leave} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.onInk, fontSize: 22 }}>›</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.onInk, fontSize: 18, fontWeight: '800', textAlign: 'right' }}>{t('scan.title')}</Text>
          {scan.stage === 'review' && (
            <Text style={{ color: C.onInkDim, fontSize: 12, textAlign: 'right' }}>{t('scan.review.subtitle')}</Text>
          )}
        </View>
      </View>

      {scan.restoring ? (
        <View style={s.centred}><ActivityIndicator color={C.ink} /></View>
      ) : scan.stage === 'capture' ? (
        <ScanCapture
          pages={scan.pages}
          onAdd={scan.addPage}
          onReplace={scan.replacePage}
          onRemove={scan.removePage}
          onMove={scan.movePage}
          onDone={() => void scan.submit()}
        />
      ) : scan.stage === 'uploading' || scan.stage === 'reading' ? (
        <View style={[s.centred, { padding: 24, gap: 14 }]}>
          <ActivityIndicator size="large" color={C.ink} />
          <Text style={[s.h2, { textAlign: 'center' }]}>
            {scan.stage === 'uploading'
              ? t('scan.processing.uploading', { n: Math.min(scan.uploaded + 1, scan.pages.length), count: scan.pages.length })
              : t('scan.processing.reading')}
          </Text>
          {scan.stage === 'reading' && <Text style={s.dim}>{t('scan.processing.readingHint')}</Text>}
          <Button variant="outline" label={t('scan.processing.cancel')} onPress={leave} style={{ marginTop: 12, minWidth: 160 }} />
        </View>
      ) : scan.stage === 'failed' ? (
        <View style={[s.centred, { padding: 24, gap: 12 }]}>
          {/* Upload failures and reading failures read differently: the first is
              the connection, and the pages are safe on the phone. */}
          {scan.uploaded < scan.pages.length ? (
            <>
              <Text style={[s.h2, { textAlign: 'center' }]}>{t('scan.failed.uploadTitle')}</Text>
              <Text style={[s.body, { textAlign: 'center', color: C.slate }]}>{t('scan.failed.uploadBody')}</Text>
              <Button label={t('scan.failed.retry')} onPress={() => void scan.submit()} style={{ minWidth: 200 }} />
            </>
          ) : (
            <>
              <Text style={[s.h2, { textAlign: 'center' }]}>{t('scan.failed.title')}</Text>
              {!!scan.error?.message && <Text style={[s.dim, { textAlign: 'center' }]}>{scan.error.message}</Text>}
              {scan.error?.retryable !== false && (
                <Button label={t('scan.failed.retry')} onPress={() => void scan.submit()} style={{ minWidth: 220 }} />
              )}
              <Button variant="outline" label={t('scan.failed.byHand')} onPress={() => void scan.reviewByHand()} style={{ minWidth: 220 }} />
            </>
          )}
        </View>
      ) : scan.response && scan.draft && scan.choices ? (
        <ScanReview
          response={scan.response}
          draft={scan.draft}
          choices={scan.choices}
          pageUrls={scan.pageUrls}
          onDraft={scan.setDraft}
          onChoices={scan.setChoices}
          onSave={scan.save}
          onSaved={(count) => {
            Alert.alert(t('scan.review.savedTitle'), t('scan.review.savedBody', { count }), [
              { text: t('common.close'), onPress: () => router.back() },
            ]);
          }}
        />
      ) : null}
    </View>
  );
}
