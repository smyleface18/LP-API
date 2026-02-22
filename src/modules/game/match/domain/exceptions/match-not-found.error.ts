export class MatchNotFoundError extends Error {
  constructor(roomId: string) {
    super(`Match with id ${roomId} not found`);
    this.name = 'MatchNotFoundError';
  }
}
