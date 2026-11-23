import type { Breakdown } from "@luminous-money/ledger-graphs-api";
import { useCallback, useMemo } from "react";

import { sliceColors } from "./BreakdownChart.js";
import { Chart, type ChartClick } from "./Chart.js";
import { monthLabel, moneyFormat, type MoneyFormat } from "./format.js";
import { alpha, LIGHT, type ChartTheme } from "./theme.js";

/**
 * A breakdown month by month (its `byMonth`): a bar a month, each made of its slices, stacked in
 * the donut's colors, and Other on top. Amounts as they were, not averaged. A month still going
 * is lighter. Tapping a bar calls `onMonth` with its month, given one, to narrow to it; else
 * tapping a slice (not Other, nor what's open itself) calls `onSelect` with it, to open it.
 */
export function BreakdownBarsChart({
  data,
  theme = LIGHT,
  format: given,
  height = 240,
  onSelect,
  onMonth,
}: {
  data: Breakdown;
  theme?: ChartTheme;
  /** How money reads (whole units by default, in the data's currency). */
  format?: MoneyFormat;
  height?: number;
  onSelect?: (account: string) => void;
  onMonth?: (month: string) => void;
}) {
  const format = useMemo(() => given ?? moneyFormat(data.currency), [given, data.currency]);
  const option = useMemo(() => {
    const colors = sliceColors(data, theme);
    const parts = [
      ...data.slices.map((s, i) => ({
        name: s.label,
        account: s.account as string | undefined,
        more: s.more,
        color: colors.slices[i]!,
        values: data.byMonth.map((m) => m.amounts[i] ?? 0),
      })),
      ...(data.other
        ? [
            {
              name: "Other",
              account: undefined,
              more: false,
              color: colors.other,
              values: data.byMonth.map((m) => m.other),
            },
          ]
        : []),
    ];
    // Each bar's top: the last part above zero, rounded there.
    const tops = data.byMonth.map((_, m) => parts.findLastIndex((p) => p.values[m]! > 0));
    const years = new Set(data.byMonth.map((m) => m.month.slice(0, 4))).size > 1;
    return {
      animationDuration: 500,
      aria: { enabled: true },
      textStyle: { fontFamily: theme.font, color: theme.text },
      grid: { left: 4, right: 48, top: 12, bottom: 24 },
      xAxis: {
        type: "category",
        data: data.byMonth.map((m) => monthLabel(m.month, years)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.muted },
      },
      yAxis: {
        type: "value",
        position: "right",
        splitNumber: 4,
        axisLabel: { color: theme.muted, formatter: (n: number) => format(n, "compact") },
        splitLine: { lineStyle: { color: theme.grid } },
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        axisPointer: { type: "shadow" },
        formatter: (items: { dataIndex: number }[]) => {
          const at = items[0]?.dataIndex ?? 0;
          const m = data.byMonth[at]!;
          return [
            `<b>${monthLabel(m.month, true)}${m.partial ? " (so far)" : ""}: ${format(m.total)}</b>`,
            // Top to bottom, as they're stacked.
            ...parts
              .filter((p) => p.values[at] !== 0)
              .reverse()
              .map((p) => `${p.name} ${format(p.values[at]!)}`),
          ].join("<br/>");
        },
      },
      series: parts.map((p, i) => ({
        name: p.name,
        type: "bar",
        stack: "breakdown",
        barMaxWidth: 48,
        data: p.values.map((value, m) => ({
          value,
          month: data.byMonth[m]!.month,
          account: p.account,
          more: p.more,
          itemStyle: {
            color: data.byMonth[m]!.partial ? alpha(p.color, 0.5) : p.color,
            borderColor: theme.background,
            borderWidth: 1,
            borderRadius: tops[m] === i ? [4, 4, 0, 0] : 0,
          },
        })),
      })),
    };
  }, [data, theme, format]);
  const click = useCallback(
    (item: ChartClick) => {
      const d = item.data as { month?: string; account?: string; more?: boolean } | undefined;
      if (onMonth) {
        if (d?.month) onMonth(d.month);
      } else if (d?.account && d.account !== data.of) onSelect?.(d.account);
    },
    [onSelect, onMonth, data.of]
  );
  const label = `By month: ${data.byMonth
    .map((m) => `${monthLabel(m.month, true)} ${format(m.total)}`)
    .join(", ")}`;
  return <Chart option={option} height={height} label={label} onClick={click} />;
}
