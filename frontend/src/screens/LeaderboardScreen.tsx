import { useCallback, useEffect } from 'react';
import { Screen } from '../components/Screen';
import { Avatar } from '../components/Avatar';
import { Spinner } from '../components/Spinner';
import { fetchLeaderboard } from '../api/endpoints';
import { useAsyncData } from '../hooks/useAsyncData';
import { useGoTo } from '../hooks/useGoTo';
import { useUiStore } from '../store/uiStore';
import type { Leaderboard, LeaderboardEntry } from '../types/api';
import styles from './LeaderboardScreen.module.css';

const MEDALS = ['🥇', '🥈', '🥉'];

export function LeaderboardScreen() {
  const goTo = useGoTo();
  const showToast = useUiStore((state) => state.showToast);

  const loadLeaderboard = useCallback(() => fetchLeaderboard(), []);
  const { data, loading, error } = useAsyncData<Leaderboard>(
    'leaderboard',
    loadLeaderboard,
  );

  useEffect(() => {
    if (error) showToast(error);
  }, [error, showToast]);

  const entries = data?.entries ?? [];
  const me = data?.me ?? null;
  // Своя строка приходит всегда, даже когда игрок уже в топе. Закрепляем её
  // внизу только если в списке её нет — иначе она задвоилась бы.
  const meOutsideTop =
    me !== null && !entries.some((entry) => entry.userId === me.userId);

  return (
    <Screen title="Лидерборд" onBack={() => goTo('/')}>
      {loading ? (
        <Spinner label="Загружаем таблицу…" />
      ) : entries.length === 0 ? (
        <p className={styles.empty}>
          Пока никто не сыграл ни одной партии с соперником
        </p>
      ) : (
        <>
          <div className={styles.list}>
            {entries.map((entry) => (
              <Row
                key={entry.userId}
                entry={entry}
                isMe={entry.userId === me?.userId}
              />
            ))}
          </div>

          {meOutsideTop && (
            <>
              <div className={styles.divider}>твоё место</div>
              <Row entry={me} isMe />
            </>
          )}

          {me === null && (
            <p className={styles.hint}>
              Сыграй партию с соперником, чтобы попасть в таблицу — тренировки
              не считаются
            </p>
          )}
        </>
      )}
    </Screen>
  );
}

function Row({ entry, isMe }: { entry: LeaderboardEntry; isMe: boolean }) {
  const name = entry.username ?? entry.firstName;
  const medal = MEDALS[entry.rank - 1];

  return (
    <div className={`${styles.item} ${isMe ? styles.me : ''}`}>
      <span className={`${styles.rank} ${medal ? styles.medal : ''}`}>
        {medal ?? entry.rank}
      </span>
      <Avatar name={name} photoUrl={entry.photoUrl} />
      <div className={styles.info}>
        <div className={styles.name}>{name}</div>
        <div className={styles.meta}>
          {entry.wins} {pluralWins(entry.wins)} из {entry.totalGames}
        </div>
      </div>
      <span className={styles.rating}>{entry.rating}</span>
    </div>
  );
}

function pluralWins(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return 'победа';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'победы';

  return 'побед';
}
