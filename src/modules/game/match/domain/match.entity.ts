import { Question, User } from '@/db/entities';
import { MatchStatus, ModeMatch, PlayerInfo, RecordedAnswer } from './match.interface';
import { Level } from '@/db/enum/question.enum';
import { QuestionNotFoundError } from './exceptions/question-not-found.error';
import { ANSWER_GRACE_MS } from '../../game-timing';

export class Match {
  private readonly roomId: string;
  private readonly owner: User;
  private players = new Map<string, PlayerInfo>();
  private currentQuestionIndex = 0;
  private status: MatchStatus = MatchStatus.WAITING;
  private readonly questions: Question[];
  private readonly difficulty: Level;
  private readonly mode: ModeMatch;
  // Una respuesta por jugador y pregunta; se persisten al terminar la partida.
  private answers: RecordedAnswer[] = [];
  // Ventana de la pregunta activa en epoch ms (hora del servidor): se muestra en
  // `questionStartsAt` y se aceptan respuestas hasta `questionEndsAt` + gracia.
  private questionStartsAt: number | null = null;
  private questionEndsAt: number | null = null;
  // Número de fase: sube en cada transición (inicio, pregunta, cierre). Los
  // jobs del scheduler lo llevan; uno con seq viejo (duplicado, reintento,
  // partida anterior) se descarta. No se reinicia en la revancha a propósito.
  private seq = 0;
  // Evita guardar dos veces el resultado si finishMatch se dispara más de una vez.
  private resultsPersisted = false;
  // userIds que pidieron revancha tras terminar la partida.
  private rematchVotes = new Set<string>();

  constructor(
    roomId: string,
    difficulty: Level,
    mode: ModeMatch,
    questions: Question[],
    owner: User,
  ) {
    this.difficulty = difficulty;
    this.roomId = roomId;
    this.questions = questions;
    this.owner = owner;
    this.mode = mode;
    this.status = MatchStatus.WAITING;
    this.addPlayer(owner.id, owner.username, owner.level, owner.score, owner.avatar?.url);
  }

  getRoomId(): string {
    return this.roomId;
  }

  getDifficulty(): Level {
    return this.difficulty;
  }

  getMode(): ModeMatch {
    return this.mode;
  }

  addPlayer(
    userId: string,
    username: string = 'Anonymous',
    level: Level,
    totalScore: number = 0,
    avatar?: string,
  ) {
    if (this.players.has(userId)) return;

    this.players.set(userId, {
      userId: userId,
      username: username,
      level: level,
      matchScore: 0,
      totalScore: totalScore,
      isConnected: true,
      isOwner: this.owner.id === userId,
      avatar: avatar,
    });
  }

  disconnectPlayer(userId: string) {
    const player = this.players.get(userId);
    if (player) {
      player.isConnected = false;
    }
  }

  reconnectPlayer(userId: string) {
    const player = this.players.get(userId);
    if (player) {
      player.isConnected = true;
    }
  }

  isUserConnected(userId: string): boolean {
    return this.players.get(userId)?.isConnected ?? false;
  }

  getPlayersCount(): number {
    return this.players.size;
  }

  getPlayers(): string[] {
    return Array.from(this.players.keys());
  }

  getPlayersWithInfo(): PlayerInfo[] {
    return Array.from(this.players.values());
  }

  /** Activa la siguiente pregunta con su ventana [startsAt, endsAt] en hora del servidor. */
  sendNextQuestion(startsAt: number, endsAt: number): Question | null {
    if (this.currentQuestionIndex >= this.questions.length) {
      this.setStatus(MatchStatus.FINISHED);
      return null;
    }

    const question = this.questions[this.currentQuestionIndex];
    this.currentQuestionIndex++;
    this.setStatus(MatchStatus.QUESTION_ACTIVE);
    this.questionStartsAt = startsAt;
    this.questionEndsAt = endsAt;
    this.seq++;

    return question;
  }

  getSeq(): number {
    return this.seq;
  }

  getQuestionWindow(): { startsAt: number; endsAt: number } | null {
    if (this.questionStartsAt === null || this.questionEndsAt === null) return null;
    return { startsAt: this.questionStartsAt, endsAt: this.questionEndsAt };
  }

