/**
 * Единственный источник правды по реалтайму: состояние комнаты, текущий раунд,
 * раскрытие ответа и финал. Компоненты только читают этот стор и вызывают его
 * действия — своей копии игрового состояния у них нет.
 *
 * Подписки на сокет ставятся один раз в `bindGameSocket`, поэтому переходы
 * между экранами не плодят дублирующихся обработчиков.
 */
import { create } from 'zustand';
import { emit } from '../socket/socket';
import type { GameSocket } from '../socket/socket';
import { toast } from './uiStore';
import { currentUserId } from './authStore';
import { getStartParam, hapticNotification } from '../lib/telegram';
import { playCorrect, playFanfare, playWrong } from '../lib/sound';
import type {
  GameErrorCode,
  GameOver,
  PublicRoomState,
  RoundEnd,
  RoundStart,
} from '../types/api';

/** Человеческий текст на каждый код ошибки контракта. */
const ERROR_MESSAGES: Record<GameErrorCode, string> = {
  ROOM_NOT_FOUND: 'Комната не найдена — проверь код или создай новую',
  ROOM_IN_PROGRESS: 'В этой комнате уже идёт игра',
  ROOM_NOT_FINISHED: 'Игра ещё не закончилась',
  NOT_HOST: 'Начать игру может только хост',
  NOT_READY: 'Не все игроки готовы',
  PACK_EMPTY: 'В этом паке нет вопросов',
  PACK_FORBIDDEN: 'Этот пак недоступен',
  NO_PUBLIC_ROOMS: 'Свободных комнат нет — создай свою',
  INTERNAL: 'Внутренняя ошибка сервера, попробуй ещё раз',
};

export type GamePhase =
  /** Вне комнаты. */
  | 'idle'
  | 'lobby'
  /** Идёт вопрос. */
  | 'round'
  /** Показ правильного ответа между раундами. */
  | 'reveal'
  | 'gameover'
  /** Связь оборвалась, ждём переподключения. */
  | 'reconnecting';

/**
 * Сервер молчит на отклонённый SUBMIT_ANSWER (опоздал, повторный ответ,
 * индекс вне 0..3). Если ANSWER_ACCEPTED не пришёл за это время — снимаем
 * блокировку вариантов, чтобы игрок не смотрел в застывший экран.
 */
const ANSWER_ACK_TIMEOUT_MS = 2000;

interface GameState {
  connected: boolean;
  phase: GamePhase;
  room: PublicRoomState | null;
  /** Ждём ответа сервера на CREATE_ROOM / JOIN_ROOM / QUICK_MATCH. */
  joining: boolean;

  round: RoundStart | null;
  /** Расхождение часов клиента и сервера, мс: серверное время = Date.now() + clockOffset. */
  clockOffset: number;
  /** Вариант, отправленный на сервер и ещё не подтверждённый. */
  pendingAnswer: number | null;
  /** Вариант, подтверждённый событием ANSWER_ACCEPTED. */
  myAnswer: number | null;
  answeredCount: number;
  totalPlayers: number;

  roundEnd: RoundEnd | null;
  gameOver: GameOver | null;
  /**
   * Своя серия правильных ответов. Держим её здесь, а не читаем из
   * `room.players`: `ROOM_UPDATED` во время партии не приходит на каждый
   * ответ, поэтому там значение было бы устаревшим.
   */
  myStreak: number;

  createRoom: (packId: string, isPublic: boolean) => void;
  joinRoom: (roomId: string) => void;
  quickMatch: () => void;
  toggleReady: () => void;
  startGame: () => void;
  leaveRoom: () => void;
  /** Реванш: возвращает комнату из итогов обратно в лобби. */
  rematch: () => void;
  /** Смена пака в лобби — только хосту. */
  changePack: (packId: string) => void;
  /** Настройки партии в лобби — только хосту. */
  changeSettings: (settings: {
    questionLimit?: number | null;
    roundDurationMs?: number;
  }) => void;
  /** Тренировка: комната на одного, партия начинается сразу. */
  soloGame: (packId: string) => void;
  submitAnswer: (optionIndex: number) => void;
  /** Полный сброс комнаты и игры — при выходе в меню. */
  reset: () => void;
}

/**
 * Код комнаты переживает перезапуск приложения: Telegram открывает Mini App
 * заново, состояние стора при этом теряется. Ключ содержит `userId`, чтобы две
 * вкладки с разными игроками (дев-режим) не затирали комнату друг другу.
 */
const ROOM_STORAGE_PREFIX = 'guessai.room.';

