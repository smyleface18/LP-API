import { PartialType } from '@nestjs/mapped-types';
import { CreateGameQuestionsGatewayDto } from './create-game-questions-gateway.dto';

export class UpdateGameQuestionsGatewayDto extends PartialType(CreateGameQuestionsGatewayDto) {}