  /** Si una respuesta recibida en `now` (hora del servidor) entra en la ventana de la pregunta activa. */
  isAcceptingAnswers(now: number): boolean {
    const window = this.getQuestionWindow();
    return (
      this.status === MatchStatus.QUESTION_ACTIVE &&
      window !== null &&
      now >= window.startsAt &&
      now <= window.endsAt + ANSWER_GRACE_MS
    );
  }

  hasPlayer(userId: string): boolean {
    return this.players.has(userId);
  }

  /** La pregunta que se está respondiendo ahora (la última enviada), o null si no hay ninguna activa. */
  getActiveQuestion(): Question | null {
    if (this.status !== MatchStatus.QUESTION_ACTIVE || this.currentQuestionIndex === 0) return null;
    return this.questions[this.currentQuestionIndex - 1] ?? null;
  }

  hasAnswered(questionId: string, userId: string): boolean {
    return this.answers.some((a) => a.questionId === questionId && a.userId === userId);
  }

  recordAnswer(
    questionId: string,
    userId: string,
    optionId: string,
    isCorrect: boolean,
    now: number,
  ) {
    const elapsedMs = this.questionStartsAt !== null ? now - this.questionStartsAt : 0;
    this.answers.push({
      questionId,
      userId,
      optionId,
      isCorrect,
      timeTaken: Math.max(0, Math.round(elapsedMs / 1000)),
    });
  }

  getAnswers(): RecordedAnswer[] {
    return this.answers;
  }

  addRematchVote(userId: string) {
    this.rematchVotes.add(userId);
  }

  getRematchVotes(): number {
    return this.rematchVotes.size;
  }

  areResultsPersisted(): boolean {
    return this.resultsPersisted;
  }

  markResultsPersisted() {
    this.resultsPersisted = true;
  }

  /** Refleja en los jugadores el score total ya guardado en BD. */
  applyTotalScores(totals: Map<string, number>) {
    totals.forEach((total, userId) => {
      const player = this.players.get(userId);
      if (player) player.totalScore = total;
    });
  }

  addScore(userId: string, points: number) {
    const player = this.players.get(userId);
    if (player) {
      player.matchScore += points;
    }
  }

  finishCurrentQuestion() {
    if (this.status === MatchStatus.QUESTION_ACTIVE) {
      this.setStatus(MatchStatus.BETWEEN_QUESTIONS);
      this.seq++;
    }

    if (this.currentQuestionIndex >= this.questions.length) {
      this.setStatus(MatchStatus.FINISHED);
    }
  }

  hasNextQuestion(): boolean {
    return this.currentQuestionIndex < this.questions.length;
  }

  getResults(): PlayerInfo[] {
    return Array.from(this.players.values()).map((player) => ({
      userId: player.userId,
      username: player.username,
      level: player.level,
      matchScore: player.matchScore,
      totalScore: player.totalScore,
      isConnected: player.isConnected,
      isOwner: player.isOwner,
      avatar: player.avatar,
    }));
  }

  getStatus() {
    return this.status;
  }

  getQuestions() {
    return this.questions;
  }

  getQuestionById(questionId: string): Question {
    const question = this.questions.find((q) => q.id == questionId);
    if (!question) {
      throw new QuestionNotFoundError(questionId);
    }

    return question;
  }

  getOwner() {
    return this.owner;
  }

  start() {
    this.setStatus(MatchStatus.STARTING);
    this.seq++;
  }

  finish() {
    this.setStatus(MatchStatus.FINISHED);
    this.seq++;
  }

  resetForRematch() {
    this.currentQuestionIndex = 0;
    this.status = MatchStatus.WAITING;
    this.answers = [];
    this.questionStartsAt = null;
    this.questionEndsAt = null;
    this.resultsPersisted = false;
    this.rematchVotes.clear();
    this.players.forEach((player) => {
      player.matchScore = 0;
      player.isConnected = true;
    });
  }

  getcurrentQuestionIndex() {
    return this.currentQuestionIndex;
  }

  calculateMatchTimeout(): number {
    return this.questions.reduce((acc, question) => acc + question.timeLimit, 0);
  }

  getNextQuestion(): Question | null {
    if (this.currentQuestionIndex >= this.questions.length) {
      this.setStatus(MatchStatus.FINISHED);
      return null;
    }

    const question = this.questions[this.currentQuestionIndex];

    return question;
  }

