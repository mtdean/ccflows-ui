// P&L: per-tranche fair-value statements — roll-forward table, component
// bars per period, IRR-to-date.

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Play } from 'lucide-react';
import { monitorPnl } from '../../lib/api';
import { COLORS } from '../../lib/colors';
import { apiErrorMessage, money, num, pct } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import type { TableData } from '../../lib/types';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import LoadingCursor from '../shared/LoadingCursor';
import RangeToggle from '../shared/RangeToggle';
import TooltipShell from '../charts/TooltipShell';

type Row = Record<string, unknown>;
type Statements = Record<string, { rollforward: TableData; summary: Row; price_series: TableData }>;

export default function PnlView() {
  const { doc, slug } = useDealDraft();
  const [spread, setSpread] = useState(200);
  const [freq, setFreq] = useState<'M' | 'Q' | 'A'>('Q');
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<Statements | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () => monitorPnl(slug!, doc!, spread, freq),
    onSuccess: (d) => {
      setData(d.statements);
      setError(null);
    },
    onError: (err) => setError(apiErrorMessage(err, 'P&L failed')),
  });

  const names = useMemo(() => Object.keys(data ?? {}), [data]);
  const active = selected && names.includes(selected) ? selected : names[0] ?? null;
  const stmt = active ? data![active] : null;

  const rfCols: Column<Row>[] = (stmt?.rollforward.columns ?? []).map((c) => ({
    key: c, header: c.replace(/_/g, ' ').toUpperCase(),
    align: c === 'period' ? 'left' : 'right', sortable: false,
    render: (r) => {
      const v = r[c];
      if (typeof v !== 'number') return <span className="dim">{String(v ?? '—')}</span>;
      if (c === 'tie_check') return <span className={`num mono ${Math.abs(v) < 1e-6 ? 'pos' : 'neg'}`}>{num(v, 2)}</span>;
      const cls = (c === 'realized_pl' || c === 'unrealized_pl') && v !== 0 ? (v > 0 ? 'pos' : 'neg') : '';
      return <span className={`num mono ${cls}`}>{money(v)}</span>;
    },
  }));

  const chartData = (stmt?.rollforward.records ?? []).map((r) => ({
    period: String(r.period),
    interest: Number(r.interest_income ?? 0),
    realized: Number(r.realized_pl ?? 0),
    unrealized: Number(r.unrealized_pl ?? 0),
  }));

  return (
    <div className="stack">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="field-row">
          <label>mark spread (bps, all tranches)</label>
          <input className="input num" type="number" step={25} value={spread}
            onChange={(e) => setSpread(Number(e.target.value))} />
        </div>
        <RangeToggle options={['M', 'Q', 'A'] as const} value={freq} onChange={setFreq} />
        <button className="btn" disabled={run.isPending} onClick={() => run.mutate()}>
          <Play size={11} /> COMPUTE P&L
        </button>
      </div>
      {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}
      {run.isPending ? (
        <LoadingCursor label="MARKING EVERY MONTH" />
      ) : !data ? (
        <EmptyState message="COMPUTE TO SEE FAIR-VALUE ROLL-FORWARDS" />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {names.map((n) => (
              <button key={n} className={`chip ${n === active ? 'chip--active' : ''}`} onClick={() => setSelected(n)}>{n}</button>
            ))}
            {stmt && (
              <span className="mono" style={{ marginLeft: 12, fontSize: 12 }}>
                IRR TO DATE <span style={{ color: 'var(--text-accent)' }}>{pct(stmt.summary.irr_to_date as number)}</span>
                {' · '}TOTAL P&L <span className={Number(stmt.summary.total_pl) >= 0 ? 'pos' : 'neg'}>{money(stmt.summary.total_pl as number)}</span>
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="period" tick={{ fill: COLORS.axis, fontSize: 10 }} stroke={COLORS.axis} />
              <YAxis tick={{ fill: COLORS.axis, fontSize: 10 }} width={60} stroke={COLORS.axis}
                tickFormatter={(v: number) => money(v)} />
              <ReferenceLine y={0} stroke={COLORS.borderBright} />
              <Tooltip content={({ active: act, payload, label }) => act && payload?.length ? (
                <TooltipShell title={String(label)}>
                  {payload.map((p) => (
                    <div key={String(p.name)} style={{ color: String(p.color) }}>
                      {String(p.name)} {money(Number(p.value))}
                    </div>
                  ))}
                </TooltipShell>
              ) : null} cursor={{ fill: COLORS.borderBright, fillOpacity: 0.15 }} />
              <Bar dataKey="interest" stackId="pl" fill="#4a90d9" fillOpacity={0.7} isAnimationActive={false} />
              <Bar dataKey="realized" stackId="pl" fill="#00c176" fillOpacity={0.7} isAnimationActive={false} />
              <Bar dataKey="unrealized" stackId="pl" fill={COLORS.chartPrimary} fillOpacity={0.7} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          {stmt && (
            <div style={{ overflowX: 'auto' }}>
              <DataTable columns={rfCols} rows={stmt.rollforward.records}
                rowKey={(r) => String(r.period)} emptyMessage="—" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
