import { Injectable } from '@nestjs/common';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Question } from '@/db/entities';
import { In, Repository } from 'typeorm';
import { Level } from '@/db/enum/question.enum';
import { MediaService } from '../media/media.service';

@Injectable()
export class QuestionService {
  constructor(
    @InjectRepository(Question)
    private readonly repo: Repository<Question>,
    private readonly mediaService: MediaService,
  ) {}

  async create(createQuestionDto: CreateQuestionDto) {
    return await this.repo.save(createQuestionDto);
  }

  async findAll() {
    const questions = await this.repo.find({
      relations: ['category', 'options', 'media', 'options.media'],
    });

    return Promise.all(questions.map((question) => this.signQuestionMedia(question)));
  }

  async findOne(id: string) {
    const question = await this.repo.findOne({
      where: { id },
      relations: ['category', 'options', 'media', 'options.media'],
    });

    return question ? this.signQuestionMedia(question) : question;
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

  /**
   * Preguntas jugables al azar: activas, de una categoría activa del nivel, y
   * con al menos 2 opciones activas y una correcta (si no, no se pueden
   * responder). Las URLs de la media NO se firman acá: el match las firma al
   * publicar cada pregunta, porque una firmada ahora vencería a mitad de partida.
   */
  async getRandomQuestions(difficulty: Level = Level.A1, limit: number = 10): Promise<Question[]> {
    const randomQuestions = await this.repo
      .createQueryBuilder('question')
      .innerJoin('question.category', 'category')
      .where('category.level = :difficulty', { difficulty })
      .andWhere('question.active = true')
      .andWhere('category.active = true')
      .andWhere(
        `(SELECT COUNT(*) FROM question_option qo
          WHERE qo.question_id = question.id AND qo.active = true) >= 2`,
      )
      .andWhere(
        `EXISTS (SELECT 1 FROM question_option qo
          WHERE qo.question_id = question.id AND qo.active = true AND qo."isCorrect" = true)`,
      )
      .select('question.id')
      .orderBy('RANDOM()')
      .limit(limit)
      .getMany();

    const ids = this.shuffle(randomQuestions.map((q) => q.id));

    if (ids.length === 0) return [];

    const questions = await this.repo.find({
      where: { id: In(ids) },
      relations: ['category', 'options', 'media', 'options.media'],
    });

    return this.shuffle(
      questions.map((q) => ({
        ...q,
        options: this.shuffle(q.options.filter((option) => option.active)),
      })),
    );
  }

  private shuffle<T>(array: T[]): T[] {
    return array
      .map((value) => ({ value, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ value }) => value);
  }

  /**
   * Reemplaza `media.url` (Question y cada QuestionOption) por una URL de
   * lectura firmada y fresca — nunca se sirve la que quedó guardada en BD.
   */
  private async signQuestionMedia(question: Question): Promise<Question> {
    const [media, options] = await Promise.all([
      this.mediaService.signUrl(question.media),
      Promise.all(
        (question.options ?? []).map(async (option) => ({
          ...option,
          media: await this.mediaService.signUrl(option.media),
        })),
      ),
    ]);

    return { ...question, media, options };
  }
}
