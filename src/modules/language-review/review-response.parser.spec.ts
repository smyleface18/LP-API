import { Level } from '@/db/enum/question.enum';
import { InvalidReviewResponseError, parseReviewResponse } from './review-response.parser';
import { LanguageReviewInput } from './language-review.types';

const input: LanguageReviewInput = {
  text: 'The dog go to the park yesterday.',
  scene: 'A park',
  level: Level.A2,
  storySoFar: [],
  cast: [],
  newCharacters: [{ name: 'Rex', kind: 'dog', description: 'a big brwn dog' }],
};

const valid = {
  correctedText: 'The dog went to the park yesterday.',
  corrections: [
    {
      original: 'go',
      suggestion: 'went',
      type: 'grammar',
      explanation: 'Con "yesterday" se usa el pasado.',
    },
  ],
  characterCorrections: [
    {
      characterIndex: 0,
      field: 'description',
      original: 'brwn',
      suggestion: 'brown',
      explanation: 'Ortografía.',
    },
  ],
  flagged: false,
};

describe('parseReviewResponse', () => {
  it('accepts a valid response', () => {
    expect(parseReviewResponse(JSON.stringify(valid), input)).toEqual(valid);
  });

  it('tolerates a ```json block around the object', () => {
    const raw = '```json\n' + JSON.stringify(valid) + '\n```';
    expect(parseReviewResponse(raw, input)).toEqual(valid);
  });

  it.each([
    ['not JSON', 'Sure! Here is the review.'],
    ['malformed JSON', '{"correctedText": "x", '],
    ['missing flagged', JSON.stringify({ ...valid, flagged: undefined })],
    ['empty correctedText', JSON.stringify({ ...valid, correctedText: ' ' })],
    ['corrections not an array', JSON.stringify({ ...valid, corrections: 'none' })],
    [
      'unknown correction type',
      JSON.stringify({ ...valid, corrections: [{ ...valid.corrections[0], type: 'style' }] }),
    ],
    [
      'bad character correction',
      JSON.stringify({
        ...valid,
        characterCorrections: [{ ...valid.characterCorrections[0], field: 'age' }],
      }),
    ],
  ])('rejects %s', (_, raw) => {
    expect(() => parseReviewResponse(raw, input)).toThrow(InvalidReviewResponseError);
  });

  it('drops corrections whose original is not in the text (they would cost points)', () => {
    const raw = JSON.stringify({
      ...valid,
      corrections: [
        ...valid.corrections,
        { original: 'goes', suggestion: 'went', type: 'grammar', explanation: '...' },
        { original: 'park', suggestion: 'park', type: 'spelling', explanation: 'no-op' },
      ],
    });
    expect(parseReviewResponse(raw, input).corrections).toEqual(valid.corrections);
  });

  it('keeps the original text when there are no corrections (no style rewrites)', () => {
    const raw = JSON.stringify({
      ...valid,
      correctedText: 'Yesterday, the dog went to the lovely park.',
      corrections: [],
    });
    expect(parseReviewResponse(raw, input).correctedText).toBe(input.text);
  });

  it('drops character corrections for unknown characters or fragments', () => {
    const raw = JSON.stringify({
      ...valid,
      characterCorrections: [
        ...valid.characterCorrections,
        { ...valid.characterCorrections[0], characterIndex: 3 },
        { ...valid.characterCorrections[0], original: 'purple' },
      ],
    });
    expect(parseReviewResponse(raw, input).characterCorrections).toEqual(
      valid.characterCorrections,
    );
  });

  it('defaults a missing characterCorrections to empty', () => {
    const raw = JSON.stringify({ ...valid, characterCorrections: undefined });
    expect(parseReviewResponse(raw, input).characterCorrections).toEqual([]);
  });

  it('passes flagged through', () => {
    const raw = JSON.stringify({ ...valid, corrections: [], flagged: true });
    expect(parseReviewResponse(raw, input).flagged).toBe(true);
  });
});
