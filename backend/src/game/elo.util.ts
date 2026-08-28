export const ELO_K = 32;
export const ELO_MIN_RATING = 100;

export interface EloParticipant {
  userId: string;
  rating: number;
  /** Место в игре, 1 — первое. При равенстве очков места совпадают. */
  place: number;
}

/**
 * Многопользовательский ELO: каждый игрок сравнивается с каждым соперником,
 * итоговая дельта усредняется по числу соперников.
 * Игра с одним участником рейтинг не меняет.
 */
export function calculateEloDeltas(
  participants: EloParticipant[],
): Map<string, number> {
  const deltas = new Map<string, number>();
  const total = participants.length;

  if (total < 2) {
    for (const participant of participants) {
      deltas.set(participant.userId, 0);
    }
    return deltas;
  }

  for (const player of participants) {
    let sum = 0;

    for (const opponent of participants) {
      if (opponent.userId === player.userId) continue;

      const actual =
        player.place < opponent.place
          ? 1
          : player.place === opponent.place
            ? 0.5
            : 0;
      const expected =
        1 / (1 + Math.pow(10, (opponent.rating - player.rating) / 400));

      sum += actual - expected;
    }

    deltas.set(player.userId, Math.round((ELO_K / (total - 1)) * sum));
  }

  return deltas;
}

/** Места по убыванию очков: одинаковые очки — одинаковое место (1, 2, 2, 4). */
export function assignPlaces<T extends { score: number }>(
  players: T[],
): Array<T & { place: number }> {
  const sorted = [...players].sort((a, b) => b.score - a.score);

  return sorted.map((player, index) => {
    const firstWithSameScore = sorted.findIndex(
      (candidate) => candidate.score === player.score,
    );

    return {
      ...player,
      place: (firstWithSameScore === -1 ? index : firstWithSameScore) + 1,
    };
  });
}
