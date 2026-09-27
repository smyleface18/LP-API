import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { HttpStatus, Logger, UseFilters, UsePipes } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server } from 'socket.io';
import { ApiResponse } from '@/common/src/api/api.type';
import { WsHttpExceptionFilter } from '@/common/src/api/ws-exception.filter';
import { WsAuthService } from '@/common/src/ws-auth/ws-auth.service';
import { StoryGameService } from './story-game.service';
import { StoryError } from './domain/story-game.errors';
import { StorySnapshot } from './domain/story-game.types';
import {
  GameStateView,
  LobbyView,
  PanelReviewResultView,
  toGameStateView,
  toLobbyView,
} from './domain/story-game.views';
import {
  PanelConfirmedEvent,
  STORY_EVENTS,
  StoryStateChangedEvent,
  TurnStartedEvent,
} from './domain/story-game.events';
import { JoinStoryGameDto } from './dto/join-story-game.dto';
import { UpdateConfigDto } from './dto/update-config.dto';
import { KickPlayerDto } from './dto/kick-player.dto';
import { SubmitPanelDraftDto } from './dto/submit-panel-draft.dto';
import { PanelOrderDto } from './dto/panel-order.dto';
import { createStoryValidationPipe } from './story-validation.pipe';
import { STORY_ERROR_EVENT, StorySocket, storyUserRoom } from './types';

