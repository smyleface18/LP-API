import { Socket } from 'socket.io';
import { ModeMatch } from '../match/domain/match.interface';
import { Level } from 'src/db/enum/question.enum';

export interface ConnectionGameSocket extends Socket {
  data: {
    userId: string;
    roomId: string;
  };
}

export interface CreateGameDto {
  level: Level;
  modeMatch: ModeMatch;
}
