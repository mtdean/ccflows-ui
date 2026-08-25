// Mid-life what-if: "performs to plan through month k, then macro scenario X."

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Play } from 'lucide-react';
import { forwardWhatIf } from '../../lib/api';
import type { WhatIfResult } from '../../lib/api';
import { COLORS } from '../../lib/colors';
import { apiErrorMessage, money, num, pct, walMonths } from '../../lib/utils';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import LoadingCursor from '../shared/LoadingCursor';
import TooltipShell from '../charts/TooltipShell';

const MACROS = ['base', 'adverse', 'severely_adverse', 'rate_spike_300bps', 'stagflation'];
const SERIES_COLORS = ['#4a90d9', '#00c176', '#9b59b6', '#ffaa00', '#ff6b6b'];

type Row = Record<string, unknown>;

export default function WhatIfPanel({ runId }: { runId: string }) {
  const [month, setMonth] = useState(12);
  const [scenario, setScenario] = useState('severely_adverse');
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () =>
      forwardWhatIf(runId, { month, scenario: scenario === 'base' ? null : scenario }),
    onSuccess: (d) => {
      setResult(d);
      setError(null);
    },
    onError: (err) => setError(apiErrorMessage(err, 'What-if failed')),
  });

  const columns: Column<Row>[] = [
    { key: 'tranche', header: 'TRANCHE', render: (r) => <span style={{ color: 'var(--text-accent)' }}>{String(r.tranche)}</span> },
    { key: 'boundary_balance', header: `BAL @ M${result?.boundary_month ?? month}`, align: 'right', sortable: false,
      render: (r) => <span className="num mono">{typeof r.boundary_balance === 'number' ? money(r.boundary_balance) : '—'}</span> },
    { key: 'wal_months', header: 'FWD WAL', align: 'right', sortable: false,
      render: (r) => <span className="num mono">{typeof r.wal_months === 'number' ? walMonths(r.wal_months) : '—'}</span> },
    { key: 'xirr', header: 'FWD XIRR', align: 'right', sortable: false,
      render: (r) => {
        const v = r.xirr as number | null;
        const base = r.base_xirr as number | null;
        if (v == null) return <span className="dim">—</span>;
        const delta = base != null ? v - base : null;
        return (
          <span className="num mono">
            {pct(v)}
            {delta != null && Math.abs(delta) > 0.0005 && (
              <span className={delta > 0 ? 'pos' : 'neg'} style={{ fontSize: 10, marginLeft: 4 }}>
                {delta > 0 ? '+' : ''}{pct(delta)}
              </span>
            )}
          </span>
        );
      } },
    { key: 'base_xirr', header: 'BASE XIRR (FULL)', align: 'right', sortable: false,
      render: (r) => <span className="num mono dim">{typeof r.base_xirr === 'number' ? pct(r.base_xirr) : '—'}</span> },
    { key: 'moic', header: 'FWD MOIC', align: 'right', sortable: false,
      render: (r) => <span className="num mono">{typeof r.moic === 'number' ? num(r.moic, 2) : '—'}</span> },
  ];

  const chartData = result
    ? result.series.months.map((m) => {
        const row: Record<string, number | null> = { month: m };
        for (const [name, vals] of Object.entries(result.series.tranches)) row[name] = vals[m] ?? null;
        return row;
      })
    : [];

  return (
    <div>
      <div className="dim" style={{ fontSize: 11, marginBottom: 8 }}>
        Assume the deal performs exactly to the current projection through month k, then a macro
        scenario hits. Carries, reserve, and trigger clocks seed from the boundary.
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <div className="field-row">
          <label>performs to plan through month</label>
          <input className="input num" style={{ width: 70 }} type="number" min={1}
            value={month} onChange={(e) => setMonth(Math.max(1, Math.trunc(Number(e.target.value))))} />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {MACROS.map((m) => (
            <button key={m} className={`chip ${m === scenario ? 'chip--active' : ''}`} onClick={() => setScenario(m)}>
              {m.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <button className="btn" disabled={run.isPending} onClick={() => run.mutate()}>
          <Play size={11} /> RUN WHAT-IF
        </button>
      </div>
      {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}
      {run.isPending ? (
        <LoadingCursor label="SPLICING" />
      ) : !result ? (
        <EmptyState message="PICK A MONTH AND SCENARIO" />
      ) : (
        <>
          <div className="section-label">
            IF PLAN THROUGH M{result.boundary_month}, THEN {result.scenario.replace(/_/g, ' ').toUpperCase()}
          </div>
          <DataTable columns={columns} rows={result.forward} rowKey={(r) => String(r.tranche)} emptyMessage="—" />
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: COLORS.axis, fontSize: 10 }} minTickGap={40} stroke={COLORS.axis} />
              <YAxis tick={{ fill: COLORS.axis, fontSize: 10 }} width={62} stroke={COLORS.axis}
                tickFormatter={(v: number) => money(v)} />
              <ReferenceLine x={result.boundary_month} stroke={COLORS.chartPrimary} strokeDasharray="3 3"
                label={{ value: `M${result.boundary_month}`, fill: COLORS.chartPrimary, fontSize: 9, position: 'top' }} />
              <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                <TooltipShell title={`MONTH ${label}`}>
                  {payload.map((p) => (
                    <div key={String(p.name)} style={{ color: String(p.color) }}>
                      {String(p.name)} {money(Number(p.value))}
                    </div>
                  ))}
                </TooltipShell>
              ) : null} cursor={{ stroke: COLORS.borderBright }} />
              {Object.keys(result.series.tranches).map((n, i) => (
                <Line key={n} dataKey={n} stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={1.3} dot={false} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
