/**
 * Тонкая обёртка над fetch. Эндпоинтов немного, поэтому библиотека запросов
 * здесь не нужна: достаточно подстановки токена и разбора ошибок Nest.
 */
import type { ApiErrorBody } from '../types/api';

/**
 * Пустое значение (режим по умолчанию) означает «API на том же origin, что и
 * фронт»: nginx контейнера проксирует /api и /socket.io на backend:3000, а в
 * dev то же делает server.proxy из vite.config.ts. Так адрес бэкенда не
 * попадает в бандл — при смене адреса туннеля фронт пересобирать не нужно.
 * Явный абсолютный адрес остаётся запасным вариантом для прямого доступа
 * к бэкенду в обход прокси.
 */
const API_ORIGIN = import.meta.env.VITE_API_URL ?? '';

/** База REST-запросов. Префикс /api существует только на стороне прокси. */
export const API_URL = API_ORIGIN === '' ? '/api' : API_ORIGIN;

/**
 * Адрес для socket.io. `undefined` = текущий origin: строку, начинающуюся
 * со слеша, socket.io принял бы за namespace, а не за адрес.
 */
export const SOCKET_URL = API_ORIGIN === '' ? undefined : API_ORIGIN;

/** Ошибка REST-запроса с сохранённым HTTP-статусом: экраны разбирают 400/422/403. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Запрос без авторизации — только `POST /auth/telegram`. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

/** Разворачивает `{ statusCode, message, error }` Nest в читаемый текст. */
function extractMessage(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body as ApiErrorBody;

    if (Array.isArray(message)) return message.join('. ');
    if (typeof message === 'string' && message.length > 0) return message;
  }

  return `Ошибка запроса (${status})`;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, anonymous = false, signal } = options;

  const headers: Record<string, string> = {};

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!anonymous && authToken) headers.Authorization = `Bearer ${authToken}`;

  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ApiError(0, 'Не удалось связаться с сервером');
  }

  if (response.status === 204) return undefined as T;

  const raw = await response.text();
  const parsed: unknown = raw.length > 0 ? safeJson(raw) : null;

  if (!response.ok) {
    throw new ApiError(response.status, extractMessage(parsed, response.status));
  }

  return parsed as T;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
