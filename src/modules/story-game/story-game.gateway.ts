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
import { StoryAvatars } from './story-avatars.service';
import { StoryError } from './domain/story-game.errors';
import { StorySnapshot } from './domain/story-game.types';
import {
  GameStateView,
  LobbyView,
  PanelReviewResultView,
  STORY_RULES,
  StoryRulesView,
  toGameStateView,
  toLobbyView,
} from './domain/story-game.views';
import {
  AuthorStatusEvent,
  DraftReviewedEvent,
  PanelConfirmedEvent,
  PanelReactionEvent,
  ReviewReadyEvent,
  STORY_EVENTS,
  StoryStateChangedEvent,
  TurnStartedEvent,
} from './domain/story-game.events';
import { JoinStoryGameDto } from './dto/join-story-game.dto';
import { UpdateConfigDto } from './dto/update-config.dto';
import { KickPlayerDto } from './dto/kick-player.dto';
import { SubmitPanelDraftDto } from './dto/submit-panel-draft.dto';
import { PanelOrderDto } from './dto/panel-order.dto';
import { ReactToPanelDto } from './dto/react-to-panel.dto';
import { GetReviewManifestDto } from './dto/get-review-manifest.dto';
import { ReviewManifest, toReviewManifest } from './domain/story-review';
import { createStoryValidationPipe } from './story-validation.pipe';
import { STORY_ERROR_EVENT, StorySocket, storyUserRoom } from './types';

