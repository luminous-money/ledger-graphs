import { describe, expect, it } from "vitest";

import {
  atDepth,
  breakdown,
  cashFlow,
  fromTransactions,
  largestTransactions,
  netWorth,
  percentile,
  spendingThisMonth,
  typicalPeriods,
  type Posting,
} from "../src/index.js";

let n = 0;
/** A two-posting transaction: `amount` into `to`, out of `from`. */
function tx(
  date: string,
  to: string,
  from: string,
  amount: string,
  extra: Partial<Posting> = {}
): Posting[] {
  const id = `t${n++}`;
  const base = { transaction: id, date, currency: "USD", payee: null, narration: to, ...extra };
  const out = amount.startsWith("-") ? amount.slice(1) : `-${amount}`;
  return [
    { ...base, account: to, amount },
    { ...base, account: from, amount: out },
  ];
}

const BANK = "Assets:Bank";
const spend = (date: string, account: string, amount: string, extra: Partial<Posting> = {}) =>
  tx(date, account, BANK, amount, extra);
const earn = (date: string, account: string, amount: string) => tx(date, BANK, account, amount);

/** A year of months: rent on the 1st, groceries weekly-ish, pay on the 15th. */
function history(months: string[]): Posting[] {
  return months.flatMap((m) => [
    ...spend(`${m}-01`, "Expenses:Housing:Rent", "2000.00"),
    ...spend(`${m}-05`, "Expenses:Food:Groceries", "100.00"),
    ...spend(`${m}-19`, "Expenses:Food:Groceries", "100.00"),
    ...spend(`${m}-20`, "Expenses:Food:Restaurants", "60.00"),
    ...earn(`${m}-15`, "Income:Salary", "5000.00"),
  ]);
}
const PAST = [
  "2025-10",
  "2025-11",
  "2025-12",
  ...Array.from({ length: 9 }, (_, i) => `2026-0${i + 1}`),
];
const TODAY = "2026-10-15";

describe("accounts", () => {
  it("finds the account a level of depth holds", () => {
    expect(atDepth("Expenses:Food:Groceries", "Expenses", 1)).toBe("Expenses:Food");
    expect(atDepth("Expenses:Food:Groceries", "Expenses", 2)).toBe("Expenses:Food:Groceries");
    expect(atDepth("Expenses:Fun", "Expenses", 3)).toBe("Expenses:Fun");
  });
});

describe("spending this month", () => {
  const postings = [
    ...history(PAST),
    ...spend("2026-10-01", "Expenses:Housing:Rent", "2000.00"),
    ...spend("2026-10-03", "Expenses:Food:Groceries", "45.10"),
    ...spend("2026-10-10", "Expenses:Home:Roof", "14000.00", { budgeted: false }),
    ...spend("2026-10-20", "Expenses:Food:Groceries", "99.00"), // after today
  ];
  const report = spendingThisMonth({ postings, today: TODAY, currency: "USD", budget: 3000 });

  it("runs the total to today, leaving out what's kept out of budgets", () => {
    expect(report.actual).toHaveLength(15);
    expect(report.actual[0]).toBe(2000);
    expect(report.actual[2]).toBe(2045.1);
    expect(report.spent).toBe(2045.1);
    expect(report.budget).toBe(3000);
    expect(report.days).toBe(31);
  });

  it("projects from the same days of past months, so the 1st's rent is on the 1st", () => {
    expect(report.projection).toHaveLength(31);
    expect(report.projection![0]).toBe(2000); // every past month paid rent on the 1st
    expect(report.projection![3]).toBe(2000);
    expect(report.projection![4]).toBe(2100);
    expect(report.projected_end).toBe(2260);
    // The same seed, the same answer.
    expect(spendingThisMonth({ postings, today: TODAY, currency: "USD" }).projection).toEqual(
      report.projection
    );
  });

  it("counts only the accounts asked for, and has no projection without history", () => {
    const food = spendingThisMonth({
      postings,
      today: TODAY,
      currency: "USD",
      accounts: ["Expenses:Food"],
    });
    expect(food.spent).toBe(45.1);
    const fresh = spendingThisMonth({
      postings: postings.slice(-8),
      today: TODAY,
      currency: "USD",
    });
    expect(fresh.projection).toBeNull();
  });
});

