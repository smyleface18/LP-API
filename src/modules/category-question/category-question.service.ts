import { Injectable } from '@nestjs/common';
import { CreateCategoryQuestionDto } from './dto/create-category-question.dto';
import { UpdateCategoryQuestionDto } from './dto/update-category-question.dto';
import { CategoryQuestion } from 'src/db/entities';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class CategoryQuestionService {
  constructor(
    @InjectRepository(CategoryQuestion)
    private readonly repo: Repository<CategoryQuestion>,
  ) {}

  create(createCategoryQuestionDto: CreateCategoryQuestionDto) {
    return this.repo.save(createCategoryQuestionDto);
  }

  findAll() {
    return this.repo.find();
  }

  findOne(id: string) {
    return this.repo.findOne({
      where: {
        id: id,
      },
    });
  }

  update(id: string, updateCategoryQuestionDto: UpdateCategoryQuestionDto) {
    return this.repo.update(id, updateCategoryQuestionDto);
  }

  remove(id: string) {
    return this.repo.delete(id);
  }
}
