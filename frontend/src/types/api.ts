/**
 * Типы контракта GuessAI (см. CONTRACT.md в корне репозитория).
 * Единственное место, где описана форма данных сервера: экраны и стор
 * импортируют типы отсюда и нигде не пересказывают контракт по памяти.
 */

// ───────────────────────────── REST ─────────────────────────────

/** Пользователь в ответе `POST /auth/telegram`. */
export interface AuthUser {
  id: string;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
  rating: number;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

/** `GET /users/me` */
export interface UserProfile extends AuthUser {
  totalGames: number;
  totalPacks: number;
  wins: number;
}

/** Элемент `GET /users/me/history` */
export interface GameHistoryItem {
  gameSessionId: string;
  packTitle: string;
  score: number;
  place: number | null;
  playersCount: number;
  /** ISO-строка */
  playedAt: string;
}

/** Строка `GET /users/leaderboard` */
export interface LeaderboardEntry {
  /** Абсолютное место по всей таблице, 1-based. */
  rank: number;
  userId: string;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
  rating: number;
  totalGames: number;
  wins: number;
}

/** `GET /users/leaderboard` */
export interface Leaderboard {
  entries: LeaderboardEntry[];
  /** Своя строка; null — зачётных партий ещё не было. */
  me: LeaderboardEntry | null;
}

/** Элемент списка `GET /pack` */
export interface PackSummary {
  id: string;
  title: string;
  description: string | null;
  category: string;
  isAiGenerated: boolean;
  isPublic: boolean;
  authorId: string | null;
  createdAt: string;
  _count: { questions: number };
}

/**
 * Вопрос в ответе `GET /pack/:id`. `correctOption` и `explanation` приходят
 * только автору собственного пака (не ИИ-пака) — всем остальным правильные
 * ответы не раскрываются до `ROUND_END`.
 */
export interface PackQuestion {
  id: string;
  text: string;
  options: string[];
  audioUrl: string | null;
  correctOption?: number;
  explanation?: string | null;
}

/** `GET /pack/:id`, а также тело ответов `POST /pack` и `PATCH /pack/:id`. */
export interface PackWithQuestions {
  id: string;
  title: string;
  description: string | null;
  category: string;
  isAiGenerated: boolean;
  isPublic: boolean;
  authorId: string | null;
  createdAt: string;
  questions: PackQuestion[];
}

/** Вопрос в теле `POST /pack` — здесь правильный ответ передаётся. */
export interface CreateQuestionDto {
  text: string;
  /** Ровно 4 непустых варианта. */
  options: string[];
  /** Индекс правильного варианта, 0..3. */
  correctOption: number;
  explanation?: string;
}

export interface CreatePackDto {
  title: string;
  description?: string;
  category: string;
  /** Опущено — пак публичный. */
  isPublic?: boolean;
  questions: CreateQuestionDto[];
}

/** Тело `PATCH /pack/:id` — частичный `CreatePackDto`. */
export type UpdatePackDto = Partial<CreatePackDto>;

/** `POST /pack/generate-ai` */
export interface GeneratedPackResponse {
  fromCache: boolean;
  pack: PackWithQuestions;
}

/** Стандартный формат ошибки Nest. */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

// ───────────────────────────── WebSocket ─────────────────────────────

export type RoomStatus = 'LOBBY' | 'PLAYING' | 'FINISHED';

export interface Player {
  userId: string;
  /** Сервер подставляет firstName, если username пуст. */
  username: string;
  photoUrl: string | null;
  score: number;
  /** Правильных ответов подряд. Ошибка и пропуск обнуляют. */
  streak: number;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
}

export interface PublicRoomState {
  /** 6 символов, uppercase. */
  roomId: string;
  packId: string;
  packTitle: string;
  isPublic: boolean;
  status: RoomStatus;
  hostUserId: string;
  players: Player[];
  /** null — разыгрывается весь пак. */
  questionLimit: number | null;
  /** Сколько вопросов в паке всего. */
  packQuestionCount: number;
  /** Уже с применённым лимитом: min(размер пака, questionLimit). */
  totalQuestions: number;
  roundDurationMs: number;
}

export interface RoundStart {
  /** 0-based. */
  index: number;
  total: number;
  question: {
    text: string;
    options: string[];
    audioUrl: string | null;
  };
  /** epoch ms по часам сервера. */
  endsAt: number;
  durationMs: number;
}

export interface RoundResult {
  userId: string;
  /** null — игрок не успел ответить. */
  optionIndex: number | null;
  isCorrect: boolean;
  gained: number;
  /** Множитель серии, применённый к `gained`. 1 — серии не было. */
  multiplier: number;
  /** Серия игрока уже с учётом этого раунда. */
  streak: number;
}

export interface RoundEnd {
  index: number;
  correctOption: number;
  explanation: string | null;
  results: RoundResult[];
  /** Отсортирован по score убыв. */
  leaderboard: Player[];
  /** Сколько миллисекунд держать раскрытие ответа. */
  nextRoundInMs: number;
}

export interface RatingChange {
  userId: string;
  before: number;
  after: number;
  delta: number;
}

export interface GameOver {
  leaderboard: Player[];
  winner: Player;
  ratingChanges: RatingChange[];
}

export interface AnswerAccepted {
  optionIndex: number;
}

export interface PlayerAnswered {
  userId: string;
  answeredCount: number;
  totalPlayers: number;
}

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

export interface GameErrorPayload {
  code: GameErrorCode;
  message: string;
}

/** События сервер → клиент. */
export interface ServerToClientEvents {
  ROOM_CREATED: (state: PublicRoomState) => void;
  ROOM_UPDATED: (state: PublicRoomState) => void;
  ROUND_START: (payload: RoundStart) => void;
  ANSWER_ACCEPTED: (payload: AnswerAccepted) => void;
  PLAYER_ANSWERED: (payload: PlayerAnswered) => void;
  ROUND_END: (payload: RoundEnd) => void;
  GAME_OVER: (payload: GameOver) => void;
  ERROR: (payload: GameErrorPayload) => void;
}

/**
 * События клиент → сервер. Личность и комната берутся сервером из JWT и
 * `client.data`, поэтому `userId`/`roomId` в payload игровых событий нет.
 */
export interface ClientToServerEvents {
  CREATE_ROOM: (payload: { packId: string; isPublic: boolean }) => void;
  JOIN_ROOM: (payload: { roomId: string }) => void;
  QUICK_MATCH: () => void;
  TOGGLE_READY: () => void;
  LEAVE_ROOM: () => void;
  START_GAME: () => void;
  REMATCH: () => void;
  CHANGE_PACK: (payload: { packId: string }) => void;
  CHANGE_SETTINGS: (payload: {
    questionLimit?: number | null;
    roundDurationMs?: number;
  }) => void;
  SOLO_GAME: (payload: { packId: string }) => void;
  SUBMIT_ANSWER: (payload: { optionIndex: number }) => void;
}
