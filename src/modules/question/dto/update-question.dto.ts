import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Question } from '@/db/entities';

// A diferencia de CreateQuestionDto, sí permite actualizar `active`:
// activar/desactivar una pregunta existente es una operación de update,
// no de creación.
export class UpdateQuestionDto extends PartialType(
  OmitType(Question, [
    'id',
    'createdAt',
    'updatedAt',
    'options',
    'games',
    'category',
    'media',
  ] as const),
) {}
