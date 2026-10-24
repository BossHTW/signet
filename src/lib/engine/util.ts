import { differenceInCalendarDays, differenceInYears, parseISO, isWithinInterval } from "date-fns";

export const cents = (c: number) => (c / 100).toFixed(2);
export const sum = (xs: { cents: number }[]) => xs.reduce((a, b) => a + b.cents, 0);
export const daysBetween = (a: string, b: string) => Math.abs(differenceInCalendarDays(parseISO(a), parseISO(b)));
export const yearsBetween = (dob: string, today: string) => differenceInYears(parseISO(today), parseISO(dob));
export const within = (d: string, start: string, end: string) =>
  isWithinInterval(parseISO(d), { start: parseISO(start), end: parseISO(end) });
export const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
export function tally<T extends string>(xs: T[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}
