import styles from './TimerRing.module.css';

interface TimerRingProps {
  /** Доля прошедшего времени, 0 → 1. */
  progress: number;
  secondsLeft: number;
  size?: number;
}

const URGENT_SECONDS = 5;

/** Кольцевой таймер раунда. Данные приходят из useRoundTimer (серверные часы). */
export function TimerRing({ progress, secondsLeft, size = 64 }: TimerRingProps) {
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const urgent = secondsLeft <= URGENT_SECONDS && secondsLeft > 0;

  return (
    <div
      className={`${styles.ring} ${urgent ? styles.urgent : ''}`}
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`Осталось ${secondsLeft} секунд`}
    >
      <svg className={styles.svg} width={size} height={size}>
        <circle
          className={styles.track}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className={styles.progress}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * Math.min(1, Math.max(0, progress))}
        />
      </svg>
      <span className={styles.value}>{secondsLeft}</span>
    </div>
  );
}