  toPersistence(): any {
    return {
      roomId: this.roomId,
      difficulty: this.difficulty,
      mode: this.mode,
      status: this.status,
      currentQuestionIndex: this.currentQuestionIndex,
      players: Array.from(this.players.entries()),
      questions: this.questions,
      owner: this.owner,
      answers: this.answers,
      questionStartsAt: this.questionStartsAt,
      questionEndsAt: this.questionEndsAt,
      seq: this.seq,
      resultsPersisted: this.resultsPersisted,
      rematchVotes: Array.from(this.rematchVotes),
    };
  }

  isRoomEmpty(): boolean {
    const hasConnected = Array.from(this.players.values()).some((player) => player.isConnected);

    return !hasConnected;
  }

  setStatus(status: MatchStatus) {
    this.status = status;
  }

  static fromPersistence(data: unknown): Match {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid match snapshot: not an object');
    }

    const snapshot = data as Record<string, unknown>;

    // 🔎 Validar roomId
    if (typeof snapshot.roomId !== 'string' || snapshot.roomId.length === 0) {
      throw new Error('Invalid match snapshot: roomId');
    }

    // 🔎 Validar difficulty
    if (!Object.values(Level).includes(snapshot.difficulty as Level)) {
      throw new Error('Invalid match snapshot: difficulty');
    }

    // 🔎 Validar status
    const allowedStatus: MatchStatus[] = [
      MatchStatus.WAITING,
      MatchStatus.QUESTION_ACTIVE,
      MatchStatus.FINISHED,
      MatchStatus.BETWEEN_QUESTIONS,
      MatchStatus.PROCESSING,
      MatchStatus.PREPARING,
      MatchStatus.STARTING,
    ];
    if (!allowedStatus.includes(snapshot.status as MatchStatus)) {
      throw new Error('Invalid match snapshot: status');
    }

    // 🔎 Validar currentQuestionIndex
    if (typeof snapshot.currentQuestionIndex !== 'number' || snapshot.currentQuestionIndex < 0) {
      throw new Error('Invalid match snapshot: currentQuestionIndex');
    }

    // 🔎 Validar questions
    if (!Array.isArray(snapshot.questions)) {
      throw new Error('Invalid match snapshot: questions');
    }

    // 🔎 Validar players
    if (!Array.isArray(snapshot.players)) {
      throw new Error('Invalid match snapshot: players');
    }

    if (typeof snapshot.owner !== 'object' || !snapshot.owner) {
      throw new Error('Invalid match snapshot: owner');
    }

    // Crear instancia
    const match = new Match(
      snapshot.roomId,
      snapshot.difficulty as Level,
      ModeMatch.MULTIPLAYER,
      snapshot.questions as Question[],
      snapshot.owner as User,
    );

    // Restaurar estado
    match.setStatus(snapshot.status as MatchStatus);
    match.currentQuestionIndex = snapshot.currentQuestionIndex;

    // Reconstruir Map de players
    const playersMap = new Map<string, PlayerInfo>();

    for (const entry of snapshot.players) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== 'string' ||
        typeof entry[1] !== 'object'
      ) {
        throw new Error('Invalid match snapshot: malformed player entry');
      }

      const playerInfo = entry[1] as PlayerInfo;
      playersMap.set(entry[0], playerInfo);
    }

    match.players = playersMap;

    // Campos opcionales: snapshots guardados antes de que existieran no los traen.
    if (Array.isArray(snapshot.answers)) {
      match.answers = snapshot.answers as RecordedAnswer[];
    }
    if (typeof snapshot.questionStartsAt === 'number') {
      match.questionStartsAt = snapshot.questionStartsAt;
    }
    if (typeof snapshot.questionEndsAt === 'number') {
      match.questionEndsAt = snapshot.questionEndsAt;
    }
    if (typeof snapshot.seq === 'number') {
      match.seq = snapshot.seq;
    }
    match.resultsPersisted = snapshot.resultsPersisted === true;
    if (Array.isArray(snapshot.rematchVotes)) {
      match.rematchVotes = new Set(snapshot.rematchVotes as string[]);
    }

    return match;
  }
}
