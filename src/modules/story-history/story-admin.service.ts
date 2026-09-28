import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Story } from '@/db/entities';
import { StoryRemovalReason, StoryVisibility } from '@/db/enum/story.enum';
import { StoryGameService } from '@/modules/story-game/story-game.service';
import { StoryHistoryService } from './story-history.service';
import { toAdminStoryItem } from './story-history.mapper';
import { AdminStoryDetail, AdminStoryItem, AdminStoryPage } from './story-history.types';

export interface AdminStoriesFilter {
  page: number;
  limit: number;
  visibility?: StoryVisibility;
  search?: string;
}

/** Escapa `%`, `_` y `\` para usar el texto del admin dentro de un ILIKE. */
const likePattern = (search: string) => `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/**
 * Moderación de historietas (panel de admin): lista todas, publicadas o
 * quitadas, y permite quitar una. Quitar es un borrado lógico: la fila queda
 * con quién, cuándo y por qué, y la historieta deja de verse en el catálogo y
 * en el historial de sus jugadores.
 */
@Injectable()
export class StoryAdminService {
  private readonly logger = new Logger(StoryAdminService.name);

  constructor(
    @InjectRepository(Story) private readonly stories: Repository<Story>,
    private readonly history: StoryHistoryService,
    private readonly game: StoryGameService,
  ) {}

  /**
   * De la más reciente a la más vieja. `search` busca (sin distinguir
   * mayúsculas) en el título, el código de la partida, los nombres de los
   * jugadores y el texto de las viñetas.
   */
  async list({ page, limit, visibility, search }: AdminStoriesFilter): Promise<AdminStoryPage> {
    const query = this.adminQuery();
    if (visibility) query.andWhere('story.visibility = :visibility', { visibility });
    if (search) {
      query.andWhere(
        `(story.title ILIKE :search OR story.gameId ILIKE :search
          OR EXISTS (SELECT 1 FROM "story_participant" sp
                     WHERE sp."story_id" = story.id AND sp."username" ILIKE :search)
          OR EXISTS (SELECT 1 FROM "story_panel" sp2
                     WHERE sp2."story_id" = story.id AND sp2."finalText" ILIKE :search))`,
        { search: likePattern(search) },
      );
    }

    const [stories, total] = await query
      .orderBy('story.finishedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const items = await Promise.all(stories.map((story) => this.toItem(story)));
    return { items, page, limit, total };
  }

  /** Detalle de cualquier historieta (también las quitadas), con el manifiesto completo. */
  async get(storyId: string): Promise<AdminStoryDetail> {
    const story = await this.findOrFail(storyId);
    const [item, manifest] = await Promise.all([
      this.toItem(story),
      this.history.manifestOf(story),
    ]);
    return { ...item, manifest };
  }

  /**
   * Quita una historieta: deja de verse en el catálogo y en el historial, y si
   * su review en vivo sigue en Redis se borra. 409 si ya estaba quitada.
   */
  async remove(
    storyId: string,
    adminId: string,
    reason: StoryRemovalReason,
    note?: string,
  ): Promise<AdminStoryDetail> {
    const story = await this.findOrFail(storyId);
    if (story.visibility === StoryVisibility.REMOVED) {
      throw new ConflictException('The story was already removed');
    }

    // Guarda condicional: si dos admins la quitan a la vez, solo gana uno.
    const result = await this.stories
      .createQueryBuilder()
      .update(Story)
      .set({
        visibility: StoryVisibility.REMOVED,
        removedAt: () => 'now()',
        removedById: adminId,
        removalReason: reason,
        removalNote: note ?? null,
      })
      .where('id = :storyId AND visibility = :published', {
        storyId,
        published: StoryVisibility.PUBLISHED,
      })
      .execute();
    if (!result.affected) throw new ConflictException('The story was already removed');

    this.logger.warn(`story ${storyId} (game ${story.gameId}) removed by ${adminId}: ${reason}`);
    await this.game.discardFinishedStory(story.gameId).catch((error: Error) =>
      // La historieta ya está quitada en Postgres; Redis vence solo en 24 h.
      this.logger.error(`story ${story.gameId}: could not discard it from Redis: ${error.message}`),
    );
    return this.get(storyId);
  }

  private adminQuery() {
    // Los filtros se agregan con andWhere: TypeORM arma bien el WHERE aunque sea el primero.
    return this.history.detailsQuery().leftJoinAndSelect('story.removedBy', 'removedBy');
  }

  private async findOrFail(storyId: string): Promise<Story> {
    const story = await this.adminQuery().andWhere('story.id = :storyId', { storyId }).getOne();
    if (!story) throw new NotFoundException('Story not found');
    return story;
  }

  private async toItem(story: Story): Promise<AdminStoryItem> {
    const [avatars, coverUrl] = await Promise.all([
      this.history.avatarsOf(story),
      this.history.coverUrlOf(story),
    ]);
    return toAdminStoryItem(story, avatars, coverUrl);
  }
}
