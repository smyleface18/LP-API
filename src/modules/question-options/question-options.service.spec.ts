import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QuestionOptionsService } from './question-options.service';
import { QuestionOption } from '@/db/entities/question-option.entity';
import { MediaService } from '../media/media.service';

describe('QuestionOptionsService', () => {
  let service: QuestionOptionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionOptionsService,
        { provide: getRepositoryToken(QuestionOption), useValue: {} },
        { provide: MediaService, useValue: { signUrl: jest.fn() } },
      ],
    }).compile();

    service = module.get<QuestionOptionsService>(QuestionOptionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
