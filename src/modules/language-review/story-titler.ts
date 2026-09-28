import { Injectable } from '@nestjs/common';

/** Lo que hace falta para titular una historieta terminada. */
export interface StoryTitleInput {
  /** Texto final (corregido) de cada viñeta, en orden. */
  panels: string[];
  /** Nombres de los personajes del elenco. */
  characters: string[];
}

/**
 * Pone el título de una historieta terminada. Es también el token de
 * inyección: el módulo decide qué implementación se usa.
 *
 * `title` nunca lanza: si no hay título (falla, timeout, respuesta inválida)
 * devuelve null y la historieta se guarda sin título.
 */
export abstract class StoryTitler {
  abstract title(input: StoryTitleInput): Promise<string | null>;
}

/** Sin títulos (tests y desarrollo local sin Bedrock). */
@Injectable()
export class NoStoryTitler extends StoryTitler {
  title(): Promise<null> {
    return Promise.resolve(null);
  }
}
