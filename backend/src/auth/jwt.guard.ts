import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthenticatedRequest, JwtPayload } from './jwt-payload.interface';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);
    if (!token) throw new UnauthorizedException('Токен не найден');

    try {
      // Секрет подставляется глобальным JwtModule, второго источника правды нет.
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      if (typeof payload.userId !== 'string' || payload.userId.length === 0) {
        throw new UnauthorizedException('Невалидный токен');
      }

      request.user = payload;
    } catch {
      throw new UnauthorizedException('Невалидный токен');
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
