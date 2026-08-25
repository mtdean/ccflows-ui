// Stacked area chart of tranche balances over the deal life, seniority order.

import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { COLORS } from '../../lib/colors';
import { money } from '../../lib/utils';
import TooltipShell from '../charts/TooltipShell';

const SERIES_COLORS = ['#4a90d9', '#00c176', '#9b59b6', '#ffaa00', '#ff6b6b', '#4dd0e1', '#8a8a8a'];

interface Props {
  months: number[];
  tranches: Record<string, number[]>;
  order: string[]; // seniority order, senior first
  height?: number;
}

export default function TrancheBalanceChart({ months, tranches, order, height = 260 }: Props) {
  const names = order.filter((n) => tranches[n]);
  const data = useMemo(() => {
    // trim the tail once every tranche is fully paid
    let lastLive = 12;
    for (let m = 0; m < months.length; m++) {
      if (names.some((n) => (tranches[n][m] ?? 0) > 1)) lastLive = m;
    }
    return months.slice(0, lastLive + 2).map((m) => {
      const row: Record<string, number> = { month: m };
      for (const n of names) row[n] = tranches[n][m] ?? 0;
      return row;
    });
  }, [months, tranches, names]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={COLORS.border} vertical={false} />
        <XAxis dataKey="month" tick={{ fill: COLORS.axis, fontSize: 10 }} minTickGap={40} stroke={COLORS.axis} />
        <YAxis
          tick={{ fill: COLORS.axis, fontSize: 10 }}
          tickFormatter={(v: number) => money(v)}
          width={64}
          stroke={COLORS.axis}
        />
        <Tooltip
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipShell title={`MONTH ${label}`}>
                {payload
                  .slice()
                  .reverse()
                  .map((p) => (
                    <div key={String(p.name)} style={{ color: String(p.color) }}>
                      {String(p.name)} {money(Number(p.value))}
                    </div>
                  ))}
              </TooltipShell>
            ) : null
          }
          cursor={{ stroke: COLORS.borderBright }}
        />
        {[...names].reverse().map((n, i) => {
          const color = SERIES_COLORS[(names.length - 1 - i) % SERIES_COLORS.length];
          return (
            <Area
              key={n}
              dataKey={n}
              stackId="stack"
              stroke={color}
              strokeWidth={1}
              fill={color}
              fillOpacity={0.25}
              isAnimationActive={false}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}
