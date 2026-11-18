/* The pieces of an expense form on the phone, shared by the scan review and
   the expense edit screen: a field that can be marked for checking, a dated
   text field's conversions, an item card, the supplier picker. */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import { listSuppliers, money, type ScanLine, type Supplier } from '@garage/shared';
import { C, s } from '../../lib/theme';
import { Sheet, TrashIcon } from '../ui';

/** YYYY-MM-DD → D/M/YYYY, the way a date is written here. */
export const showDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : '';
};
/** What was typed → YYYY-MM-DD, or '' while it is not yet a date. */
export const parseDate = (typed: string) => {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(typed.trim());
  if (!m) return '';
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mo = Number(m[2]);
  const d = Number(m[1]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

export const warnStyle = { borderColor: C.warn, borderWidth: 2, backgroundColor: C.warnBg };

export function Input({ warn, style, ...rest }: TextInputProps & { warn?: boolean }) {
  return (
    <TextInput
      placeholderTextColor={C.dim}
      {...rest}
      style={[s.input, warn ? warnStyle : null, style]}
    />
  );
}

export function Banner({ tone, title, body, children }: {
  tone: 'info' | 'warn' | 'danger';
  title?: string;
  body?: string;
  children?: React.ReactNode;
}) {
  const bg = tone === 'danger' ? C.dangerBg : tone === 'warn' ? C.warnBg : C.tint;
  const fg = tone === 'danger' ? C.danger : tone === 'warn' ? C.warnText : C.slate;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 12, padding: 12, gap: 4 }}>
      {!!title && <Text style={[s.body, { fontWeight: '700', color: fg }]}>{title}</Text>}
      {!!body && <Text style={[s.body, { fontSize: 13, color: fg }]}>{body}</Text>}
      {children}
    </View>
  );
}

export function Row({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <View style={s.rowBetween}>
      <Text style={[s.body, { fontSize: 13, color: color ?? C.dim, fontWeight: bold ? '700' : '400' }]}>{label}</Text>
      <Text style={[s.body, { fontSize: 14, color: color ?? C.ink, fontWeight: bold ? '800' : '600' }]}>{value}</Text>
    </View>
  );
}

export function LineCard({ line, onChange, onRemove }: {
  line: ScanLine;
  onChange: (field: 'desc' | 'qty' | 'unitPrice', v: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const qty = Number(line.qty) || 0;
  const unit = Number(line.unitPrice) || 0;
  const flagged = line.flags.length > 0;
  return (
    <View style={[s.card, { gap: 8, padding: 12 }]}>
      <View style={[s.row, { gap: 8 }]}>
        <Input
          style={{ flex: 1 }}
          value={line.desc}
          placeholder={t('scan.review.desc')}
          warn={line.flags.includes('desc')}
          onChangeText={(v) => onChange('desc', v)}
          accessibilityLabel={t('scan.review.desc')}
        />
        <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('scan.review.removeLine')} style={{ padding: 4 }}>
          <TrashIcon size={18} />
        </Pressable>
      </View>
      <View style={[s.row, { gap: 6 }]}>
        <Input
          style={{ width: 64, textAlign: 'center' }}
          value={line.qty}
          keyboardType="decimal-pad"
          placeholder={t('scan.review.qty')}
          warn={line.flags.includes('qty')}
          onChangeText={(v) => onChange('qty', v)}
          accessibilityLabel={t('scan.review.qty')}
        />
        <Text style={s.dim}>×</Text>
        <Input
          style={{ width: 100, textAlign: 'center' }}
          value={line.unitPrice}
          keyboardType="decimal-pad"
          placeholder={t('scan.review.unitPrice')}
          warn={line.flags.includes('unitPrice')}
          onChangeText={(v) => onChange('unitPrice', v)}
          accessibilityLabel={t('scan.review.unitPrice')}
        />
        <Text style={s.dim}>=</Text>
        <Text style={[s.body, { flex: 1, textAlign: 'left', fontWeight: '700' }]}>{money(Math.round(qty * unit * 100) / 100)}</Text>
      </View>
      {flagged && <Text style={[s.dim, { color: C.warnText }]}>{t('scan.review.checkLine')}</Text>}
    </View>
  );
}

export function SupplierPicker({ visible, onClose, onPick }: {
  visible: boolean;
  onClose: () => void;
  onPick: (s: Supplier) => void;
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState<Supplier[]>([]);
  const [q, setQ] = useState('');
  // Fetched each time it opens: a supplier added on the web a minute ago is in it.
  useEffect(() => {
    if (!visible) return;
    let live = true;
    listSuppliers().then((rows) => { if (live) setAll(rows); }).catch(() => {});
    return () => { live = false; };
  }, [visible]);
  const needle = q.trim().toLowerCase();
  const shown = all.filter((sp) => !needle
    || sp.name.toLowerCase().includes(needle) || (sp.taxId ?? '').includes(needle));
  return (
    <Sheet visible={visible} onClose={onClose} title={t('scan.review.pickTitle')}>
      <View style={{ padding: 12 }}>
        <Input value={q} onChangeText={setQ} placeholder={t('scan.review.search')} autoCorrect={false} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled">
        {shown.map((sp) => (
          <Pressable
            key={sp.id}
            onPress={() => onPick(sp)}
            style={({ pressed }) => ({ paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: pressed ? C.tint : C.card })}
            accessibilityRole="button"
          >
            <Text style={[s.body, { fontWeight: '600' }]}>{sp.name}</Text>
            {!!sp.taxId && <Text style={s.dim}>{sp.taxId}</Text>}
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}
