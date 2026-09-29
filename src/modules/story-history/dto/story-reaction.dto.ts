import { IsIn, ValidateIf } from 'class-validator';
import { STORY_REACTIONS } from '@/modules/story-game/story-game.config';

/** `PUT /story/catalog/:storyId/panels/:order/reaction`. */
export class PanelReactionDto {
  /** Una de las reacciones permitidas, o null para quitar la propia. */
  @ValidateIf((_, value) => value !== null)
  @IsIn([...STORY_REACTIONS])
  emoji!: string | null;
}
