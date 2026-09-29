import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Story, StoryLike, StoryPanel, StoryParticipant } from '@/db/entities';
import { Level } from '@/db/enum/question.enum';
import { StoryVisibility } from '@/db/enum/story.enum';
import {
  PanelImageRegeneratedEvent,
  PanelReactionEvent,
  STORY_EVENTS,
  StoryFinishedEvent,
} from '@/modules/story-game/domain/story-game.events';
import { StorySnapshot } from '@/modules/story-game/domain/story-game.types';
import { ReviewManifest } from '@/modules/story-game/domain/story-review';
import { StoryUrlSigner } from '@/modules/story-game/story-url-signer.service';
import { STORY_REACTIONS } from '@/modules/story-game/story-game.config';
import { AvatarUrls } from '@/modules/story-game/domain/story-game.views';
import { toHistoryItem, toStoryManifest, toStoryRecords } from './story-history.mapper';
import { whereStoryMatches } from './story-search';
import { StoredStoryManifest, StoryHistoryPage, StoryLikes } from './story-history.types';

const NO_LIKES: StoryLikes = { count: 0, likedByMe: false };

/**
 * Historial del modo Historieta (Fase 4c). Guarda cada historieta al llegar a
 * FINISHED (con la media ya terminada) y la sirve a sus participantes. Redis
 * la sigue teniendo 1 h para el review en vivo; después solo existe acá.
 */
@Injectable()
export class StoryHistoryService {
  private readonly logger = new Logger(StoryHistoryService.name);

  constructor(
    @InjectRepository(Story) private readonly stories: Repository<Story>,
    private readonly urls: StoryUrlSigner,
  ) {}

  /** Un error al guardar no afecta a la partida: queda en el log (y en Redis 1 h). */
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

