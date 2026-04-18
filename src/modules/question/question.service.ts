import { Injectable } from '@nestjs/common';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Question } from 'src/db/entities';
import { In, Repository } from 'typeorm';
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

  async getRandomQuestions(difficulty: Level = Level.A1, limit: number = 10): Promise<Question[]> {
    // 1️⃣ Obtener IDs aleatorios de preguntas (SIN options)
    const randomQuestions = await this.repo
      .createQueryBuilder('question')
      .innerJoin('question.category', 'category')
      .where('category.level = :difficulty', { difficulty })
      .select('question.id')
      .orderBy('RANDOM()')
      .limit(limit)
      .getMany();

    const ids = randomQuestions.map((q) => q.id);

    if (ids.length === 0) return [];

    // 2️⃣ Cargar preguntas con TODAS sus relaciones completas
    const questions = await this.repo.find({
      where: { id: In(ids) },
      relations: ['category', 'options'],
    });

    console.log(`${questions.length} preguntas seleccionadas aleatoriamente`);

    return questions;
  }

  toQuestionDto(question: Question): QuestionDto {
    const options =
      question.options?.map((option) => ({
        id: option.id,
        optionText: option.text,
        optionMedia: option.media,
        isCorrect: option.isCorrect,
      })) || [];

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
      options: options,
    };
  }
}
