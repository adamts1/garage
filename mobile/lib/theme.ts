import { StyleSheet, TextStyle } from 'react-native';

/** The web app's palette, so the two products look like one system. */
export const C = {
  ink: '#1d2d44',
  slate: '#3e5c76',
  mist: '#748cab',
  sand: '#f0ebd8',
  bg: '#f4f5f7',
  card: '#ffffff',
  line: '#e3e6ea',
  text: '#1d2d44',
  dim: '#7a8699',
  danger: '#a5544b',
  ok: '#4f7a5b',
};

/* Hebrew UI. We don't call I18nManager.forceRTL - on native it needs a full app
   restart to take effect and behaves inconsistently in Expo Go. Aligning text
   explicitly gets the same result, predictably. */
export const rtl: TextStyle = { textAlign: 'right', writingDirection: 'rtl' };

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  card: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.line,
  },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  label: { ...rtl, fontSize: 12, fontWeight: '600', color: C.dim, marginBottom: 6 },
  input: {
    ...rtl,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: C.text,
  },
  h1: { ...rtl, fontSize: 22, fontWeight: '800', color: C.ink },
  h2: { ...rtl, fontSize: 15, fontWeight: '700', color: C.ink },
  body: { ...rtl, fontSize: 14, color: C.text },
  dim: { ...rtl, fontSize: 12, color: C.dim },
});
