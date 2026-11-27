import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export interface AiResult {
  ok: boolean;
  text?: string;
  errorCode?: string;
  latencyMs: number;
  timedOut: boolean;
}

export interface AiProvider {
  complete(prompt: string): Promise<AiResult>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

@Injectable()
export class SimulatedAiProvider implements AiProvider {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async complete(prompt: string): Promise<AiResult> {
    const delay =
      this.config.aiMinDelayMs +
      Math.floor(
        Math.random() * (this.config.aiMaxDelayMs - this.config.aiMinDelayMs + 1),
      );

    let workTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const work = new Promise<AiResult>((resolve) => {
      workTimer = setTimeout(() => {
        const fail = Math.random() < this.config.aiFailureRate;
        if (fail) {
          resolve({
            ok: false,
            errorCode: 'AI_SIMULATED_FAILURE',
            latencyMs: delay,
            timedOut: false,
          });
        } else {
          resolve({
            ok: true,
            text: `echo:${prompt.slice(0, 200)}`,
            latencyMs: delay,
            timedOut: false,
          });
        }
      }, delay);
    });

    const timeout = new Promise<AiResult>((resolve) => {
      timeoutTimer = setTimeout(() => {
        resolve({
          ok: false,
          errorCode: 'AI_TIMEOUT',
          latencyMs: this.config.aiTimeoutMs,
          timedOut: true,
        });
      }, this.config.aiTimeoutMs);
    });

    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(workTimer);
      clearTimeout(timeoutTimer);
    }
  }
}
