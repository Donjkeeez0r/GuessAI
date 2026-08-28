export type RoomStatus = 'LOBBY' | 'PLAYING' | 'FINISHED';

/** Вопрос в оперативном состоянии комнаты. Живёт только в Redis — наружу не уходит. */
export interface IRoomQuestion {
  id: string;
  text: string;
  options: string[];
  correctOption: number;
  explanation: string | null;
  audioUrl: string | null;
}

/** Внутреннее представление игрока: `socketId` наружу не эмитится. */
export interface IPlayer {
  socketId: string;
  userId: string;
  username: string;
  photoUrl: string | null;
  score: number;
  /** Серия правильных ответов подряд. Ошибка и пропуск обнуляют её. */
  streak: number;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
}

/** Ответ игрока в текущем раунде. */
export interface IRoundAnswer {
  userId: string;
  optionIndex: number;
  answeredAt: number;
  isCorrect: boolean;
  gained: number;
  /** Множитель серии, с которым начислены очки. Нужен экрану раунда. */
  multiplier: number;
}

/** Полное состояние комнаты. Хранится в Redis, наружу отдаётся только `PublicRoomState`. */
export interface IRoomState {
  roomId: string;
  packId: string;
  packTitle: string;
  isPublic: boolean;
  status: RoomStatus;
  hostUserId: string;
  players: IPlayer[];
  /**
   * Сколько вопросов пака разыгрывается. `null` — весь пак.
   * `totalQuestions` — это уже применённый лимит, то есть min(размер пака, лимит).
   */
  questionLimit: number | null;
  /** Сколько вопросов в паке всего — лобби гасит по нему лишние пресеты. */
  packQuestionCount: number;
  totalQuestions: number;
  /** Вопросы подгружаются только при `START_GAME`. */
  questions: IRoomQuestion[];
  /** Индекс текущего вопроса, 0-based. */
  currentQuestion: number;
  /** Конец текущего раунда по часам сервера, epoch ms. `null` вне раунда. */
  roundEndsAt: number | null;
  roundDurationMs: number;
  answers: IRoundAnswer[];
}

/** Игрок в том виде, в каком он уходит клиентам. */
export interface PublicPlayer {
  userId: string;
  username: string;
  photoUrl: string | null;
  score: number;
  streak: number;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
}

/** Состояние комнаты в том виде, в каком оно уходит клиентам. */
export interface PublicRoomState {
  roomId: string;
  packId: string;
  packTitle: string;
  isPublic: boolean;
  status: RoomStatus;
  hostUserId: string;
  players: PublicPlayer[];
  questionLimit: number | null;
  packQuestionCount: number;
  totalQuestions: number;
  /** Длительность раунда: лобби показывает её и даёт хосту менять. */
  roundDurationMs: number;
}

export function toPublicPlayer(player: IPlayer): PublicPlayer {
  return {
    userId: player.userId,
    username: player.username,
    photoUrl: player.photoUrl,
    score: player.score,
    streak: player.streak,
    isHost: player.isHost,
    isReady: player.isReady,
    connected: player.connected,
  };
}

/**
 * Единственный сериализатор комнаты для внешнего мира.
 * Все исходящие эмиты состояния комнаты обязаны идти через него,
 * иначе наружу утекут `questions` с правильными ответами.
 */
export function toPublicRoomState(room: IRoomState): PublicRoomState {
  return {
    roomId: room.roomId,
    packId: room.packId,
    packTitle: room.packTitle,
    isPublic: room.isPublic,
    status: room.status,
    hostUserId: room.hostUserId,
    players: room.players.map(toPublicPlayer),
    questionLimit: room.questionLimit,
    packQuestionCount: room.packQuestionCount,
    totalQuestions: room.totalQuestions,
    roundDurationMs: room.roundDurationMs,
  };
}

/** Лидерборд: игроки по убыванию очков. */
export function buildLeaderboard(room: IRoomState): PublicPlayer[] {
  return [...room.players]
    .sort((a, b) => b.score - a.score)
    .map(toPublicPlayer);
}
