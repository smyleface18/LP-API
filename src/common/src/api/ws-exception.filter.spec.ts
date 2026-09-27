import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { WsHttpExceptionFilter } from './ws-exception.filter';
import { LockTimeoutError } from '../redis/redis-lock.service';
import { MatchNotFoundError } from '@/modules/game/match/domain/exceptions/match-not-found.error';

function makeHost(withAck: boolean) {
  const client = { emit: jest.fn() };
  const ack = jest.fn();
  const args: unknown[] = [client, { some: 'payload' }];
  if (withAck) args.push(ack);
  const host = {
    switchToWs: () => ({ getClient: () => client }),
    getArgs: () => args,
  } as unknown as ArgumentsHost;
  return { host, client, ack };
}

describe('WsHttpExceptionFilter', () => {
  it("emits 'error' by default (/game behavior unchanged)", () => {
    const { host, client } = makeHost(false);
    new WsHttpExceptionFilter().catch(new BadRequestException('missing roomId'), host);

    expect(client.emit).toHaveBeenCalledWith('error', {
      ok: false,
      status: 400,
      message: 'missing roomId',
    });
  });

  it('emits the configured event when there is no ack', () => {
    const { host, client } = makeHost(false);
    new WsHttpExceptionFilter('storyError').catch(new BadRequestException('nope'), host);

    expect(client.emit).toHaveBeenCalledWith('storyError', {
      ok: false,
      status: 400,
      message: 'nope',
    });
  });

  it('answers through the ack instead of emitting when the client sent one', () => {
    const { host, client, ack } = makeHost(true);
    new WsHttpExceptionFilter('storyError').catch(new BadRequestException('nope'), host);

    expect(ack).toHaveBeenCalledWith({ ok: false, status: 400, message: 'nope' });
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('forwards a domain code and joins validation messages', () => {
    const { host, client } = makeHost(false);
    const error = new HttpException(
      { code: 'VALIDATION_ERROR', message: ['a is too long', 'b is required'] },
      HttpStatus.BAD_REQUEST,
    );
    new WsHttpExceptionFilter('storyError').catch(error, host);

    expect(client.emit).toHaveBeenCalledWith('storyError', {
      ok: false,
      status: 400,
      message: 'a is too long\nb is required',
      code: 'VALIDATION_ERROR',
    });
  });

  it('keeps the trivia and lock mappings', () => {
    const filter = new WsHttpExceptionFilter();
    const notFound = makeHost(false);
    filter.catch(new MatchNotFoundError('room'), notFound.host);
    expect(notFound.client.emit).toHaveBeenCalledWith('error', {
      ok: false,
      status: 404,
      message: 'Match not found',
    });

    const busy = makeHost(false);
    filter.catch(new LockTimeoutError('lock'), busy.host);
    expect(busy.client.emit).toHaveBeenCalledWith('error', {
      ok: false,
      status: 503,
      message: 'The room is busy, try again',
    });
  });
});
