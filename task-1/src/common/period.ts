import { PeriodKind } from '../config/app-config';

export function periodIdFor(now: Date, period: PeriodKind): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  if (period === 'monthly') {
    return `${y}-${m}`;
  }
  return `${y}-${m}-${d}`;
}

export function periodBounds(
  periodId: string,
  period: PeriodKind,
): { start: string; end: string } {
  if (period === 'monthly') {
    const [y, m] = periodId.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
    return { start: start.toISOString(), end: end.toISOString() };
  }
  const [y, m, d] = periodId.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}
