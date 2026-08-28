import { useEffect, useRef } from 'react';
import { Spinner } from '../components/Spinner';
import { TimerRing } from '../components/TimerRing';
import { Leaderboard } from '../components/Leaderboard';
import { SoundToggle } from '../components/SoundToggle';
import { useRoundTimer } from '../hooks/useRoundTimer';
import { useBackButton } from '../hooks/useBackButton';
import { useGoTo } from '../hooks/useGoTo';
import { useQuestionAudio } from '../hooks/useQuestionAudio';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';
import { confirmAction, hapticImpact } from '../lib/telegram';
import { playTick, unlockAudio } from '../lib/sound';
import styles from './GameScreen.module.css';

const TICK_FROM_SECOND = 5;

/** Тот же список, что на сервере: множитель по серии до текущего ответа. */
const STREAK_MULTIPLIERS = [1, 1.25, 1.5, 2];

function streakMultiplier(streak: number): number {
  return STREAK_MULTIPLIERS[Math.min(streak, STREAK_MULTIPLIERS.length - 1)];
}

/**
 * Игровой экран. Раундами управляет сервер: здесь нет ни одного эмита
 * «дальше» — экран только отражает состояние стора.
 */
export function GameScreen() {
  const goTo = useGoTo();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const phase = useGameStore((state) => state.phase);
  const room = useGameStore((state) => state.room);
  const round = useGameStore((state) => state.round);
  const roundEnd = useGameStore((state) => state.roundEnd);
  const clockOffset = useGameStore((state) => state.clockOffset);
  const myAnswer = useGameStore((state) => state.myAnswer);
  const myStreak = useGameStore((state) => state.myStreak);
  const pendingAnswer = useGameStore((state) => state.pendingAnswer);
  const answeredCount = useGameStore((state) => state.answeredCount);
  const totalPlayers = useGameStore((state) => state.totalPlayers);
  const submitAnswer = useGameStore((state) => state.submitAnswer);
  const leaveRoom = useGameStore((state) => state.leaveRoom);

  // Партия остаётся без вышедшего: очки замирают, место и рейтинг считаются
  // как при закрытом приложении. В тренировке терять нечего — комната просто
  // закрывается, поэтому и предупреждение другое.
  const isSolo = (room?.players.length ?? 1) <= 1;

  const exit = async (): Promise<void> => {
    const confirmed = await confirmAction(
      isSolo
        ? 'Выйти в меню? Тренировка прервётся.'
        : 'Выйти в меню? Партия продолжится без тебя, а набранные очки останутся в итогах.',
    );

    if (!confirmed) return;

    leaveRoom();
    goTo('/', { replace: true });
  };

  // Системная стрелка Telegram делает то же самое: на этом экране ей больше
  // некуда вести.
  useBackButton(exit);

  const exitButton = (
    <button
      type="button"
      className={styles.exit}
      onClick={exit}
      aria-label="Выйти в меню"
    >
      ✕
    </button>
  );

  const revealing = phase === 'reveal' && roundEnd !== null;

  const timer = useRoundTimer(
    revealing || !round ? null : round.endsAt,
    round?.durationMs ?? 1,
    clockOffset,
  );

  const audio = useQuestionAudio(round?.question.audioUrl ?? null);

  // Тик на последних секундах: по одному разу на каждую целую секунду.
  const lastTickRef = useRef<number | null>(null);
  const { secondsLeft } = timer;

  useEffect(() => {
    if (revealing || myAnswer !== null) return;
    if (secondsLeft > TICK_FROM_SECOND || secondsLeft <= 0) return;
    if (lastTickRef.current === secondsLeft) return;

    lastTickRef.current = secondsLeft;
    playTick();
  }, [secondsLeft, revealing, myAnswer]);

  useEffect(() => {
    lastTickRef.current = null;
  }, [round?.index]);

  if (phase === 'reconnecting' || !round) {
    return (
      <div className={styles.screen}>
        <div className={styles.top}>{exitButton}</div>
        <div className={styles.center}>
          <Spinner label="Переподключаемся к игре…" />
          <p>Раунд подхватится автоматически, как только придёт от сервера.</p>
        </div>
      </div>
    );
  }

  const chosen = myAnswer ?? pendingAnswer;
  const locked = chosen !== null || revealing;
  const myResult = roundEnd?.results.find((result) => result.userId === userId);
  // ROUND_END присылает лидерборд уже отсортированным; в середине раунда
  // берём игроков из ROOM_UPDATED и сортируем сами.
  const leaderboard =
    roundEnd?.leaderboard ??
    [...(room?.players ?? [])].sort((a, b) => b.score - a.score);

  const optionClass = (index: number): string => {
    if (revealing && roundEnd) {
      if (index === roundEnd.correctOption) return styles.correct;
      if (index === myResult?.optionIndex) return styles.wrong;
      return styles.muted;
    }

    if (chosen === null) return '';

    return index === chosen ? styles.picked : styles.muted;
  };

  const pick = (index: number): void => {
    if (locked) return;

    unlockAudio();
    hapticImpact('medium');
    submitAnswer(index);
  };

  return (
    <div className={styles.screen}>
      <div className={styles.top}>
        {exitButton}
        <div className={styles.progress}>
          <div className={styles.progressLabel}>
            Вопрос {round.index + 1} из {round.total}
          </div>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${((round.index + 1) / round.total) * 100}%` }}
            />
          </div>
        </div>
        {myStreak > 0 && (
          <span
            className={styles.streak}
            aria-label={`Серия ${myStreak}, множитель ${streakMultiplier(myStreak)}`}
          >
            🔥{myStreak}
            <span className={styles.streakMult}>
              ×{streakMultiplier(myStreak)}
            </span>
          </span>
        )}
        <SoundToggle />
        <TimerRing
          progress={revealing ? 1 : timer.progress}
          secondsLeft={revealing ? 0 : timer.secondsLeft}
        />
      </div>

      <div className={styles.question}>
        <p className={styles.questionText}>{round.question.text}</p>
        <button
          type="button"
          className={`${styles.speak} ${audio.playing ? styles.speaking : ''}`}
          disabled={!audio.available}
          aria-label="Озвучить вопрос"
          onClick={audio.play}
        >
          🔈
        </button>
      </div>

      <div className={styles.options}>
        {round.question.options.map((option, index) => (
          <button
            key={index}
            type="button"
            className={`${styles.option} ${optionClass(index)}`}
            style={{ animationDelay: `${index * 50}ms` }}
            disabled={locked}
            onClick={() => pick(index)}
          >
            <span className={styles.optionIndex}>{index + 1}</span>
            {option}
          </button>
        ))}
      </div>

      {revealing && myResult && myResult.gained > 0 && (
        <div className={styles.floatScore} aria-hidden="true">
          +{myResult.gained}
          {myResult.multiplier > 1 && (
            <span className={styles.floatMult}>×{myResult.multiplier}</span>
          )}
        </div>
      )}

      {revealing && roundEnd && (
        <div className={styles.reveal}>
          <span
            className={`${styles.revealTitle} ${
              myResult?.isCorrect ? styles.revealCorrect : styles.revealWrong
            }`}
          >
            {myResult?.isCorrect
              ? 'Верно!'
              : myResult?.optionIndex === null || myResult === undefined
                ? 'Ты не успел ответить'
                : 'Мимо'}
          </span>
          {roundEnd.explanation && (
            <span className={styles.explanation}>{roundEnd.explanation}</span>
          )}
        </div>
      )}

      <div className={styles.bottom}>
        <div className={styles.answered}>
          {revealing ? (
            <span>Следующий вопрос вот-вот начнётся</span>
          ) : (
            <span>
              Ответили: {answeredCount}
              {totalPlayers > 0 ? ` из ${totalPlayers}` : ''}
            </span>
          )}
          {myAnswer !== null && !revealing && (
            <span className={styles.accepted}>Ответ принят</span>
          )}
          {pendingAnswer !== null && myAnswer === null && !revealing && (
            <span>Отправляем…</span>
          )}
        </div>

        <Leaderboard
          players={leaderboard}
          currentUserId={userId}
          results={revealing ? roundEnd?.results : undefined}
          compact
          showAvatars={false}
        />
      </div>
    </div>
  );
}
