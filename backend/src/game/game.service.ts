import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { RoomService } from '../room/room.service';
import {
  buildLeaderboard,
  IPlayer,
  IRoomQuestion,
  IRoomState,
  toPublicRoomState,
} from '../room/room.types';
import { assignPlaces, calculateEloDeltas, ELO_MIN_RATING } from './elo.util';
import {
  GameError,
  GameSocket,
  RatingChange,
  RoundEndPayload,
  RoundStartPayload,
} from './game.types';

const DEFAULT_ROUND_DURATION_MS = 15000;
const DEFAULT_ROUND_REVEAL_MS = 5000;
const BASE_POINTS = 100;
const SPEED_POINTS = 100;

/**
 * Множитель по длине серии: индекс — число правильных ответов подряд минус
 * один, дальше потолок. Серия в четыре ответа удваивает очки, поэтому
 * отстающий может отыграться, а один промах стоит дорого.
 */
const STREAK_MULTIPLIERS = [1, 1.25, 1.5, 2];

/** Пресеты настроек лобби. Значения вне списка отвергаются молча. */
const QUESTION_LIMIT_OPTIONS = [5, 10, 15];
const ROUND_DURATION_OPTIONS = [10000, 15000, 20000, 30000];

/**
 * Вся игровая логика: состояние комнат, серверные таймеры раундов,
 * подсчёт очков, сохранение результатов и пересчёт рейтинга.
 * Гейтвей только принимает события и передаёт их сюда.
 */
@Injectable()
export class GameService implements OnModuleDestroy {
  private readonly logger = new Logger(GameService.name);
  private server: Server | null = null;
  /** Активные таймеры раундов, по одному на комнату. */
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly roundDurationMs: number;
  private readonly revealMs: number;

  constructor(
    private readonly roomService: RoomService,
    private readonly prismaService: PrismaService,
    configService: ConfigService,
  ) {
    this.roundDurationMs = Number(
      configService.get<string>('ROUND_DURATION_MS') ??
        DEFAULT_ROUND_DURATION_MS,
    );
    this.revealMs = Number(
      configService.get<string>('ROUND_REVEAL_MS') ?? DEFAULT_ROUND_REVEAL_MS,
    );
  }

  onModuleDestroy() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  setServer(server: Server): void {
    this.server = server;
  }

  private get io(): Server {
    if (!this.server) {
      throw new GameError('INTERNAL', 'Сервер сокетов не инициализирован');
    }
    return this.server;
  }

  // ───────────────────────────── Комнаты ─────────────────────────────

  async createRoom(
    client: GameSocket,
    packId: string,
    isPublic: boolean,
  ): Promise<void> {
    const room = await this.openRoom(client, packId, isPublic);

    client.emit('ROOM_CREATED', toPublicRoomState(room));
  }

  /**
   * Тренировка: приватная комната на одного и сразу первый раунд.
   * Состояние комнаты уходит **после** старта: пошли бы мы обычным путём,
   * клиент на мгновение увидел бы комнату в `LOBBY` и мигнул бы лобби по
   * дороге в игру. `ROUND_START` приходит первым и сразу ставит фазу раунда.
   */
  async soloGame(client: GameSocket, packId: string): Promise<void> {
    await this.openRoom(client, packId, false);

    // Состояние комнаты рассылает сам startGame — уже после ROUND_START.
    await this.startGame(client);
  }

  /** Общее для обычной комнаты и тренировки создание комнаты в `LOBBY`. */
  private async openRoom(
    client: GameSocket,
    packId: string,
    isPublic: boolean,
  ): Promise<IRoomState> {
    const userId = client.data.userId;

    const pack = await this.loadPlayablePack(packId, userId);

    await this.detachFromCurrentRoom(client, { fromDisconnect: false });

    const roomId = await this.roomService.generateRoomId();
    const host = await this.buildPlayer(userId, client.id, true);

    const room: IRoomState = {
      roomId,
      packId: pack.id,
      packTitle: pack.title,
      isPublic,
      status: 'LOBBY',
      hostUserId: userId,
      players: [host],
      questionLimit: null,
      packQuestionCount: pack.questionCount,
      totalQuestions: pack.questionCount,
      questions: [],
      currentQuestion: 0,
      roundEndsAt: null,
      roundDurationMs: this.roundDurationMs,
      answers: [],
    };

    await this.roomService.saveRoom(room);

    if (isPublic) {
      await this.roomService.addPublicRoom(roomId);
    }

    await client.join(roomId);
    client.data.roomId = roomId;

    return room;
  }

