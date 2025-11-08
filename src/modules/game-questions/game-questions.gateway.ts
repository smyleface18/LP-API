import { WebSocketGateway, SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { GameQuestionsService } from './game-questions.service';
import { CreateGameQuestionDto } from './dto/create-game-question.dto';
import { UpdateGameQuestionDto } from './dto/update-game-question.dto';

@WebSocketGateway()
export class GameQuestionsGateway {
  constructor(private readonly gameQuestionsService: GameQuestionsService) {}

  @SubscribeMessage('createGameQuestion')
  create(@MessageBody() createGameQuestionDto: CreateGameQuestionDto) {
    return this.gameQuestionsService.create(createGameQuestionDto);
  }

  @SubscribeMessage('findAllGameQuestions')
  findAll() {
    return this.gameQuestionsService.findAll();
  }

  @SubscribeMessage('findOneGameQuestion')
  findOne(@MessageBody() id: number) {
    return this.gameQuestionsService.findOne(id);
  }

  @SubscribeMessage('updateGameQuestion')
  update(@MessageBody() updateGameQuestionDto: UpdateGameQuestionDto) {
    return this.gameQuestionsService.update(updateGameQuestionDto.id, updateGameQuestionDto);
  }

  @SubscribeMessage('removeGameQuestion')
  remove(@MessageBody() id: number) {
    return this.gameQuestionsService.remove(id);
  }
}
