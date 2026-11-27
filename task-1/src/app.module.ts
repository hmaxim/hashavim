import { DynamicModule, Module, Provider } from '@nestjs/common';
import { AiController } from './api/ai.controller';
import { UsersController } from './api/users.controller';
import { AI_PROVIDER, AiProvider, SimulatedAiProvider } from './ai/ai-provider';
import { APP_CONFIG, AppConfig, loadAppConfig } from './config/app-config';
import { CLOCK, Clock, SystemClock } from './common/clock';
import { SqliteDatabase } from './ledger/database';
import { LedgerRepository } from './ledger/ledger.repository';
import { QuotaService } from './quota/quota.service';
import { ReservationSweeper } from './quota/reservation.sweeper';
import { HealthController } from './api/health.controller';

export interface AppModuleOptions {
  config?: AppConfig;
  clock?: Clock;
  aiProvider?: AiProvider;
  enableSweeper?: boolean;
}

@Module({})
export class AppModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    const config = options.config ?? loadAppConfig();
    const clock = options.clock ?? new SystemClock();
    const enableSweeper = options.enableSweeper ?? true;

    const providers: Provider[] = [
      { provide: APP_CONFIG, useValue: config },
      { provide: CLOCK, useValue: clock },
      {
        provide: SqliteDatabase,
        useFactory: () => new SqliteDatabase(config.dbPath),
      },
      LedgerRepository,
      QuotaService,
      {
        provide: AI_PROVIDER,
        useFactory: () => options.aiProvider ?? new SimulatedAiProvider(config),
      },
    ];

    if (enableSweeper) {
      providers.push(ReservationSweeper);
    }

    return {
      module: AppModule,
      controllers: [AiController, UsersController, HealthController],
      providers,
      exports: [QuotaService, LedgerRepository, APP_CONFIG, CLOCK, AI_PROVIDER],
    };
  }
}
