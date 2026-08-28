import { useUiStore } from '../store/uiStore';
import styles from './ToastHost.module.css';

/** Все ошибки видны пользователю, а не только в консоли. */
export function ToastHost() {
  const toasts = useUiStore((state) => state.toasts);
  const dismissToast = useUiStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.host}>
      {toasts.map((item) => (
        <div
          key={item.id}
          className={`${styles.toast} ${styles[item.tone]}`}
          role="alert"
          onClick={() => dismissToast(item.id)}
        >
          {item.text}
        </div>
      ))}
    </div>
  );
}
