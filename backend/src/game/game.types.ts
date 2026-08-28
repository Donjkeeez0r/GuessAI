import type { DefaultEventsMap, Socket } from 'socket.io';
import type { PublicPlayer } from '../room/room.types';

/** Данные, которые сервер сам кладёт в сокет. Клиент на них не влияет. */
export interface GameSocketData {
  userId: string;
  roomId?: string;
}

export type GameSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  GameSocketData
>;

export type GameErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_IN_PROGRESS'
  | 'ROOM_NOT_FINISHED'
  | 'NOT_HOST'
  | 'NOT_READY'
  | 'PACK_EMPTY'
  | 'PACK_FORBIDDEN'
  | 'NO_PUBLIC_ROOMS'
  | 'INTERNAL';

/** Ошибка игрового цикла: гейтвей превращает её в событие `ERROR`. */
export class GameError extends Error {
  constructor(
    readonly code: GameErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export interface RoundStartPayload {
  index: number;
  total: number;
  question: {
    text: string;
    options: string[];
    audioUrl: string | null;
  };
  endsAt: number;
  durationMs: number;
}

export interface RoundEndPayload {
  index: number;
  correctOption: number;
  explanation: string | null;
  results: Array<{
    userId: string;
    optionIndex: number | null;
    isCorrect: boolean;
    gained: number;
    /** Множитель серии, применённый к этим очкам. 1 — серии не было. */
    multiplier: number;
    /** Серия игрока уже с учётом этого раунда: ошибка и пропуск дают 0. */
    streak: number;
  }>;
  leaderboard: PublicPlayer[];
  nextRoundInMs: number;
}

export interface RatingChange {
  userId: string;
  before: number;
  after: number;
  delta: number;
}

export interface GameOverPayload {
  leaderboard: PublicPlayer[];
  winner: PublicPlayer;
  ratingChanges: RatingChange[];
}
