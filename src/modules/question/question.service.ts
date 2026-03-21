import { Injectable } from '@nestjs/common';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Question } from 'src/db/entities';
import { Repository } from 'typeorm';
import { Level } from 'src/db/enum/question.enum';
import { QuestionDto } from '../game/match/domain/match.interface';

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

  async getRandomQuestions(
    difficulty: Level = Level.A1,
    limit: number = 10,
  ): Promise<QuestionDto[]> {
    const questions = await this.repo
      .createQueryBuilder('question')
      .innerJoinAndSelect('question.category', 'category')
      .leftJoinAndSelect('question.options', 'options')
      .where('category.level = :difficulty', { difficulty })
      .orderBy('RANDOM()')
      .limit(limit)
      .getMany();
    console.log(questions[0]);
    console.log(`${questions.length} preguntas seleccionadas aleatoriamente`);

    return questions.map((q) => this.toQuestionDto(q));
  }

  private toQuestionDto(question: Question): QuestionDto {
    return {
      id: question.id,
      active: question.active,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
      questionText: question.questionText,
      category: question.category,
      categoryId: question.categoryId,
      timeLimit: question.timeLimit,
      media: question.media,
      options:
        question.options?.map((option) => ({
          id: option.id,
          text: option.text,
          media: option.media,
        })) || [],
    };
  }
}
