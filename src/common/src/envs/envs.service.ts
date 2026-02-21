import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EnvsService {
  constructor(private readonly config: ConfigService) {}

  get port(): number {
    return this.getNumber('PORT', 3000);
  }

  get dbHost(): string {
    return this.getString('DB_HOST');
  }

  get dbPort(): number {
    return this.getNumber('POSTGRES_PORT', 5432);
  }

  get dbUser(): string {
    return this.getString('POSTGRES_USER');
  }

  get dbPassword(): string {
    return this.getString('POSTGRES_PASSWORD');
  }

  get dbName(): string {
    return this.getString('POSTGRES_DB');
  }

  get redisHost(): string {
    return this.getString('REDIS_HOST');
  }

  get redisPort(): number {
    return this.getNumber('REDIS_PORT', 6379);
  }

  get matchTtl(): number {
    return this.getNumber('MATCH_TTL', 3600);
  }

  // Helpers para evitar valores undefined
  private getString(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) throw new Error(`Missing env variable: ${key}`);
    return value;
  }

  private getNumber(key: string, fallback?: number): number {
    const value = this.config.get<string>(key);
    if (!value && fallback !== undefined) return fallback;
    if (!value) throw new Error(`Missing env variable: ${key}`);
    return Number(value);
  }
}
