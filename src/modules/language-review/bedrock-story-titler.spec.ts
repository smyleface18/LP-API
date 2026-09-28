import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { EnvsService } from '@/common/src/envs/envs.service';
import { BedrockStoryTitler, cleanStoryTitle } from './bedrock-story-titler';
import { BedrockClient } from './language-review.service';
import { STORY_TITLE_MAX_CHARS } from './language-review.config';
import { STORY_TITLE_SYSTEM_PROMPT } from './prompts/story-title-prompt.v1';

const INPUT = {
  panels: ['Max found a shiny key.', 'Luna opened the old door.'],
  characters: ['Max', 'Luna'],
};

const reply = (text: string) => ({ output: { message: { content: [{ text }] } } });

describe('cleanStoryTitle', () => {
  it.each([
    ['The Shiny Key', 'The Shiny Key'],
    ['"The Shiny Key"', 'The Shiny Key'],
    ['Title: The Shiny Key.', 'The Shiny Key'],
    ['**The Shiny Key**\nA story about a key', 'The Shiny Key'],
    ['  \n  The   Shiny Key  ', 'The Shiny Key'],
    ['“Max and Luna”', 'Max and Luna'],
  ])('cleans %j', (raw, title) => {
    expect(cleanStoryTitle(raw)).toBe(title);
  });

  it('is null when nothing is left', () => {
    expect(cleanStoryTitle('  "" \n')).toBeNull();
  });

  it(`cuts a long title at the last word that fits in ${STORY_TITLE_MAX_CHARS} chars`, () => {
    const title = cleanStoryTitle('word '.repeat(30))!;
    expect(title.length).toBeLessThanOrEqual(STORY_TITLE_MAX_CHARS);
    expect(title.endsWith('word')).toBe(true);
  });
});

describe('BedrockStoryTitler', () => {
  let client: { send: jest.Mock };
  let modelId: string | undefined;
  let titler: BedrockStoryTitler;

  beforeEach(() => {
    client = { send: jest.fn().mockResolvedValue(reply('The Shiny Key')) };
    modelId = 'us.amazon.nova-2-lite-v1:0';
    titler = new BedrockStoryTitler(
      client as unknown as BedrockClient,
      {
        get bedrockReviewModelId() {
          return modelId;
        },
      } as EnvsService,
    );
  });

  it('asks the review model for a title, passing the story as data', async () => {
    expect(await titler.title(INPUT)).toBe('The Shiny Key');

    const [command] = client.send.mock.calls[0] as [ConverseCommand];
    expect(command.input.modelId).toBe('us.amazon.nova-2-lite-v1:0');
    expect(command.input.system).toEqual([{ text: STORY_TITLE_SYSTEM_PROMPT }]);
    expect(command.input.messages).toEqual([
      { role: 'user', content: [{ text: JSON.stringify(INPUT) }] },
    ]);
  });

  it('is null without a model, without panels, or when Bedrock fails', async () => {
    client.send.mockRejectedValueOnce(new Error('throttled'));
    expect(await titler.title(INPUT)).toBeNull();

    expect(await titler.title({ panels: [], characters: [] })).toBeNull();

    modelId = undefined;
    expect(await titler.title(INPUT)).toBeNull();
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('is null when the answer is empty', async () => {
    client.send.mockResolvedValue(reply('   '));
    expect(await titler.title(INPUT)).toBeNull();
  });
});
