import { parseSpeechMarks } from './speech-marks.parser';

const line = (mark: object) => JSON.stringify(mark);

describe('parseSpeechMarks', () => {
  it('keeps the word marks in order', () => {
    const text = 'Max walked home.';
    const raw = [
      line({ time: 0, type: 'sentence', start: 0, end: 16, value: text }),
      line({ time: 6, type: 'word', start: 0, end: 3, value: 'Max' }),
      line({ time: 350, type: 'word', start: 4, end: 10, value: 'walked' }),
      line({ time: 720, type: 'word', start: 11, end: 15, value: 'home' }),
    ].join('\n');

    expect(parseSpeechMarks(raw, text)).toEqual([
      { time: 6, start: 0, end: 3, value: 'Max' },
      { time: 350, start: 4, end: 10, value: 'walked' },
      { time: 720, start: 11, end: 15, value: 'home' },
    ]);
  });

  it('turns the UTF-8 byte offsets of Polly into string indexes', () => {
    // "José" ocupa 5 bytes en UTF-8 pero 4 caracteres.
    const text = 'José smiled.';
    const raw = [
      line({ time: 0, type: 'word', start: 0, end: 5, value: 'José' }),
      line({ time: 400, type: 'word', start: 6, end: 12, value: 'smiled' }),
    ].join('\n');

    const marks = parseSpeechMarks(raw, text);
    expect(marks.map(({ start, end }) => text.slice(start, end))).toEqual(['José', 'smiled']);
  });

  it('skips broken lines and offsets outside the text', () => {
    const text = 'Hi there.';
    const raw = [
      '{not json',
      line({ time: 0, type: 'word', start: 0, end: 2, value: 'Hi' }),
      line({ time: 200, type: 'word', start: 3, end: 99, value: 'there' }),
      '',
    ].join('\n');

    expect(parseSpeechMarks(raw, text)).toEqual([{ time: 0, start: 0, end: 2, value: 'Hi' }]);
  });
});
