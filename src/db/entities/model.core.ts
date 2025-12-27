import { IsBoolean } from 'class-validator';
import { Column, CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export class CoreEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @IsBoolean()
  @Column({ type: 'boolean', nullable: false, default: true })
  active: boolean;

  @CreateDateColumn({ nullable: false })
  createdAt: Date;

  @UpdateDateColumn({ nullable: true })
  updatedAt: Date;
}

export class S3Object {
  key: string;

  type: string;

  displayName?: string;

  url?: string;

  bucketName?: string;
}
