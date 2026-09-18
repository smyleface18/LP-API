import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CategoryQuestion } from '@/db/entities';

// A diferencia de CreateCategoryQuestionDto, sí permite actualizar `active`:
// activar/desactivar una categoría existente es una operación de update,
// no de creación.
export class UpdateCategoryQuestionDto extends PartialType(
  OmitType(CategoryQuestion, ['id', 'createdAt', 'updatedAt', 'questions'] as const),
) {}
