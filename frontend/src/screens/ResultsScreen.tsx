import { useGoTo } from '../hooks/useGoTo';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { Leaderboard } from '../components/Leaderboard';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { shareLink, shareToStory } from '../lib/telegram';
import type { Player } from '../types/api';
import styles from './ResultsScreen.module.css';

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME ?? '';
const MEDALS = ['🥇', '🥈', '🥉'];

export function ResultsScreen() {
  const goTo = useGoTo();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const gameOver = useGameStore((state) => state.gameOver);
  const leaveRoom = useGameStore((state) => state.leaveRoom);
  const rematch = useGameStore((state) => state.rematch);
  const soloGame = useGameStore((state) => state.soloGame);
  const packId = useGameStore((state) => state.room?.packId ?? null);
  const showToast = useUiStore((state) => state.showToast);

  const goHome = (): void => {
    leaveRoom();
    goTo('/', { replace: true });
  };

  if (!gameOver) {
    return (
      <Screen title="Итоги" onBack={goHome}>
        <p>Результаты этой игры уже недоступны.</p>
        <Button block onClick={goHome}>
          В меню
        </Button>
      </Screen>
    );
  }

  const { leaderboard, winner, ratingChanges } = gameOver;
  const myPlace = leaderboard.findIndex((player) => player.userId === userId) + 1;
  const myChange = ratingChanges.find((change) => change.userId === userId);
  const me = leaderboard.find((player) => player.userId === userId);

  // Тренировка: соревноваться не с кем, поэтому ни подиума, ни победителя,
  // ни строки рейтинга — он в одиночной игре и не меняется.
  const isSolo = leaderboard.length === 1;

  const appUrl = BOT_USERNAME
    ? `https://t.me/${BOT_USERNAME}`
    : window.location.origin;
  const resultText = isSolo
    ? `Набрал ${me?.score ?? 0} очков на тренировке в GuessAI!`
    : myPlace > 0
      ? `Я занял ${myPlace}-е место в GuessAI с ${me?.score ?? 0} очками!`
      : `Победил ${winner.username} с ${winner.score} очками в GuessAI!`;

  const share = (): void => {
    if (shareToStory(resultText, appUrl)) return;

    // Сторис доступны не во всех клиентах — падаем в обычный шэринг ссылки.
    if (!shareLink(appUrl, resultText)) {
      showToast('Поделиться не получилось');
    }
  };

  // Подиум: 2-е место слева, 1-е в центре, 3-е справа.
  const podium: Array<{ player: Player; place: number }> = [
    leaderboard[1] ? { player: leaderboard[1], place: 2 } : null,
    leaderboard[0] ? { player: leaderboard[0], place: 1 } : null,
    leaderboard[2] ? { player: leaderboard[2], place: 3 } : null,
  ].filter((item): item is { player: Player; place: number } => item !== null);

  const pillarClass = (place: number): string =>
    place === 1 ? styles.first : place === 2 ? styles.second : styles.third;

  return (
    <Screen title={isSolo ? 'Тренировка' : 'Итоги'} onBack={goHome}>
      {isSolo ? (
        <div className={styles.soloResult}>
          <span className={styles.soloScore}>{me?.score ?? 0}</span>
          <span className={styles.soloLabel}>очков за тренировку</span>
        </div>
      ) : (
        <>
          <div className={styles.podium}>
            {podium.map(({ player, place }) => (
              <div className={styles.place} key={player.userId}>
                <span className={styles.medal}>{MEDALS[place - 1]}</span>
                <Avatar
                  name={player.username}
                  photoUrl={player.photoUrl}
                  size={place === 1 ? 56 : 44}
                />
                <span className={styles.placeName}>{player.username}</span>
                <div className={`${styles.pillar} ${pillarClass(place)}`}>
                  {player.score}
                </div>
              </div>
            ))}
          </div>

          <p className={styles.winner}>Победил {winner.username}</p>
        </>
      )}

      {!isSolo && myChange && (
        <div className={styles.myRating}>
          <span>Рейтинг: {myChange.before}</span>
          <span
            className={
              myChange.delta > 0
                ? styles.up
                : myChange.delta < 0
                  ? styles.down
                  : styles.flat
            }
          >
            {myChange.delta > 0
              ? `+${myChange.delta}`
              : myChange.delta === 0
                ? '±0'
                : String(myChange.delta)}
          </span>
          <span>→ {myChange.after}</span>
        </div>
      )}

      {!isSolo && (
        <>
          <div className={styles.sectionTitle}>Все игроки</div>
          <Leaderboard
            players={leaderboard}
            currentUserId={userId}
            ratingChanges={ratingChanges}
          />
        </>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" block onClick={share}>
          Поделиться результатом
        </Button>
        {isSolo ? (
          <Button
            size="lg"
            block
            disabled={!packId}
            onClick={() => packId && soloGame(packId)}
          >
            Ещё раз
          </Button>
        ) : (
          <Button size="lg" block onClick={rematch}>
            Реванш
          </Button>
        )}
        <Button variant="ghost" block onClick={goHome}>
          В меню
        </Button>
      </div>
    </Screen>
  );
}