  async joinRoom(client: GameSocket, rawRoomId: string): Promise<void> {
    const userId = client.data.userId;
    const roomId = rawRoomId.trim().toUpperCase();

    if (client.data.roomId && client.data.roomId !== roomId) {
      await this.detachFromCurrentRoom(client, { fromDisconnect: false });
    }

    const room = await this.roomService.withRoomLock(roomId, async () => {
      const current = await this.roomService.getRoom(roomId);

      if (!current) {
        throw new GameError('ROOM_NOT_FOUND', 'Комната не найдена');
      }

      const existing = current.players.find(
        (player) => player.userId === userId,
      );

      if (!existing && current.status === 'PLAYING') {
        throw new GameError('ROOM_IN_PROGRESS', 'В комнате уже идёт игра');
      }

      if (!existing && current.status === 'FINISHED') {
        throw new GameError('ROOM_NOT_FOUND', 'Игра в этой комнате завершена');
      }

      if (existing) {
        // Реконнект: игрок опознан по userId, обновляем только сокет.
        existing.socketId = client.id;
        existing.connected = true;
      } else {
        current.players.push(await this.buildPlayer(userId, client.id, false));
      }

      await this.roomService.saveRoom(current);

      return current;
    });

    await client.join(room.roomId);
    client.data.roomId = room.roomId;

    this.emitRoomUpdated(room);
  }

  async quickMatch(client: GameSocket): Promise<void> {
    const lobby = await this.roomService.findPublicLobby(client.data.userId);

    if (lobby) {
      try {
        await this.joinRoom(client, lobby.roomId);
        return;
      } catch (error) {
        // Комната могла стартовать между поиском и входом — падаем в создание новой.
        this.logger.debug(
          `QUICK_MATCH: не удалось войти в ${lobby.roomId}: ${String(error)}`,
        );
      }
    }

    const packs = await this.prismaService.pack.findMany({
      where: { isPublic: true, questions: { some: {} } },
      select: { id: true },
    });

    if (packs.length === 0) {
      throw new GameError(
        'NO_PUBLIC_ROOMS',
        'Нет открытых комнат и публичных паков',
      );
    }

    const pack = packs[Math.floor(Math.random() * packs.length)];

    await this.createRoom(client, pack.id, true);
  }

  async toggleReady(client: GameSocket): Promise<void> {
    const roomId = this.requireRoomId(client);

    const room = await this.roomService.withRoomLock(roomId, async () => {
      const current = await this.roomService.getRoom(roomId);

      if (!current) {
        throw new GameError('ROOM_NOT_FOUND', 'Комната не найдена');
      }

      const player = current.players.find(
        (candidate) => candidate.userId === client.data.userId,
      );

      if (!player) {
        throw new GameError('ROOM_NOT_FOUND', 'Игрок не найден в комнате');
      }

      player.isReady = !player.isReady;

      await this.roomService.saveRoom(current);

      return current;
    });

    this.emitRoomUpdated(room);
  }

  /**
   * Явный выход в меню. Во время партии он приравнен к обрыву связи: очки
   * игрока замирают, но он остаётся в комнате и попадает в итоги, историю и
   * пересчёт рейтинга. Иначе кнопка выхода стала бы способом не получить
   * проигранную партию в ELO.
   */
  async leaveRoom(client: GameSocket): Promise<void> {
    await this.detachFromCurrentRoom(client, { fromDisconnect: false });
  }

  /** Обрыв связи: в лобби игрок выбывает, в игре — остаётся с очками. */
  async handleDisconnect(client: GameSocket): Promise<void> {
    await this.detachFromCurrentRoom(client, { fromDisconnect: true });
  }

  // ───────────────────────────── Игровой цикл ─────────────────────────────

