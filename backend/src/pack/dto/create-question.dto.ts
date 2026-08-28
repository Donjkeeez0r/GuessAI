import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateQuestionDto {
  @IsString()
  text!: string;

  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  options!: string[];

  @IsNumber()
  @Min(0)
  @Max(3)
  correctOption!: number;

  @IsOptional()
  @IsString()
  explanation?: string;
}
