import { useLayoutEffect, useRef } from 'react';
import { Avatar } from './Avatar';
import type { Player, RatingChange, RoundResult } from '../types/api';
import styles from './Leaderboard.module.css';

interface LeaderboardProps {
  players: Player[];
  currentUserId: string | null;
  /** Очки за последний раунд из ROUND_END. */
  results?: RoundResult[];
  /** Изменения рейтинга из GAME_OVER. */
  ratingChanges?: RatingChange[];
  compact?: boolean;
  showAvatars?: boolean;
}

/**
 * Лидерборд. При смене мест строки не «перепрыгивают»: старая позиция каждой
 * строки запоминается и доигрывается анимацией сдвига (приём FLIP).
 */
export function Leaderboard({
  players,
  currentUserId,
  results,
  ratingChanges,
  compact = false,
  showAvatars = true,
}: LeaderboardProps) {
  const nodesRef = useRef(new Map<string, HTMLLIElement>());
  const offsetsRef = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const previous = offsetsRef.current;
    const next = new Map<string, number>();

    for (const [userId, node] of nodesRef.current) {
      const top = node.offsetTop;
      next.set(userId, top);

      const before = previous.get(userId);
      if (before === undefined || before === top) continue;

      node.style.setProperty('--shift', `${before - top}px`);
      node.classList.remove(styles.moved);
      // Чтение layout заставляет браузер перезапустить анимацию.
      void node.offsetWidth;
      node.classList.add(styles.moved);
    }

    offsetsRef.current = next;
  }, [players]);

  return (
    <ul className={`${styles.list} ${compact ? styles.compact : ''}`}>
      {players.map((player, index) => {
        const isMe = player.userId === currentUserId;
        const gained = results?.find(
          (result) => result.userId === player.userId,
        )?.gained;
        const delta = ratingChanges?.find(
          (change) => change.userId === player.userId,
        )?.delta;

        return (
          <li
            key={player.userId}
            ref={(node) => {
              if (node) nodesRef.current.set(player.userId, node);
              else nodesRef.current.delete(player.userId);
            }}
            className={[
              styles.row,
              isMe ? styles.me : '',
              player.connected ? '' : styles.offline,
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className={styles.place}>{index + 1}</span>
            {showAvatars && (
              <Avatar
                name={player.username}
                photoUrl={player.photoUrl}
                size={compact ? 26 : 34}
                dimmed={!player.connected}
              />
            )}
            <span className={styles.name}>{player.username}</span>
            <span className={styles.score}>{player.score}</span>
            {gained !== undefined && (
              <span
                className={`${styles.gained} ${gained === 0 ? styles.zero : ''}`}
              >
                {gained > 0 ? `+${gained}` : '—'}
              </span>
            )}
            {delta !== undefined && (
              <span
                className={`${styles.delta} ${
                  delta > 0 ? styles.up : delta < 0 ? styles.down : styles.flat
                }`}
              >
                {delta > 0 ? `+${delta}` : delta === 0 ? '±0' : String(delta)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
