import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class JoinStoryGameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  gameId!: string;
}
