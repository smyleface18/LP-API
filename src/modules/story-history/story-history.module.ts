import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Story, StoryPanel, StoryParticipant } from '@/db/entities';
import { StoryGameModule } from '@/modules/story-game/story-game.module';
import { StoryHistoryService } from './story-history.service';
import { StoryHistoryController } from './story-history.controller';

/** Historial del modo Historieta en Postgres (Fase 4c). */
@Module({
  imports: [TypeOrmModule.forFeature([Story, StoryPanel, StoryParticipant]), StoryGameModule],
  controllers: [StoryHistoryController],
  providers: [StoryHistoryService],
})
export class StoryHistoryModule {}
