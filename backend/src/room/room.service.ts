import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { IRoomState } from './room.types';

const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_ID_LENGTH = 6;
const ROOM_ID_ATTEMPTS = 10;

/**
 * Хранилище комнат в Redis. Здесь нет игровой логики — только чтение,
 * запись, реестр публичных лобби и сериализация по комнате.
 */
@Injectable()
export class RoomService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly ttlSeconds: number;
  /**
   * Очередь операций по каждой комнате. Состояние читается и пишется целиком,
   * поэтому два параллельных сокет-события без сериализации потеряли бы запись.
   */
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private configService: ConfigService) {
    this.redis = new Redis(
      this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
    );
    this.ttlSeconds = Number(
      this.configService.get<string>('ROOM_TTL_SECONDS') ?? 7200,
    );
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  private roomKey(roomId: string): string {
    return `room:${roomId}`;
  }

  private get publicSetKey(): string {
    return 'rooms:public';
  }

  /** Сериализует операции над одной комнатой: read-modify-write не пересекаются. */
  async withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(roomId) ?? Promise.resolve();
    const current = previous.then(fn, fn);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(roomId, tail);

    try {
      return await current;
    } finally {
      if (this.locks.get(roomId) === tail) {
        this.locks.delete(roomId);
      }
    }
  }

  /** Генерирует свободный 6-символьный код комнаты. */
  async generateRoomId(): Promise<string> {
    for (let attempt = 0; attempt < ROOM_ID_ATTEMPTS; attempt++) {
      let roomId = '';
      for (let i = 0; i < ROOM_ID_LENGTH; i++) {
        roomId +=
          ROOM_ID_ALPHABET[Math.floor(Math.random() * ROOM_ID_ALPHABET.length)];
      }

      const exists = await this.redis.exists(this.roomKey(roomId));
      if (exists === 0) {
        return roomId;
      }
    }

    throw new Error('Не удалось подобрать свободный код комнаты');
  }

  async getRoom(roomId: string): Promise<IRoomState | null> {
    const data = await this.redis.get(this.roomKey(roomId));

    if (!data) return null;

    return normalizeRoom(JSON.parse(data) as IRoomState);
  }

  async saveRoom(room: IRoomState): Promise<void> {
    await this.redis.set(
      this.roomKey(room.roomId),
      JSON.stringify(room),
      'EX',
      this.ttlSeconds,
    );
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.redis.del(this.roomKey(roomId));
    await this.redis.srem(this.publicSetKey, roomId);
  }

  async addPublicRoom(roomId: string): Promise<void> {
    await this.redis.sadd(this.publicSetKey, roomId);
  }

  async removePublicRoom(roomId: string): Promise<void> {
    await this.redis.srem(this.publicSetKey, roomId);
  }

  /**
   * Случайное публичное лобби, готовое принять игрока.
   * Протухшие записи (комната удалена или уже играет) чистит на ходу.
   */
  async findPublicLobby(excludeUserId: string): Promise<IRoomState | null> {
    const candidates = await this.redis.smembers(this.publicSetKey);

    for (const roomId of shuffle(candidates)) {
      const room = await this.getRoom(roomId);

      if (!room) {
        await this.removePublicRoom(roomId);
        continue;
      }

      if (room.status !== 'LOBBY') {
        await this.removePublicRoom(roomId);
        continue;
      }

      if (room.players.some((player) => player.userId === excludeUserId)) {
        continue;
      }

      return room;
    }

    return null;
  }
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Комнаты живут в Redis до двух часов и переживают выкатку новой версии.
 * Запись, сериализованная до появления поля, вернулась бы с `undefined` —
 * а `Math.min(packSize, undefined)` даёт `NaN` и ломает счётчик вопросов.
 * Поэтому недостающие поля добираются здесь, в единственной точке чтения.
 */
function normalizeRoom(room: IRoomState): IRoomState {
  room.questionLimit = room.questionLimit ?? null;
  room.packQuestionCount = room.packQuestionCount ?? room.totalQuestions;
  room.players.forEach((player) => {
    player.streak = player.streak ?? 0;
  });

  return room;
}
