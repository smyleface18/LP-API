import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ContentType } from '@/db/enum/question.enum';

export class PresignMediaDto {
  @IsEnum(ContentType)
  contentType!: ContentType;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsOptional()
  @IsString()
  fileName?: string;
}
