import { IsEnum, IsOptional } from 'class-validator';
import { Level } from '@/db/enum/question.enum';
import { StoryHistoryQueryDto } from './story-history-query.dto';

/** `GET /story/catalog?page=1&limit=20&level=A2`. */
export class StoryCatalogQueryDto extends StoryHistoryQueryDto {
  @IsOptional()
  @IsEnum(Level)
  level?: Level;
}
