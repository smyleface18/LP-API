import { Injectable } from '@nestjs/common';
import { CreateCategoryQuestionDto } from './dto/create-category-question.dto';
import { UpdateCategoryQuestionDto } from './dto/update-category-question.dto';

@Injectable()
export class CategoryQuestionService {
  create(createCategoryQuestionDto: CreateCategoryQuestionDto) {
    return 'This action adds a new categoryQuestion';
  }

  findAll() {
    return `This action returns all categoryQuestion`;
  }

  findOne(id: number) {
    return `This action returns a #${id} categoryQuestion`;
  }

  update(id: number, updateCategoryQuestionDto: UpdateCategoryQuestionDto) {
    return `This action updates a #${id} categoryQuestion`;
  }

  remove(id: number) {
    return `This action removes a #${id} categoryQuestion`;
  }
}
