export class CacheKeys {
  static match(roomId: string): string {
    return `match:${roomId}`;
  }
}
