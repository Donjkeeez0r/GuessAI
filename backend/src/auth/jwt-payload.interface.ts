import type { Request } from 'express';

/** Полезная нагрузка JWT. Ничего, кроме идентификатора пользователя, туда не кладём. */
export interface JwtPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

/** Express-запрос после `JwtAuthGuard`: личность берём только отсюда. */
export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
