import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Story, StoryModerationLog } from '@/db/entities';
import { StoryModerationAction, StoryRemovalReason, StoryVisibility } from '@/db/enum/story.enum';
import { StoryGameService } from '@/modules/story-game/story-game.service';
import { StoryHistoryService } from './story-history.service';
import { toAdminStoryItem } from './story-history.mapper';
import { whereStoryMatches } from './story-search';
import {
  AdminStoryDetail,
  AdminStoryItem,
  AdminStoryModerationEntry,
  AdminStoryPage,
} from './story-history.types';

export interface AdminStoriesFilter {
  page: number;
  limit: number;
  visibility?: StoryVisibility;
  search?: string;
}

/**
 * Moderación de historietas (panel de admin): lista todas, publicadas o
 * quitadas, y permite quitarlas y restaurarlas. Quitar es un borrado lógico:
 * la historieta deja de verse en el catálogo y en el historial de sus
 * jugadores. Cada acción queda en `StoryModerationLog` (quién, cuándo, qué y
 * por qué), en la misma transacción que el cambio de estado.
 */
@Injectable()
export class StoryAdminService {
  private readonly logger = new Logger(StoryAdminService.name);

  constructor(
    @InjectRepository(Story) private readonly stories: Repository<Story>,
    @InjectRepository(StoryModerationLog)
    private readonly moderationLog: Repository<StoryModerationLog>,
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
    if (search) whereStoryMatches(query, search, { includeGameId: true });

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
    const [item, manifest, history] = await Promise.all([
      this.toItem(story),
      this.history.manifestOf(story),
      this.moderationHistory(storyId),
    ]);
    return { ...item, manifest, moderationHistory: history };
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

    await this.stories.manager.transaction(async (manager) => {
      const changed = await this.setVisibility(manager, storyId, StoryVisibility.REMOVED, {
        removedAt: () => 'now()',
        removedById: adminId,
        removalReason: reason,
        removalNote: note ?? null,
      });
      if (!changed) throw new ConflictException('The story was already removed');
      await manager.insert(StoryModerationLog, {
        storyId,
        action: StoryModerationAction.REMOVED,
        adminId,
        reason,
        note: note ?? null,
      });
    });

    this.logger.warn(`story ${storyId} (game ${story.gameId}) removed by ${adminId}: ${reason}`);
    await this.game.discardFinishedStory(story.gameId).catch((error: Error) =>
      // La historieta ya está quitada en Postgres; Redis vence solo en 24 h.
      this.logger.error(`story ${story.gameId}: could not discard it from Redis: ${error.message}`),
    );
    return this.get(storyId);
  }

  /**
   * Restaura una historieta quitada: vuelve al catálogo y al historial de sus
   * jugadores, y se vacían los datos de la remoción (quedan en el historial de
   * moderación). 409 si ya estaba publicada.
   */
  async restore(storyId: string, adminId: string, note?: string): Promise<AdminStoryDetail> {
    const story = await this.findOrFail(storyId);
    if (story.visibility === StoryVisibility.PUBLISHED) {
      throw new ConflictException('The story is already published');
    }

    await this.stories.manager.transaction(async (manager) => {
      const changed = await this.setVisibility(manager, storyId, StoryVisibility.PUBLISHED, {
        removedAt: null,
        removedById: null,
        removalReason: null,
        removalNote: null,
      });
      if (!changed) throw new ConflictException('The story is already published');
      await manager.insert(StoryModerationLog, {
        storyId,
        action: StoryModerationAction.RESTORED,
        adminId,
        reason: null,
        note: note ?? null,
      });
    });

    this.logger.warn(`story ${storyId} (game ${story.gameId}) restored by ${adminId}`);
    return this.get(storyId);
  }

  /**
   * Cambia la visibilidad solo si está en la contraria (guarda contra dos
   * admins a la vez: solo uno gana). Devuelve si cambió.
   */
  private async setVisibility(
    manager: EntityManager,
    storyId: string,
    visibility: StoryVisibility,
    removal: Record<string, unknown>,
  ): Promise<boolean> {
    const from =
      visibility === StoryVisibility.REMOVED ? StoryVisibility.PUBLISHED : StoryVisibility.REMOVED;
    const result = await manager
      .createQueryBuilder()
      .update(Story)
      .set({ visibility, ...removal })
      .where('id = :storyId AND visibility = :from', { storyId, from })
      .execute();
    return !!result.affected;
  }

  /** Acciones de moderación de la historieta, de la más reciente a la más vieja. */
  private async moderationHistory(storyId: string): Promise<AdminStoryModerationEntry[]> {
    const entries = await this.moderationLog.find({
      where: { storyId },
      relations: { admin: true },
      order: { createdAt: 'DESC' },
    });
    return entries.map((entry) => ({
      action: entry.action,
      at: entry.createdAt.toISOString(),
      admin: entry.admin ? { userId: entry.admin.id, username: entry.admin.username } : null,
      reason: entry.reason,
      note: entry.note,
    }));
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