/**
 * Namespace /story (modo Historieta). Solo traduce eventos: las reglas viven
 * en StoryGameService. La sala de Socket.IO es el gameId; además cada socket
 * está en `user:{userId}`, para hablarle a un usuario (o sacarlo de una sala)
 * en cualquier instancia. El adapter de Redis difunde entre instancias. La
 * partida actual de cada usuario se lee de Redis en cada evento.
 *
 * Las vistas llevan los avatares firmados, que se calculan con `await`. Para
 * que los eventos de una instancia salgan en el orden en que el servicio los
 * publicó (ej. `lobbyUpdated` antes de `turnStarted`), toda emisión a una sala
 * pasa por `emitInOrder`.
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
  /** Cola de emisiones a salas: ver la nota de la clase. */
  private emissions: Promise<void> = Promise.resolve();

  constructor(
    private readonly storyGameService: StoryGameService,
    private readonly wsAuthService: WsAuthService,
    private readonly avatars: StoryAvatars,
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
      if (snapshot) await this.broadcast(snapshot);
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
      await this.broadcast(snapshot);
      // Estado completo para reconstruir la pantalla (incluido su turno, si es el autor).
      client.emit(
        'gameState',
        toGameStateView(snapshot, client.data.userId, await this.avatarsOf(snapshot)),
      );
    } catch (error) {
      this.logger.warn(`resume failed for ${client.data.userId}: ${(error as Error).message}`);
    }
  }

  @SubscribeMessage('createStoryGame')
  async handleCreate(@ConnectedSocket() client: StorySocket): Promise<ApiResponse<LobbyView>> {
    const snapshot = await this.storyGameService.createGame(client.data.userId);
    this.enterRoom(client.data.userId, snapshot.game.gameId);
    return { ok: true, data: await this.broadcast(snapshot), message: 'story game created' };
  }

  @SubscribeMessage('joinStoryGame')
  async handleJoin(
    @MessageBody() dto: JoinStoryGameDto,
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<LobbyView>> {
    const snapshot = await this.storyGameService.joinGame(dto.gameId, client.data.userId);
    this.enterRoom(client.data.userId, snapshot.game.gameId);
    return { ok: true, data: await this.broadcast(snapshot), message: 'story game joined' };
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
    return { ok: true, data: await this.broadcast(snapshot), message: 'config updated' };
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

    return { ok: true, data: await this.broadcast(snapshot), message: 'player kicked' };
  }

  /** LOBBY → PLAYING (solo anfitrión). `lobbyUpdated` y `turnStarted` llegan por los eventos del servicio. */
  @SubscribeMessage('startStory')
  async handleStartStory(@ConnectedSocket() client: StorySocket): Promise<ApiResponse<LobbyView>> {
    const snapshot = await this.storyGameService.startStory(
      await this.requireGameId(client),
      client.data.userId,
    );
    return {
      ok: true,
      data: toLobbyView(snapshot, await this.avatarsOf(snapshot)),
      message: 'story started',
    };
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

  /** `panelReaction` llega a la sala por los eventos del servicio. */
  @SubscribeMessage('reactToPanel')
  async handleReact(
    @MessageBody() dto: ReactToPanelDto,
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<null>> {
    await this.storyGameService.reactToPanel(
      dto.gameId ?? (await this.requireGameId(client)),
      client.data.userId,
      dto.panelOrder,
      dto.emoji,
    );
    return { ok: true, data: null, message: 'reaction saved' };
  }

  @SubscribeMessage('getGameState')
  async handleGetGameState(
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<GameStateView>> {
    const state = await this.storyGameService.getGameState(client.data.userId);
    return { ok: true, data: state, message: 'game state' };
  }

  /**
   * Manifiesto del review (REVIEW o FINISHED). Lleva `gameId` porque al entrar
   * a REVIEW la partida deja de ser la activa del usuario. El socket entra a la
   * sala para recibir las reacciones.
   */
  @SubscribeMessage('getReviewManifest')
  async handleGetReviewManifest(
    @MessageBody() dto: GetReviewManifestDto,
    @ConnectedSocket() client: StorySocket,
  ): Promise<ApiResponse<ReviewManifest>> {
    const manifest = await this.storyGameService.getReviewManifest(dto.gameId, client.data.userId);
    await client.join(dto.gameId);
    return { ok: true, data: manifest, message: 'review manifest' };
  }

  @SubscribeMessage('leaveGame')
  async handleLeave(@ConnectedSocket() client: StorySocket): Promise<ApiResponse<null>> {
    const gameId = await this.requireGameId(client);
    const snapshot = await this.storyGameService.leaveGame(gameId, client.data.userId);

    // Todos los sockets del usuario, en cualquier instancia.
    this.server.in(storyUserRoom(client.data.userId)).socketsLeave(gameId);
    await this.broadcast(snapshot);
    return { ok: true, data: null, message: 'left the game' };
  }

  /**
   * Hora del servidor para que el cliente estime su offset con el RTT (igual
   * que `timeSync` de /game): `turnStarted.endsAt` está en hora del servidor.
   */
  @SubscribeMessage('timeSync')
  handleTimeSync() {
    return { serverTime: Date.now() };
  }

  /** Rangos de la configuración, límites del borrador y reacciones permitidas. */
  @SubscribeMessage('getStoryRules')
  handleGetRules(): ApiResponse<StoryRulesView> {
    return { ok: true, data: STORY_RULES, message: 'story rules' };
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

  private avatarsOf(snapshot: StorySnapshot) {
    return this.avatars.urlsFor(snapshot.game.players);
  }

  /**
   * Encola una emisión: `build` corre después de las encoladas antes, así los
   * eventos salen en orden aunque armar el payload sea async. Un error se
   * registra y no frena las siguientes.
   */
  private emitInOrder<T>(build: () => Promise<T> | T): Promise<T> {
    const done = this.emissions.then(build);
    this.emissions = done.then(
      () => undefined,
      (error: Error) => this.logger.warn(`emit failed: ${error.message}`),
    );
    return done;
  }

  /** Para los `@OnEvent`: el error ya quedó registrado en la cola, no se propaga. */
  private emitFromEvent(build: () => unknown): Promise<void> {
    return this.emitInOrder(build).then(
      () => undefined,
      () => undefined,
    );
  }

  /** `lobbyUpdated` a la sala. Devuelve la vista, que también va en los acks. */
  private broadcast(snapshot: StorySnapshot): Promise<LobbyView> {
    return this.emitInOrder(async () => {
      const lobby = toLobbyView(snapshot, await this.avatarsOf(snapshot));
      this.server.to(snapshot.game.gameId).emit('lobbyUpdated', lobby);
      return lobby;
    });
  }

  // Eventos del servicio (ya guardados). Llegan en la instancia que hizo el
  // cambio, incluidos los timers, y se difunden a la sala en todas.

  @OnEvent(STORY_EVENTS.stateChanged)
  onStateChanged({ snapshot }: StoryStateChangedEvent) {
    return this.broadcast(snapshot).then(
      () => undefined,
      () => undefined,
    );
  }

  @OnEvent(STORY_EVENTS.turnStarted)
  onTurnStarted({ gameId, ...turn }: TurnStartedEvent) {
    return this.emitFromEvent(() => this.server.to(gameId).emit('turnStarted', turn));
  }

  @OnEvent(STORY_EVENTS.panelConfirmed)
  onPanelConfirmed({ gameId, ...panel }: PanelConfirmedEvent) {
    return this.emitFromEvent(() => this.server.to(gameId).emit('panelConfirmed', panel));
  }

  @OnEvent(STORY_EVENTS.authorStatus)
  onAuthorStatus({ gameId, ...status }: AuthorStatusEvent) {
    return this.emitFromEvent(() => this.server.to(gameId).emit('authorStatus', status));
  }

  /** A la sala menos el autor (todos sus sockets): él ya tiene `panelReviewResult`. */
  @OnEvent(STORY_EVENTS.draftReviewed)
  onDraftReviewed({ gameId, ...draft }: DraftReviewedEvent) {
    return this.emitFromEvent(() =>
      this.server
        .to(gameId)
        .except(storyUserRoom(draft.authorId))
        .emit('panelDraftReviewed', draft),
    );
  }

  @OnEvent(STORY_EVENTS.reviewReady)
  onReviewReady({ gameId, snapshot }: ReviewReadyEvent) {
    return this.emitFromEvent(async () => {
      const manifest = toReviewManifest(snapshot, await this.avatarsOf(snapshot));
      this.server.to(gameId).emit('storyReviewReady', manifest);
    });
  }

  /** Lleva `gameId`: un socket puede seguir en la sala de una partida ya terminada. */
  @OnEvent(STORY_EVENTS.panelReaction)
  onPanelReaction(reaction: PanelReactionEvent) {
    return this.emitFromEvent(() =>
      this.server.to(reaction.gameId).emit('panelReaction', reaction),
    );
  }
}
