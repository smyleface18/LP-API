import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const STORY_HISTORY_MAX_LIMIT = 50;

/** `GET /story/history?page=1&limit=20`. */
export class StoryHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STORY_HISTORY_MAX_LIMIT)
  limit: number = 20;
}
