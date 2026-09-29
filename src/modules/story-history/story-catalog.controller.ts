import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CognitoUser } from '../auth/type';
import { StoryHistoryService } from './story-history.service';
import { StoryCatalogQueryDto } from './dto/story-catalog-query.dto';
import { PanelReactionDto } from './dto/story-reaction.dto';

/**
 * Catálogo del modo Historieta: las historietas publicadas de todos los
 * jugadores, para cualquier usuario autenticado. Se pueden leer, reaccionar a
 * cada viñeta y darle like a la historieta completa.
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

  /**
   * `GET /story/catalog/:storyId`: el manifiesto, con el formato de
   * `storyReviewReady`, más los likes y las reacciones permitidas.
   */
  @Get(':storyId')
  get(@CurrentUser() user: CognitoUser, @Param('storyId', ParseUUIDPipe) storyId: string) {
    return this.history.getFromCatalog(storyId, user.username);
  }

  /** `PUT /story/catalog/:storyId/panels/:order/reaction` `{ emoji }` (null la quita). */
  @Put(':storyId/panels/:order/reaction')
  react(
    @CurrentUser() user: CognitoUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Param('order', ParseIntPipe) order: number,
    @Body() body: PanelReactionDto,
  ) {
    return this.history.react(storyId, order, user.username, body.emoji);
  }

  /** `PUT /story/catalog/:storyId/like`: idempotente. Devuelve `{ count, likedByMe }`. */
  @Put(':storyId/like')
  like(@CurrentUser() user: CognitoUser, @Param('storyId', ParseUUIDPipe) storyId: string) {
    return this.history.like(storyId, user.username);
  }

  /** `DELETE /story/catalog/:storyId/like`. Devuelve `{ count, likedByMe }`. */
  @Delete(':storyId/like')
  unlike(@CurrentUser() user: CognitoUser, @Param('storyId', ParseUUIDPipe) storyId: string) {
    return this.history.unlike(storyId, user.username);
  }
}
