import { Injectable } from '@nestjs/common';
import { LanguageReview, LanguageReviewInput } from './language-review.types';

/**
 * Revisor de inglés de los borradores. Es también el token de inyección: el
 * módulo decide qué implementación se usa.
 *
 * `review` nunca lanza: si la revisión no está disponible (falla, timeout,
 * respuesta inválida) devuelve null y el juego sigue sin revisión.
 */
export abstract class LanguageReviewer {
  abstract review(input: LanguageReviewInput): Promise<LanguageReview | null>;
}

/**
 * Revisor falso de la Fase 2: todo texto está bien. Se reemplaza por la
 * implementación con Bedrock en la Fase 3.
 */
@Injectable()
export class NoErrorsLanguageReviewer extends LanguageReviewer {
  review(input: LanguageReviewInput): Promise<LanguageReview> {
    return Promise.resolve({
      correctedText: input.text,
      corrections: [],
      characterCorrections: [],
      flagged: false,
    });
  }
}
