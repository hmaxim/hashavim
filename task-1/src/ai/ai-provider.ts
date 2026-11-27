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

    const work = new Promise<AiResult>((resolve) => {
      setTimeout(() => {
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
      setTimeout(() => {
        resolve({
          ok: false,
          errorCode: 'AI_TIMEOUT',
          latencyMs: this.config.aiTimeoutMs,
          timedOut: true,
        });
      }, this.config.aiTimeoutMs);
    });

    return Promise.race([work, timeout]);
  }
}

/** Controllable AI for tests. */
export class ControllableAiProvider implements AiProvider {
  nextResult: AiResult = {
    ok: true,
    text: 'ok',
    latencyMs: 1,
    timedOut: false,
  };
  delayMs = 0;
  calls = 0;
  private gate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;
  private enteredGate: (() => void) | null = null;
  private enteredPromise: Promise<void> | null = null;

  /** Block inside complete() until release() is called. */
  block(): Promise<void> {
    this.enteredPromise = new Promise((resolve) => {
      this.enteredGate = resolve;
    });
    this.gate = new Promise((resolve) => {
      this.releaseGate = resolve;
    });
    return this.enteredPromise;
  }

  release(): void {
    if (this.releaseGate) {
      this.releaseGate();
      this.releaseGate = null;
      this.gate = null;
    }
  }

  async complete(_prompt: string): Promise<AiResult> {
    this.calls += 1;
    if (this.gate) {
      this.enteredGate?.();
      this.enteredGate = null;
      await this.gate;
    }
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    return { ...this.nextResult };
  }

  succeed(text = 'ok'): void {
    this.nextResult = { ok: true, text, latencyMs: 1, timedOut: false };
  }

  fail(code = 'AI_SIMULATED_FAILURE'): void {
    this.nextResult = {
      ok: false,
      errorCode: code,
      latencyMs: 1,
      timedOut: false,
    };
  }

  timeout(): void {
    this.nextResult = {
      ok: false,
      errorCode: 'AI_TIMEOUT',
      latencyMs: 1,
      timedOut: true,
    };
  }
}
