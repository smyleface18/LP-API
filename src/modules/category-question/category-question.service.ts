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

  async findAll() {
    return await this.repo.find({
      relations: ['questions'],
    });
  }

  async findOne(id: string) {
    return await this.repo.findOne({
      where: { id },
      relations: ['questions'],
    });
  }

  update(id: string, updateCategoryQuestionDto: UpdateCategoryQuestionDto) {
    return this.repo.update(id, updateCategoryQuestionDto);
  }

  remove(id: string) {
    return this.repo.delete(id);
  }
}
