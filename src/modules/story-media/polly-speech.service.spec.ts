import { SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { EnvsService } from '@/common/src/envs/envs.service';
import { PollySpeechService } from './polly-speech.service';

const stream = (bytes: Uint8Array, text: string) => ({
  transformToByteArray: () => Promise.resolve(bytes),
  transformToString: () => Promise.resolve(text),
});

const MARKS_NDJSON = [
  JSON.stringify({ time: 0, type: 'word', start: 0, end: 3, value: 'Max' }),
  JSON.stringify({ time: 300, type: 'word', start: 4, end: 10, value: 'walked' }),
].join('\n');

describe('PollySpeechService (Polly mocked)', () => {
  let send: jest.Mock;
  let service: PollySpeechService;

  beforeEach(() => {
    send = jest.fn((command: SynthesizeSpeechCommand) =>
      Promise.resolve(
        command.input.OutputFormat === 'mp3'
          ? { AudioStream: stream(new Uint8Array([7, 7]), ''), ContentType: 'audio/mpeg' }
          : { AudioStream: stream(new Uint8Array(), MARKS_NDJSON) },
      ),
    );
    service = new PollySpeechService(
      { send } as never,
      {
        pollyVoiceId: 'Joanna',
      } as unknown as EnvsService,
    );
  });

  it('asks for the neural audio and the word marks of the same text', async () => {
    const speech = await service.synthesize('Max walked.', 'en-US');

    expect(speech).toEqual({
      audio: new Uint8Array([7, 7]),
      contentType: 'audio/mpeg',
      speechMarks: [
        { time: 0, start: 0, end: 3, value: 'Max' },
        { time: 300, start: 4, end: 10, value: 'walked' },
      ],
    });
    const inputs = send.mock.calls.map(([command]) => (command as SynthesizeSpeechCommand).input);
    expect(inputs).toEqual([
      expect.objectContaining({
        Text: 'Max walked.',
        VoiceId: 'Joanna',
        Engine: 'neural',
        LanguageCode: 'en-US',
        OutputFormat: 'mp3',
      }),
      expect.objectContaining({ OutputFormat: 'json', SpeechMarkTypes: ['word'] }),
    ]);
  });

  it('returns null instead of throwing when Polly fails', async () => {
    send.mockRejectedValue(new Error('AccessDenied'));
    expect(await service.synthesize('Max walked.', 'en-US')).toBeNull();
  });
});
