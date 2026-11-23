import { useTranslation } from 'react-i18next';
import type { Letterhead } from '../../../api/types';
import { CheckboxField, Section, TextField } from '../../../components';
import type { OnboardingApi } from '../useOnboarding';
import styles from '../OnboardingPage.module.css';

const LETTERHEAD: { key: keyof Letterhead; label: string; ltr?: boolean; wide?: boolean }[] = [
  { key: 'printName', label: 'console.letterhead.printName' },
  { key: 'motto', label: 'console.letterhead.motto' },
  { key: 'services', label: 'console.letterhead.services', wide: true },
  { key: 'address', label: 'console.letterhead.address', wide: true },
  { key: 'phone', label: 'console.letterhead.phone', ltr: true },
  { key: 'fax', label: 'console.letterhead.fax', ltr: true },
  { key: 'licenseNo', label: 'console.letterhead.licenseNo', ltr: true },
  { key: 'taxId', label: 'console.letterhead.taxId', ltr: true },
];

export function GarageSection({ api }: { api: OnboardingApi }) {
  const { t } = useTranslation();
  const { form, update, updateLetterhead, errorFor } = api;
  return (
    <Section title="console.onboard.garage.title">
      <div className={styles.grid}>
        <TextField
          label="console.onboard.garage.name"
          required
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          error={errorFor('garage.name')}
          hint="console.onboard.garage.nameHint"
          className={styles.wide}
        />
      </div>

      <h4 className={styles.subhead}>{t('console.onboard.garage.letterhead')}</h4>
      <p className={styles.subnote}>{t('console.onboard.garage.letterheadHint')}</p>
      <div className={styles.grid}>
        {LETTERHEAD.map((f) => (
          <TextField
            key={f.key}
            label={f.label}
            value={form.letterhead[f.key]}
            onChange={(e) => updateLetterhead(f.key, e.target.value)}
            dir={f.ltr ? 'ltr' : undefined}
            className={f.wide ? styles.wide : undefined}
          />
        ))}
      </div>

      <CheckboxField
        label="console.onboard.garage.seedCatalog"
        hint="console.onboard.garage.seedCatalogHint"
        checked={form.seedCatalog}
        onChange={(e) => update('seedCatalog', e.target.checked)}
      />
    </Section>
  );
}
