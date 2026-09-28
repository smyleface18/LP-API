import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CognitoUser } from '../auth/type';
import { StoryHistoryService } from './story-history.service';
import { StoryCatalogQueryDto } from './dto/story-catalog-query.dto';

/**
 * Catálogo del modo Historieta: las historietas publicadas de todos los
 * jugadores, para cualquier usuario autenticado. Solo lectura.
 */
@Controller('story/catalog')
@UseGuards(JwtAuthGuard)
export class StoryCatalogController {
  constructor(private readonly history: StoryHistoryService) {}

  /**
   * `GET /story/catalog?page=1&limit=20&level=A1,A2&search=robot`: de la más
   * reciente a la más vieja.
   */
  @Get()
  list(@CurrentUser() user: CognitoUser, @Query() query: StoryCatalogQueryDto) {
    return this.history.listCatalog(user.username, query.page, query.limit, {
      levels: query.level,
      search: query.search,
    });
  }

  /** `GET /story/catalog/:storyId`: el manifiesto, con el formato de `storyReviewReady`. */
  @Get(':storyId')
  get(@Param('storyId', ParseUUIDPipe) storyId: string) {
    return this.history.getFromCatalog(storyId);
  }
}
