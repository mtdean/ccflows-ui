// Per-trigger timeline: metric value vs threshold, breach months shaded.

import { useQuery } from '@tanstack/react-query';
import {
  Area, ComposedChart, CartesianGrid, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { getRunTriggers } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { COLORS } from '../../lib/colors';
import EmptyState from '../shared/EmptyState';
import LoadingCursor from '../shared/LoadingCursor';
import Panel from '../shared/Panel';
import TooltipShell from '../charts/TooltipShell';

interface Props {
  runId: string;
}

function thresholdAt(threshold: number | number[] | null, month: number): number | null {
  if (threshold == null) return null;
  if (typeof threshold === 'number') return threshold;
  return threshold[Math.min(month, threshold.length - 1)] ?? null;
}

export default function TriggerTimelinePanel({ runId }: Props) {
  const query = useQuery({
    queryKey: qk.runData(runId, 'triggers'),
    queryFn: () => getRunTriggers(runId),
    staleTime: Infinity,
  });

  if (query.isLoading) return <LoadingCursor />;
  const triggers = Object.entries(query.data ?? {});
  if (!triggers.length) return <EmptyState message="NO TRIGGERS IN THIS STRUCTURE" />;

  return (
    <div className="stack">
      {triggers.map(([name, t]) => {
        const lastLive = Math.max(
          24,
          t.values.reduce((acc: number, v, i) => (v != null && v !== 0 ? i : acc), 0) + 6,
        );
        const data = t.values.slice(0, lastLive).map((v, m) => ({
          month: m,
          value: v,
          threshold: thresholdAt(t.threshold, m),
        }));
        // contiguous breach windows for shading
        const zones: { start: number; end: number }[] = [];
        let start: number | null = null;
        t.breached.slice(0, lastLive).forEach((b, m) => {
          if (b && start == null) start = m;
          if (!b && start != null) {
            zones.push({ start, end: m });
            start = null;
          }
        });
        if (start != null) zones.push({ start, end: lastLive });
        const breachCount = t.breached.filter(Boolean).length;
        return (
          <Panel
            key={name}
            title={name.toUpperCase()}
            subtitle={
              breachCount ? (
                <span className="neg">breached {breachCount} month{breachCount > 1 ? 's' : ''}</span>
              ) : (
                <span className="pos">never breached</span>
              )
            }
          >
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="month" tick={{ fill: COLORS.axis, fontSize: 10 }} minTickGap={40} stroke={COLORS.axis} />
                <YAxis tick={{ fill: COLORS.axis, fontSize: 10 }} width={56} stroke={COLORS.axis} domain={['auto', 'auto']} />
                {zones.map((z, i) => (
                  <ReferenceArea key={i} x1={z.start} x2={z.end} fill="#ff3b3b" fillOpacity={0.12} stroke="none" />
                ))}
                <Tooltip
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <TooltipShell title={`MONTH ${label}`}>
                        {payload.map((p) => (
                          <div key={String(p.name)} style={{ color: String(p.color) }}>
                            {String(p.name)}: {Number(p.value).toFixed(4)}
                          </div>
                        ))}
                      </TooltipShell>
                    ) : null
                  }
                  cursor={{ stroke: COLORS.borderBright }}
                />
                <Area
                  type="stepAfter" dataKey="value" name="metric"
                  stroke={COLORS.chartPrimary} strokeWidth={1.5}
                  fill={COLORS.chartPrimary} fillOpacity={0.08}
                  isAnimationActive={false} connectNulls
                />
                <Line
                  type="stepAfter" dataKey="threshold" name="threshold"
                  stroke="#ff3b3b" strokeWidth={1} strokeDasharray="4 3"
                  dot={false} isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>
        );
      })}
    </div>
  );
}