  async startGame(client: GameSocket): Promise<void> {
    const roomId = this.requireRoomId(client);

    await this.roomService.withRoomLock(roomId, async () => {
      const room = await this.roomService.getRoom(roomId);

      if (!room) {
        throw new GameError('ROOM_NOT_FOUND', 'Комната не найдена');
      }

      if (room.hostUserId !== client.data.userId) {
        throw new GameError('NOT_HOST', 'Начать игру может только хост');
      }

      if (room.status !== 'LOBBY') {
        throw new GameError('ROOM_IN_PROGRESS', 'Игра уже идёт');
      }

      if (room.players.some((player) => player.connected && !player.isReady)) {
        throw new GameError('NOT_READY', 'Не все игроки готовы');
      }

      const questions = await this.prismaService.question.findMany({
        where: { packId: room.packId },
        orderBy: { id: 'asc' },
      });

      if (questions.length === 0) {
        throw new GameError('PACK_EMPTY', 'В паке нет вопросов');
      }

      room.questions = this.selectQuestions(
        questions.map((question) => ({
          id: question.id,
          text: question.text,
          options: question.options,
          correctOption: question.correctOption,
          explanation: question.explanation,
          audioUrl: question.audioUrl,
        })),
        room.questionLimit,
      );
      room.packQuestionCount = questions.length;
      room.totalQuestions = room.questions.length;
      room.status = 'PLAYING';
      room.currentQuestion = 0;
      room.roundEndsAt = null;
      room.answers = [];
      room.players.forEach((player) => {
        player.score = 0;
        player.streak = 0;
      });

      await this.roomService.saveRoom(room);
      await this.roomService.removePublicRoom(room.roomId);
    });

    await this.startRound(roomId);

    // Статус комнаты уходит клиентам только теперь, после ROUND_START. Раньше
    // его не слали вовсе, и у клиента room.status оставался 'LOBBY' всю
    // партию — из-за чего разрыв связи не переводил экран в «переподключение».
    // Порядок важен: приди ROOM_UPDATED первым, resolvePhase на мгновение
    // отдал бы лобби и увёл бы игрока с игрового экрана.
    const started = await this.roomService.getRoom(roomId);

    if (started) {
      this.emitRoomUpdated(started);
    }
  }

  /**
   * Смена пака в лобби. Готовность сбрасывается до исходной: игроки жали
   * «Готов» под прежний пак, их согласие нужно переспросить.
   */
  async changePack(client: GameSocket, packId: string): Promise<void> {
    const roomId = this.requireRoomId(client);
    const userId = client.data.userId;

    const pack = await this.loadPlayablePack(packId, userId);

    const room = await this.roomService.withRoomLock(roomId, async () => {
      const current = await this.roomService.getRoom(roomId);

      if (!current) {
        throw new GameError('ROOM_NOT_FOUND', 'Комната не найдена');
      }

      if (current.hostUserId !== userId) {
        throw new GameError('NOT_HOST', 'Менять пак может только хост');
      }

      if (current.status !== 'LOBBY') {
        throw new GameError('ROOM_IN_PROGRESS', 'Пак меняется только в лобби');
      }

      current.packId = pack.id;
      current.packTitle = pack.title;
      current.packQuestionCount = pack.questionCount;
      // Лимит переживает смену пака, но упирается в его размер: выбранные
      // «15 вопросов» на паке из пяти — это пять.
      current.totalQuestions = applyQuestionLimit(
        pack.questionCount,
        current.questionLimit,
      );
      current.players.forEach((player) => {
        player.isReady = player.isHost;
      });

      await this.roomService.saveRoom(current);

      return current;
    });

    this.emitRoomUpdated(room);
  }