function roomStorageKey(): string | null {
  const userId = currentUserId();

  return userId ? `${ROOM_STORAGE_PREFIX}${userId}` : null;
}

function rememberRoom(roomId: string | null): void {
  const key = roomStorageKey();
  if (!key) return;

  try {
    if (roomId) window.localStorage.setItem(key, roomId);
    else window.localStorage.removeItem(key);
  } catch {
    // Приватный режим может запрещать localStorage — тогда комната просто не переживёт перезапуск.
  }
}

function recallRoom(): string | null {
  const key = roomStorageKey();
  if (!key) return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

let answerAckTimer: number | null = null;

function clearAnswerAckTimer(): void {
  if (answerAckTimer !== null) {
    window.clearTimeout(answerAckTimer);
    answerAckTimer = null;
  }
}

const emptyRound = {
  round: null,
  pendingAnswer: null,
  myAnswer: null,
  answeredCount: 0,
  totalPlayers: 0,
  roundEnd: null,
  myStreak: 0,
};

export const useGameStore = create<GameState>((set, get) => ({
  connected: false,
  phase: 'idle',
  room: null,
  joining: false,

  round: null,
  clockOffset: 0,
  pendingAnswer: null,
  myAnswer: null,
  answeredCount: 0,
  totalPlayers: 0,
  myStreak: 0,

  roundEnd: null,
  gameOver: null,

  createRoom: (packId, isPublic) => {
    if (!emit('CREATE_ROOM', { packId, isPublic })) {
      toast('Нет соединения с сервером');
      return;
    }

    set({ joining: true, gameOver: null, ...emptyRound });
  },

  joinRoom: (roomId) => {
    const normalized = roomId.trim().toUpperCase();

    if (!emit('JOIN_ROOM', { roomId: normalized })) {
      toast('Нет соединения с сервером');
      return;
    }

    set({ joining: true, gameOver: null, ...emptyRound });
  },

  quickMatch: () => {
    if (!emit('QUICK_MATCH')) {
      toast('Нет соединения с сервером');
      return;
    }

    set({ joining: true, gameOver: null, ...emptyRound });
  },

  toggleReady: () => {
    emit('TOGGLE_READY');
  },

  startGame: () => {
    emit('START_GAME');
  },

  leaveRoom: () => {
    emit('LEAVE_ROOM');
    get().reset();
  },

  rematch: () => {
    if (!emit('REMATCH')) {
      toast('Нет соединения с сервером');
    }
  },

  changePack: (packId) => {
    if (!emit('CHANGE_PACK', { packId })) {
      toast('Нет соединения с сервером');
    }
  },

  changeSettings: (settings) => {
    if (!emit('CHANGE_SETTINGS', settings)) {
      toast('Нет соединения с сервером');
    }
  },

  soloGame: (packId) => {
    set({ joining: true, gameOver: null, ...emptyRound });

    if (!emit('SOLO_GAME', { packId })) {
      set({ joining: false });
      toast('Нет соединения с сервером');
    }
  },

  submitAnswer: (optionIndex) => {
    const { phase, myAnswer, pendingAnswer } = get();

    if (phase !== 'round' || myAnswer !== null || pendingAnswer !== null) return;
    if (!emit('SUBMIT_ANSWER', { optionIndex })) {
      toast('Нет соединения с сервером');
      return;
    }

    set({ pendingAnswer: optionIndex });

    clearAnswerAckTimer();
    answerAckTimer = window.setTimeout(() => {
      answerAckTimer = null;

      if (get().myAnswer === null && get().phase === 'round') {
        set({ pendingAnswer: null });
        toast('Ответ не принят — попробуй ещё раз', 'info');
      }
    }, ANSWER_ACK_TIMEOUT_MS);
  },

  reset: () => {
    clearAnswerAckTimer();
    rememberRoom(null);
    set({
      phase: 'idle',
      room: null,
      joining: false,
      gameOver: null,
      clockOffset: 0,
      ...emptyRound,
    });
  },
}));

/**
 * Ставит обработчики серверных событий. Вызывается один раз сразу после
 * создания сокета.
 */
export function bindGameSocket(socket: GameSocket): void {
  const set = useGameStore.setState;
  const get = useGameStore.getState;

  socket.on('connect', () => {
    set({ connected: true });

    // Серверная привязка сокета к комнате теряется при разрыве: после
    // реконнекта заново входим в ту же комнату по её коду. После полного
    // перезапуска приложения код берётся из localStorage — если комнаты уже
    // нет, сервер ответит ROOM_NOT_FOUND и состояние сбросится.
    // Открытие по deep link ведёт в свою комнату — сохранённая тогда не нужна.
    const roomId =
      get().room?.roomId ?? (getStartParam() ? null : recallRoom());

    if (roomId) {
      emit('JOIN_ROOM', { roomId });
      set({ joining: true });
    }
  });

  socket.on('disconnect', () => {
    set((state) => ({
      connected: false,
      // В лобби экран остаётся прежним — там разрыв показывает баннер.
      // Прерванную игру заменяем состоянием «переподключение».
      phase: state.room?.status === 'PLAYING' ? 'reconnecting' : state.phase,
    }));
  });

  socket.on('connect_error', () => {
    set({ connected: false });
  });

  const applyRoom = (state: PublicRoomState): void => {
    rememberRoom(state.roomId);
    set((current) => {
      const phase = resolvePhase(current.phase, state);

      // Реванш возвращает комнату в лобби: итоги и остатки раунда
      // с прошлой партии нужно убрать, иначе они переживут новую игру.
      const finished =
        phase === 'lobby' ? { gameOver: null, ...emptyRound } : null;

      return { room: state, joining: false, phase, ...finished };
    });
  };

  socket.on('ROOM_CREATED', applyRoom);
  socket.on('ROOM_UPDATED', applyRoom);

  socket.on('ROUND_START', (payload) => {
    clearAnswerAckTimer();

    set((state) => ({
      phase: 'round',
      round: payload,
      // Первый раунд партии — серия начинается заново, как и на сервере.
      myStreak: payload.index === 0 ? 0 : state.myStreak,
      // Раунд стартовал в серверный момент endsAt - durationMs, а получен сейчас:
      // разница и есть смещение часов. Остаток считается как endsAt - (Date.now() + offset).
      clockOffset: payload.endsAt - payload.durationMs - Date.now(),
      pendingAnswer: null,
      myAnswer: null,
      answeredCount: 0,
      totalPlayers: 0,
      roundEnd: null,
    }));
  });

  socket.on('ANSWER_ACCEPTED', ({ optionIndex }) => {
    clearAnswerAckTimer();
    set({ myAnswer: optionIndex, pendingAnswer: null });
  });

  socket.on('PLAYER_ANSWERED', ({ answeredCount, totalPlayers }) => {
    set({ answeredCount, totalPlayers });
  });

  socket.on('ROUND_END', (payload) => {
    clearAnswerAckTimer();
    set({ phase: 'reveal', roundEnd: payload, pendingAnswer: null });

    const userId = currentUserId();
    const mine = payload.results.find((result) => result.userId === userId);

    // Серия обновляется и когда игрок промолчал: пропуск её обнуляет,
    // поэтому выходить раньше нельзя.
    if (mine) set({ myStreak: mine.streak });

    if (!mine || mine.optionIndex === null) return;

    if (mine.isCorrect) {
      playCorrect();
      hapticNotification('success');
    } else {
      playWrong();
      hapticNotification('error');
    }
  });

  socket.on('GAME_OVER', (payload) => {
    clearAnswerAckTimer();
    set({ phase: 'gameover', gameOver: payload, ...emptyRound });

    playFanfare();
    hapticNotification('success');
  });

  socket.on('ERROR', ({ code, message }) => {
    set({ joining: false });

    // Неизвестный код всё равно виден пользователю: сообщение сервера как есть.
    toast(ERROR_MESSAGES[code] ?? message);

    // Комнаты больше нет (истёк TTL, игра завершилась) — забываем её,
    // иначе при каждом старте приложение будет ломиться в мёртвый код.
    if (code === 'ROOM_NOT_FOUND' || code === 'ROOM_IN_PROGRESS') {
      const { phase } = get();

      if (phase === 'reconnecting' || phase === 'idle') {
        get().reset();
      } else {
        rememberRoom(null);
      }
    }
  });
}

/**
 * Фаза по статусу комнаты. ROOM_UPDATED приходит и во время игры (кто-то
 * отключился), поэтому активный раунд им перебивать нельзя.
 */
function resolvePhase(current: GamePhase, room: PublicRoomState): GamePhase {
  if (room.status === 'LOBBY') return 'lobby';
  if (room.status === 'FINISHED') return 'gameover';

  // status === 'PLAYING'
  if (current === 'round' || current === 'reveal' || current === 'gameover') {
    return current;
  }

  // Реконнект в идущую игру: ждём ближайший ROUND_START / ROUND_END.
  return 'reconnecting';
}
