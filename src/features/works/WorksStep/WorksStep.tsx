import { workTotal, type PartRow, type TicketWork } from '@garage/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { CellInput, RowActions, Table, type Column } from '../../../components/Table';
import { IconBox, IconToolbox, IconWrench } from '../../../icons';
import styles from './WorksStep.module.css';
import { useWorksStep } from './useWorksStep';

/* Same format as the summary rail — a row reading ₪150 next to a total reading
   ₪150.00 looks like a bug. */
const shekel = (n: number) =>
  '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface WorksStepProps {
  works: TicketWork[];
  setWorks: (next: TicketWork[]) => void;
  /** One shared empty state instead of one per column. */
  combinedEmpty?: boolean;
}

export default function WorksStep({ works, setWorks, combinedEmpty }: WorksStepProps) {
  const { t } = useTranslation();
  const step = useWorksStep({ works, setWorks });
  const { current } = step;

  const workColumns: Column<TicketWork>[] = [
    {
      key: 'code',
      header: 'works.fields.code',
      width: 116,
      render: (w) => (
        <CellInput
          className={styles.code}
          value={w.code}
          aria-label={t('works.fields.code')}
          onChange={(e) => step.patchWork(w.uid, { code: e.target.value })}
        />
      ),
    },
    {
      key: 'name',
      header: 'works.fields.name',
      render: (w) => (
        <div className={styles.nameCell}>
          <CellInput
            value={w.name}
            aria-label={t('works.fields.name')}
            onChange={(e) => step.patchWork(w.uid, { name: e.target.value })}
          />
          {w.custom && <span className={styles.badge}>{t('picker.work.new')}</span>}
        </div>
      ),
    },
    {
      key: 'labor',
      header: 'works.fields.labor',
      width: 84,
      render: (w) => (
        <CellInput
          type="number"
          min={0}
          value={w.labor}
          aria-label={t('works.fields.labor')}
          onChange={(e) => step.patchWork(w.uid, { labor: Number(e.target.value) || 0 })}
        />
      ),
    },
    {
      key: 'parts',
      header: 'works.fields.parts',
      width: 54,
      cellClassName: styles.muted,
      render: (w) => w.items.length,
    },
    {
      key: 'total',
      header: 'works.fields.total',
      width: 96,
      render: (w) => <strong>{shekel(workTotal(w))}</strong>,
    },
    {
      key: 'actions',
      width: 44,
      render: (w) => (
        <RowActions>
          <Button
            variant="ghostDanger"
            size="sm"
            title={t('works.removeWork')}
            aria-label={t('works.removeWork')}
            /* The row selects the work; the button must not do both. */
            onClick={(e) => { e.stopPropagation(); step.removeWork(w.uid); }}
          >
            ✕
          </Button>
        </RowActions>
      ),
    },
  ];

  const partColumns: Column<PartRow>[] = [
    { key: 'sku', header: 'items.fields.sku', width: 84, cellClassName: styles.muted, render: (i) => i.sku },
    { key: 'name', header: 'works.fields.part', render: (i) => i.name },
    {
      key: 'qty',
      header: 'picker.work.qty',
      width: 64,
      render: (i) => (
        <CellInput
          type="number"
          min={0}
          value={i.qty}
          aria-label={t('picker.work.qty')}
          onChange={(e) => current && step.patchPart(current.uid, i.sku, { qty: Number(e.target.value) || 0 })}
        />
      ),
    },
    {
      key: 'price',
      header: 'works.fields.unitPrice',
      width: 84,
      render: (i) => (
        <CellInput
          type="number"
          min={0}
          value={i.price}
          aria-label={t('works.fields.unitPrice')}
          onChange={(e) => current && step.patchPart(current.uid, i.sku, { price: Number(e.target.value) || 0 })}
        />
      ),
    },
    {
      key: 'total',
      header: 'works.fields.total',
      width: 96,
      render: (i) => <strong>{shekel(i.qty * i.price)}</strong>,
    },
    {
      key: 'actions',
      width: 44,
      render: (i) => (
        <RowActions>
          <Button
            variant="ghostDanger"
            size="sm"
            title={t('works.removePart')}
            aria-label={t('works.removePart')}
            onClick={() => current && step.removePart(current.uid, i.sku)}
          >
            ✕
          </Button>
        </RowActions>
      ),
    },
  ];

  if (combinedEmpty && works.length === 0) {
    return (
      <div className={styles.step}>
        <EmptyState
          title="works.emptyTitle"
          body="works.emptyBody"
          icon={<IconToolbox />}
          large
          actions={
            <Button variant="primary" onClick={() => void step.addWork()}>
              {t('works.addWork')} ＋
            </Button>
          }
        />
      </div>
    );
  }

  const worksTotal = works.reduce((s, w) => s + workTotal(w), 0);
  const partsTotal = current ? current.items.reduce((s, i) => s + i.qty * i.price, 0) : 0;

  return (
    <div className={styles.step}>
      <div className={styles.grid}>
        <div className={styles.col}>
          <div className={styles.head}>
            <span className={styles.title}>
              <IconWrench /> {t('works.works', { count: works.length })}
            </span>
          </div>

          {works.length === 0 ? (
            <EmptyState
              title="works.noWorksTitle"
              body="works.noWorksBody"
              icon={<IconWrench />}
              actions={
                <Button onClick={() => void step.addWork()}>{t('works.addWork')} ＋</Button>
              }
            />
          ) : (
            <>
              <Table
                className={styles.quietCells}
                fixedLayout
                columns={workColumns}
                rows={works}
                rowKey={(w) => w.uid}
                onRowClick={(w) => step.setSelectedUid(w.uid)}
                isRowSelected={(w) => w.uid === step.selectedUid}
                /* Labour plus that work's parts, so this foots to the pre-VAT
                   subtotal — not to the summary's labour-only figure. */
                footer={
                  <span className={styles.foot}>
                    {t('works.worksAndParts')} <strong>{shekel(worksTotal)}</strong>
                  </span>
                }
              />
              <button type="button" className={styles.addRow} onClick={() => void step.addWork()}>
                ＋ {t('works.addWork')}
              </button>
            </>
          )}
        </div>

        <div className={styles.col}>
          <div className={styles.head}>
            <span className={styles.title}>
              <IconBox /> {t('works.parts', { count: current ? current.items.length : 0 })}
              {current && <span className={styles.ofWork}>{current.name}</span>}
            </span>
          </div>

          {!current || current.items.length === 0 ? (
            <EmptyState
              title="works.noPartsTitle"
              body="works.noPartsBody"
              icon={<IconBox />}
              actions={
                <Button onClick={() => void (current ? step.addPart() : step.addWork())}>
                  {t('works.addPart')} ＋
                </Button>
              }
            />
          ) : (
            <>
              <Table
                className={styles.quietCells}
                fixedLayout
                columns={partColumns}
                rows={current.items}
                rowKey={(i) => i.sku}
                /* Only the selected work's parts, so say so — the summary's
                   figure is every work's parts together. */
                footer={
                  <span className={styles.foot}>
                    {t('works.partsOfThisWork')} <strong>{shekel(partsTotal)}</strong>
                  </span>
                }
              />
              <button type="button" className={styles.addRow} onClick={() => void step.addPart()}>
                ＋ {t('works.addPart')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