describe("cash flow", () => {
  it("has each month's income and expenses, this one so far, and the totals", () => {
    const postings = [...history(PAST), ...spend("2026-10-03", "Expenses:Food:Groceries", "50.00")];
    const report = cashFlow({ postings, today: TODAY, currency: "USD" });
    expect(report.months.map((m) => m.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(report.months[0]).toEqual({
      month: "2026-05",
      income: 5000,
      expenses: 2260,
      net: 2740,
      partial: false,
    });
    expect(report.months[5]).toMatchObject({ income: 0, expenses: 50, partial: true });
    expect(report.totals).toEqual({
      income: 25000,
      expenses: 11350,
      net: 13650,
      average_net: 2275,
    });
  });
});

describe("breakdown", () => {
  const postings = history(PAST);
  /** The six complete months before today's. */
  const SIX = { from: "2026-04", through: "2026-09" };

  it("averages each category over a range of months, largest first", () => {
    const report = breakdown({
      postings,
      today: TODAY,
      currency: "USD",
      ...SIX,
    });
    expect(report.slices.map((s) => [s.label, s.amount, s.more])).toEqual([
      ["Housing", 2000, true],
      ["Food", 260, true],
    ]);
    expect(report.total).toBe(2260);
    expect(report.slices[0]!.share).toBeCloseTo(2000 / 2260);
    expect([report.from, report.through, report.months, report.average]).toEqual([
      "2026-04",
      "2026-09",
      6,
      true,
    ]);
  });

  it("stops at today: a month ahead adds nothing, and today's counts as the part gone", () => {
    const ahead = breakdown({
      postings,
      today: "2026-09-15",
      currency: "USD",
      from: "2026-08-20",
      through: "2027-12",
    });
    expect([ahead.from, ahead.through, ahead.months]).toEqual(["2026-08", "2026-09", 1.5]);
    // August's 2260, and September's 2100 by the 15th, over a month and a half.
    expect(ahead.total).toBeCloseTo(4360 / 1.5);
    expect(ahead.byMonth.map((m) => [m.month, m.total, m.partial])).toEqual([
      ["2026-08", 2260, false],
      ["2026-09", 2100, true],
    ]);
    // Today's month alone is what it's come to so far.
    const alone = breakdown({
      postings,
      today: "2026-09-15",
      currency: "USD",
      from: "2026-09",
      through: "2026-09",
    });
    expect([alone.months, alone.total]).toEqual([1, 2100]);
    // All of it ahead: nothing.
    const later = breakdown({ postings, today: TODAY, currency: "USD", from: "2027-01" });
    expect([later.slices, later.byMonth, later.total]).toEqual([[], [], 0]);
  });

  it("drills into a category, and groups what's past the slices as Other", () => {
    const report = breakdown({
      postings,
      today: TODAY,
      currency: "USD",
      ...SIX,
      of: "Expenses:Food",
      slices: 1,
    });
    expect(report.of).toBe("Expenses:Food");
    expect(report.slices.map((s) => s.label)).toEqual(["Groceries", "Restaurants"]); // one left: itself
    const deep = breakdown({
      postings,
      today: TODAY,
      currency: "USD",
      ...SIX,
      depth: 2,
      slices: 1,
    });
    expect(deep.slices.map((s) => s.label)).toEqual(["Rent"]);
    expect(deep.other).toEqual({
      amount: 260,
      share: 260 / 2260,
      accounts: ["Expenses:Food:Groceries", "Expenses:Food:Restaurants"],
    });
  });

  it("breaks down income, read as earned", () => {
    const report = breakdown({ postings, today: TODAY, currency: "USD", ...SIX, root: "Income" });
    expect(report.slices.map((s) => [s.label, s.amount])).toEqual([["Salary", 5000]]);
  });

  it("sums the window, from the first posting by default", () => {
    const all = breakdown({ postings, today: TODAY, currency: "USD", average: false });
    expect(all.slices.map((s) => [s.label, s.amount])).toEqual([
      ["Housing", 24000],
      ["Food", 3120],
    ]);
    expect([all.from, all.through, all.average]).toEqual(["2025-10", "2026-10", false]);
    const since = breakdown({
      postings,
      today: TODAY,
      currency: "USD",
      average: false,
      from: "2026-09",
    });
    expect(since.slices.map((s) => [s.label, s.amount])).toEqual([
      ["Housing", 2000],
      ["Food", 260],
    ]);
  });

  it("has each month of the window, not averaged, slice by slice", () => {
    const more = [
      ...postings,
      ...spend("2026-08-09", "Expenses:Fun", "30.00"),
      ...spend("2026-09-09", "Expenses:Fun", "45.00"),
      ...spend("2026-10-02", "Expenses:Food:Groceries", "80.00"),
    ];
    const three = breakdown({
      postings: more,
      today: TODAY,
      currency: "USD",
      from: "2026-07",
      through: "2026-09",
      slices: 1,
    });
    expect(three.slices.map((s) => s.label)).toEqual(["Housing"]);
    expect(three.other?.accounts).toEqual(["Expenses:Food", "Expenses:Fun"]);
    expect(three.byMonth).toEqual([
      { month: "2026-07", partial: false, amounts: [2000], other: 260, total: 2260 },
      { month: "2026-08", partial: false, amounts: [2000], other: 290, total: 2290 },
      { month: "2026-09", partial: false, amounts: [2000], other: 305, total: 2305 },
    ]);
    // Averaged, the slices are the months' mean.
    expect(three.total).toBeCloseTo(6855 / 3);
    const month = breakdown({ postings: more, today: TODAY, currency: "USD", from: "2026-10" });
    expect(month.byMonth).toEqual([
      { month: "2026-10", partial: true, amounts: [80], other: 0, total: 80 },
    ]);
    const since = breakdown({
      postings: more,
      today: TODAY,
      currency: "USD",
      average: false,
      from: "2026-08",
    });
    expect(since.byMonth.map((m) => [m.month, m.total, m.partial])).toEqual([
      ["2026-08", 2290, false],
      ["2026-09", 2305, false],
      ["2026-10", 80, true],
    ]);
  });
});

describe("largest transactions", () => {
  it("lists this month's largest, each with where most of it went", () => {
    const postings = [
      ...spend("2026-09-30", "Expenses:Fun", "999.00"),
      ...spend("2026-10-02", "Expenses:Food:Groceries", "86.13"),
      ...spend("2026-10-05", "Expenses:Food:Groceries", "109.01", { payee: "Meijer" }),
      ...spend("2026-10-06", "Expenses:Food:Groceries", "-20.00"), // a refund
    ];
    const found = largestTransactions({ postings, today: TODAY, currency: "USD", limit: 2 });
    expect(found.currency).toBe("USD");
    expect(found.transactions.map((t) => [t.payee, t.amount, t.account])).toEqual([
      ["Meijer", 109.01, "Expenses:Food:Groceries"],
      [null, 86.13, "Expenses:Food:Groceries"],
    ]);
  });
});

describe("net worth", () => {
  it("backs month ends out from today's balances, valuing holdings at their prices then", () => {
    const postings: Posting[] = [
      ...earn("2026-09-15", "Income:Salary", "5000.00"),
      ...tx("2026-10-02", "Liabilities:Card", BANK, "300.00"), // paid the card down
      {
        transaction: "buy",
        date: "2026-10-03",
        account: "Assets:Broker:VTI",
        amount: "2",
        currency: "VTI",
      },
      {
        transaction: "buy",
        date: "2026-10-03",
        account: "Assets:Broker:Cash",
        amount: "-200.00",
        currency: "USD",
      },
    ];
    const report = netWorth({
      balances: [
        { account: "Assets", amount: "9500.00", currency: "USD" },
        { account: "Assets", amount: "2", currency: "VTI" },
        { account: "Assets", amount: "3", currency: "VACHR" },
        { account: "Liabilities", amount: "-700.00", currency: "USD" },
      ],
      postings,
      prices: [
        { commodity: "VTI", date: "2026-10-03", number: "100.00", currency: "USD" },
        { commodity: "VTI", date: "2026-10-10", number: "150.00", currency: "USD" },
      ],
      today: TODAY,
      currency: "USD",
      months: 3,
    });
    expect(report.months).toEqual([
      { month: "2026-08", end: "2026-08-31", assets: 5000, liabilities: 1000, net: 4000 },
      { month: "2026-09", end: "2026-09-30", assets: 10000, liabilities: 1000, net: 9000 },
      { month: "2026-10", end: TODAY, assets: 9800, liabilities: 700, net: 9100 },
    ]);
    expect(report.unpriced).toEqual(["VACHR"]);
  });
});

describe("typical periods", () => {
  it("has the median week, month and year, and a simulated high that's at least the median", () => {
    const postings = history(PAST).filter(
      (p) => p.account.startsWith("Expenses:Food") || p.account === BANK
    );
    const report = typicalPeriods({
      postings,
      account: "Expenses:Food",
      today: TODAY,
      currency: "USD",
      since: "2025-10-01",
    });
    expect(report.month).toMatchObject({ median: 260, periods: 12 });
    expect(report.month.high).toBeGreaterThanOrEqual(260);
    expect(report.year).toMatchObject({ median: 3120, high: 3120, periods: 1 }); // the last 12 months
    expect(report.week.periods).toBe(52);
    expect(report.week.median).toBeLessThan(report.month.median);
    expect(report.week.high).toBeGreaterThan(report.week.median);
  });

  it("reads income as earned", () => {
    const report = typicalPeriods({
      postings: history(PAST),
      account: "Income",
      today: TODAY,
      currency: "USD",
    });
    expect(report.month.median).toBe(5000);
  });
});

describe("helpers", () => {
  it("interpolates percentiles, and builds the stream from transactions", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(
      fromTransactions([
        {
          id: "x",
          date: "2026-10-01",
          postings: [
            { account: "Expenses:Fun", amount: { number: "5.00", currency: "USD" } },
            { account: BANK, amount: null },
          ],
        },
      ])
    ).toEqual([
      {
        transaction: "x",
        date: "2026-10-01",
        flag: undefined,
        budgeted: undefined,
        payee: null,
        narration: null,
        account: "Expenses:Fun",
        amount: "5.00",
        currency: "USD",
      },
    ]);
  });
});
