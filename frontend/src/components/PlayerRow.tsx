import { Avatar } from './Avatar';
import type { Player } from '../types/api';
import styles from './PlayerRow.module.css';

interface PlayerRowProps {
  player: Player;
  isMe: boolean;
}

/** Строка игрока в лобби: корона у хоста, «готов», приглушение при обрыве. */
export function PlayerRow({ player, isMe }: PlayerRowProps) {
  return (
    <li className={`${styles.row} ${player.connected ? '' : styles.offline}`}>
      <Avatar
        name={player.username}
        photoUrl={player.photoUrl}
        dimmed={!player.connected}
      />
      <span className={`${styles.name} ${isMe ? styles.me : ''}`}>
        {player.isHost && (
          <span className={styles.crown} aria-label="Хост">
            👑{' '}
          </span>
        )}
        {player.username}
        {isMe && ' (ты)'}
      </span>
      {!player.connected ? (
        <span className={styles.badge}>не в сети</span>
      ) : player.isReady ? (
        <span className={`${styles.badge} ${styles.ready}`}>готов</span>
      ) : (
        <span className={styles.badge}>ждёт</span>
      )}
    </li>
  );
}
