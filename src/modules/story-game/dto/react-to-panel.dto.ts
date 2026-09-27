import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { STORY_REACTIONS, StoryReaction } from '../story-game.config';
import { PanelOrderDto } from './panel-order.dto';

/**
 * Reacción a una viñeta confirmada. `emoji: null` quita la reacción. `gameId`
 * es opcional: sin él se usa la partida activa del usuario; con él se puede
 * reaccionar en el review, cuando la partida ya no es la activa.
 */
export class ReactToPanelDto extends PanelOrderDto {
  @ValidateIf((dto: ReactToPanelDto) => dto.emoji !== null)
  @IsIn(STORY_REACTIONS)
  emoji!: StoryReaction | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  gameId?: string;
}
