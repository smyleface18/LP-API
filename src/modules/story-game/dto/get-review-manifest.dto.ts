import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Partida cuyo review se pide (`storyId`/`gameId` de `storyReviewReady`). */
export class GetReviewManifestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  gameId!: string;
}
