import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRoles } from '@/db/enum/roles.enum';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CognitoUser } from '../auth/type';
import { StoryAdminService } from './story-admin.service';
import { AdminStoriesQueryDto, RemoveStoryDto, RestoreStoryDto } from './dto/story-admin.dto';

/** Moderación de historietas: solo ADMIN. */
@Controller('admin/stories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoles.ADMIN)
export class StoryAdminController {
  constructor(private readonly admin: StoryAdminService) {}

  /** `GET /admin/stories?page&limit&visibility&search`: publicadas y quitadas. */
  @Get()
  list(@Query() query: AdminStoriesQueryDto) {
    return this.admin.list(query);
  }

  /** `GET /admin/stories/:storyId`: resumen, jugadores, remoción, historial y manifiesto. */
  @Get(':storyId')
  get(@Param('storyId', ParseUUIDPipe) storyId: string) {
    return this.admin.get(storyId);
  }

  /** `POST /admin/stories/:storyId/remove` `{ reason, note? }`: la quita (borrado lógico). */
  @Post(':storyId/remove')
  remove(
    @CurrentUser() admin: CognitoUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: RemoveStoryDto,
  ) {
    return this.admin.remove(storyId, admin.username, dto.reason, dto.note);
  }

  /**
   * `POST /admin/stories/:storyId/regenerate-images`: vuelve a dibujar las
   * viñetas que quedaron sin imagen. Responde `{ queued, orders }` enseguida;
   * las imágenes llegan en unos segundos (o hasta ~3 min si el proveedor está lento).
   */
  @Post(':storyId/regenerate-images')
  regenerateImages(@Param('storyId', ParseUUIDPipe) storyId: string) {
    return this.admin.regenerateMissingImages(storyId);
  }

  /** `POST /admin/stories/:storyId/restore` `{ note? }`: la vuelve a publicar. */
  @Post(':storyId/restore')
  restore(
    @CurrentUser() admin: CognitoUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: RestoreStoryDto,
  ) {
    return this.admin.restore(storyId, admin.username, dto.note);
  }
}
