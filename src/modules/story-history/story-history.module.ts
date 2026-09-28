import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Story, StoryModerationLog, StoryPanel, StoryParticipant } from '@/db/entities';
import { StoryGameModule } from '@/modules/story-game/story-game.module';
import { StoryHistoryService } from './story-history.service';
import { StoryHistoryController } from './story-history.controller';
import { StoryCatalogController } from './story-catalog.controller';
import { StoryAdminController } from './story-admin.controller';
import { StoryAdminService } from './story-admin.service';

/**
 * Historietas terminadas en Postgres: historial de cada jugador, catálogo
 * público y moderación (panel de admin).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Story, StoryPanel, StoryParticipant, StoryModerationLog]),
    StoryGameModule,
  ],
  controllers: [StoryHistoryController, StoryCatalogController, StoryAdminController],
  providers: [StoryHistoryService, StoryAdminService],
})
export class StoryHistoryModule {}
