import { HttpException, HttpStatus } from '@nestjs/common';

export type StoryErrorCode =
  | 'VALIDATION_ERROR'
  | 'USER_NOT_FOUND'
  | 'GAME_NOT_FOUND'
  | 'NOT_IN_GAME'
  | 'ALREADY_IN_GAME'
  | 'NOT_A_PLAYER'
  | 'NOT_HOST'
  | 'INVALID_STATE'
  | 'GAME_FULL'
  | 'NOT_ENOUGH_PLAYERS'
  | 'CHARACTERS_MISSING';

/**
 * Error de dominio del modo Historieta. Es una HttpException para que
 * WsHttpExceptionFilter lo traduzca a `{ ok, status, message, code }`.
 */
export class StoryError extends HttpException {
  constructor(
    readonly code: StoryErrorCode,
    message: string | string[],
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message }, status);
  }

  static gameNotFound(gameId: string) {
    return new StoryError('GAME_NOT_FOUND', `Story game ${gameId} not found`, HttpStatus.NOT_FOUND);
  }

  static notHost() {
    return new StoryError('NOT_HOST', 'Only the host can do this', HttpStatus.FORBIDDEN);
  }

  static notAPlayer() {
    return new StoryError(
      'NOT_A_PLAYER',
      'You are not a player of this game',
      HttpStatus.FORBIDDEN,
    );
  }

  static invalidState(action: string, status: string) {
    return new StoryError(
      'INVALID_STATE',
      `Cannot ${action} while the game is ${status}`,
      HttpStatus.CONFLICT,
    );
  }
}
