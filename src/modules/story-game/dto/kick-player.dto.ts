import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class KickPlayerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  userId!: string;
}
