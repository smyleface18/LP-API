import { IsInt, Max, Min } from 'class-validator';
import { STORY_PANELS_MAX } from '../story-game.config';

/**
 * Viñeta a la que se refiere el evento. Evita que un mensaje que llega tarde
 * (ej. después del timeout) se aplique al turno siguiente.
 */
export class PanelOrderDto {
  @IsInt()
  @Min(0)
  @Max(STORY_PANELS_MAX - 1)
  panelOrder!: number;
}
