import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRoles } from '@/db/enum/roles.enum';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CognitoUser } from '../auth/type';
import { StatsService } from './stats.service';

/** `GET /stats/me`: las estadísticas del jugador que pide (cualquier usuario). */
@Controller('stats')
@UseGuards(JwtAuthGuard)
export class PlayerStatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('me')
  me(@CurrentUser() user: CognitoUser) {
    return this.stats.player(user.username);
  }
}

/** `GET /admin/stats`: las estadísticas de la app (solo ADMIN). */
@Controller('admin/stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoles.ADMIN)
export class AdminStatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  get() {
    return this.stats.admin();
  }
}
