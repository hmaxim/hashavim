import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { RequestIdInterceptor } from './common/request-id.interceptor';
import { loadAppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.create(AppModule.forRoot({ config }), {
    logger: ['error', 'warn', 'log'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  app.enableShutdownHooks();

  await app.listen(config.port);
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'server_started',
      port: config.port,
      dbPath: config.dbPath,
      defaultLimit: config.defaultLimit,
      period: config.period,
    }),
  );
}

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ level: 'fatal', msg: 'boot_failed', error: message }));
  process.exit(1);
});
