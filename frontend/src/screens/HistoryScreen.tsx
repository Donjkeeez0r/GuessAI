import { useCallback, useEffect } from 'react';
import { Screen } from '../components/Screen';
import { Spinner } from '../components/Spinner';
import { fetchHistory } from '../api/endpoints';
import { useAsyncData } from '../hooks/useAsyncData';
import { useGoTo } from '../hooks/useGoTo';
import { useUiStore } from '../store/uiStore';
import type { GameHistoryItem } from '../types/api';
import styles from './HistoryScreen.module.css';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function HistoryScreen() {
  const goTo = useGoTo();
  const showToast = useUiStore((state) => state.showToast);

  const loadHistory = useCallback(() => fetchHistory(), []);
  const { data, loading, error } = useAsyncData<GameHistoryItem[]>(
    'history',
    loadHistory,
  );
  const items = data ?? [];

  useEffect(() => {
    if (error) showToast(error);
  }, [error, showToast]);

  return (
    <Screen title="Мои игры" onBack={() => goTo('/')}>
      {loading ? (
        <Spinner label="Загружаем историю…" />
      ) : items.length === 0 ? (
        <p className={styles.empty}>Ты ещё не сыграл ни одной игры</p>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <div className={styles.item} key={item.gameSessionId}>
              <span
                className={`${styles.place} ${item.place === 1 ? styles.won : ''}`}
              >
                {item.place ?? '—'}
              </span>
              <div className={styles.info}>
                <div className={styles.pack}>{item.packTitle}</div>
                <div className={styles.meta}>
                  {item.playersCount}{' '}
                  {pluralPlayers(item.playersCount)} ·{' '}
                  {dateFormatter.format(new Date(item.playedAt))}
                </div>
              </div>
              <span className={styles.score}>{item.score}</span>
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}

function pluralPlayers(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return 'игрок';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'игрока';

  return 'игроков';
}
