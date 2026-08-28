import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { useAuthStore } from '../store/authStore';
import styles from './SplashScreen.module.css';

/**
 * Стартовый экран: авторизация по initData и внятная заглушка, когда
 * приложение открыли вне Telegram.
 */
export function SplashScreen() {
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const authorize = useAuthStore((state) => state.authorize);

  return (
    <div className={styles.splash}>
      <div className={styles.logo}>GuessAI</div>

      {(status === 'idle' || status === 'loading') && (
        <Spinner label="Входим через Telegram…" />
      )}

      {status === 'no-init-data' && (
        <>
          <p className={styles.tagline}>Откройте приложение через Telegram</p>
          <p className={styles.message}>
            Данные запуска приходят от Telegram и подделать их нельзя. Для
            отладки в браузере положите реальную <span className={styles.code}>initData</span>{' '}
            в <span className={styles.code}>VITE_DEV_INIT_DATA</span> файла{' '}
            <span className={styles.code}>.env.local</span> — как это снять,
            описано в README.
          </p>
        </>
      )}

      {status === 'error' && (
        <>
          <p className={styles.error}>Не удалось войти</p>
          <p className={styles.message}>{error}</p>
          <Button onClick={() => void authorize()}>Повторить</Button>
        </>
      )}
    </div>
  );
}
