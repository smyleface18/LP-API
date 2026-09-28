import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Level } from '@/db/enum/question.enum';
import { StoryHistoryQueryDto } from './story-history-query.dto';
import { STORY_SEARCH_MAX_CHARS } from './story-admin.dto';

/** `level=A1,A2` (o `level=A1&level=A2`) → `['A1', 'A2']`. */
const toList = ({ value }: { value: unknown }) => {
  const values: unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return values
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
};

/** `GET /story/catalog?page=1&limit=20&level=A1,A2&search=robot`. */
export class StoryCatalogQueryDto extends StoryHistoryQueryDto {
  /** Uno o más niveles CEFR; sin definir, todos. */
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(Object.values(Level).length)
  @IsEnum(Level, { each: true })
  level?: Level[];

  /** Busca en el título, los nombres de los jugadores y el texto de las viñetas. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(STORY_SEARCH_MAX_CHARS)
  search?: string;
}