  /**
   * Настройки партии в лобби: сколько вопросов разыгрываем и сколько секунд
   * даётся на ответ. Как и смена пака — только хост, только в `LOBBY` и со
   * сбросом готовности: игроки соглашались на прежние правила.
   */
  async changeSettings(
    client: GameSocket,
    settings: { questionLimit?: number | null; roundDurationMs?: number },
  ): Promise<void> {
    const roomId = this.requireRoomId(client);
    const userId = client.data.userId;

    const room = await this.roomService.withRoomLock(roomId, async () => {
      const current = await this.roomService.getRoom(roomId);

      if (!current) {
        throw new GameError('ROOM_NOT_FOUND', 'Комната не найдена');
      }

      if (current.hostUserId !== userId) {
        throw new GameError('NOT_HOST', 'Менять настройки может только хост');
      }

      if (current.status !== 'LOBBY') {
        throw new GameError(
          'ROOM_IN_PROGRESS',
          'Настройки меняются только в лобби',
        );
      }

      // Значения приходят из наших же чипсов, поэтому всё вне белого списка — это
      // самодельный клиент: отвергаем молча, как и прочий мусор в сокете.
      if (settings.questionLimit !== undefined) {
        const limit = settings.questionLimit;

        if (limit !== null && !QUESTION_LIMIT_OPTIONS.includes(limit)) {
          return null;
        }

        current.questionLimit = limit;
      }

      if (settings.roundDurationMs !== undefined) {
        if (!ROUND_DURATION_OPTIONS.includes(settings.roundDurationMs)) {
          return null;
        }

        current.roundDurationMs = settings.roundDurationMs;
      }

      // Размер пака мог измениться с момента выбора лимита, поэтому счётчик
      // пересчитывается по свежему значению из БД, а не по прежнему.
      const packSize = await this.prismaService.question.count({
        where: { packId: current.packId },
      });

      current.packQuestionCount = packSize;
      current.totalQuestions = applyQuestionLimit(
        packSize,
        current.questionLimit,
      );
      current.players.forEach((player) => {
        player.isReady = player.isHost;
      });

      await this.roomService.saveRoom(current);

      return current;
    });

    if (!room) return;

    this.emitRoomUpdated(room);
  }

  /**
   * Реванш: комната из `FINISHED` возвращается в `LOBBY` с обнулённым счётом.
   * Звать может любой игрок — кто нажал первым, тот и вернул остальных.
   * Повторное нажатие не ошибка, а переотправка состояния: иначе двое,
   * нажавшие одновременно, увидели бы `ERROR` на ровном месте.
   */
  async rematch(client: GameSocket): Promise<void> {
    const roomId = this.requireRoomId(client);

    const outcome = await this.roomService.withRoomLock(roomId, async () => {
      const room = await this.roomService.getRoom(roomId);

      if (!room) {
        throw new GameError('ROOM_NOT_FOUND', 'Комната не найдена');
      }

      if (
        !room.players.some((player) => player.userId === client.data.userId)
      ) {
        throw new GameError('ROOM_NOT_FOUND', 'Ты не состоишь в этой комнате');
      }

      if (room.status === 'LOBBY') {
        return { room, alreadyReset: true };
      }

      if (room.status !== 'FINISHED') {
        throw new GameError('ROOM_NOT_FINISHED', 'Игра ещё не закончилась');
      }

      // В лобби отключившихся не держим — по контракту их там быть не должно.
      const remaining = room.players.filter((player) => player.connected);

      if (remaining.length === 0) {
        await this.roomService.deleteRoom(room.roomId);
        return null;
      }

      // Хост мог уйти сразу после партии — роль наследует первый оставшийся.
      if (!remaining.some((player) => player.isHost)) {
        remaining[0].isHost = true;
        room.hostUserId = remaining[0].userId;
      }

      remaining.forEach((player) => {
        player.score = 0;
        player.streak = 0;
        // В новой комнате хост готов по умолчанию — после реванша так же,
        // иначе он один остался бы неготовым и не понял почему.
        player.isReady = player.isHost;
      });

      room.players = remaining;
      room.status = 'LOBBY';
      room.questions = [];
      room.answers = [];
      room.currentQuestion = 0;
      room.roundEndsAt = null;

      await this.roomService.saveRoom(room);

      if (room.isPublic) {
        // `START_GAME` убрал комнату из публичного списка: без возврата
        // `QUICK_MATCH` её больше не найдёт.
        await this.roomService.addPublicRoom(room.roomId);
      }

      return { room, alreadyReset: false };
    });

    if (!outcome) return;

    if (outcome.alreadyReset) {
      client.emit('ROOM_UPDATED', toPublicRoomState(outcome.room));
      return;
    }

    this.emitRoomUpdated(outcome.room);
  }

