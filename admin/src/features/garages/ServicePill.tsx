import { useTranslation } from 'react-i18next';
import { Pill } from '../../components';
import type { ServiceStatus } from './serviceStatus';

export function ServicePill({ status }: { status: ServiceStatus }) {
  const { t } = useTranslation();
  return (
    <Pill tone={status.tone} title={status.title ? t(status.title, status.titleValues) : undefined}>
      {t(status.label, status.values)}
    </Pill>
  );
}
