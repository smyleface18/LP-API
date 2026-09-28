import { SpeechMark } from './story-media.types';

interface RawSpeechMark {
  time: number;
  type: string;
  start: number;
  end: number;
  value: string;
}

/**
 * Posición en caracteres (UTF-16, como indexa JS) de cada offset en bytes
 * UTF-8 del texto. Polly da `start`/`end` en bytes: con tildes o emojis no
 * coinciden con los índices del string que resalta el cliente.
 */
function byteToCharOffsets(text: string): Map<number, number> {
  const offsets = new Map<number, number>([[0, 0]]);
  let bytes = 0;
  let chars = 0;
  for (const codePoint of text) {
    bytes += Buffer.byteLength(codePoint, 'utf8');
    chars += codePoint.length;
    offsets.set(bytes, chars);
  }
  return offsets;
}

/**
 * Speech marks de Polly (`OutputFormat: json`): una línea JSON por marca. Se
 * quedan las de tipo `word`, con los offsets pasados a caracteres de `text`.
 * Una línea inválida se descarta, no invalida el resto.
 */
export function parseSpeechMarks(raw: string, text: string): SpeechMark[] {
  const offsets = byteToCharOffsets(text);
  const marks: SpeechMark[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let mark: RawSpeechMark;
    try {
      mark = JSON.parse(line) as RawSpeechMark;
    } catch {
      continue;
    }
    if (mark.type !== 'word') continue;
    const start = offsets.get(mark.start);
    const end = offsets.get(mark.end);
    if (start === undefined || end === undefined) continue;
    marks.push({ time: mark.time, start, end, value: mark.value });
  }

  return marks;
}
