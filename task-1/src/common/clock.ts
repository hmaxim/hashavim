import { Injectable } from '@nestjs/common';

export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

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
