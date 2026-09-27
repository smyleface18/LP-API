import { ConverseCommand, ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { EnvsService } from '@/common/src/envs/envs.service';
import { Level } from '@/db/enum/question.enum';
import { LanguageReviewService } from './language-review.service';
import { LanguageReviewInput } from './language-review.types';
import { REVIEW_TIMEOUT_MS } from './language-review.config';

const MODEL_ID = 'us.amazon.nova-2-lite-v1:0';

const input: LanguageReviewInput = {
  text: 'The dog go to the park yesterday.',
  scene: 'A park',
  level: Level.B1,
  storySoFar: ['Once upon a time there was a dog.'],
  cast: [{ name: 'Rex', kind: 'dog', description: 'big brown dog' }],
  newCharacters: [],
};

const review = {
  correctedText: 'The dog went to the park yesterday.',
  corrections: [
    { original: 'go', suggestion: 'went', type: 'grammar', explanation: 'Pasado con yesterday.' },
  ],
  characterCorrections: [],
  flagged: false,
};

const answer = (text: string) =>
  ({
    output: { message: { role: 'assistant', content: [{ text }] } },
  }) as ConverseCommandOutput;

/** Una llamada a Bedrock que nunca responde, salvo que la aborten. */
const hanging = (_command: unknown, options?: { abortSignal?: AbortSignal }) =>
  new Promise((_, reject) => {
    options?.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('LanguageReviewService (Bedrock mocked)', () => {
  let send: jest.Mock;
  let envs: { bedrockReviewModelId: string | undefined };
  let service: LanguageReviewService;

  beforeEach(() => {
    send = jest.fn();
    envs = { bedrockReviewModelId: MODEL_ID };
    service = new LanguageReviewService({ send } as never, envs as unknown as EnvsService);
  });

  afterEach(() => jest.useRealTimers());

  it('returns the validated review', async () => {
    send.mockResolvedValue(answer(JSON.stringify(review)));
    await expect(service.review(input)).resolves.toEqual(review);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('calls the Converse API with the configured model, temperature 0 and the prompt for the level', async () => {
    send.mockResolvedValue(answer(JSON.stringify(review)));
    await service.review(input);

    const [command, options] = send.mock.calls[0] as [
      ConverseCommand,
      { abortSignal: AbortSignal },
    ];
    expect(command).toBeInstanceOf(ConverseCommand);
    expect(command.input.modelId).toBe(MODEL_ID);
    expect(command.input.inferenceConfig?.temperature).toBe(0);
    expect(command.input.system?.[0].text).toContain('CEFR level B1');
    const payload = JSON.parse(command.input.messages![0].content![0].text!) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      text: input.text,
      scene: 'A park',
      storySoFar: input.storySoFar,
      existingCharacters: input.cast,
      newCharacters: [],
    });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('retries once when the response is not valid JSON', async () => {
    send
      .mockResolvedValueOnce(answer('Here is my review: the dog...'))
      .mockResolvedValueOnce(answer(JSON.stringify(review)));
    await expect(service.review(input)).resolves.toEqual(review);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('returns null when the response is still invalid after the retry', async () => {
    send.mockResolvedValue(answer('{"correctedText": '));
    await expect(service.review(input)).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retries once when Bedrock fails, then gives up with null', async () => {
    send.mockRejectedValue(new Error('ThrottlingException'));
    await expect(service.review(input)).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it(`returns null after ${REVIEW_TIMEOUT_MS} ms, without a retry`, async () => {
    jest.useFakeTimers();
    send.mockImplementation(hanging);

    const result = service.review(input);
    await jest.advanceTimersByTimeAsync(REVIEW_TIMEOUT_MS);

    await expect(result).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('the timeout covers the retry too (total budget)', async () => {
    jest.useFakeTimers();
    send
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, REVIEW_TIMEOUT_MS - 1_000));
        return answer('not json');
      })
      .mockImplementationOnce(hanging);

    const result = service.review(input);
    await jest.advanceTimersByTimeAsync(REVIEW_TIMEOUT_MS);

    await expect(result).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('wins the race even if the client ignores the abort signal', async () => {
    jest.useFakeTimers();
    send.mockImplementation(() => new Promise(() => undefined));

    const result = service.review(input);
    await jest.advanceTimersByTimeAsync(REVIEW_TIMEOUT_MS);
    await expect(result).resolves.toBeNull();
  });

  it('returns null without calling Bedrock when BEDROCK_REVIEW_MODEL_ID is not set', async () => {
    envs.bedrockReviewModelId = undefined;
    await expect(service.review(input)).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
