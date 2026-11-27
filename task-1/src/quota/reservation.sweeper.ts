import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { QuotaService } from './quota.service';

@Injectable()
export class ReservationSweeper implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly quota: QuotaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      try {
        const n = this.quota.sweep();
        if (n > 0) {
          console.log(
            JSON.stringify({
              level: 'info',
              msg: 'reservation_sweep',
              released: n,
            }),
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(
          JSON.stringify({
            level: 'error',
            msg: 'reservation_sweep_failed',
            error: message,
          }),
        );
      }
    }, this.config.sweeperIntervalMs);
    // Do not keep the process alive solely for the sweeper in tests.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
