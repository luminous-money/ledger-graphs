import { atDepth, flowSign, lastPart, under } from "./accounts.js";
import { addMonths, dayOf, daysInMonth, lastOf, monthOf } from "./dates.js";
import { cents, units } from "./money.js";
import { DEFAULT_ROOTS, type Posting, type Roots } from "./types.js";

export type Slice = {
  account: string;
  label: string;
  amount: number;
  /** Of the total, 0 to 1. */
  share: number;
  /** Whether it has accounts under it to drill into. */
  more: boolean;
};

export type Breakdown = {
  currency: string;
  /** What's broken down: the root, or the category drilled into. */
  of: string;
  /** The first month counted. */
  from: string;
  /** The last month counted: the one asked for, or today's if that's earlier. */
  through: string;
  /** Whether the amounts are each a month's average over the window, or (false) its sum. */
  average: boolean;
  /** The months averaged over: the window's, today's counting as the part of it gone (unless
   * it's the window's only one). */
  months: number;
  total: number;
  slices: Slice[];
  /** The rest, together. */
  other: { amount: number; share: number; accounts: string[] } | null;
  /** Each month of the window, oldest first: what each slice (in `slices`' order) and Other
   * came to in it, not averaged, to draw a bar a month. */
  byMonth: BreakdownMonth[];
};

export type BreakdownMonth = {
  month: string;
  /** Still going: today's month, and today isn't its last day. */
  partial: boolean;
  /** Each slice's, in `slices`' order. */
  amounts: number[];
  other: number;
  total: number;
};

/**
 * Where the money goes (or comes from): the largest categories `depth` levels under `root`
 * (or, drilling in, the accounts just under `of`) from the first of `from`'s month through the
 * end of `through`'s, each as a monthly average over those months or (`average: false`) summed;
 * the rest as Other. The window stops at today, so a month ahead adds nothing to the average, and
 * today's month counts as the part of it that's gone. `byMonth` has what each came to in each
 * month of the window.
 */
export function breakdown({
  postings,
  today,
  currency,
  root,
  of,
  depth = 1,
  slices = 6,
  from,
  through,
  average = true,
  roots = DEFAULT_ROOTS,
}: {
  postings: Posting[];
  today: string;
  currency: string;
  root?: string;
  of?: string;
  depth?: number;
  slices?: number;
  /** The first month (YYYY-MM) counted; by default, the first posting's under what's broken
   * down. */
  from?: string;
  /** The last month (YYYY-MM) counted; by default (and at the latest), today's. */
  through?: string;
  /** Each a month's average (the default), or summed over the window. */
  average?: boolean;
  roots?: Roots;
}): Breakdown {
  const base = of ?? root ?? roots.expenses;
  const levels = of ? 1 : depth;
  const current = monthOf(today);
  const last = through && monthOf(through) < current ? monthOf(through) : current;
  const inScope = postings.filter(
    (p) => p.currency === currency && under(p.account, base) && p.date <= today
  );
  const first = from ? monthOf(from) : (inScope.map((p) => monthOf(p.date)).sort()[0] ?? last);
  const sums = new Map<string, number>();
  // Each month's sums, by the same keys.
  const monthly = new Map<string, Map<string, number>>();
  const deeper = new Set<string>();
  for (const posting of inScope) {
    const month = monthOf(posting.date);
    if (month < first || month > last) continue;
    const key = atDepth(posting.account, base, levels);
    const amount = cents(posting.amount) * flowSign(base, roots);
    sums.set(key, (sums.get(key) ?? 0) + amount);
    const its = monthly.get(month) ?? new Map<string, number>();
    its.set(key, (its.get(key) ?? 0) + amount);
    monthly.set(month, its);
    if (posting.account !== key) deeper.add(key);
  }
  const inMonths: string[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) inMonths.push(m);
  // Today's month, when the window has others, counts as the part of it that's gone.
  const months =
    inMonths.length > 1 && last === current
      ? inMonths.length - 1 + dayOf(today) / daysInMonth(current)
      : inMonths.length;
  const divisor = average && months > 0 ? months : 1;
  const ranked = [...sums]
    .map(([account, sum]) => ({ account, sum: sum / divisor }))
    .filter((c) => c.sum > 0)
    .sort((a, b) => b.sum - a.sum);
  const total = ranked.reduce((n, c) => n + c.sum, 0);
  // Other only when it holds two or more: one left over is shown as itself.
  const shown = ranked.length === slices + 1 ? ranked : ranked.slice(0, slices);
  const rest = ranked.slice(shown.length);
  const share = (sum: number) => (total ? sum / total : 0);
  const byMonth = inMonths.map((month) => {
    const its = monthly.get(month) ?? new Map<string, number>();
    const amounts = shown.map((c) => its.get(c.account) ?? 0);
    const other = rest.reduce((n, c) => n + (its.get(c.account) ?? 0), 0);
    return {
      month,
      partial: month === current && today !== lastOf(month),
      amounts: amounts.map(units),
      other: units(other),
      // What's drawn: a category that comes to nothing or less over the window isn't.
      total: units(amounts.reduce((n, a) => n + a, other)),
    };
  });
  return {
    currency,
    of: base,
    from: first,
    through: last,
    average,
    months,
    total: units(total),
    slices: shown.map((c) => ({
      account: c.account,
      label: c.account === base ? `${lastPart(base)} (itself)` : lastPart(c.account),
      amount: units(c.sum),
      share: share(c.sum),
      more: deeper.has(c.account),
    })),
    other: rest.length
      ? {
          amount: units(rest.reduce((n, c) => n + c.sum, 0)),
          share: share(rest.reduce((n, c) => n + c.sum, 0)),
          accounts: rest.map((c) => c.account),
        }
      : null,
    byMonth,
  };
}
