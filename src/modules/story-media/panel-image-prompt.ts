import {
  IMAGE_PROMPT_MAX_CHARS,
  PROMPT_MAX_CHARACTERS,
  PROMPT_MAX_CHARACTER_CHARS,
  PROMPT_MAX_SCENE_CHARS,
} from './story-media.config';
import { PanelImageInput } from './story-media.types';

/**
 * Mismo estilo en todas las viñetas: es lo que las hace parecer una sola
 * historieta. FLUX no admite prompt negativo, así que el "sin texto" va acá.
 */
export const PANEL_STYLE =
  "Children's comic book panel, wordless illustration, no text, no speech bubbles, " +
  'colorful cartoon illustration, clean bold outlines, friendly expressive characters, ' +
  'soft lighting.';

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Recorta `value` a `max` caracteres (con "…" si se cortó). */
const cap = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

/**
 * Prompt de la imagen de una viñeta: estilo fijo, escenario, fichas de los
 * personajes (para que se vean parecidos en todas) y lo que pasa.
 *
 * Cada parte tiene su tope (escenario, cada ficha y cantidad de personajes),
 * elegido para que el estilo, el escenario y las fichas siempre entren en
 * IMAGE_PROMPT_MAX_CHARS: lo único que se recorta para llegar al límite es la
 * acción, que va al final.
 */
export function buildPanelImagePrompt({ scene, text, characters }: PanelImageInput): string {
  const cast = characters
    .slice(0, PROMPT_MAX_CHARACTERS)
    .map(({ name, kind, description }) =>
      cap(`${clean(name)} is a ${clean(kind)}: ${clean(description)}`, PROMPT_MAX_CHARACTER_CHARS),
    )
    .join('. ');
  const head = [
    PANEL_STYLE,
    `Setting: ${cap(clean(scene), PROMPT_MAX_SCENE_CHARS)}.`,
    cast && `Characters: ${cast}.`,
  ]
    .filter(Boolean)
    .join(' ');

  const action = `Action: ${clean(text)}`;
  const room = IMAGE_PROMPT_MAX_CHARS - head.length - 1;
  return `${head} ${action.length > room ? cap(action, room) : action}`;
}

/**
 * Semilla fija por partida (0 a 858993459), a partir del `gameId`: todas las
 * viñetas de una historieta se dibujan con la misma y comparten estilo.
 */
export function seedForGame(gameId: string): number {
  let hash = 0;
  for (let i = 0; i < gameId.length; i++) hash = (hash * 31 + gameId.charCodeAt(i)) >>> 0;
  return hash % 858_993_460;
}
