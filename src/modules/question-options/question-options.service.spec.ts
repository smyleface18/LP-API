import { Test, TestingModule } from '@nestjs/testing';
import { QuestionOptionsService } from './question-options.service';

describe('QuestionOptionsService', () => {
  let service: QuestionOptionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QuestionOptionsService],
    }).compile();

    service = module.get<QuestionOptionsService>(QuestionOptionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
