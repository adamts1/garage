import { type Ticket } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { TabPanel, Tabs, type TabDef } from '../../components/Tabs';
import { IconPrint } from '../../icons';
import AgingReport from './AgingReport';
import CustomerReport from './CustomerReport';
import IncomeReport from './IncomeReport';
import ObligoReport from './ObligoReport';

/* Four reports, one page.
 *
 * Tabs rather than four routes, because a garage comparing what it is owed
 * against what it owes switches between them in the same breath, and a page
 * load between the two questions is a page load in the middle of a thought.
 *
 * Only the selected panel is mounted. Each report loads its own data — invoices
 * for income, expenses for obligo and aging — and mounting all four would have
 * the page fetch three tables nobody is looking at, then keep them live over a
 * realtime subscription for the rest of the session.
 */
type ReportId = 'income' | 'obligo' | 'aging' | 'customers';

const TABS: readonly TabDef<ReportId>[] = [
  { id: 'income', label: 'reports.tabs.income' },
  { id: 'obligo', label: 'reports.tabs.obligo' },
  { id: 'aging', label: 'reports.tabs.aging' },
  { id: 'customers', label: 'reports.tabs.customers' },
];

export default function ReportsPage({ tickets }: { tickets: Ticket[] }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ReportId>('income');

  return (
    <>
      <PageHeader
        title="reports.title"
        subtitle={`reports.subtitles.${tab}`}
        actions={
          /* Print stays on the shell: it prints what is on screen, and what is
             on screen is whichever report is open. Export does not — each report
             exports its own columns, so its button lives with its table. */
          <Button onClick={() => window.print()}>
            <IconPrint /> {t('reports.print')}
          </Button>
        }
      />

      <Tabs tabs={TABS} selected={tab} onSelect={setTab} label="reports.title" />

      <TabPanel id={tab}>
        {tab === 'income' && <IncomeReport />}
        {tab === 'obligo' && <ObligoReport />}
        {tab === 'aging' && <AgingReport tickets={tickets} />}
        {tab === 'customers' && <CustomerReport tickets={tickets} />}
      </TabPanel>
    </>
  );
}
