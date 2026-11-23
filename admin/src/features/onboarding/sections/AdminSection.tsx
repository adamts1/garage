import { Section, TextField } from '../../../components';
import styles from '../OnboardingPage.module.css';
import type { OnboardingApi } from '../useOnboarding';

/** The garage's first user, always an admin. More users are added from the app
 *  (the staff screen) or with the onboard script. */
export function AdminSection({ api }: { api: OnboardingApi }) {
  const { form, update, errorFor } = api;
  return (
    <Section title="console.onboard.admin.title">
      <div className={styles.grid}>
        <TextField
          label="console.onboard.admin.email"
          required
          type="email"
          dir="ltr"
          autoComplete="off"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          error={errorFor('admin.email')}
        />
        <TextField
          label="console.onboard.admin.password"
          dir="ltr"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => update('password', e.target.value)}
          error={errorFor('admin.password')}
          hint="console.onboard.admin.passwordHint"
        />
      </div>
    </Section>
  );
}
