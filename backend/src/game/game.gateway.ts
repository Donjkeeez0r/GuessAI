import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { GameService } from './game.service';
import { GameError } from './game.types';
import type { GameSocket } from './game.types';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Тонкий транспортный слой: проверяет токен на handshake, разбирает payload
 * и передаёт всё в `GameService`. Игровой логики здесь нет.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(GameGateway.name);

  constructor(
    private readonly gameService: GameService,
    private readonly jwtService: JwtService,
  ) {}

  afterInit(server: Server): void {
    this.gameService.setServer(server);
  }

  async handleConnection(client: GameSocket): Promise<void> {
    const token = extractToken(client);

    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      if (typeof payload.userId !== 'string' || payload.userId.length === 0) {
        client.disconnect();
        return;
      }

      client.data.userId = payload.userId;
    } catch {
      client.disconnect();
    }
  }

  async handleDisconnect(client: GameSocket): Promise<void> {
    try {
      await this.gameService.handleDisconnect(client);
    } catch (error) {
      this.logger.error(
        `Ошибка при отключении сокета ${client.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  @SubscribeMessage('CREATE_ROOM')
  async handleCreateRoom(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    await this.run(client, async () => {
      const packId = readString(payload, 'packId');
      const isPublic = readBoolean(payload, 'isPublic');

      if (!packId) {
        throw new GameError('PACK_EMPTY', 'Не передан идентификатор пака');
      }

      await this.gameService.createRoom(client, packId, isPublic);
    });
  }

  @SubscribeMessage('JOIN_ROOM')
  async handleJoinRoom(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    await this.run(client, async () => {
      const roomId = readString(payload, 'roomId');

      if (!roomId) {
        throw new GameError('ROOM_NOT_FOUND', 'Не передан код комнаты');
      }

      await this.gameService.joinRoom(client, roomId);
    });
  }

  @SubscribeMessage('QUICK_MATCH')
  async handleQuickMatch(@ConnectedSocket() client: GameSocket): Promise<void> {
    await this.run(client, () => this.gameService.quickMatch(client));
  }

  @SubscribeMessage('TOGGLE_READY')
  async handleToggleReady(
    @ConnectedSocket() client: GameSocket,
  ): Promise<void> {
    await this.run(client, () => this.gameService.toggleReady(client));
  }

  @SubscribeMessage('LEAVE_ROOM')
  async handleLeaveRoom(@ConnectedSocket() client: GameSocket): Promise<void> {
    await this.run(client, () => this.gameService.leaveRoom(client));
  }

  @SubscribeMessage('START_GAME')
  async handleStartGame(@ConnectedSocket() client: GameSocket): Promise<void> {
    await this.run(client, () => this.gameService.startGame(client));
  }

  @SubscribeMessage('SOLO_GAME')
  async handleSoloGame(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    await this.run(client, async () => {
      const packId = readString(payload, 'packId');

      if (!packId) {
        throw new GameError('PACK_EMPTY', 'Не передан идентификатор пака');
      }

      await this.gameService.soloGame(client, packId);
    });
  }

  @SubscribeMessage('CHANGE_PACK')
  async handleChangePack(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    await this.run(client, async () => {
      const packId = readString(payload, 'packId');

      if (!packId) {
        throw new GameError('PACK_EMPTY', 'Не передан идентификатор пака');
      }

      await this.gameService.changePack(client, packId);
    });
  }

  @SubscribeMessage('CHANGE_SETTINGS')
  async handleChangeSettings(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    await this.run(client, async () => {
      // `null` у questionLimit — это «весь пак», а не «поле не передано»,
      // поэтому читаем сырое свойство: readNumber их не различает.
      const rawLimit = readProperty(payload, 'questionLimit');
      const rawDuration = readNumber(payload, 'roundDurationMs');

      const settings: {
        questionLimit?: number | null;
        roundDurationMs?: number;
      } = {};

      if (rawLimit === null) {
        settings.questionLimit = null;
      } else if (typeof rawLimit === 'number' && Number.isFinite(rawLimit)) {
        settings.questionLimit = rawLimit;
      }

      if (rawDuration !== null) {
        settings.roundDurationMs = rawDuration;
      }

      if (Object.keys(settings).length === 0) return;

      await this.gameService.changeSettings(client, settings);
    });
  }

  @SubscribeMessage('REMATCH')
  async handleRematch(@ConnectedSocket() client: GameSocket): Promise<void> {
    await this.run(client, () => this.gameService.rematch(client));
  }

  @SubscribeMessage('SUBMIT_ANSWER')
  async handleSubmitAnswer(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    await this.run(client, async () => {
      const optionIndex = readNumber(payload, 'optionIndex');

      if (optionIndex === null) return;

      await this.gameService.submitAnswer(client, optionIndex);
    });
  }

  /** Превращает `GameError` в событие `ERROR`, остальное — в `INTERNAL`. */
  private async run(
    client: GameSocket,
    action: () => Promise<void>,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (error instanceof GameError) {
        client.emit('ERROR', { code: error.code, message: error.message });
        return;
      }

      this.logger.error(
        `Необработанная ошибка в сокет-событии (${client.id})`,
        error instanceof Error ? error.stack : String(error),
      );
      client.emit('ERROR', {
        code: 'INTERNAL',
        message: 'Внутренняя ошибка сервера',
      });
    }
  }
}

/**
 * Токен берём из `handshake.auth.token` (единственный путь для браузерного
 * socket.io на websocket-транспорте) либо из заголовка `authorization`.
 */
function extractToken(client: GameSocket): string | null {
  const fromAuth = readString(client.handshake.auth, 'token');
  const header = client.handshake.headers.authorization;
  const raw = fromAuth ?? (typeof header === 'string' ? header : null);

  if (!raw) return null;

  const trimmed = raw.trim();

  return trimmed.toLowerCase().startsWith('bearer ')
    ? trimmed.slice(7).trim()
    : trimmed;
}

function readProperty(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined;

  return (source as Record<string, unknown>)[key];
}

function readString(source: unknown, key: string): string | null {
  const value = readProperty(source, key);

  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readBoolean(source: unknown, key: string): boolean {
  return readProperty(source, key) === true;
}

function readNumber(source: unknown, key: string): number | null {
  const value = readProperty(source, key);

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