  async submitAnswer(client: GameSocket, optionIndex: number): Promise<void> {
    const roomId = this.requireRoomId(client);
    const answeredAt = Date.now();
    const userId = client.data.userId;

    const outcome = await this.roomService.withRoomLock(roomId, async () => {
      const room = await this.roomService.getRoom(roomId);

      if (!room) {
        throw new GameError('ROOM_NOT_FOUND', 'Комната не найдена');
      }

      // Любое несоответствие — молчаливый отказ: контракт не описывает
      // отдельного кода ошибки на опоздавший или повторный ответ.
      if (room.status !== 'PLAYING') return null;
      if (room.roundEndsAt === null || answeredAt > room.roundEndsAt) {
        return null;
      }
      if (
        !Number.isInteger(optionIndex) ||
        optionIndex < 0 ||
        optionIndex > 3
      ) {
        return null;
      }

      const question = room.questions[room.currentQuestion];
      if (!question || optionIndex >= question.options.length) return null;

      const player = room.players.find(
        (candidate) => candidate.userId === userId,
      );
      if (!player) return null;

      if (room.answers.some((answer) => answer.userId === userId)) return null;

      const isCorrect = question.correctOption === optionIndex;
      // Множитель берётся по серии ДО этого ответа: первый правильный ответ
      // идёт по ×1, наградой за него становится множитель следующего.
      const multiplier = isCorrect ? streakMultiplier(player.streak) : 1;
      const gained = isCorrect
        ? Math.floor(
            (BASE_POINTS +
              Math.floor(
                (SPEED_POINTS * Math.max(0, room.roundEndsAt - answeredAt)) /
                  room.roundDurationMs,
              )) *
              multiplier,
          )
        : 0;

      player.streak = isCorrect ? player.streak + 1 : 0;
      player.score += gained;
      room.answers.push({
        userId,
        optionIndex,
        answeredAt,
        isCorrect,
        gained,
        multiplier,
      });

      await this.roomService.saveRoom(room);

      const connectedPlayers = room.players.filter(
        (candidate) => candidate.connected,
      );
      const answeredConnected = connectedPlayers.filter((candidate) =>
        room.answers.some((answer) => answer.userId === candidate.userId),
      ).length;

      return {
        index: room.currentQuestion,
        // Обе величины считаются по одному множеству — подключённым игрокам,
        // иначе отвалившийся участник даёт «3 из 2».
        answeredCount: answeredConnected,
        totalPlayers: connectedPlayers.length,
        allAnswered: answeredConnected >= connectedPlayers.length,
      };
    });

    if (!outcome) return;

    client.emit('ANSWER_ACCEPTED', { optionIndex });
    this.io.to(roomId).emit('PLAYER_ANSWERED', {
      userId,
      answeredCount: outcome.answeredCount,
      totalPlayers: outcome.totalPlayers,
    });

    if (outcome.allAnswered) {
      await this.endRound(roomId, outcome.index);
    }
  }

  /** Открывает раунд `room.currentQuestion` и заводит таймер его окончания. */
  private async startRound(roomId: string): Promise<void> {
    const prepared = await this.roomService.withRoomLock(roomId, async () => {
      const room = await this.roomService.getRoom(roomId);
      if (!room || room.status !== 'PLAYING') return null;

      const question = room.questions[room.currentQuestion];
      if (!question) return null;

      // Длительность берётся из комнаты, а не из env: хост мог сменить её в
      // лобби через CHANGE_SETTINGS. Значение из env — только дефолт новой
      // комнаты, и перезаписывать им выбор хоста нельзя.
      room.roundEndsAt = Date.now() + room.roundDurationMs;
      room.answers = [];

      await this.roomService.saveRoom(room);

      const payload: RoundStartPayload = {
        index: room.currentQuestion,
        total: room.questions.length,
        question: {
          text: question.text,
          options: question.options,
          audioUrl: question.audioUrl,
        },
        endsAt: room.roundEndsAt,
        durationMs: room.roundDurationMs,
      };

      return {
        payload,
        index: room.currentQuestion,
        durationMs: room.roundDurationMs,
      };
    });

    if (!prepared) return;

    this.io.to(roomId).emit('ROUND_START', prepared.payload);

    // Таймер обязан идти по той же длительности, что ушла клиентам: иначе
    // раунд закрылся бы раньше или позже, чем показывает кольцо таймера.
    this.setTimer(
      roomId,
      () => {
        void this.endRound(roomId, prepared.index);
      },
      prepared.durationMs,
    );
  }

