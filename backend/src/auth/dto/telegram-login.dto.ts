import { IsNotEmpty, IsString } from 'class-validator';

export class TelegramLoginDto {
  @IsString()
  @IsNotEmpty()
  initData!: string;
}
