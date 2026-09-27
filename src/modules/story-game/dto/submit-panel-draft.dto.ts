import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_CHARACTERS_PER_PANEL,
  MAX_CHARS_PER_PANEL,
  MAX_CHARS_PER_SCENE,
  MAX_NEW_CHARACTERS_PER_PANEL,
} from '../story-game.config';
import { CharacterSheetDto, trim } from './character-sheet.dto';
import { PanelOrderDto } from './panel-order.dto';

/**
 * Borrador de una viñeta. Forma y largos se validan acá; las reglas que
 * dependen del estado (mínimo de palabras, elenco, nombres) en el servicio.
 */
export class SubmitPanelDraftDto extends PanelOrderDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CHARS_PER_PANEL)
  text!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CHARS_PER_SCENE)
  scene!: string;

  /** Personajes del elenco que aparecen. Puede estar vacío (ej. un paisaje). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CHARACTERS_PER_PANEL)
  @IsString({ each: true })
  characterIds: string[] = [];

  /** Personajes nuevos: entran al elenco recién al confirmar. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_NEW_CHARACTERS_PER_PANEL)
  @ValidateNested({ each: true })
  @Type(() => CharacterSheetDto)
  newCharacters: CharacterSheetDto[] = [];
}
