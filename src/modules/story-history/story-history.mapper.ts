import { Story, StoryPanel, StoryParticipant } from '@/db/entities';
import { Level } from '@/db/enum/question.enum';
import { StorySnapshot } from '@/modules/story-game/domain/story-game.types';
import { closedPanels } from '@/modules/story-game/domain/story-turns';
import { ReviewManifest, toReviewManifest } from '@/modules/story-game/domain/story-review';
import { AvatarUrls, MediaUrls } from '@/modules/story-game/domain/story-game.views';
import { AdminStoryItem, StoryHistoryItem, StoryLikes } from './story-history.types';

/** Columnas de una entidad, sin las que pone la base ni las relaciones. */
type Row<T> = Omit<
  T,
  | 'id'
  | 'active'
  | 'createdAt'
  | 'updatedAt'
  | 'story'
  | 'user'
  | 'author'
  | 'panels'
  | 'participants'
  // Moderación: al guardar, la base la deja publicada y sin datos de remoción.
  | 'visibility'
  | 'removedAt'
  | 'removedBy'
  | 'removedById'
  | 'removalReason'
  | 'removalNote'
>;

/** Filas a guardar de una historieta terminada. */
export interface StoryRecords {
  story: Row<Story> & { id: string };
  panels: Row<StoryPanel>[];
  participants: Row<StoryParticipant>[];
}

/**
 * Partida FINISHED (Redis) → filas de Postgres. Parte del mismo manifiesto
 * del review, así el historial muestra exactamente lo que vieron los jugadores.
 */
export function toStoryRecords(snapshot: StorySnapshot, finishedAt: Date): StoryRecords {
  const { game } = snapshot;
  const storyId = game.storyId!;
  const manifest = toReviewManifest(snapshot);
  const mediaOf = new Map(closedPanels(snapshot).map((panel) => [panel.order, panel.media]));

  return {
    story: {
      id: storyId,
      gameId: game.gameId,
      title: game.title,
      level: game.config.level as Level,
      language: game.config.language,
      panelsCount: game.config.panelsCount,
      characters: manifest.characters,
      finishedAt,
    },
    panels: manifest.panels.map((panel) => {
      const media = mediaOf.get(panel.order);
      return {
        storyId,
        order: panel.order,
        authorId: panel.author.id,
        authorName: panel.author.name,
        originalText: panel.originalText,
        finalText: panel.finalText,
        scene: panel.scene,
        characterIds: panel.characterIds,
        corrections: panel.corrections,
        score: panel.score,
        reactions: panel.reactions,
        // Se guarda con la media terminada: un `pending` sería un plazo roto.
        mediaStatus: media?.status === 'pending' ? 'failed' : (media?.status ?? 'none'),
        audioKey: media?.audioKey ?? null,
        imageKey: media?.imageKey ?? null,
        speechMarks: media?.speechMarks ?? null,
      };
    }),
    participants: manifest.ranking.map((entry, index) => ({
      storyId,
      userId: entry.userId,
      username: entry.name,
      position: index + 1,
      panelsWritten: entry.panelsWritten,
      totalScore: entry.totalScore,
      averageScore: entry.averageScore,
      left: game.players.find((player) => player.userId === entry.userId)?.left ?? false,
    })),
  };
}

const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;
const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

/**
 * Historieta de Postgres → manifiesto del review (mismo formato que
 * `storyReviewReady`), con las URLs firmadas de avatares y media.
 */
export function toStoryManifest(
  story: Story,
  avatars: AvatarUrls = {},
  media: MediaUrls = {},
): ReviewManifest {
  return {
    storyId: story.id,
    gameId: story.gameId,
    title: story.title ?? null,
    characters: story.characters,
    ranking: [...story.participants].sort(byPosition).map((participant) => ({
      userId: participant.userId,
      name: participant.username,
      avatarUrl: avatars[participant.userId] ?? null,
      panelsWritten: participant.panelsWritten,
      totalScore: participant.totalScore,
      averageScore: participant.averageScore,
    })),
    panels: [...story.panels].sort(byOrder).map((panel) => ({
      order: panel.order,
      author: { id: panel.authorId ?? '', name: panel.authorName },
      originalText: panel.originalText,
      finalText: panel.finalText,
      scene: panel.scene,
      characterIds: panel.characterIds,
      corrections: panel.corrections,
      score: panel.score,
      reactions: panel.reactions as ReviewManifest['panels'][number]['reactions'],
      audioUrl: media[panel.order]?.audioUrl ?? null,
      speechMarks: panel.speechMarks,
      imageUrl: media[panel.order]?.imageUrl ?? null,
      mediaStatus: panel.mediaStatus as ReviewManifest['panels'][number]['mediaStatus'],
      // El historial no guarda el estado de la imagen: sin imagen guardada es `none`.
      imageStatus: panel.imageKey ? 'ready' : 'none',
    })),
  };
}

/** Fila del historial de un jugador: resumen para la lista. */
export function toHistoryItem(
  story: Story,
  userId: string,
  avatars: AvatarUrls = {},
  coverImageUrl: string | null = null,
  likes: StoryLikes = { count: 0, likedByMe: false },
): StoryHistoryItem {
  const participants = [...story.participants].sort(byPosition);
  const me = participants.find((participant) => participant.userId === userId);
  const [firstPanel] = [...story.panels].sort(byOrder);
  return {
    storyId: story.id,
    title: story.title ?? null,
    finishedAt: story.finishedAt.toISOString(),
    level: story.level,
    panelsCount: story.panels.length,
    excerpt: firstPanel?.finalText ?? '',
    coverImageUrl,
    players: participants.map((participant) => ({
      userId: participant.userId,
      name: participant.username,
      avatarUrl: avatars[participant.userId] ?? null,
    })),
    myPosition: me?.position ?? null,
    myScore: me?.totalScore ?? 0,
    likes,
  };
}

/** Fila del panel de admin: resumen, jugadores con su cuenta y datos de la remoción. */
export function toAdminStoryItem(
  story: Story,
  avatars: AvatarUrls = {},
  coverImageUrl: string | null = null,
): AdminStoryItem {
  const [firstPanel] = [...story.panels].sort(byOrder);
  return {
    storyId: story.id,
    gameId: story.gameId,
    title: story.title ?? null,
    finishedAt: story.finishedAt.toISOString(),
    level: story.level,
    panelsCount: story.panels.length,
    excerpt: firstPanel?.finalText ?? '',
    coverImageUrl,
    visibility: story.visibility,
    participants: [...story.participants].sort(byPosition).map((participant) => ({
      userId: participant.userId,
      username: participant.username,
      currentUsername: participant.user?.username ?? null,
      email: participant.user?.email ?? null,
      avatarUrl: avatars[participant.userId] ?? null,
      position: participant.position,
      panelsWritten: participant.panelsWritten,
      totalScore: participant.totalScore,
      left: participant.left,
    })),
    removal:
      story.removedAt && story.removalReason
        ? {
            removedAt: story.removedAt.toISOString(),
            removedBy: story.removedBy
              ? { userId: story.removedBy.id, username: story.removedBy.username }
              : null,
            reason: story.removalReason,
            note: story.removalNote ?? null,
          }
        : null,
  };
}
