import { useAppSelector } from '../../store';
import Toast from './Toast';
import styles from './Toast.module.css';

/** Mounted once, at the root. Anything anywhere can `dispatch(showSuccess(...))`
 *  without a toast prop being threaded to it. */
export default function ToastHost() {
  const items = useAppSelector((s) => s.toast.items);

  if (items.length === 0) return null;

  return (
    <div className={styles.stack}>
      {items.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
