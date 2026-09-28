import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CognitoUser } from '../auth/type';
import { StoryHistoryService } from './story-history.service';
import { StoryHistoryQueryDto } from './dto/story-history-query.dto';

/** Historial del modo Historieta: solo las historietas en las que jugó el usuario. */
@Controller('story')
@UseGuards(JwtAuthGuard)
export class StoryHistoryController {
  constructor(private readonly history: StoryHistoryService) {}

  /** `GET /story/history?page=1&limit=20`: de la más reciente a la más vieja. */
  @Get('history')
  list(@CurrentUser() user: CognitoUser, @Query() query: StoryHistoryQueryDto) {
    return this.history.list(user.username, query.page, query.limit);
  }

  /** `GET /story/history/:storyId`: el manifiesto, con el formato de `storyReviewReady`. */
  @Get('history/:storyId')
  get(@CurrentUser() user: CognitoUser, @Param('storyId', ParseUUIDPipe) storyId: string) {
    return this.history.get(storyId, user.username);
  }
}
