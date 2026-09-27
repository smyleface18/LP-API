import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  STORY_LANGUAGES,
  STORY_LEVELS,
  STORY_PANELS_MAX,
  STORY_PANELS_MIN,
  STORY_TURN_DURATIONS_SEC,
  StoryLanguage,
  StoryLevel,
  StoryTurnDurationSec,
} from '../story-game.config';

/** Cambios parciales de la configuración; lo que no se envía se mantiene. */
export class UpdateConfigDto {
  @IsOptional()
  @IsInt()
  @Min(STORY_PANELS_MIN)
  @Max(STORY_PANELS_MAX)
  panelsCount?: number;

  @IsOptional()
  @IsIn(STORY_TURN_DURATIONS_SEC)
  turnDurationSec?: StoryTurnDurationSec;

  @IsOptional()
  @IsIn(STORY_LEVELS)
  level?: StoryLevel;

  @IsOptional()
  @IsIn(STORY_LANGUAGES)
  language?: StoryLanguage;

  /** Los demás ven los borradores revisados del autor (`panelDraftReviewed`). */
  @IsOptional()
  @IsBoolean()
  shareDrafts?: boolean;
}
