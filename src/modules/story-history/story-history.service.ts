import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Story, StoryPanel, StoryParticipant } from '@/db/entities';
import {
  PanelReactionEvent,
  STORY_EVENTS,
  StoryFinishedEvent,
} from '@/modules/story-game/domain/story-game.events';
import { StorySnapshot } from '@/modules/story-game/domain/story-game.types';
import { ReviewManifest } from '@/modules/story-game/domain/story-review';
import { StoryUrlSigner } from '@/modules/story-game/story-url-signer.service';
import { AvatarUrls } from '@/modules/story-game/domain/story-game.views';
import { toHistoryItem, toStoryManifest, toStoryRecords } from './story-history.mapper';
import { StoryHistoryPage } from './story-history.types';

/**
 * Historial del modo Historieta (Fase 4c). Guarda cada historieta al llegar a
 * FINISHED (con la media ya terminada) y la sirve a sus participantes. Redis
 * la sigue teniendo 24 h para el review en vivo; después solo existe acá.
 */
@Injectable()
export class StoryHistoryService {
  private readonly logger = new Logger(StoryHistoryService.name);

  constructor(
    @InjectRepository(Story) private readonly stories: Repository<Story>,
    private readonly urls: StoryUrlSigner,
  ) {}

  /** Un error al guardar no afecta a la partida: queda en el log (y en Redis 24 h). */
  @OnEvent(STORY_EVENTS.finished, { async: true, promisify: true })
  async onStoryFinished({ snapshot }: StoryFinishedEvent): Promise<void> {
    try {
      await this.save(snapshot);
    } catch (error) {
      this.logger.error(
        `story ${snapshot.game.gameId}: could not save it: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Guarda la historieta con sus viñetas y participantes en una transacción.
   * Idempotente: si ya estaba guardada no hace nada. Devuelve si la guardó.
   */
  async save(snapshot: StorySnapshot, finishedAt = new Date()): Promise<boolean> {
    if (!snapshot.game.storyId) return false;
    const records = toStoryRecords(snapshot, finishedAt);

    return this.stories.manager.transaction(async (manager) => {
      if (await manager.exists(Story, { where: { id: records.story.id } })) return false;
      await manager.insert(Story, records.story);
      if (records.panels.length > 0) await manager.insert(StoryPanel, records.panels);
      if (records.participants.length > 0) {
        await manager.insert(StoryParticipant, records.participants);
      }
      this.logger.log(`story ${snapshot.game.gameId} saved as ${records.story.id}`);
      return true;
    });
  }

  /**
   * Las reacciones siguen abiertas después de terminar: se reflejan en la
   * viñeta guardada con una actualización atómica del jsonb. Antes de FINISHED
   * no hay fila y no cambia nada (se guardan con la historieta).
   */
  @OnEvent(STORY_EVENTS.panelReaction, { async: true, promisify: true })
  async onPanelReaction({ gameId, order, userId, emoji }: PanelReactionEvent): Promise<void> {
    try {
      await this.stories.manager.query(
        `UPDATE "story_panel" SET "reactions" = CASE
           WHEN $3::text IS NULL THEN "reactions" - $2::text
           ELSE "reactions" || jsonb_build_object($2::text, $3::text)
         END
         WHERE "order" = $4 AND "story_id" = (SELECT "id" FROM "story" WHERE "gameId" = $1)`,
        [gameId, userId, emoji, order],
      );
    } catch (error) {
      this.logger.warn(`story ${gameId}: could not save a reaction: ${(error as Error).message}`);
    }
  }

  /** Historietas en las que jugó el usuario, de la más reciente a la más vieja. */
  async list(userId: string, page: number, limit: number): Promise<StoryHistoryPage> {
    const [stories, total] = await this.withDetails()
      .innerJoin('story.participants', 'me', 'me.userId = :userId', { userId })
      .orderBy('story.finishedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const items = await Promise.all(
      stories.map(async (story) => {
        const cover = [...story.panels]
          .sort((a, b) => a.order - b.order)
          .find((panel) => panel.imageKey);
        const [avatars, coverUrls] = await Promise.all([
          this.avatarsOf(story),
          cover ? this.urls.signMedia({ audioKey: null, imageKey: cover.imageKey }) : null,
        ]);
        return toHistoryItem(story, userId, avatars, coverUrls?.imageUrl ?? null);
      }),
    );
    return { items, page, limit, total };
  }

  /**
   * Manifiesto de una historieta guardada, con el mismo formato que el review.
   * Solo para sus participantes: a los demás se les responde 404, sin revelar
   * que existe.
   */
  async get(storyId: string, userId: string): Promise<ReviewManifest> {
    const story = await this.withDetails().where('story.id = :storyId', { storyId }).getOne();
    if (!story || !story.participants.some((participant) => participant.userId === userId)) {
      throw new NotFoundException('Story not found');
    }

    const [avatars, media] = await Promise.all([
      this.avatarsOf(story),
      this.urls.mediaFor(
        story.panels.map((panel) => ({
          order: panel.order,
          media: { audioKey: panel.audioKey, imageKey: panel.imageKey },
        })),
      ),
    ]);
    return toStoryManifest(story, avatars, media);
  }

  /** Historieta con sus viñetas y participantes (y el avatar actual de cada uno). */
  private withDetails() {
    return this.stories
      .createQueryBuilder('story')
      .leftJoinAndSelect('story.panels', 'panel')
      .leftJoinAndSelect('story.participants', 'participant')
      .leftJoinAndSelect('participant.user', 'user')
      .leftJoinAndSelect('user.avatar', 'avatar');
  }

  private avatarsOf(story: Story): Promise<AvatarUrls> {
    return this.urls.avatarsFor(
      story.participants.map((participant) => ({
        userId: participant.userId,
        avatarKey: participant.user?.avatar?.key ?? null,
      })),
    );
  }
}
