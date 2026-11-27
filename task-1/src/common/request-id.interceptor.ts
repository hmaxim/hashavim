import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Observable, tap } from 'rxjs';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { requestId?: string }>();
    const res = http.getResponse<Response>();
    const incoming = req.header('x-request-id');
    const requestId = incoming && incoming.trim() !== '' ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const started = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          console.log(
            JSON.stringify({
              level: 'info',
              msg: 'request_completed',
              request_id: requestId,
              method: req.method,
              path: req.originalUrl,
              status: res.statusCode,
              duration_ms: Date.now() - started,
            }),
          );
        },
        error: (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.log(
            JSON.stringify({
              level: 'error',
              msg: 'request_failed',
              request_id: requestId,
              method: req.method,
              path: req.originalUrl,
              error: message,
              duration_ms: Date.now() - started,
            }),
          );
        },
      }),
    );
  }
}
