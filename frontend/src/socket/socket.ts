/**
 * Единственный сокет приложения. Живёт в модуле, а не в компоненте:
 * при перемонтировании экранов соединение и подписки не пересоздаются.
 */
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { SOCKET_URL } from '../api/client';
import type { ClientToServerEvents, ServerToClientEvents } from '../types/api';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

/** Создаёт сокет (или возвращает уже созданный) с токеном в handshake. */
export function connectSocket(token: string): GameSocket {
  if (socket) return socket;

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });

  return socket;
}

export function getSocket(): GameSocket | null {
  return socket;
}

/**
 * Отправляет событие, если сокет есть. Возвращает `false`, когда соединения
 * нет — вызывающий код показывает пользователю понятное сообщение.
 */
export function emit<E extends keyof ClientToServerEvents>(
  event: E,
  ...args: Parameters<ClientToServerEvents[E]>
): boolean {
  if (!socket) return false;

  socket.emit(event, ...args);

  return true;
}

export function disconnectSocket(): void {
  if (!socket) return;

  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}
