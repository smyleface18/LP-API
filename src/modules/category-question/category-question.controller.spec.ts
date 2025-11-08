import { Test, TestingModule } from '@nestjs/testing';
import { CategoryQuestionController } from './category-question.controller';
import { CategoryQuestionService } from './category-question.service';

describe('CategoryQuestionController', () => {
  let controller: CategoryQuestionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoryQuestionController],
      providers: [CategoryQuestionService],
    }).compile();

    controller = module.get<CategoryQuestionController>(CategoryQuestionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
