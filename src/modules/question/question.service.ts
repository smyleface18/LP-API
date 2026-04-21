import { Injectable } from '@nestjs/common';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Question } from 'src/db/entities';
import { In, Repository } from 'typeorm';
import { Level } from 'src/db/enum/question.enum';

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

  async getRandomQuestions(difficulty: Level = Level.A1, limit: number = 10): Promise<Question[]> {
    const randomQuestions = await this.repo
      .createQueryBuilder('question')
      .innerJoin('question.category', 'category')
      .where('category.level = :difficulty', { difficulty })
      .select('question.id')
      .orderBy('RANDOM()')
      .limit(limit)
      .getMany();

    const ids = this.shuffle(randomQuestions.map((q) => q.id));

    if (ids.length === 0) return [];

    const questions = await this.repo.find({
      where: { id: In(ids) },
      relations: ['category', 'options'],
    });

    return this.shuffle(
      questions.map((q) => ({
        ...q,
        options: this.shuffle(q.options),
      })),
    );
  }

  private shuffle<T>(array: T[]): T[] {
    return array
      .map((value) => ({ value, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ value }) => value);
  }
}
