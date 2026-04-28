import { IsBoolean } from 'class-validator';
import { Column, CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ContentType } from '../enum/question.enum';

export class CoreEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @IsBoolean()
  @Column({ type: 'boolean', nullable: false, default: true })
  active!: boolean;

  @CreateDateColumn({ nullable: false })
  createdAt!: Date;

  @UpdateDateColumn({ nullable: true })
  updatedAt!: Date;
}

export class S3Object {
  key!: string;

  type!: string;

  displayName?: string;

  url?: string;

  bucketName?: string;
}

export class ContentObject {
  type!: ContentType;
  value!: string; // Para TEXTO, será el texto. Para otros, será la URL o la clave del S3Object.
  meta?: S3Object; // Opcional, para almacenar metadatos del archivo (key, bucket, etc.)
}
