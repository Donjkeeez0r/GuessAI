import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { TelegramLoginDto } from './dto/telegram-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('telegram')
  loginWithTelegram(@Body() dto: TelegramLoginDto) {
    return this.authService.authorizeTelegram(dto.initData);
  }
}
