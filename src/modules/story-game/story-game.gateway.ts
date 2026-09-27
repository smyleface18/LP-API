import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UseFilters, UsePipes } from '@nestjs/common';
import { Server } from 'socket.io';
import { ApiResponse } from '@/common/src/api/api.type';
import { WsHttpExceptionFilter } from '@/common/src/api/ws-exception.filter';
import { WsAuthService } from '@/common/src/ws-auth/ws-auth.service';
import { StoryGameService } from './story-game.service';
import { StoryError } from './domain/story-game.errors';
import { StorySnapshot, StoryStatus } from './domain/story-game.types';
import { LobbyView, toCharactersView, toLobbyView } from './domain/story-game.views';
import { JoinStoryGameDto } from './dto/join-story-game.dto';
import { UpdateConfigDto } from './dto/update-config.dto';
import { CreateCharacterDto } from './dto/create-character.dto';
import { createStoryValidationPipe } from './story-validation.pipe';
import { STORY_ERROR_EVENT, StorySocket } from './types';

/**
 * Namespace /story (modo Historieta). Solo traduce eventos: las reglas viven
 * en StoryGameService. La sala de Socket.IO es el gameId; el adapter de Redis
 * difunde entre instancias.
 */
@UseFilters(new WsHttpExceptionFilter(STORY_ERROR_EVENT))
@UsePipes(createStoryValidationPipe())
@WebSocketGateway({
  namespace: '/story',
  cors: {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
})
export class StoryGameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(StoryGameGateway.name);

  constructor(
    private readonly storyGameService: StoryGameService,
    private readonly wsAuthService: WsAuthService,
  ) {}

  async handleConnection(@ConnectedSocket() client: StorySocket) {
    const user = await this.wsAuthService.authenticateSocket(client, STORY_ERROR_EVENT);
    if (!user) return;

    this.logger.debug(`user connected: ${client.data.userId}`);
    await this.resume(client);
  }

  async handleDisconnect(@ConnectedSocket() client: StorySocket) {
    const { userId, gameId } = client.data;
    if (!userId || !gameId) return;

    try {
      const snapshot = await this.storyGameService.disconnect(gameId, userId);
      if (snapshot) this.broadcast(snapshot);
    } catch (error) {
      this.logger.warn(`disconnect handling failed: ${(error as Error).message}`);
    }
  }

  /** Si el usuario tenía una partida activa (en cualquier instancia), vuelve a su sala. */
  private async resume(client: StorySocket) {
    try {
      const snapshot = await this.storyGameService.resume(client.data.userId);
      if (!snapshot) return;

      await this.enterRoom(client, snapshot.game.gameId);
      this.broadcast(snapshot);
      if (snapshot.game.status !== StoryStatus.LOBBY) {
        client.emit('charactersUpdated', toCharactersView(snapshot));
      }
    } catch (error) {
      this.logger.warn(`resume failed for ${client.data.userId}: ${(error as Error).message}`);
    }
  }

  @SubscribeMessage('createStoryGame')
  async handleCreate(@ConnectedSocket() client: StorySocket): Promise<ApiResponse<LobbyView>> {
    const snapshot = await this.storyGameService.createGame(client.data.userId);
    await this.enterRoom(client, snapshot.game.gameId);
    this.broadcast(snapshot);
    return { ok: true, data: toLobbyView(snapshot), message: 'story game created' };
  }

  @SubscribeMessage('joinStoryGame')
  async handleJoin(
    @MessageBody() dto: JoinStoryGameDto,
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<LobbyView>> {
    const snapshot = await this.storyGameService.joinGame(dto.gameId, client.data.userId);
    await this.enterRoom(client, snapshot.game.gameId);
    this.broadcast(snapshot, { characters: snapshot.game.status !== StoryStatus.LOBBY });
    return { ok: true, data: toLobbyView(snapshot), message: 'story game joined' };
  }

  @SubscribeMessage('updateConfig')
  async handleUpdateConfig(
    @MessageBody() dto: UpdateConfigDto,
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<LobbyView>> {
    const snapshot = await this.storyGameService.updateConfig(
      this.requireGameId(client),
      client.data.userId,
      dto,
    );
    this.broadcast(snapshot);
    return { ok: true, data: toLobbyView(snapshot), message: 'config updated' };
  }

  @SubscribeMessage('startCharacters')
  async handleStartCharacters(
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<LobbyView>> {
    const snapshot = await this.storyGameService.startCharacters(
      this.requireGameId(client),
      client.data.userId,
    );
    this.broadcast(snapshot, { characters: true });
    return { ok: true, data: toLobbyView(snapshot), message: 'characters step started' };
  }

  @SubscribeMessage('createCharacter')
  async handleCreateCharacter(
    @MessageBody() dto: CreateCharacterDto,
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<null>> {
    const snapshot = await this.storyGameService.createCharacter(
      this.requireGameId(client),
      client.data.userId,
      dto,
    );
    this.broadcast(snapshot, { characters: true });
    return { ok: true, data: null, message: 'character saved' };
  }

  /** CHARACTERS → PLAYING (solo anfitrión). La apertura del primer turno llega en la Fase 2. */
  @SubscribeMessage('startStory')
  async handleStartStory(@ConnectedSocket() client: StorySocket): Promise<ApiResponse<LobbyView>> {
    const snapshot = await this.storyGameService.startStory(
      this.requireGameId(client),
      client.data.userId,
    );
    this.broadcast(snapshot);
    return { ok: true, data: toLobbyView(snapshot), message: 'story started' };
  }

  @SubscribeMessage('leaveGame')
  async handleLeave(@ConnectedSocket() client: StorySocket): Promise<ApiResponse<null>> {
    const gameId = this.requireGameId(client);
    const snapshot = await this.storyGameService.leaveGame(gameId, client.data.userId);

    await client.leave(gameId);
    client.data.gameId = undefined;
    this.broadcast(snapshot, { characters: snapshot.game.status === StoryStatus.CHARACTERS });
    return { ok: true, data: null, message: 'left the game' };
  }

  private async enterRoom(client: StorySocket, gameId: string) {
    await client.join(gameId);
    client.data.gameId = gameId;
  }

  private requireGameId(client: StorySocket): string {
    const { gameId } = client.data;
    if (!gameId) throw new StoryError('NOT_IN_GAME', 'Join a story game first');
    return gameId;
  }

  private broadcast(snapshot: StorySnapshot, { characters = false } = {}) {
    const room = snapshot.game.gameId;
    this.server.to(room).emit('lobbyUpdated', toLobbyView(snapshot));
    if (characters) this.server.to(room).emit('charactersUpdated', toCharactersView(snapshot));
  }
}
