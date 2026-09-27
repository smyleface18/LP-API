import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CHARACTER_LIMITS } from '../story-game.config';
import { CharacterSheet } from '../domain/story-game.types';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Ficha del personaje, en inglés. No pasa por revisión de IA en esta versión. */
export class CreateCharacterDto implements CharacterSheet {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHARACTER_LIMITS.name)
  name!: string;

  /** Ej. "girl", "robot", "cat". */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHARACTER_LIMITS.type)
  type!: string;

  /** Rasgo físico. */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHARACTER_LIMITS.trait)
  trait!: string;

  /** Ropa y color. */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHARACTER_LIMITS.clothing)
  clothing!: string;

  /** Detalle único. */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHARACTER_LIMITS.detail)
  detail!: string;
}
