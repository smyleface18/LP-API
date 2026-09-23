import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 } from 'uuid';
import { MediaAsset } from '@/db/entities';
import { MediaStatus } from '@/db/enum/media.enum';
import { ContentType } from '@/db/enum/question.enum';
import { EnvsService } from '@/common/src/envs/envs.service';
import { StorageService } from '@/common/src/storage/storage.service';
import { PresignMediaDto } from './dto/presign-media.dto';

export interface PresignedUpload {
  mediaId: string;
  uploadUrl: string;
  key: string;
}

export interface CleanupResult {
  deletedPending: number;
  deletedUnreferenced: number;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(MediaAsset)
    private readonly repo: Repository<MediaAsset>,
    private readonly storage: StorageService,
    private readonly envs: EnvsService,
  ) {}

  async createPresignedUpload(dto: PresignMediaDto, userId: string): Promise<PresignedUpload> {
    const key = this.buildKey(dto.contentType, dto.fileName);

    const media = this.repo.create({
      key,
      bucketName: this.envs.awsConfig.s3BucketName,
      contentType: dto.contentType,
      mimeType: dto.mimeType,
      displayName: dto.fileName,
      status: MediaStatus.PENDING,
      uploadedByUserId: userId,
    });
    await this.repo.save(media);

    const uploadUrl = await this.storage.getUploadUrl(key, dto.mimeType);

    return { mediaId: media.id, uploadUrl, key };
  }

  async confirm(id: string): Promise<MediaAsset> {
    const media = await this.findOne(id);

    if (media.status === MediaStatus.CONFIRMED) {
      return (await this.signUrl(media))!;
    }

    const metadata = await this.storage.headObject(media.key);
    if (!metadata) {
      throw new BadRequestException('The file has not been uploaded to S3 yet');
    }

    media.status = MediaStatus.CONFIRMED;
    media.size = metadata.size;

    const saved = await this.repo.save(media);

    return (await this.signUrl(saved))!;
  }

  async findOne(id: string): Promise<MediaAsset> {
    const media = await this.repo.findOne({ where: { id } });
    if (!media) throw new NotFoundException(`Media asset ${id} not found`);

    return media;
  }

  /**
   * Devuelve una copia del MediaAsset con `url` reemplazada por una URL de
   * lectura firmada y fresca. `url` nunca se guarda en BD como fuente de
   * verdad (el bucket es privado y expira), solo se calcula al servir.
   */
  async signUrl(
    media: MediaAsset | undefined | null,
    expiresInSeconds?: number,
  ): Promise<MediaAsset | undefined> {
    if (!media) return undefined;

    const url = await this.storage.getReadUrl(media.key, expiresInSeconds);

    return { ...media, url };
  }

  private buildKey(contentType: ContentType, fileName?: string): string {
    const prefix = contentType.toLowerCase();
    const extension = fileName?.includes('.') ? fileName.split('.').pop() : undefined;

    return `${prefix}/${v4()}${extension ? `.${extension}` : ''}`;
  }

  /**
   * Borra MediaAsset que quedaron abandonados:
   * - PENDING más viejos que `pendingOlderThanMs` (la URL de subida ya expiró,
   *   nunca se va a confirmar).
   * - CONFIRMED más viejos que `unreferencedOlderThanMs` que ningún Question,
   *   QuestionOption o User (avatar) referencia.
   * El margen de antigüedad evita borrar algo que está a mitad de un flujo
   * (recién confirmado pero todavía no asociado a la pregunta que se está creando).
   */
  async cleanupOrphans(
    pendingOlderThanMs: number = ONE_HOUR_MS,
    unreferencedOlderThanMs: number = ONE_HOUR_MS,
  ): Promise<CleanupResult> {
    const deletedPending = await this.deleteMatching(
      `SELECT id, key FROM media_asset WHERE status = 'PENDING' AND "createdAt" < $1`,
      pendingOlderThanMs,
    );

    const deletedUnreferenced = await this.deleteMatching(
      `SELECT m.id, m.key FROM media_asset m
       WHERE m.status = 'CONFIRMED' AND m."createdAt" < $1
         AND NOT EXISTS (SELECT 1 FROM question q WHERE q.media_id = m.id)
         AND NOT EXISTS (SELECT 1 FROM question_option qo WHERE qo.media_id = m.id)
         AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.avatar_id = m.id)`,
      unreferencedOlderThanMs,
    );

    return { deletedPending, deletedUnreferenced };
  }

  private async deleteMatching(query: string, olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows: { id: string; key: string }[] = await this.repo.manager.query(query, [cutoff]);

    for (const row of rows) {
      await this.storage.deleteObject(row.key).catch(() => undefined);
      await this.repo.delete(row.id);
    }

    return rows.length;
  }
}
