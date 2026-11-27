import { AiProvider, AiResult } from '../src/ai/ai-provider';
import { Clock } from '../src/common/clock';

/** Mutable clock for tests (period rollover, TTL expiry). */
export class FakeClock implements Clock {
  private current: Date;

  constructor(initial: Date = new Date('2024-01-15T12:00:00.000Z')) {
    this.current = new Date(initial.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** AI provider whose outcome and timing the test controls. */
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

  /** Block inside complete() until release() is called; resolves once a call is blocked. */
  block(): Promise<void> {
    const entered = new Promise<void>((resolve) => {
      this.enteredGate = resolve;
    });
    this.gate = new Promise((resolve) => {
      this.releaseGate = resolve;
    });
    return entered;
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
