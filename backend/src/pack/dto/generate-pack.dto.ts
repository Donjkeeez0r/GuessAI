import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class GeneratePackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  topic!: string;
}
