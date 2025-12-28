import { Injectable } from '@nestjs/common';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Question } from 'src/db/entities';
import { Repository } from 'typeorm';

@Injectable()
export class QuestionService {
  constructor(
    @InjectRepository(Question)
    private readonly repo: Repository<Question>,
  ) {}

  async create(createQuestionDto: CreateQuestionDto) {
    return await this.repo.save(createQuestionDto);
  }

  async findAll() {
    return await this.repo.find({
      relations: ['category'],
    });
  }

  async findOne(id: string) {
    return await this.repo.findOne({
      where: { id },
      relations: ['category'],
    });
  }

  async createMany(createQuestionDtos: CreateQuestionDto[]) {
    return await this.repo.save(createQuestionDtos);
  }

  async update(id: string, updateQuestionDto: UpdateQuestionDto) {
    return await this.repo.update(id, updateQuestionDto);
  }

  async remove(id: string) {
    return await this.repo.delete(id);
  }

  async getRandomQuestions(limit: number = 10): Promise<Question[]> {
    // Si estás usando TypeORM
    const questions = await this.repo
      .createQueryBuilder('question')
      .leftJoinAndSelect('question.category', 'category')
      .leftJoinAndSelect('question.options', 'options')
      .orderBy('RANDOM()') // Para PostgreSQL
      .limit(limit)
      .getMany();

    console.log(`${questions.length} preguntas seleccionadas aleatoriamente`);
    return questions;
  }
}
