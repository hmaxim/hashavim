import { loadAppConfig } from '../src/config/app-config';

describe('loadAppConfig', () => {
  it('loads defaults', () => {
    const cfg = loadAppConfig({});
    expect(cfg.defaultLimit).toBe(100);
    expect(cfg.period).toBe('daily');
    expect(cfg.port).toBe(3000);
  });

  it('rejects negative DEFAULT_LIMIT', () => {
    expect(() => loadAppConfig({ DEFAULT_LIMIT: '-1' })).toThrow(/DEFAULT_LIMIT/);
  });

  it('rejects non-integer DEFAULT_LIMIT', () => {
    expect(() => loadAppConfig({ DEFAULT_LIMIT: '1.5' })).toThrow(/integer/);
  });

  it('rejects bad PERIOD', () => {
    expect(() => loadAppConfig({ PERIOD: 'weekly' })).toThrow(/PERIOD/);
  });

  it('rejects AI_FAILURE_RATE out of range', () => {
    expect(() => loadAppConfig({ AI_FAILURE_RATE: '2' })).toThrow(/AI_FAILURE_RATE/);
  });
});
