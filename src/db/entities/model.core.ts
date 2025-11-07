import { IsBoolean } from 'class-validator';
import { BeforeInsert, Column, CreateDateColumn, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { v7 } from 'uuid';

export class CoreEntity {
  @PrimaryColumn({
    type: 'uuid',
    //generated: 'uuid',
  })
  id: string;

  @IsBoolean()
  @Column({ type: 'boolean', nullable: true, default: true })
  active: boolean;

  @CreateDateColumn({ nullable: false })
  createdAt: Date;

  @UpdateDateColumn({ nullable: true })
  updatedAt: Date;

  @BeforeInsert()
  protected beforeInsert() {
    this.id = v7();
  }
}
