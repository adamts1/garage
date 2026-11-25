import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Load } from '../hooks/useLoad';
import { Note } from './Section/Section';

/** The error of a load, if any, above whatever has loaded. Data from before a
 *  failed refresh stays on screen: a refresh that fails should not blank a page
 *  you were reading. */
export function LoadState<T>({ load, children }: { load: Load<T>; children: (data: T) => ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      {load.error && <Note tone="danger">{t('console.common.error', { message: load.error })}</Note>}
      {!load.data && load.loading && <Note>{t('console.common.loading')}</Note>}
      {load.data && children(load.data)}
    </>
  );
}
