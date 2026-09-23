import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { CoreEntity } from './model.core';
import { ContentType } from '../enum/question.enum';
import { MediaStatus } from '../enum/media.enum';
import { User } from './user.entity';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

@Entity()
export class MediaAsset extends CoreEntity {
  @IsString()
  @IsNotEmpty()
  @Column()
  key!: string;

  @IsString()
  @IsNotEmpty()
  @Column()
  bucketName!: string;

  @IsEnum(ContentType)
  @Column({
    type: 'enum',
    enum: ContentType,
  })
  contentType!: ContentType;

  @IsOptional()
  @IsString()
  @Column({ nullable: true })
  mimeType?: string;

  @IsOptional()
  @IsString()
  @Column({ nullable: true })
  displayName?: string;

  @IsOptional()
  @IsNumber()
  @Column({ type: 'int', nullable: true })
  size?: number;

  @IsOptional()
  @IsString()
  @Column({ nullable: true })
  url?: string;

  @IsEnum(MediaStatus)
  @Column({
    type: 'enum',
    enum: MediaStatus,
    default: MediaStatus.PENDING,
  })
  status!: MediaStatus;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by_user_id' })
  uploadedBy?: User;

  @IsOptional()
  @IsUUID()
  @Column({ name: 'uploaded_by_user_id', type: 'uuid', nullable: true })
  uploadedByUserId?: string;
}
