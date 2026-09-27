import { ArgumentMetadata } from '@nestjs/common';
import { createStoryValidationPipe } from '../story-validation.pipe';
import { StoryError } from '../domain/story-game.errors';
import { UpdateConfigDto } from './update-config.dto';
import { KickPlayerDto } from './kick-player.dto';
import { JoinStoryGameDto } from './join-story-game.dto';
import { SubmitPanelDraftDto } from './submit-panel-draft.dto';
import { PanelOrderDto } from './panel-order.dto';
import { ReactToPanelDto } from './react-to-panel.dto';
import { GetReviewManifestDto } from './get-review-manifest.dto';

const pipe = createStoryValidationPipe();
const body = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});

async function rejectionOf(value: unknown, metatype: ArgumentMetadata['metatype']) {
  try {
    await pipe.transform(value, body(metatype));
  } catch (error) {
    return error as StoryError;
  }
  throw new Error('expected validation to fail');
}

describe('story DTO validation', () => {
  describe('UpdateConfigDto', () => {
    it.each([
      { panelsCount: 4 },
      { panelsCount: 10 },
      { turnDurationSec: 60 },
      { turnDurationSec: 180 },
      { level: 'B2' },
      { language: 'en-US' },
      { shareDrafts: false },
      {},
    ])('accepts %j', async (value) => {
      await expect(pipe.transform(value, body(UpdateConfigDto))).resolves.toBeInstanceOf(
        UpdateConfigDto,
      );
    });

    it.each([
      { panelsCount: 3 },
      { panelsCount: 11 },
      { panelsCount: 5.5 },
      { panelsCount: '6' },
      { turnDurationSec: 100 },
      { level: 'C1' },
      { language: 'es-ES' },
      { shareDrafts: 'no' },
      { hostId: 'me' },
    ])('rejects %j as VALIDATION_ERROR', async (value) => {
      const error = await rejectionOf(value, UpdateConfigDto);
      expect(error).toBeInstanceOf(StoryError);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.getStatus()).toBe(400);
    });
  });

  describe('JoinStoryGameDto', () => {
    it('requires a gameId', async () => {
      const error = await rejectionOf({}, JoinStoryGameDto);
      expect(error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('KickPlayerDto', () => {
    it('requires a userId string', async () => {
      await expect(pipe.transform({ userId: 'bob' }, body(KickPlayerDto))).resolves.toEqual({
        userId: 'bob',
      });
      expect((await rejectionOf({}, KickPlayerDto)).code).toBe('VALIDATION_ERROR');
      expect((await rejectionOf({ userId: 42 }, KickPlayerDto)).code).toBe('VALIDATION_ERROR');
    });
  });

  describe('SubmitPanelDraftDto', () => {
    const valid = {
      panelOrder: 0,
      text: '  The robot walked into the forest at night.  ',
      scene: 'Forest',
      characterIds: ['ch-0-0'],
      newCharacters: [{ name: ' Beep ', kind: 'robot', description: 'tiny silver robot' }],
    };

    it('trims the texts and the nested sheets', async () => {
      const dto = (await pipe.transform(valid, body(SubmitPanelDraftDto))) as SubmitPanelDraftDto;
      expect(dto.text).toBe('The robot walked into the forest at night.');
      expect(dto.newCharacters[0].name).toBe('Beep');
    });

    it('defaults the character lists to empty', async () => {
      const dto = (await pipe.transform(
        { panelOrder: 0, text: 'x', scene: 'y' },
        body(SubmitPanelDraftDto),
      )) as SubmitPanelDraftDto;
      expect(dto.characterIds).toEqual([]);
      expect(dto.newCharacters).toEqual([]);
    });

    it.each([
      ['a text over 320 chars', { text: 'x'.repeat(321) }],
      ['a scene over 200 chars', { scene: 'x'.repeat(201) }],
      ['an empty scene', { scene: '   ' }],
      ['more than 3 characterIds', { characterIds: ['a', 'b', 'c', 'd'] }],
      [
        'more than 2 new characters',
        {
          newCharacters: [1, 2, 3].map((i) => ({ name: `N${i}`, kind: 'cat', description: 'd' })),
        },
      ],
      [
        'a description over 100 chars',
        { newCharacters: [{ name: 'Beep', kind: 'robot', description: 'x'.repeat(101) }] },
      ],
      ['a sheet without kind', { newCharacters: [{ name: 'Beep', description: 'tiny' }] }],
      ['a non-integer panelOrder', { panelOrder: 1.5 }],
    ])('rejects %s', async (_, override) => {
      const error = await rejectionOf({ ...valid, ...override }, SubmitPanelDraftDto);
      expect(error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PanelOrderDto', () => {
    it('requires an integer panelOrder in range', async () => {
      await expect(pipe.transform({ panelOrder: 3 }, body(PanelOrderDto))).resolves.toEqual({
        panelOrder: 3,
      });
      expect((await rejectionOf({}, PanelOrderDto)).code).toBe('VALIDATION_ERROR');
      expect((await rejectionOf({ panelOrder: -1 }, PanelOrderDto)).code).toBe('VALIDATION_ERROR');
      expect((await rejectionOf({ panelOrder: 10 }, PanelOrderDto)).code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GetReviewManifestDto', () => {
    it('requires a gameId', async () => {
      await expect(
        pipe.transform({ gameId: 'brave-red-fox' }, body(GetReviewManifestDto)),
      ).resolves.toEqual({ gameId: 'brave-red-fox' });
      expect((await rejectionOf({}, GetReviewManifestDto)).code).toBe('VALIDATION_ERROR');
      expect((await rejectionOf({ gameId: '' }, GetReviewManifestDto)).code).toBe(
        'VALIDATION_ERROR',
      );
    });
  });

  describe('ReactToPanelDto', () => {
    it.each([
      { panelOrder: 0, emoji: '😂' },
      { panelOrder: 2, emoji: null },
      { panelOrder: 1, emoji: '🔥', gameId: 'brave-red-fox' },
    ])('accepts %j', async (value) => {
      await expect(pipe.transform(value, body(ReactToPanelDto))).resolves.toEqual(value);
    });

    it.each([
      { panelOrder: 0 },
      { panelOrder: 0, emoji: '💩' },
      { panelOrder: 0, emoji: 'lol' },
      { emoji: '😂' },
      { panelOrder: 0, emoji: '😂', gameId: '' },
    ])('rejects %j', async (value) => {
      expect((await rejectionOf(value, ReactToPanelDto)).code).toBe('VALIDATION_ERROR');
    });
  });
});
