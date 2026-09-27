import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CHARACTER_LIMITS } from '../story-game.config';
import { CharacterSheet } from '../domain/story-game.types';

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Ficha corta de un personaje nuevo, en inglés. */
export class CharacterSheetDto implements CharacterSheet {
  /** "Max". */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHARACTER_LIMITS.name)
  name!: string;

  /** "dog", "girl", "robot"... */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHARACTER_LIMITS.kind)
  kind!: string;

  /** Aspecto en una línea: "small brown dog with a red collar". */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHARACTER_LIMITS.description)
  description!: string;
}
