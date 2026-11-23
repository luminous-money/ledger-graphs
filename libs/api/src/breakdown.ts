import { atDepth, flowSign, lastPart, under } from "./accounts.js";
import { addMonths, lastOf, monthOf } from "./dates.js";
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
  window: "average" | "month" | "total";
  /** The complete months averaged over (the window "average"). */
  months: number;
  /** The window "total": its first date (null: from the first posting). */
  from: string | null;
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
 * (or, drilling in, the accounts just under `of`), each as a monthly average over the last
 * `months` complete months, this month so far, or (the window "total") everything from `from`
 * to today, summed; the rest as Other. `byMonth` has what each came to in each month of the
 * window.
 */
export function breakdown({
  postings,
  today,
  currency,
  root,
  of,
  depth = 1,
  slices = 6,
  window = "average",
  months = 6,
  from,
  roots = DEFAULT_ROOTS,
}: {
  postings: Posting[];
  today: string;
  currency: string;
  root?: string;
  of?: string;
  depth?: number;
  slices?: number;
  window?: "average" | "month" | "total";
  months?: number;
  /** The window "total": the first date counted (by default, every posting's). */
  from?: string;
  roots?: Roots;
}): Breakdown {
  const base = of ?? root ?? roots.expenses;
  const levels = of ? 1 : depth;
  const current = monthOf(today);
  const inWindow: (date: string) => boolean =
    window === "total"
      ? (date) => !from || date >= from
      : window === "month"
        ? (date) => monthOf(date) === current
        : (() => {
            const set = new Set(
              Array.from({ length: months }, (_, i) => addMonths(current, -months + i))
            );
            return (date) => set.has(monthOf(date));
          })();
  const sums = new Map<string, number>();
  // Each month's sums, by the same keys.
  const monthly = new Map<string, Map<string, number>>();
  const deeper = new Set<string>();
  for (const posting of postings) {
    if (posting.currency !== currency || !under(posting.account, base)) continue;
    if (posting.date > today || !inWindow(posting.date)) continue;
    const key = atDepth(posting.account, base, levels);
    const amount = cents(posting.amount) * flowSign(base, roots);
    sums.set(key, (sums.get(key) ?? 0) + amount);
    const month = monthOf(posting.date);
    const its = monthly.get(month) ?? new Map<string, number>();
    its.set(key, (its.get(key) ?? 0) + amount);
    monthly.set(month, its);
    if (posting.account !== key) deeper.add(key);
  }
  const divisor = window === "average" ? months : 1;
  const ranked = [...sums]
    .map(([account, sum]) => ({ account, sum: sum / divisor }))
    .filter((c) => c.sum > 0)
    .sort((a, b) => b.sum - a.sum);
  const total = ranked.reduce((n, c) => n + c.sum, 0);
  // Other only when it holds two or more: one left over is shown as itself.
  const shown = ranked.length === slices + 1 ? ranked : ranked.slice(0, slices);
  const rest = ranked.slice(shown.length);
  const share = (sum: number) => (total ? sum / total : 0);
  // The window's months: those averaged, this one, or (the total) from `from`'s month, or the
  // first posting's, to today's.
  const first =
    window === "average"
      ? addMonths(current, -months)
      : window === "month"
        ? current
        : from
          ? monthOf(from)
          : [...monthly.keys()].sort()[0];
  const last = window === "average" ? addMonths(current, -1) : current;
  const inMonths: string[] = [];
  for (let m = first; m && m <= last; m = addMonths(m, 1)) inMonths.push(m);
  const byMonth = inMonths.map((month) => {
    const its = monthly.get(month) ?? new Map<string, number>();
    const amounts = shown.map((c) => its.get(c.account) ?? 0);
    const other = rest.reduce((n, c) => n + (its.get(c.account) ?? 0), 0);
    return {
      month,
      partial: month === monthOf(today) && today !== lastOf(month),
      amounts: amounts.map(units),
      other: units(other),
      // What's drawn: a category that comes to nothing or less over the window isn't.
      total: units(amounts.reduce((n, a) => n + a, other)),
    };
  });
  return {
    currency,
    of: base,
    window,
    months: window === "average" ? months : 0,
    from: window === "total" ? (from ?? null) : null,
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
