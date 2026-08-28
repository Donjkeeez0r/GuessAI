/**
 * Остаток раунда по серверным часам.
 *
 * `endsAt` — метка времени сервера, часы клиента могут расходиться, поэтому
 * остаток считается как `endsAt - (Date.now() + clockOffset)`. Локального
 * отсчёта «от нуля» здесь нет намеренно: он разъезжается с сервером.
 */
import { useEffect, useState } from 'react';

export interface RoundTimer {
  remainingMs: number;
  /** Доля прошедшего времени, 0 → 1. */
  progress: number;
  secondsLeft: number;
}

export function useRoundTimer(
  endsAt: number | null,
  durationMs: number,
  clockOffset: number,
): RoundTimer {
  // В состоянии живёт только «сейчас»; остаток выводится из него и из endsAt,
  // поэтому смена раунда сразу даёт правильное значение, без кадра со старым.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null) return;

    let frame = 0;
    let stopped = false;

    /** Обновляет «сейчас». Возвращает false, когда раунд уже истёк. */
    const tick = (): boolean => {
      const current = Date.now();

      setNow(current);

      // На нуле останавливаемся: конец раунда объявит сервер событием ROUND_END.
      return endsAt - (current + clockOffset) > 0;
    };

    const loop = (): void => {
      if (stopped || !tick()) return;

      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);

    // В скрытой вкладке requestAnimationFrame не вызывается вовсе, поэтому
    // рядом идёт интервал: он тоже тормозится, но время не застывает совсем.
    const interval = window.setInterval(() => {
      if (!tick()) window.clearInterval(interval);
    }, 250);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, [endsAt, clockOffset]);

  const safeDuration = durationMs > 0 ? durationMs : 1;
  // Ограничение сверху длительностью раунда: между раундами `now` успевает
  // устареть, и без него первый кадр нового вопроса показал бы время больше,
  // чем длится раунд.
  const remainingMs =
    endsAt === null
      ? 0
      : Math.min(safeDuration, Math.max(0, endsAt - (now + clockOffset)));

  return {
    remainingMs,
    progress: Math.min(1, Math.max(0, 1 - remainingMs / safeDuration)),
    secondsLeft: Math.ceil(remainingMs / 1000),
  };
}