/**
 * Namespace /story (modo Historieta). Solo traduce eventos: las reglas viven
 * en StoryGameService. La sala de Socket.IO es el gameId; además cada socket
 * está en `user:{userId}`, para hablarle a un usuario (o sacarlo de una sala)
 * en cualquier instancia. El adapter de Redis difunde entre instancias. La
 * partida actual de cada usuario se lee de Redis en cada evento.
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

    await client.join(storyUserRoom(client.data.userId));
    this.logger.debug(`user connected: ${client.data.userId}`);
    await this.resume(client);
  }

  async handleDisconnect(@ConnectedSocket() client: StorySocket) {
    const { userId } = client.data;
    if (!userId) return;

    try {
      const gameId = await this.storyGameService.getActiveGameId(userId);
      if (!gameId) return;
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

      await client.join(snapshot.game.gameId);
      this.broadcast(snapshot);
      // Estado completo para reconstruir la pantalla (incluido su turno, si es el autor).
      client.emit('gameState', toGameStateView(snapshot, client.data.userId));
    } catch (error) {
      this.logger.warn(`resume failed for ${client.data.userId}: ${(error as Error).message}`);
    }
  }

  @SubscribeMessage('createStoryGame')
  async handleCreate(@ConnectedSocket() client: StorySocket): Promise<ApiResponse<LobbyView>> {
    const snapshot = await this.storyGameService.createGame(client.data.userId);
    this.enterRoom(client.data.userId, snapshot.game.gameId);
    this.broadcast(snapshot);
    return { ok: true, data: toLobbyView(snapshot), message: 'story game created' };
  }

  @SubscribeMessage('joinStoryGame')
  async handleJoin(
    @MessageBody() dto: JoinStoryGameDto,
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<LobbyView>> {
    const snapshot = await this.storyGameService.joinGame(dto.gameId, client.data.userId);
    this.enterRoom(client.data.userId, snapshot.game.gameId);
    this.broadcast(snapshot);
    return { ok: true, data: toLobbyView(snapshot), message: 'story game joined' };
  }

  @SubscribeMessage('updateConfig')
  async handleUpdateConfig(
    @MessageBody() dto: UpdateConfigDto,
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<LobbyView>> {
    const snapshot = await this.storyGameService.updateConfig(
      await this.requireGameId(client),
      client.data.userId,
      dto,
    );
    this.broadcast(snapshot);
    return { ok: true, data: toLobbyView(snapshot), message: 'config updated' };
  }

  @SubscribeMessage('kickPlayer')
  async handleKick(
    @MessageBody() dto: KickPlayerDto,
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<LobbyView>> {
    const gameId = await this.requireGameId(client);
    const snapshot = await this.storyGameService.kickPlayer(gameId, client.data.userId, dto.userId);

    // El expulsado puede estar conectado a otra instancia: se le habla por su sala personal.
    const target = storyUserRoom(dto.userId);
    this.server.to(target).emit(STORY_ERROR_EVENT, {
      ok: false,
      status: HttpStatus.FORBIDDEN,
      message: 'The host removed you from the game',
      code: 'KICKED',
    });
    this.server.in(target).socketsLeave(gameId);

    this.broadcast(snapshot);
    return { ok: true, data: toLobbyView(snapshot), message: 'player kicked' };
  }

  /** LOBBY → PLAYING (solo anfitrión). `lobbyUpdated` y `turnStarted` llegan por los eventos del servicio. */
  @SubscribeMessage('startStory')
  async handleStartStory(@ConnectedSocket() client: StorySocket): Promise<ApiResponse<LobbyView>> {
    const snapshot = await this.storyGameService.startStory(
      await this.requireGameId(client),
      client.data.userId,
    );
    return { ok: true, data: toLobbyView(snapshot), message: 'story started' };
  }

  /** Borrador del autor. El resultado va solo al autor (todos sus sockets) y en el ack. */
  @SubscribeMessage('submitPanelDraft')
  async handleSubmitDraft(
    @MessageBody() dto: SubmitPanelDraftDto,
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<PanelReviewResultView>> {
    const { userId } = client.data;
    const result = await this.storyGameService.submitPanelDraft(
      await this.requireGameId(client),
      userId,
      dto.panelOrder,
      {
        text: dto.text,
        scene: dto.scene,
        characterIds: dto.characterIds,
        newCharacters: dto.newCharacters.map(({ name, kind, description }) => ({
          name,
          kind,
          description,
        })),
      },
    );
    this.server.to(storyUserRoom(userId)).emit('panelReviewResult', result);
    return { ok: true, data: result, message: 'draft reviewed' };
  }

  /** `panelConfirmed` y el siguiente `turnStarted` llegan por los eventos del servicio. */
  @SubscribeMessage('confirmPanel')
  async handleConfirmPanel(
    @MessageBody() dto: PanelOrderDto,
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<null>> {
    await this.storyGameService.confirmPanel(
      await this.requireGameId(client),
      client.data.userId,
      dto.panelOrder,
    );
    return { ok: true, data: null, message: 'panel confirmed' };
  }

  @SubscribeMessage('getGameState')
  async handleGetGameState(
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<GameStateView>> {
    const state = await this.storyGameService.getGameState(client.data.userId);
    return { ok: true, data: state, message: 'game state' };
  }

  @SubscribeMessage('leaveGame')
  async handleLeave(@ConnectedSocket() client: StorySocket): Promise<ApiResponse<null>> {
    const gameId = await this.requireGameId(client);
    const snapshot = await this.storyGameService.leaveGame(gameId, client.data.userId);

    // Todos los sockets del usuario, en cualquier instancia.
    this.server.in(storyUserRoom(client.data.userId)).socketsLeave(gameId);
    this.broadcast(snapshot);
    return { ok: true, data: null, message: 'left the game' };
  }

  /** Mete a la sala todos los sockets del usuario (puede tener la app abierta en otra instancia). */
  private enterRoom(userId: string, gameId: string) {
    this.server.in(storyUserRoom(userId)).socketsJoin(gameId);
  }

  private async requireGameId(client: StorySocket): Promise<string> {
    const gameId = await this.storyGameService.getActiveGameId(client.data.userId);
    if (!gameId) throw new StoryError('NOT_IN_GAME', 'Join a story game first');
    return gameId;
  }

  private broadcast(snapshot: StorySnapshot) {
    this.server.to(snapshot.game.gameId).emit('lobbyUpdated', toLobbyView(snapshot));
  }

  // Eventos del servicio (ya guardados). Llegan en la instancia que hizo el
  // cambio, incluidos los timers, y se difunden a la sala en todas.

  @OnEvent(STORY_EVENTS.stateChanged)
  onStateChanged({ snapshot }: StoryStateChangedEvent) {
    this.broadcast(snapshot);
  }

  @OnEvent(STORY_EVENTS.turnStarted)
  onTurnStarted({ gameId, ...turn }: TurnStartedEvent) {
    this.server.to(gameId).emit('turnStarted', turn);
  }

  @OnEvent(STORY_EVENTS.panelConfirmed)
  onPanelConfirmed({ gameId, ...panel }: PanelConfirmedEvent) {
    this.server.to(gameId).emit('panelConfirmed', panel);
  }
}
