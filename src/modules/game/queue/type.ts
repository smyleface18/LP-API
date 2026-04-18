export interface GameQueueEvent {
  roomId: string;
  timeLimit?: number;
  delay?: number;
}

export interface GameQueueJobPayload {
  roomId: string;
  timeLimit?: number;
}
