// Monte Carlo results: percentile summary, metric histogram, cashflow fan
// chart, VaR/ES. Reads the latest finished monte-carlo job for the open deal.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { getJobResult, listJobs } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { COLORS } from '../../lib/colors';
import { money, num, pct } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import type { TableData } from '../../lib/types';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import LoadingCursor from '../shared/LoadingCursor';
import TooltipShell from '../charts/TooltipShell';

interface McResult {
  n_sims: number;
  seed: number | null;
  summary: TableData;
  var: Record<string, number | null>;
  expected_shortfall: Record<string, number | null>;
  histograms: Record<string, { bin_left: number; bin_right: number; count: number }[]>;
  percentile_paths: Record<string, number[]> | null;
}

const PCT_METRICS = new Set(['xirr', 'irr', 'cumulative_loss_rate', 'peak_dq']);

function fmtMetric(metric: string, v: number | null | undefined): string {
  if (v == null) return '—';
  if (PCT_METRICS.has(metric)) return pct(v);
  if (metric === 'total_cashflow') return money(v);
  return v.toFixed(2);
}

export default function McResultsPanel() {
  const { slug } = useDealDraft();
  const [metric, setMetric] = useState('xirr');

  const jobs = useQuery({ queryKey: qk.jobs, queryFn: listJobs, refetchInterval: 4000 });
  const job = (jobs.data ?? []).find(
    (j) => j.kind === 'monte-carlo' && j.deal === slug && j.status === 'done',
  );
  const running = (jobs.data ?? []).find(
    (j) => j.kind === 'monte-carlo' && j.deal === slug && (j.status === 'running' || j.status === 'queued'),
  );

  const result = useQuery({
    queryKey: job ? qk.jobResult(job.job_id) : ['jobResult', 'none'],
    queryFn: () => getJobResult(job!.job_id) as Promise<unknown> as Promise<McResult>,
    enabled: job != null,
    staleTime: Infinity,
  });

  if (running) {
    const p = running.progress;
    return <LoadingCursor label={p ? `SIMULATING ${p.completed}/${p.total}` : 'SIMULATING'} />;
  }
  if (!job) return <EmptyState message="NO MONTE CARLO YET — RUN ONE FROM SCENARIOS" />;
  if (result.isLoading || !result.data) return <LoadingCursor />;

  const mc = result.data;
  const metrics = Object.keys(mc.histograms ?? {});
  const hist = mc.histograms?.[metric] ?? [];
  const histData = hist.map((b) => ({
    x: (b.bin_left + b.bin_right) / 2,
    label: fmtMetric(metric, (b.bin_left + b.bin_right) / 2),
    count: b.count,
  }));

  const summaryCols: Column<Record<string, unknown>>[] = (mc.summary?.columns ?? []).map((col) => ({
    key: col,
    header: col.replace(/_/g, ' ').toUpperCase(),
    align: col === 'metric' || col === 'index' ? 'left' : 'right',
    sortable: false,
    render: (r) => {
      const v = r[col];
      if (typeof v !== 'number') return <span style={{ color: 'var(--text-accent)' }}>{String(v ?? '—')}</span>;
      const m = String(r.metric ?? r.index ?? '');
      return <span className="num mono">{fmtMetric(m, v)}</span>;
    },
  }));

  const paths = mc.percentile_paths;
  const fanData =
    paths && paths.p50
      ? paths.p50.map((_, m) => ({
          month: m,
          p5: paths.p5?.[m] ?? null,
          band90: (paths.p95?.[m] ?? 0) - (paths.p5?.[m] ?? 0),
          p25: paths.p25?.[m] ?? null,
          band50: (paths.p75?.[m] ?? 0) - (paths.p25?.[m] ?? 0),
          p50: paths.p50?.[m] ?? null,
        }))
      : null;

  return (
    <div className="stack">
      <div className="dim" style={{ fontSize: 11 }}>
        {num(mc.n_sims)} simulations{mc.seed != null ? ` · seed ${mc.seed}` : ''}
      </div>

      <div className="section-label">PERCENTILE SUMMARY</div>
      {mc.summary && (
        <div style={{ overflowX: 'auto' }}>
          <DataTable
            columns={summaryCols}
            rows={mc.summary.records}
            rowKey={(r) => String(r.metric ?? r.index)}
            emptyMessage="NO SUMMARY"
          />
        </div>
      )}

      <div className="section-label">DISTRIBUTION</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {metrics.map((m) => (
          <button key={m} className={`chip ${m === metric ? 'chip--active' : ''}`} onClick={() => setMetric(m)}>
            {m.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={histData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COLORS.border} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: COLORS.axis, fontSize: 9 }} minTickGap={30} stroke={COLORS.axis} />
          <YAxis tick={{ fill: COLORS.axis, fontSize: 10 }} width={44} stroke={COLORS.axis} />
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.length ? (
                <TooltipShell title={String(payload[0].payload.label)}>
                  <div style={{ color: COLORS.textPrimary }}>{String(payload[0].value)} sims</div>
                </TooltipShell>
              ) : null
            }
            cursor={{ fill: COLORS.borderBright, fillOpacity: 0.2 }}
          />
          <Bar dataKey="count" fill={COLORS.chartPrimary} fillOpacity={0.7} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>

      <div className="grid-2">
        <div>
          <div className="section-label">VALUE AT RISK (95%)</div>
          <table className="data-table">
            <tbody>
              {Object.entries(mc.var ?? {}).map(([m, v]) => (
                <tr key={m}>
                  <td>{m.replace(/_/g, ' ').toUpperCase()}</td>
                  <td className="num mono">{fmtMetric(m, v)}</td>
                  <td className="num mono dim" title="Expected shortfall">
                    ES {fmtMetric(m, mc.expected_shortfall?.[m])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {fanData && (
          <div>
            <div className="section-label">CASHFLOW FAN (P5–P95 / P25–P75 / P50)</div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={fanData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="month" tick={{ fill: COLORS.axis, fontSize: 10 }} minTickGap={40} stroke={COLORS.axis} />
                <YAxis tick={{ fill: COLORS.axis, fontSize: 10 }} width={60} stroke={COLORS.axis}
                  tickFormatter={(v: number) => money(v)} />
                <Area dataKey="p5" stackId="fan90" stroke="none" fill="transparent" isAnimationActive={false} />
                <Area dataKey="band90" stackId="fan90" stroke="none" fill={COLORS.chartPrimary} fillOpacity={0.10} isAnimationActive={false} />
                <Area dataKey="p25" stackId="fan50" stroke="none" fill="transparent" isAnimationActive={false} />
                <Area dataKey="band50" stackId="fan50" stroke="none" fill={COLORS.chartPrimary} fillOpacity={0.16} isAnimationActive={false} />
                <Line dataKey="p50" stroke={COLORS.chartPrimary} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <ReferenceLine y={0} stroke={COLORS.border} />
                <Tooltip
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <TooltipShell title={`MONTH ${label}`}>
                        {(['p5', 'p50'] as const).map((k) => {
                          const row = payload[0]?.payload as Record<string, number>;
                          return (
                            <div key={k} style={{ color: COLORS.textPrimary }}>
                              {k.toUpperCase()} {money(row?.[k])}
                            </div>
                          );
                        })}
                      </TooltipShell>
                    ) : null
                  }
                  cursor={{ stroke: COLORS.borderBright }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
