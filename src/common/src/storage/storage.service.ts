import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EnvsService } from '../envs/envs.service';

export interface ObjectMetadata {
  size?: number;
  contentType?: string;
}

// Tiempo para que el cliente suba el archivo con la URL firmada antes de que expire.
const UPLOAD_URL_EXPIRES_IN_SECONDS = 5 * 60;
// Default para URLs de lectura; el caller puede pedir un TTL mayor (ej. duración de un match).
const DEFAULT_READ_URL_EXPIRES_IN_SECONDS = 15 * 60;

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor(private readonly envs: EnvsService) {
    const { region, accessKeyId, secretAccessKey, s3BucketName } = this.envs.awsConfig;

    this.bucketName = s3BucketName;
    this.client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  /** URL firmada para que el cliente suba el objeto directo a S3 (PUT). */
  async getUploadUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(this.client, command, { expiresIn: UPLOAD_URL_EXPIRES_IN_SECONDS });
  }

  /** URL firmada para leer el objeto (bucket privado, sin exponer la URL cruda de S3). */
  async getReadUrl(
    key: string,
    expiresInSeconds: number = DEFAULT_READ_URL_EXPIRES_IN_SECONDS,
  ): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /** Verifica que el objeto exista en S3. Devuelve null si no existe (para el paso de confirmación). */
  async headObject(key: string): Promise<ObjectMetadata | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
      );

      return { size: result.ContentLength, contentType: result.ContentType };
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
  }

  private isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;

    const name = (error as { name?: string }).name;
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;

    return name === 'NotFound' || statusCode === 404;
  }
}
