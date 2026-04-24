import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

function isTransientPostgresTcpError(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
    return true;
  }
  const m = err.message;
  return (
    m.includes('ECONNRESET') ||
    m.includes('ECONNREFUSED') ||
    m.includes('ETIMEDOUT') ||
    m.includes('Connection terminated unexpectedly')
  );
}

/**
 * Never exposes raw Error messages, paths, or stacks to clients.
 * HttpException responses are passed through except 5xx bodies are replaced with a generic message.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      let body: Record<string, unknown>;

      if (typeof payload === 'string') {
        body = { statusCode: status, message: payload };
      } else if (typeof payload === 'object' && payload !== null) {
        body = { ...(payload as Record<string, unknown>) };
        body.statusCode = status;
      } else {
        body = { statusCode: status, message: 'Request failed' };
      }

      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(
          `${req.method} ${req.url} → ${status}`,
          exception.stack ?? exception.message,
        );
        body.message = 'An unexpected error occurred';
        if ('error' in body) {
          body.error = 'Internal Server Error';
        }
      }

      res.status(status).json(body);
      return;
    }

    const err =
      exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(`${req.method} ${req.url}`, err.stack ?? err.message);

    if (isTransientPostgresTcpError(err)) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message:
          'Database connection was interrupted. Retry the request; if this persists, check DATABASE_URL and Postgres availability.',
        error: 'Service Unavailable',
      });
      return;
    }

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred',
      error: 'Internal Server Error',
    });
  }
}
