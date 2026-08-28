import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import type { AuthenticatedRequest } from '../auth/jwt-payload.interface';

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;
const DEFAULT_LEADERBOARD_LIMIT = 50;
const MAX_LEADERBOARD_LIMIT = 100;

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.usersService.getProfile(req.user.userId);
  }

  @Get('me/history')
  getHistory(@Req() req: AuthenticatedRequest, @Query('limit') limit?: string) {
    return this.usersService.getHistory(
      req.user.userId,
      normalizeLimit(limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT),
    );
  }

  @Get('leaderboard')
  getLeaderboard(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.getLeaderboard(
      req.user.userId,
      normalizeLimit(limit, DEFAULT_LEADERBOARD_LIMIT, MAX_LEADERBOARD_LIMIT),
    );
  }
}

function normalizeLimit(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return Math.min(Math.floor(parsed), max);
}
