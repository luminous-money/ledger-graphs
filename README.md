ledger-graphs
==================================================================================================

Reports and charts for any double-entry ledger (Beancount, hledger, Ledger, or your own
database), as two small libraries:

- **[`@luminous-money/ledger-graphs-api`](libs/api):** plain TypeScript, no dependencies. Give a
  report the **posting stream** and it returns a plain JSON dataset.
- **[`@luminous-money/ledger-graphs-ui`](libs/ui):** React charts for those datasets, drawn with
  [Apache ECharts](https://echarts.apache.org).

They're split so the data side can run wherever the ledger is (a server, a worker, the browser),
and the charts can be swapped without touching it.

## The posting stream

One entry per posting, as any ledger can produce:

```ts
type Posting = {
  transaction: string; // postings of one transaction share it
  date: string; // YYYY-MM-DD
  account: string; // "Expenses:Food:Groceries"
  amount: string; // a decimal string: the account's change, debits positive
  currency: string;
  flag?: string; // "*" or "!"; both count
  budgeted?: boolean; // false: kept out of budget-style reports ("spent this month")
  payee?: string | null;
  narration?: string | null;
};
```

`fromTransactions` builds it from Beancount-shaped transactions (`{ id, date, postings: [{
account, amount: { number, currency } }] }`). Top-level account names are a parameter (`roots`;
Beancount's by default).

## Reports

| Report                | What it answers                                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spendingThisMonth`   | This month's spending by day, against a budget and what 85% of months stay under (simulated: each day drawn from the same day of one of the last 12 months, so the rent stays on the 1st) |
| `cashFlow`            | Income and expenses, month by month, with totals                                                                                                                                          |
| `breakdown`           | The largest categories at a depth, as monthly averages (or this month), the rest as Other; drill into one                                                                                 |
| `largestTransactions` | This month's largest expenses                                                                                                                                                             |
| `netWorth`            | Assets, liabilities and net worth at month ends, holdings at their prices then (backed out from today's balances, so no full history is needed)                                           |
| `typicalPeriods`      | What an account's week, month and year typically come to: the median, and a simulated 85th percentile                                                                                     |

```ts
import { breakdown, fromTransactions } from "@luminous-money/ledger-graphs-api";

const postings = fromTransactions(await fetchTransactions());
const where = breakdown({ postings, today: "2026-10-15", currency: "USD", depth: 1 });
// { total: 7872, slices: [{ label: "Housing", amount: 4316, share: 0.55, more: true }, …], other }
```

Sums run in integer cents, and simulations take a seed, so the same data gives the same answer.

## Charts

```tsx
import { BreakdownChart, SpendingChart } from "@luminous-money/ledger-graphs-ui";

<SpendingChart data={spending} theme={theme} />
<BreakdownChart data={where} caption="a month, on average" onSelect={drillInto} />
```

Each chart takes its dataset, a `theme` (colors and font: pass your own light or dark palette),
and a money format, and describes itself for screen readers. Only the parts of ECharts the charts
use are bundled.

## Developing

```sh
pnpm install
pnpm build && pnpm test && pnpm typecheck
pnpm publish:all   # publishes each library whose version isn't on npm yet
```

## License

ISC
