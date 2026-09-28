import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { AdminStoriesQueryDto, RemoveStoryDto, RestoreStoryDto } from './story-admin.dto';
import { StoryCatalogQueryDto } from './story-catalog-query.dto';

// Mismas opciones que el ValidationPipe global de main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const validate = (value: unknown, metatype: ArgumentMetadata['metatype'], type = 'body') =>
  pipe.transform(value, { type: type as ArgumentMetadata['type'], metatype });

describe('story admin DTOs', () => {
  describe('RemoveStoryDto', () => {
    it('accepts a reason, with an optional trimmed note', async () => {
      await expect(validate({ reason: 'SPAM' }, RemoveStoryDto)).resolves.toEqual({
        reason: 'SPAM',
      });
      await expect(
        validate({ reason: 'SPAM', note: '  bot text  ' }, RemoveStoryDto),
      ).resolves.toEqual({ reason: 'SPAM', note: 'bot text' });
    });

    it.each([
      ['an unknown reason', { reason: 'BORING' }],
      ['OTHER without a note', { reason: 'OTHER' }],
      ['OTHER with a blank note', { reason: 'OTHER', note: '   ' }],
      ['a note over 500 chars', { reason: 'SPAM', note: 'x'.repeat(501) }],
    ])('rejects %s', async (_, value) => {
      await expect(validate(value, RemoveStoryDto)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('RestoreStoryDto takes an optional note', async () => {
    await expect(validate({}, RestoreStoryDto)).resolves.toEqual({});
    await expect(validate({ note: ' ok ' }, RestoreStoryDto)).resolves.toEqual({ note: 'ok' });
    await expect(validate({ note: 'x'.repeat(501) }, RestoreStoryDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('parses the admin list filters from the query string', async () => {
    await expect(
      validate(
        { page: '2', limit: '10', visibility: 'REMOVED', search: ' key ' },
        AdminStoriesQueryDto,
        'query',
      ),
    ).resolves.toMatchObject({ page: 2, limit: 10, visibility: 'REMOVED', search: 'key' });
    await expect(
      validate({ visibility: 'HIDDEN' }, AdminStoriesQueryDto, 'query'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('StoryCatalogQueryDto', () => {
    it('accepts one or more levels, as a list or repeated', async () => {
      await expect(validate({ level: 'B1' }, StoryCatalogQueryDto, 'query')).resolves.toMatchObject(
        { page: 1, limit: 20, level: ['B1'] },
      );
      await expect(
        validate({ level: 'A1, A2' }, StoryCatalogQueryDto, 'query'),
      ).resolves.toMatchObject({ level: ['A1', 'A2'] });
      await expect(
        validate({ level: ['A1', 'B2'] }, StoryCatalogQueryDto, 'query'),
      ).resolves.toMatchObject({ level: ['A1', 'B2'] });
    });

    it('trims the search text', async () => {
      await expect(
        validate({ search: '  robot ' }, StoryCatalogQueryDto, 'query'),
      ).resolves.toMatchObject({ search: 'robot' });
    });

    it.each([
      ['an unknown level', { level: 'Z9' }],
      ['an unknown level in the list', { level: 'A1,Z9' }],
      ['a search over 100 chars', { search: 'x'.repeat(101) }],
    ])('rejects %s', async (_, value) => {
      await expect(validate(value, StoryCatalogQueryDto, 'query')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
