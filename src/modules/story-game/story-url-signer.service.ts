import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '@/common/src/storage/storage.service';
import { SIGNED_URL_MIN_REMAINING_MS, SIGNED_URL_TTL_SEC } from './story-game.config';
import { AvatarUrls, MediaUrls, PanelMediaUrls } from './domain/story-game.views';
import { PanelMedia, StoryPlayer } from './domain/story-game.types';

/** Tope de URLs en caché; al pasarlo se descartan las vencidas. */
const MAX_CACHED_URLS = 1_000;

/**
 * URLs firmadas de los archivos de S3 del modo Historieta: avatares de los
 * jugadores y media de las viñetas. En Redis se guardan las keys (el bucket es
 * privado y las URLs vencen) y se firman al enviar cada vista. Cada key
 * reutiliza su URL mientras le quede tiempo, así el cliente no recarga la
 * imagen o el audio en cada evento. Una key que no se puede firmar sale como
 * `null`: nunca frena la partida.
 */
@Injectable()
export class StoryUrlSigner {
  private readonly logger = new Logger(StoryUrlSigner.name);
  private readonly cache = new Map<string, { url: string; expiresAt: number }>();

  constructor(private readonly storage: StorageService) {}

  /** userId → URL firmada; los jugadores sin avatar no aparecen. */
  async avatarsFor(players: Pick<StoryPlayer, 'userId' | 'avatarKey'>[]): Promise<AvatarUrls> {
    const entries = await Promise.all(
      players.map(async ({ userId, avatarKey }) =>
        avatarKey ? ([userId, await this.urlOf(avatarKey)] as const) : null,
      ),
    );
    const urls: AvatarUrls = {};
    for (const entry of entries) if (entry?.[1]) urls[entry[0]] = entry[1];
    return urls;
  }

  /**
   * Media de las viñetas que la tienen (las demás no aparecen). Sirve para las
   * viñetas de Redis y para las del historial (solo necesita las keys).
   */
  async mediaFor(
    panels: { order: number; media?: Pick<PanelMedia, 'audioKey' | 'imageKey'> }[],
  ): Promise<MediaUrls> {
    const entries = await Promise.all(
      panels
        .filter(({ media }) => media?.audioKey || media?.imageKey)
        .map(async ({ order, media }) => [order, await this.signMedia(media!)] as const),
    );
    return Object.fromEntries(entries);
  }

  async signMedia(media: Pick<PanelMedia, 'audioKey' | 'imageKey'>): Promise<PanelMediaUrls> {
    const [audioUrl, imageUrl] = await Promise.all([
      media.audioKey ? this.urlOf(media.audioKey) : null,
      media.imageKey ? this.urlOf(media.imageKey) : null,
    ]);
    return { audioUrl, imageUrl };
  }

  private async urlOf(key: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt - now >= SIGNED_URL_MIN_REMAINING_MS) return cached.url;

    try {
      const url = await this.storage.getReadUrl(key, SIGNED_URL_TTL_SEC);
      if (this.cache.size >= MAX_CACHED_URLS) this.prune(now);
      this.cache.set(key, { url, expiresAt: now + SIGNED_URL_TTL_SEC * 1000 });
      return url;
    } catch (error) {
      this.logger.warn(`could not sign ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  private prune(now: number) {
    for (const [key, { expiresAt }] of this.cache) {
      if (expiresAt - now < SIGNED_URL_MIN_REMAINING_MS) this.cache.delete(key);
    }
    // Si todas siguen vigentes, se descarta la más vieja (orden de inserción).
    const oldest = this.cache.keys().next();
    if (this.cache.size >= MAX_CACHED_URLS && !oldest.done) this.cache.delete(oldest.value);
  }
}
