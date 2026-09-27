import { ValidationError, ValidationPipe } from '@nestjs/common';
import { StoryError } from './domain/story-game.errors';

function collectMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...collectMessages(error.children ?? []),
  ]);
}

/**
 * ValidationPipe del namespace /story. El pipe global de main.ts no aplica a
 * los gateways; los errores salen como StoryError('VALIDATION_ERROR') y el
 * filtro los emite por `storyError` con el formato { ok, status, message, code }.
 */
export function createStoryValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new StoryError('VALIDATION_ERROR', collectMessages(errors)),
  });
}
