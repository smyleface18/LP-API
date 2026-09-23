import { Test, TestingModule } from '@nestjs/testing';
import { QuestionOptionsController } from './question-options.controller';
import { QuestionOptionsService } from './question-options.service';

describe('QuestionOptionsController', () => {
  let controller: QuestionOptionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuestionOptionsController],
      providers: [{ provide: QuestionOptionsService, useValue: {} }],
    }).compile();

    controller = module.get<QuestionOptionsController>(QuestionOptionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
