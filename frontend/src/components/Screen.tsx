import type { ReactNode } from 'react';
import { useBackButton } from '../hooks/useBackButton';
import styles from './Screen.module.css';

interface ScreenProps {
  title?: string;
  /** Если задан, включается системный BackButton Telegram и экранная стрелка. */
  onBack?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

/** Каркас экрана: safe-area, заголовок и кнопка «назад». */
export function Screen({ title, onBack, actions, children }: ScreenProps) {
  useBackButton(onBack ?? null);

  return (
    <div className={styles.screen}>
      {(title || onBack || actions) && (
        <header className={styles.header}>
          {onBack && (
            <button
              type="button"
              className={styles.back}
              onClick={onBack}
              aria-label="Назад"
            >
              ←
            </button>
          )}
          {title && <h1 className={styles.title}>{title}</h1>}
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={styles.body}>{children}</div>
    </div>
  );
}
