import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface UserProfile {
  id: string;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
  rating: number;
  totalGames: number;
  totalPacks: number;
  wins: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
  rating: number;
  totalGames: number;
  wins: number;
}

export interface Leaderboard {
  entries: LeaderboardEntry[];
  /** Своя строка с абсолютным рангом; null — партий с соперником не было. */
  me: LeaderboardEntry | null;
}

export interface GameHistoryItem {
  gameSessionId: string;
  packTitle: string;
  score: number;
  place: number | null;
  playersCount: number;
  playedAt: string;
}

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService) {}

  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            createdPacks: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден!');
    }

    // Тренировки в счётчики не идут: в них не с кем соревноваться, и каждая
    // засчитывалась бы победой. Отсекаем по наличию хотя бы одного соперника.
    const withRivals = {
      userId,
      gameSession: { players: { some: { userId: { not: userId } } } },
    };

    const [totalGames, wins] = await Promise.all([
      this.prismaService.gamePlayer.count({ where: withRivals }),
      this.prismaService.gamePlayer.count({
        where: { ...withRivals, place: 1 },
      }),
    ]);

    return {
      id: user.id,
      firstName: user.firstName,
      username: user.username,
      photoUrl: user.photoUrl,
      rating: user.rating,
      totalGames,
      totalPacks: user._count.createdPacks,
      wins,
    };
  }

  /**
   * Глобальная таблица по ELO. В неё попадают только сыгравшие партию с живым
   * соперником: тренировка — это сессия на одного, а нетронутая стартовая
   * тысяча у ни разу не игравшего забила бы середину списка.
   *
   * Сырой SQL здесь вынужденный. В getProfile «был соперник» записано как
   * players.some({ userId: { not: userId } }), но там userId известен заранее;
   * для всех игроков сразу это корреляция с внешней строкой, которую Prisma во
   * вложенном some не выражает. Эквивалент без корреляции — «в сессии больше
   * одного игрока». Плюс ранг: ROW_NUMBER считает абсолютное место одним
   * проходом, иначе пришлось бы поднимать всю таблицу в память.
   */
  async getLeaderboard(userId: string, limit: number): Promise<Leaderboard> {
    // Сортировка добита по id: при равных рейтингах порядок иначе не определён
    // и ранг игрока менялся бы от запроса к запросу.
    const rows = await this.prismaService.$queryRaw<LeaderboardEntry[]>`
      WITH multi AS (
        SELECT "gameSessionId"
        FROM "GamePlayer"
        GROUP BY "gameSessionId"
        HAVING COUNT(*) > 1
      ), ranked AS (
        SELECT
          u."id" AS "userId",
          u."firstName" AS "firstName",
          u."username" AS "username",
          u."photoUrl" AS "photoUrl",
          u."rating" AS "rating",
          COUNT(*)::int AS "totalGames",
          COUNT(*) FILTER (WHERE gp."place" = 1)::int AS "wins",
          (ROW_NUMBER() OVER (ORDER BY u."rating" DESC, u."id"))::int AS "rank"
        FROM "User" u
        JOIN "GamePlayer" gp ON gp."userId" = u."id"
        JOIN multi ON multi."gameSessionId" = gp."gameSessionId"
        GROUP BY u."id"
      )
      SELECT *
      FROM ranked
      WHERE "rank" <= ${limit} OR "userId" = ${userId}
      ORDER BY "rank"
    `;

    return {
      entries: rows.filter((row) => row.rank <= limit),
      me: rows.find((row) => row.userId === userId) ?? null,
    };
  }

  async getHistory(userId: string, limit: number): Promise<GameHistoryItem[]> {
    const rows = await this.prismaService.gamePlayer.findMany({
      where: { userId },
      orderBy: { gameSession: { createdAt: 'desc' } },
      take: limit,
      select: {
        gameSessionId: true,
        score: true,
        place: true,
        gameSession: {
          select: {
            createdAt: true,
            pack: { select: { title: true } },
            _count: { select: { players: true } },
          },
        },
      },
    });

    return rows.map((row) => ({
      gameSessionId: row.gameSessionId,
      packTitle: row.gameSession.pack.title,
      score: row.score,
      place: row.place,
      playersCount: row.gameSession._count.players,
      playedAt: row.gameSession.createdAt.toISOString(),
    }));
  }
}
