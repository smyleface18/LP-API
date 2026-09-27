import { ArgumentMetadata } from '@nestjs/common';
import { createStoryValidationPipe } from '../story-validation.pipe';
import { StoryError } from '../domain/story-game.errors';
import { UpdateConfigDto } from './update-config.dto';
import { CreateCharacterDto } from './create-character.dto';
import { JoinStoryGameDto } from './join-story-game.dto';

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
      { hostId: 'me' },
    ])('rejects %j as VALIDATION_ERROR', async (value) => {
      const error = await rejectionOf(value, UpdateConfigDto);
      expect(error).toBeInstanceOf(StoryError);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.getStatus()).toBe(400);
    });
  });

  describe('CreateCharacterDto', () => {
    const valid = {
      name: '  Luna ',
      type: 'girl',
      trait: 'curly red hair',
      clothing: 'a yellow raincoat',
      detail: 'carries a tiny robot',
    };

    it('trims the fields', async () => {
      const dto = (await pipe.transform(valid, body(CreateCharacterDto))) as CreateCharacterDto;
      expect(dto.name).toBe('Luna');
    });

    it('rejects a name longer than 30 characters', async () => {
      const error = await rejectionOf({ ...valid, name: 'x'.repeat(31) }, CreateCharacterDto);
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a detail longer than 60 characters', async () => {
      const error = await rejectionOf({ ...valid, detail: 'x'.repeat(61) }, CreateCharacterDto);
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects blank or missing fields', async () => {
      const blank = await rejectionOf({ ...valid, trait: '   ' }, CreateCharacterDto);
      expect(blank.code).toBe('VALIDATION_ERROR');
      const missing = await rejectionOf({ name: 'Luna' }, CreateCharacterDto);
      expect(missing.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('JoinStoryGameDto', () => {
    it('requires a gameId', async () => {
      const error = await rejectionOf({}, JoinStoryGameDto);
      expect(error.code).toBe('VALIDATION_ERROR');
    });
  });
});
