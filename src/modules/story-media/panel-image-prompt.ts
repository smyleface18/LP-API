import { IMAGE_PROMPT_MAX_CHARS } from './story-media.config';
import { PanelImageInput } from './story-media.types';

/** Mismo estilo en todas las viñetas: es lo que las hace parecer una sola historieta. */
const STYLE =
  "Children's comic book panel, colorful cartoon illustration, clean bold outlines, " +
  'friendly expressive characters, soft lighting.';

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * Prompt de la imagen de una viñeta: estilo fijo, escenario, fichas de los
 * personajes (para que se vean parecidos en todas) y lo que pasa. Se recorta
 * la acción, que es lo último, si no entra en IMAGE_PROMPT_MAX_CHARS.
 */
export function buildPanelImagePrompt({ scene, text, characters }: PanelImageInput): string {
  const cast = characters
    .map(
      ({ name, kind, description }) => `${clean(name)} is a ${clean(kind)}: ${clean(description)}`,
    )
    .join('. ');
  const head = [STYLE, `Setting: ${clean(scene)}.`, cast && `Characters: ${cast}.`]
    .filter(Boolean)
    .join(' ');

  const action = `Action: ${clean(text)}`;
  const room = IMAGE_PROMPT_MAX_CHARS - head.length - 1;
  if (room <= 'Action: '.length) return head.slice(0, IMAGE_PROMPT_MAX_CHARS);
  return `${head} ${action.length > room ? action.slice(0, room) : action}`;
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
