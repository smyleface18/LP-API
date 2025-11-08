import { Test, TestingModule } from '@nestjs/testing';
import { CategoryQuestionService } from './category-question.service';

describe('CategoryQuestionService', () => {
  let service: CategoryQuestionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CategoryQuestionService],
    }).compile();

    service = module.get<CategoryQuestionService>(CategoryQuestionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
