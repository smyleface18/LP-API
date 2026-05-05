import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status = exception.getStatus();

    const exceptionResponse = exception.getResponse() as
      | string
      | { message?: string | string[]; error?: string };

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse.message ?? 'Unexpected error');

    const error =
      typeof exceptionResponse === 'string'
        ? undefined
        : (exceptionResponse.error ?? exception.name);

    response.status(status).json({
      ok: false,
      data: null,
      message,
      error,
      statusCode: status,
    });
  }
}
