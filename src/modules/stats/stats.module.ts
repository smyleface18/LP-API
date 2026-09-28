import { Module } from '@nestjs/common';
import { StatsService } from './stats.service';
import { AdminStatsController, PlayerStatsController } from './stats.controller';

/** Estadísticas reales para el dashboard del jugador y el del admin. */
@Module({
  controllers: [PlayerStatsController, AdminStatsController],
  providers: [StatsService],
})
export class StatsModule {}