  /**
   * Una imagen regenerada por un admin: se guarda la key de S3 en la viñeta.
   * Si no se pudo dibujar, la viñeta sigue sin imagen (se puede volver a pedir).
   */
  @OnEvent(STORY_EVENTS.panelImageRegenerated, { async: true, promisify: true })
  async onPanelImageRegenerated({
    storyId,
    order,
    image,
  }: PanelImageRegeneratedEvent): Promise<void> {
    if (image.imageStatus !== 'ready' || !image.imageKey) {
      this.logger.warn(`story ${storyId}: panel ${order} image could not be regenerated`);
      return;
    }
    try {
      await this.stories.manager.update(
        StoryPanel,
        { storyId, order },
        { imageKey: image.imageKey },
      );
      this.logger.log(`story ${storyId}: panel ${order} image regenerated`);
    } catch (error) {
      this.logger.error(
        `story ${storyId}: could not save a regenerated image: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Historietas en las que jugó el usuario, de la más reciente a la más vieja.
   * Las que quitó un admin no aparecen.
   */
  async list(userId: string, page: number, limit: number): Promise<StoryHistoryPage> {
    const [stories, total] = await this.detailsQuery()
      .innerJoin('story.participants', 'me', 'me.userId = :userId', { userId })
      .where('story.visibility = :published', { published: StoryVisibility.PUBLISHED })
      .orderBy('story.finishedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items: await this.toItems(stories, userId), page, limit, total };
  }

  /**
   * Catálogo: todas las historietas publicadas, de cualquier jugador, de la
   * más reciente a la más vieja. `levels` filtra por nivel (cualquiera de
   * ellos) y `search` por título, jugadores o texto de las viñetas.
   */
  async listCatalog(
    userId: string,
    page: number,
    limit: number,
    { levels, search }: { levels?: Level[]; search?: string } = {},
  ): Promise<StoryHistoryPage> {
    const query = this.detailsQuery().where('story.visibility = :published', {
      published: StoryVisibility.PUBLISHED,
    });
    if (levels?.length) query.andWhere('story.level IN (:...levels)', { levels });
    if (search) whereStoryMatches(query, search);

    const [stories, total] = await query
      .orderBy('story.finishedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items: await this.toItems(stories, userId), page, limit, total };
  }

  /**
   * Manifiesto de una historieta guardada, con el mismo formato que el review.
   * Solo para sus participantes, y solo si sigue publicada: a los demás se les
   * responde 404, sin revelar que existe.
   */
  async get(storyId: string, userId: string): Promise<StoredStoryManifest> {
    const story = await this.findPublished(storyId);
    if (!story || !story.participants.some((participant) => participant.userId === userId)) {
      throw new NotFoundException('Story not found');
    }
    return this.storedManifestOf(story, userId);
  }

  /** Manifiesto de una historieta del catálogo (cualquier usuario); 404 si no está publicada. */
  async getFromCatalog(storyId: string, userId: string): Promise<StoredStoryManifest> {
    const story = await this.findPublished(storyId);
    if (!story) throw new NotFoundException('Story not found');
    return this.storedManifestOf(story, userId);
  }

  /**
   * Reacción del usuario a una viñeta de una historieta publicada (null la
   * quita). Actualización atómica del jsonb, como en la partida. Devuelve las
   * reacciones de la viñeta; 404 si no existe o no está publicada.
   */
  async react(
    storyId: string,
    order: number,
    userId: string,
    emoji: string | null,
  ): Promise<{ order: number; reactions: Record<string, string> }> {
    const rows = await this.stories.manager.query<{ reactions: Record<string, string> }[]>(
      `WITH updated AS (
         UPDATE "story_panel" AS panel SET "reactions" = CASE
           WHEN $3::text IS NULL THEN panel."reactions" - $2::text
           ELSE panel."reactions" || jsonb_build_object($2::text, $3::text)
         END
         FROM "story" AS story
         WHERE story."id" = panel."story_id" AND story."id" = $1
           AND story."visibility" = $5 AND panel."order" = $4
         RETURNING panel."reactions"
       )
       SELECT "reactions" FROM updated`,
      [storyId, userId, emoji, order, StoryVisibility.PUBLISHED],
    );
    if (rows.length === 0) throw new NotFoundException('Panel not found');
    return { order, reactions: rows[0].reactions };
  }

  /** Like a una historieta publicada. Idempotente: un segundo like no suma. */
  async like(storyId: string, userId: string): Promise<StoryLikes> {
    await this.assertPublished(storyId);
    await this.stories.manager
      .createQueryBuilder()
      .insert()
      .into(StoryLike)
      .values({ storyId, userId })
      .orIgnore()
      .execute();
    return this.likesOfOne(storyId, userId);
  }

  /** Quita el like del usuario (si no había, no cambia nada). */
  async unlike(storyId: string, userId: string): Promise<StoryLikes> {
    await this.assertPublished(storyId);
    await this.stories.manager.delete(StoryLike, { storyId, userId });
    return this.likesOfOne(storyId, userId);
  }

  /** Likes de varias historietas en una sola consulta (las que no tienen, no aparecen). */
  async likesOf(storyIds: string[], userId: string): Promise<Map<string, StoryLikes>> {
    if (storyIds.length === 0) return new Map();
    const rows = await this.stories.manager.query<
      { storyId: string; count: number; likedByMe: boolean }[]
    >(
      `SELECT "story_id" AS "storyId", COUNT(*)::int AS "count",
              BOOL_OR("user_id" = $2::uuid) AS "likedByMe"
         FROM "story_like"
        WHERE "story_id" = ANY($1::uuid[])
        GROUP BY "story_id"`,
      [storyIds, userId],
    );
    return new Map(
      rows.map((row) => [row.storyId, { count: row.count, likedByMe: row.likedByMe }]),
    );
  }

  /** Historieta con sus viñetas y participantes (y la cuenta y el avatar actual de cada uno). */
  detailsQuery() {
    return this.stories
      .createQueryBuilder('story')
      .leftJoinAndSelect('story.panels', 'panel')
      .leftJoinAndSelect('story.participants', 'participant')
      .leftJoinAndSelect('participant.user', 'user')
      .leftJoinAndSelect('user.avatar', 'avatar');
  }

  /** Manifiesto con las URLs firmadas de avatares y media. */
  async manifestOf(story: Story): Promise<ReviewManifest> {
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

  avatarsOf(story: Story): Promise<AvatarUrls> {
    return this.urls.avatarsFor(
      story.participants.map((participant) => ({
        userId: participant.userId,
        avatarKey: participant.user?.avatar?.key ?? null,
      })),
    );
  }

  /** Imagen firmada de la primera viñeta que tenga una; null si ninguna. */
  async coverUrlOf(story: Story): Promise<string | null> {
    const cover = [...story.panels]
      .sort((a, b) => a.order - b.order)
      .find((panel) => panel.imageKey);
    if (!cover) return null;
    const { imageUrl } = await this.urls.signMedia({ audioKey: null, imageKey: cover.imageKey });
    return imageUrl;
  }

  private async storedManifestOf(story: Story, userId: string): Promise<StoredStoryManifest> {
    const [manifest, likes] = await Promise.all([
      this.manifestOf(story),
      this.likesOfOne(story.id, userId),
    ]);
    return { ...manifest, likes, reactionOptions: STORY_REACTIONS };
  }

  private async likesOfOne(storyId: string, userId: string): Promise<StoryLikes> {
    return (await this.likesOf([storyId], userId)).get(storyId) ?? NO_LIKES;
  }

  private async assertPublished(storyId: string): Promise<void> {
    const published = await this.stories.exists({
      where: { id: storyId, visibility: StoryVisibility.PUBLISHED },
    });
    if (!published) throw new NotFoundException('Story not found');
  }

  private findPublished(storyId: string): Promise<Story | null> {
    return this.detailsQuery()
      .where('story.id = :storyId', { storyId })
      .andWhere('story.visibility = :published', { published: StoryVisibility.PUBLISHED })
      .getOne();
  }

  private async toItems(stories: Story[], userId: string) {
    const likes = await this.likesOf(
      stories.map((story) => story.id),
      userId,
    );
    return Promise.all(
      stories.map(async (story) => {
        const [avatars, coverUrl] = await Promise.all([
          this.avatarsOf(story),
          this.coverUrlOf(story),
        ]);
        return toHistoryItem(story, userId, avatars, coverUrl, likes.get(story.id) ?? NO_LIKES);
      }),
    );
  }
}
