import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AiRequestDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(128)
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(8000)
  prompt!: string;
}

export class SetLimitDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limit!: number;
}
