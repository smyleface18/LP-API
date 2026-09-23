import { EventEmitter2 } from '@nestjs/event-emitter';
import { GameService } from './game.service';
import { MatchService } from './match/match.service';
import { GAME_SCHEDULE_EVENT } from './queue/queue.service';
import { ANSWER_GRACE_MS, QUESTION_LEAD_MS } from './game-timing';

const ROOM = 'room-1';

describe('GameService (game loop orchestration)', () => {
  let match: jest.Mocked<
    Pick<MatchService, 'startMatch' | 'publishNextQuestion' | 'closeQuestion' | 'finishMatch'>
  >;
  let events: { emit: jest.Mock; emitAsync: jest.Mock };
  let service: GameService;

  const scheduled = () =>
    events.emitAsync.mock.calls
      .filter(([name]) => name === GAME_SCHEDULE_EVENT)
      .map(([, job]) => job as unknown);
  const emitted = (name: string): unknown[] =>
    (events.emit.mock.calls as [string, unknown][])
      .filter(([event]) => event === name)
      .map(([, payload]) => payload);

  beforeEach(() => {
    match = {
      startMatch: jest.fn(),
      publishNextQuestion: jest.fn(),
      closeQuestion: jest.fn(),
      finishMatch: jest.fn().mockResolvedValue([]),
    };
    events = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
    service = new GameService(match as unknown as MatchService, events as unknown as EventEmitter2);
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
  });

  afterEach(() => jest.restoreAllMocks());

  it('start schedules the first publish planned by the match', async () => {
    match.startMatch.mockResolvedValue({ seq: 1, publishAt: 4_000, firstQuestionAt: 5_500 });

    const { firstQuestionAt } = await service.start(ROOM, 'u1');

    expect(match.startMatch).toHaveBeenCalledWith(ROOM, 'u1', 1_000);
    expect(scheduled()).toEqual([{ roomId: ROOM, seq: 1, kind: 'publish-question', dueAt: 4_000 }]);
    expect(firstQuestionAt).toBe(5_500);
  });

  it('early close does nothing while players are still answering', async () => {
    match.closeQuestion.mockResolvedValue({ kind: 'pending' });

    await service.closeQuestionIfAllAnswered(ROOM, 2);

    expect(match.closeQuestion).toHaveBeenCalledWith(ROOM, 2, 1_000, { whenAllAnswered: true });
    expect(events.emit).not.toHaveBeenCalled();
    expect(scheduled()).toEqual([]);
  });

  it('early close ends the question and schedules the next one', async () => {
    match.closeQuestion.mockResolvedValue({
      kind: 'closed',
      seq: 3,
      questionId: 'q1',
      hasNext: true,
      nextPlannedAt: 4_000,
    });

    await service.closeQuestionIfAllAnswered(ROOM, 2);

    expect(emitted('game.question-ended')).toEqual([
      { roomId: ROOM, questionId: 'q1', nextQuestionAt: 4_000 + QUESTION_LEAD_MS },
    ]);
    expect(scheduled()).toEqual([{ roomId: ROOM, seq: 3, kind: 'publish-question', dueAt: 4_000 }]);
  });

  it('publish broadcasts the question window and schedules its close', async () => {
    match.publishNextQuestion.mockResolvedValue({
      kind: 'question',
      seq: 2,
      question: { id: 'q1', timeLimit: 10 } as never,
      questionNumber: 1,
      totalQuestions: 5,
      startsAt: 5_000,
      endsAt: 15_000,
    });

    await service.publishQuestion(ROOM, 1, 3_500);

    expect(match.publishNextQuestion).toHaveBeenCalledWith(ROOM, 1, 3_500, 1_000);
    expect(emitted('game.next-question')).toEqual([
      expect.objectContaining({ roomId: ROOM, startsAt: 5_000, endsAt: 15_000 }),
    ]);
    expect(scheduled()).toEqual([
      { roomId: ROOM, seq: 2, kind: 'close-question', dueAt: 15_000 + ANSWER_GRACE_MS },
    ]);
  });

  it('a stale publish does nothing', async () => {
    match.publishNextQuestion.mockResolvedValue({ kind: 'stale' });

    await service.publishQuestion(ROOM, 1, 3_500);

    expect(events.emit).not.toHaveBeenCalled();
    expect(scheduled()).toEqual([]);
  });

  it('publish finishes the match when there are no more questions', async () => {
    match.publishNextQuestion.mockResolvedValue({ kind: 'finished' });

    await service.publishQuestion(ROOM, 4, 3_500);

    expect(match.finishMatch).toHaveBeenCalledWith(ROOM);
    expect(emitted('game.finished')).toHaveLength(1);
  });

  it('an early close is rescheduled for the real deadline', async () => {
    match.closeQuestion.mockResolvedValue({ kind: 'early', seq: 2, dueAt: 15_500 });

    await service.closeQuestion(ROOM, 2);

    expect(scheduled()).toEqual([{ roomId: ROOM, seq: 2, kind: 'close-question', dueAt: 15_500 }]);
    expect(emitted('game.question-ended')).toEqual([]);
  });

  it('close announces the end and schedules the next publish at the planned time', async () => {
    match.closeQuestion.mockResolvedValue({
      kind: 'closed',
      seq: 3,
      questionId: 'q1',
      hasNext: true,
      nextPlannedAt: 18_500,
    });

    await service.closeQuestion(ROOM, 2);

    expect(emitted('game.question-ended')).toEqual([
      { roomId: ROOM, questionId: 'q1', nextQuestionAt: 18_500 + QUESTION_LEAD_MS },
    ]);
    expect(scheduled()).toEqual([
      { roomId: ROOM, seq: 3, kind: 'publish-question', dueAt: 18_500 },
    ]);
  });

  it('closing the last question finishes the match', async () => {
    match.closeQuestion.mockResolvedValue({
      kind: 'closed',
      seq: 3,
      questionId: 'q5',
      hasNext: false,
      nextPlannedAt: 18_500,
    });

    await service.closeQuestion(ROOM, 2);

    expect(emitted('game.question-ended')).toEqual([
      { roomId: ROOM, questionId: 'q5', nextQuestionAt: null },
    ]);
    expect(match.finishMatch).toHaveBeenCalledWith(ROOM);
    expect(scheduled()).toEqual([]);
  });
});
