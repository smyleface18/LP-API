import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '@/common/src/storage/storage.service';
import { AVATAR_URL_MIN_REMAINING_MS, AVATAR_URL_TTL_SEC } from './story-game.config';
import { AvatarUrls } from './domain/story-game.views';
import { StoryPlayer } from './domain/story-game.types';

/** Tope de URLs en caché; al pasarlo se descartan las vencidas. */
const MAX_CACHED_URLS = 1_000;

/**
 * URLs firmadas de los avatares de los jugadores. En Redis se guarda la key de
 * S3 y la URL se firma al enviar cada vista. Cada key reutiliza su URL mientras
 * le quede tiempo, así el cliente no recarga la imagen en cada evento. Un
 * avatar que no se puede firmar sale como `null`: nunca frena la partida.
 */
@Injectable()
export class StoryAvatars {
  private readonly logger = new Logger(StoryAvatars.name);
  private readonly cache = new Map<string, { url: string; expiresAt: number }>();

  constructor(private readonly storage: StorageService) {}

  /** userId → URL firmada; los jugadores sin avatar no aparecen. */
  async urlsFor(players: Pick<StoryPlayer, 'userId' | 'avatarKey'>[]): Promise<AvatarUrls> {
    const entries = await Promise.all(
      players.map(async ({ userId, avatarKey }) =>
        avatarKey ? ([userId, await this.urlOf(avatarKey)] as const) : null,
      ),
    );
    const urls: AvatarUrls = {};
    for (const entry of entries) if (entry?.[1]) urls[entry[0]] = entry[1];
    return urls;
  }

  private async urlOf(key: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt - now >= AVATAR_URL_MIN_REMAINING_MS) return cached.url;

    try {
      const url = await this.storage.getReadUrl(key, AVATAR_URL_TTL_SEC);
      if (this.cache.size >= MAX_CACHED_URLS) this.prune(now);
      this.cache.set(key, { url, expiresAt: now + AVATAR_URL_TTL_SEC * 1000 });
      return url;
    } catch (error) {
      this.logger.warn(`could not sign avatar ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  private prune(now: number) {
    for (const [key, { expiresAt }] of this.cache) {
      if (expiresAt - now < AVATAR_URL_MIN_REMAINING_MS) this.cache.delete(key);
    }
    // Si todas siguen vigentes, se descarta la más vieja (orden de inserción).
    const oldest = this.cache.keys().next();
    if (this.cache.size >= MAX_CACHED_URLS && !oldest.done) this.cache.delete(oldest.value);
  }
}