  /** Закрывает раунд: по таймеру или досрочно, когда ответили все подключённые. */
  private async endRound(roomId: string, index: number): Promise<void> {
    this.clearTimer(roomId);

    const prepared = await this.roomService.withRoomLock(roomId, async () => {
      const room = await this.roomService.getRoom(roomId);
      if (!room || room.status !== 'PLAYING') return null;
      if (room.currentQuestion !== index) return null;
      // roundEndsAt === null означает, что раунд уже закрыт другим вызовом.
      if (room.roundEndsAt === null) return null;

      const question = room.questions[index];
      if (!question) return null;

      room.roundEndsAt = null;

      // Не ответившие теряют серию наравне с ошибившимися: иначе промолчать
      // было бы выгоднее, чем рискнуть и промахнуться.
      room.players.forEach((player) => {
        const answered = room.answers.some(
          (answer) => answer.userId === player.userId,
        );

        if (!answered) player.streak = 0;
      });

      await this.roomService.saveRoom(room);

      const payload: RoundEndPayload = {
        index,
        correctOption: question.correctOption,
        explanation: question.explanation,
        results: room.players.map((player) => {
          const answer = room.answers.find(
            (candidate) => candidate.userId === player.userId,
          );

          return {
            userId: player.userId,
            optionIndex: answer ? answer.optionIndex : null,
            isCorrect: answer ? answer.isCorrect : false,
            gained: answer ? answer.gained : 0,
            multiplier: answer ? answer.multiplier : 1,
            streak: player.streak,
          };
        }),
        leaderboard: buildLeaderboard(room),
        nextRoundInMs: this.revealMs,
      };

      return { payload, isLast: index >= room.questions.length - 1 };
    });

    if (!prepared) return;

    this.io.to(roomId).emit('ROUND_END', prepared.payload);

    this.setTimer(
      roomId,
      () => {
        void (prepared.isLast
          ? this.finishGame(roomId)
          : this.advanceRound(roomId, index));
      },
      this.revealMs,
    );
  }

  private async advanceRound(
    roomId: string,
    previousIndex: number,
  ): Promise<void> {
    const advanced = await this.roomService.withRoomLock(roomId, async () => {
      const room = await this.roomService.getRoom(roomId);
      if (!room || room.status !== 'PLAYING') return false;
      if (room.currentQuestion !== previousIndex) return false;

      room.currentQuestion = previousIndex + 1;
      await this.roomService.saveRoom(room);

      return true;
    });

    if (advanced) {
      await this.startRound(roomId);
    }
  }

