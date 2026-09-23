import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateQuestionOptionDto } from './dto/create-question-option.dto';
import { UpdateQuestionOptionDto } from './dto/update-question-option.dto';
import { QuestionOption } from '@/db/entities/question-option.entity';
import { DeleteResult, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { MediaService } from '../media/media.service';

@Injectable()
export class QuestionOptionsService {
  constructor(
    @InjectRepository(QuestionOption)
    private readonly repo: Repository<QuestionOption>,
    private readonly mediaService: MediaService,
  ) {}

  async create(createQuestionOptionDto: CreateQuestionOptionDto): Promise<QuestionOption> {
    return await this.repo.save(createQuestionOptionDto);
  }

  async createMany(createQuestionOptionDto: CreateQuestionOptionDto[]): Promise<QuestionOption[]> {
    return await this.repo.save(createQuestionOptionDto);
  }

  async findAll(): Promise<QuestionOption[]> {
    const options = await this.repo.find({ relations: ['media'] });

    return Promise.all(options.map((option) => this.signOptionMedia(option)));
  }

  async findOne(id: string): Promise<QuestionOption | null> {
    const questionOption = await this.repo.findOne({
      where: {
        id: id,
      },
      relations: ['media'],
    });

    if (!questionOption) {
      throw new HttpException(`question option with ${id} not found`, HttpStatus.NOT_FOUND);
    }
    return this.signOptionMedia(questionOption);
  }

  async update(id: string, updateQuestionOptionDto: UpdateQuestionOptionDto) {
    const questionOption = await this.findOne(id);

    if (!questionOption) {
      throw new HttpException(`Question option with id ${id} not found`, HttpStatus.NOT_FOUND);
    }

    Object.assign(questionOption, updateQuestionOptionDto);

    return this.repo.save(questionOption);
  }

  async remove(id: string): Promise<DeleteResult> {
    return await this.repo.delete(id);
  }

  private async signOptionMedia(option: QuestionOption): Promise<QuestionOption> {
    return { ...option, media: await this.mediaService.signUrl(option.media) };
  }
}
