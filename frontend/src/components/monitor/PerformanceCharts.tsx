// Actual vs projected performance: CDR + CPR (annualized, same basis both
// sides), pool factor, and monthly dollar variances — remittance charts.

import {
  Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { monitorPerformanceSeries } from '../../lib/api';
import { COLORS } from '../../lib/colors';
import { apiErrorMessage, money, pct } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import { hasActuals, useMonitorQuery } from '../../lib/useMonitor';
import EmptyState from '../shared/EmptyState';
import LoadingCursor from '../shared/LoadingCursor';
import Panel from '../shared/Panel';
import TooltipShell from '../charts/TooltipShell';

const BLUE = '#4a90d9';

function RateChart({ rows, actualKey, projKey, title, boundary }: {
  rows: Record<string, unknown>[];
  actualKey: string;
  projKey: string;
  title: string;
  boundary: number;
}) {
  const data = rows.map((r) => ({
    month: Number(r.month),
    actual: r[actualKey] as number | null,
    projected: r[projKey] as number | null,
  }));
  return (
    <div>
      <div className="section-label">{title}</div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COLORS.border} vertical={false} />
          <XAxis dataKey="month" tick={{ fill: COLORS.axis, fontSize: 10 }} stroke={COLORS.axis} minTickGap={30} />
          <YAxis tick={{ fill: COLORS.axis, fontSize: 10 }} width={56} stroke={COLORS.axis}
            tickFormatter={(v: number) => pct(v, 1)} domain={[0, 'auto']} />
          <ReferenceLine x={boundary} stroke={COLORS.borderBright} strokeDasharray="3 3"
            label={{ value: `M${boundary}`, fill: COLORS.textDim, fontSize: 9, position: 'top' }} />
          <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
            <TooltipShell title={`MONTH ${label}`}>
              {payload.map((p) => (
                <div key={String(p.name)} style={{ color: String(p.color) }}>
                  {String(p.name)} {pct(Number(p.value))}
                </div>
              ))}
            </TooltipShell>
          ) : null} cursor={{ stroke: COLORS.borderBright }} />
          <Line dataKey="projected" name="projected" stroke={BLUE} strokeWidth={1} strokeDasharray="5 3"
            dot={false} isAnimationActive={false} connectNulls />
          <Line dataKey="actual" name="actual" stroke={COLORS.chartPrimary} strokeWidth={1.8}
            dot={false} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PerformanceCharts() {
  const { doc } = useDealDraft();
  const query = useMonitorQuery('performance', monitorPerformanceSeries,
    Boolean(doc?.actuals?.collateral?.length));

  if (!hasActuals(doc)) return null;

  return (
    <Panel
      title="PERFORMANCE — ACTUAL VS PROJECTED"
      subtitle={<span className="dim">annualized rates, same balance basis on both sides</span>}
    >
      {query.isLoading ? (
        <LoadingCursor />
      ) : query.isError ? (
        <div className="field-error-msg" style={{ textAlign: 'left' }}>{apiErrorMessage(query.error, 'Series failed')}</div>
      ) : !query.data ? (
        <EmptyState message="—" />
      ) : (
        <>
          <div className="grid-2">
            <RateChart rows={query.data.rows} actualKey="actual_cdr" projKey="projected_cdr"
              title="CDR" boundary={query.data.boundary_month} />
            <RateChart rows={query.data.rows} actualKey="actual_cpr" projKey="projected_cpr"
              title="CPR" boundary={query.data.boundary_month} />
          </div>
          {query.data.dollars.chargeoffs && (
            <div style={{ marginTop: 10 }}>
              <div className="section-label">MONTHLY CHARGE-OFFS $ — ACTUAL VS MODEL</div>
              <ResponsiveContainer width="100%" height={140}>
                <ComposedChart data={query.data.dollars.chargeoffs.records as Record<string, number>[]}
                  margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={COLORS.border} vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: COLORS.axis, fontSize: 10 }} stroke={COLORS.axis} />
                  <YAxis tick={{ fill: COLORS.axis, fontSize: 10 }} width={56} stroke={COLORS.axis}
                    tickFormatter={(v: number) => money(v)} />
                  <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                    <TooltipShell title={`MONTH ${label}`}>
                      {payload.map((p) => (
                        <div key={String(p.name)} style={{ color: String(p.color) }}>
                          {String(p.name)} {money(Number(p.value))}
                        </div>
                      ))}
                    </TooltipShell>
                  ) : null} cursor={{ fill: COLORS.borderBright, fillOpacity: 0.15 }} />
                  <Bar dataKey="model" name="model" fill={BLUE} fillOpacity={0.5} isAnimationActive={false} />
                  <Bar dataKey="actual" name="actual" fill={COLORS.chartPrimary} fillOpacity={0.75} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
