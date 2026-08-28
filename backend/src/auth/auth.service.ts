import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { parse, validate } from '@tma.js/init-data-node';
import { JwtPayload } from './jwt-payload.interface';

/** Форма пользователя, которую отдаём наружу. `telegramId` (BigInt) не сериализуется в JSON. */
export interface AuthUserView {
  id: string;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
  rating: number;
}

@Injectable()
export class AuthService {
  private readonly botToken: string;
  constructor(
    private prismaService: PrismaService,
    private configService: ConfigService,
    private jwtService: JwtService,
  ) {
    this.botToken = this.configService.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
  }

  async authorizeTelegram(
    initData: string,
  ): Promise<{ token: string; user: AuthUserView }> {
    // `parse` тоже бросает на непригодном initData (например, на поле
    // `signature`, которое шлёт живой Telegram), поэтому он обязан стоять
    // внутри того же try, что и `validate` — иначе наружу уходит 500.
    let parsedData: ReturnType<typeof parse>;

    try {
      validate(initData, this.botToken, { expiresIn: 86400 });
      parsedData = parse(initData);
    } catch {
      throw new UnauthorizedException('Недействительные данные телеграмм');
    }

    const tgUser = parsedData.user;

    if (!tgUser) {
      throw new UnauthorizedException('Данные пользователя не найдены');
    }

    const user = await this.prismaService.user.upsert({
      where: { telegramId: tgUser.id },
      update: {
        firstName: tgUser.first_name,
        username: tgUser.username ?? null,
        photoUrl: tgUser.photo_url ?? null,
      },
      create: {
        telegramId: tgUser.id,
        firstName: tgUser.first_name,
        username: tgUser.username ?? null,
        photoUrl: tgUser.photo_url ?? null,
      },
    });

    const payload: JwtPayload = { userId: user.id };

    const token = this.jwtService.sign(payload);

    return {
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        username: user.username,
        photoUrl: user.photoUrl,
        rating: user.rating,
      },
    };
  }
}