  /** Финал: фиксируем сессию в БД, пересчитываем рейтинг, шлём `GAME_OVER`. */
  private async finishGame(roomId: string): Promise<void> {
    this.clearTimer(roomId);

    const room = await this.roomService.withRoomLock(roomId, async () => {
      const current = await this.roomService.getRoom(roomId);
      if (!current || current.status !== 'PLAYING') return null;

      current.status = 'FINISHED';
      current.roundEndsAt = null;

      await this.roomService.saveRoom(current);
      await this.roomService.removePublicRoom(roomId);

      return current;
    });

    if (!room) return;

    if (room.players.length === 0) {
      await this.roomService.deleteRoom(roomId);
      return;
    }

    let ratingChanges: RatingChange[] = [];

    try {
      ratingChanges = await this.persistResults(room);
    } catch (error) {
      this.logger.error(
        `Не удалось сохранить итоги игры ${roomId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    const leaderboard = buildLeaderboard(room);

    this.io.to(roomId).emit('GAME_OVER', {
      leaderboard,
      winner: leaderboard[0],
      ratingChanges,
    });
  }

  /**
   * Одна транзакция: `GameSession` + `GamePlayer` на каждого участника + новые рейтинги.
   * Игра с одним игроком пишется в историю, но рейтинг не меняет.
   */
  private async persistResults(room: IRoomState): Promise<RatingChange[]> {
    const ranked = assignPlaces(room.players);
    const userIds = ranked.map((player) => player.userId);

    const users = await this.prismaService.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, rating: true },
    });
    const ratingByUser = new Map(users.map((user) => [user.id, user.rating]));

    const deltas = calculateEloDeltas(
      ranked.map((player) => ({
        userId: player.userId,
        rating: ratingByUser.get(player.userId) ?? 1000,
        place: player.place,
      })),
    );

    const ratingChanges: RatingChange[] = ranked.map((player) => {
      const before = ratingByUser.get(player.userId) ?? 1000;
      const after = Math.max(
        ELO_MIN_RATING,
        before + (deltas.get(player.userId) ?? 0),
      );

      return { userId: player.userId, before, after, delta: after - before };
    });

    await this.prismaService.$transaction([
      this.prismaService.gameSession.create({
        data: {
          packId: room.packId,
          players: {
            create: ranked.map((player) => ({
              userId: player.userId,
              score: player.score,
              place: player.place,
            })),
          },
        },
      }),
      ...ratingChanges
        .filter((change) => change.delta !== 0)
        .map((change) =>
          this.prismaService.user.update({
            where: { id: change.userId },
            data: { rating: change.after },
          }),
        ),
    ]);

    return ratingChanges;
  }

  // ───────────────────────────── Вспомогательное ─────────────────────────────

  private emitRoomUpdated(room: IRoomState): void {
    this.io.to(room.roomId).emit('ROOM_UPDATED', toPublicRoomState(room));
  }

  private requireRoomId(client: GameSocket): string {
    const roomId = client.data.roomId;

    if (!roomId) {
      throw new GameError('ROOM_NOT_FOUND', 'Комната не найдена');
    }

    return roomId;
  }

  /**
   * Пак, на котором вообще можно играть: существует, непустой и доступен
   * этому пользователю. Приватный пак — только своему автору.
   */
  /**
   * Отбор вопросов под лимит комнаты. Подмножество берётся случайным, а не
   * первыми N: вопросы приходят из БД стабильным порядком по `id`, и «первые
   * пять» означали бы один и тот же набор в каждой партии на этом паке —
   * реванш шёл бы по уже сыгранным вопросам. Без лимита порядок не трогаем.
   */
  private selectQuestions(
    questions: IRoomQuestion[],
    limit: number | null,
  ): IRoomQuestion[] {
    if (limit === null || limit >= questions.length) return questions;

    const shuffled = [...questions];

    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Порядок внутри выбранного набора возвращаем к порядку пака: случайной
    // должна быть выборка, а не последовательность вопросов в партии.
    return shuffled
      .slice(0, limit)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private async loadPlayablePack(
    packId: string,
    userId: string,
  ): Promise<{ id: string; title: string; questionCount: number }> {
    const pack = await this.prismaService.pack.findUnique({
      where: { id: packId },
      select: {
        id: true,
        title: true,
        isPublic: true,
        authorId: true,
        _count: { select: { questions: true } },
      },
    });

    if (!pack) {
      throw new GameError('PACK_EMPTY', 'Пак не найден');
    }

    if (!pack.isPublic && pack.authorId !== userId) {
      throw new GameError('PACK_FORBIDDEN', 'Этот пак недоступен');
    }

    if (pack._count.questions === 0) {
      throw new GameError('PACK_EMPTY', 'В паке нет вопросов');
    }

    return {
      id: pack.id,
      title: pack.title,
      questionCount: pack._count.questions,
    };
  }

  private async buildPlayer(
    userId: string,
    socketId: string,
    isHost: boolean,
  ): Promise<IPlayer> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, username: true, photoUrl: true },
    });

    if (!user) {
      throw new GameError('INTERNAL', 'Пользователь не найден');
    }

    return {
      socketId,
      userId: user.id,
      username: user.username ?? user.firstName,
      photoUrl: user.photoUrl,
      score: 0,
      streak: 0,
      isHost,
      isReady: isHost,
      connected: true,
    };
  }

  /** Явный выход: игрок удаляется из комнаты независимо от статуса игры. */
  /**
   * Открепление игрока от текущей комнаты: явный выход, обрыв связи и переезд
   * в другую комнату идут одним путём. Во время партии игрок не удаляется, а
   * помечается отключённым — очки, место и рейтинг считаются так же, как если
   * бы он просто закрыл приложение. В лобби и на итогах он выбывает совсем.
   */
  private async detachFromCurrentRoom(
    client: GameSocket,
    { fromDisconnect }: { fromDisconnect: boolean },
  ): Promise<void> {
    const roomId = client.data.roomId;
    if (!roomId) return;

    const outcome = await this.roomService.withRoomLock(roomId, async () => {
      const room = await this.roomService.getRoom(roomId);
      if (!room) return null;

      const player = room.players.find(
        (candidate) => candidate.userId === client.data.userId,
      );
      if (!player) return null;

      // Сокет мог закрыться уже после реконнекта — тогда закрылся старый, и
      // трогать комнату нельзя. На явном выходе сокет актуален по определению,
      // а такая проверка молча оставила бы игрока в комнате призраком.
      if (fromDisconnect && player.socketId !== client.id) return null;

      if (room.status === 'PLAYING') {
        player.connected = false;
        player.socketId = '';
      } else {
        room.players = room.players.filter(
          (candidate) => candidate.userId !== player.userId,
        );
      }

      return this.finalizeRoomMutation(room);
    });

    client.data.roomId = undefined;

    // Покидать канал socket.io имеет смысл, только пока сокет жив.
    if (!fromDisconnect) await client.leave(roomId);

    if (!outcome) return;

    this.emitRoomUpdated(outcome.room);

    if (outcome.shouldCloseRound) {
      await this.endRound(outcome.room.roomId, outcome.room.currentQuestion);
    }
  }

  /**
   * Общий хвост изменения состава комнаты: передача роли хоста, удаление
   * опустевшей комнаты со снятием таймера и проверка «все уже ответили».
   * Вызывается внутри блокировки комнаты.
   */
  private async finalizeRoomMutation(
    room: IRoomState,
  ): Promise<{ room: IRoomState; shouldCloseRound: boolean } | null> {
    const connectedPlayers = room.players.filter((player) => player.connected);

    if (connectedPlayers.length === 0) {
      this.clearTimer(room.roomId);
      await this.roomService.deleteRoom(room.roomId);
      return null;
    }

    if (!connectedPlayers.some((player) => player.isHost)) {
      connectedPlayers[0].isHost = true;
      room.hostUserId = connectedPlayers[0].userId;
    }

    await this.roomService.saveRoom(room);

    const shouldCloseRound =
      room.status === 'PLAYING' &&
      room.roundEndsAt !== null &&
      connectedPlayers.every((player) =>
        room.answers.some((answer) => answer.userId === player.userId),
      );

    return { room, shouldCloseRound };
  }

  private setTimer(roomId: string, fn: () => void, ms: number): void {
    this.clearTimer(roomId);
    this.timers.set(roomId, setTimeout(fn, ms));
  }

  private clearTimer(roomId: string): void {
    const timer = this.timers.get(roomId);

    if (timer) {
      clearTimeout(timer);
      this.timers.delete(roomId);
    }
  }
}

/**
 * Множитель по текущей длине серии. Серия здесь — число правильных ответов
 * ДО текущего, поэтому нулевая серия даёт ×1.
 */
function streakMultiplier(streak: number): number {
  const index = Math.min(streak, STREAK_MULTIPLIERS.length - 1);

  return STREAK_MULTIPLIERS[index];
}

/** Сколько вопросов реально разыграется: лимит не может превысить пак. */
function applyQuestionLimit(packSize: number, limit: number | null): number {
  return limit === null ? packSize : Math.min(packSize, limit);
}
