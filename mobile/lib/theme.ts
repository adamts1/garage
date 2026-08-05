import { StyleSheet, TextStyle } from 'react-native';

/** The web app's palette, so the two products look like one system.

    Everything below the first block was a hex literal written inline in a
    component. They are here because the same colour appearing as '#eef2f7' in
    four files, '#fdeceb' in one and '#fdecec' in another is not a palette, it
    is a coincidence — and it is how a redesign misses a screen. */
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

  /** Text and icons drawn on top of `ink`. */
  onInk: '#ffffff',
  /** Soft navy wash — selected rows, secondary buttons, informational strips. */
  tint: '#eef2f7',
  /** Background behind an error message. */
  dangerBg: '#fdecec',
  /** Pressed state on a destructive row — dangerBg is too loud for a flash. */
  dangerPress: '#faf0ef',
  /** "Nobody is assigned" — a real state, so it gets a colour rather than none. */
  unassigned: '#8d99ae',
  /** WhatsApp brand green, on the button that opens WhatsApp. */
  whatsapp: '#25d366',
  /** The staging strip. Amber rather than red: informational, not a fault. */
  staging: '#8a6d1f',
  /** Muted caption on the black photo viewer. */
  onOverlay: '#8b93a1',
  /** Login sub-heading, on the navy header. */
  onInkDim: '#b8c4d6',
};

/* Hebrew UI. We don't call I18nManager.forceRTL — on native it needs a full app
   restart to take effect and behaves inconsistently in Expo Go. Aligning text
   explicitly gets the same result, predictably. */
export const rtl: TextStyle = { textAlign: 'right', writingDirection: 'rtl' };

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  /** A whole screen given over to one centred thing — a spinner, a message. */
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.line,
  },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  /** `row` with its children pushed to opposite ends — the commonest pairing. */
  rowBetween: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'space-between',
  },
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
