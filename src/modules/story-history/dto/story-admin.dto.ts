import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { StoryRemovalReason, StoryVisibility } from '@/db/enum/story.enum';
import { StoryHistoryQueryDto } from './story-history-query.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const STORY_SEARCH_MAX_CHARS = 100;
export const STORY_REMOVAL_NOTE_MAX_CHARS = 500;

/** `GET /admin/stories?page&limit&visibility&search`. */
export class AdminStoriesQueryDto extends StoryHistoryQueryDto {
  /** Sin definir: todas (publicadas y quitadas). */
  @IsOptional()
  @IsEnum(StoryVisibility)
  visibility?: StoryVisibility;

  /** Busca en el título, el código de la partida, los jugadores y el texto de las viñetas. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(STORY_SEARCH_MAX_CHARS)
  search?: string;
}

/** `POST /admin/stories/:storyId/remove`. */
export class RemoveStoryDto {
  @IsEnum(StoryRemovalReason)
  reason!: StoryRemovalReason;

  /** Obligatoria con el motivo OTHER. */
  @ValidateIf((dto: RemoveStoryDto) => dto.reason === StoryRemovalReason.OTHER || !!dto.note)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(STORY_REMOVAL_NOTE_MAX_CHARS)
  note?: string;
}
