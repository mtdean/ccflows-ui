// Per-tranche spliced series: actual months (shaded) then projection, plus
// realized/forward metrics and the bond redline summary.

import { useState } from 'react';
import {
  Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { monitorBondRedline, monitorTrancheSeries } from '../../lib/api';
import { COLORS } from '../../lib/colors';
import { apiErrorMessage, money, num, pct, walMonths } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import { useMonitorQuery } from '../../lib/useMonitor';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import LoadingCursor from '../shared/LoadingCursor';
import TooltipShell from '../charts/TooltipShell';

type Row = Record<string, unknown>;

export default function TrancheSeriesView() {
  const { doc } = useDealDraft();
  const [tranche, setTranche] = useState<string | null>(null);
  const series = useMonitorQuery('trancheSeries', monitorTrancheSeries);
  const redline = useMonitorQuery('bondRedline', monitorBondRedline,
    Boolean(doc?.actuals?.bonds?.length));

  if (series.isLoading) return <LoadingCursor />;
  if (series.isError) {
    return <div className="field-error-msg" style={{ textAlign: 'left' }}>{apiErrorMessage(series.error, 'Series failed')}</div>;
  }
  if (!series.data) return null;

  const { boundary_month: boundary, tranches } = series.data;
  const active = tranche && tranches.includes(tranche) ? tranche : tranches[0];
  const rows = series.data.series.records.filter((r) => r.tranche === active);
  const data = rows.map((r) => ({
    month: Number(r.month),
    balance: r.tranche_balance_end as number | null,
    interest: r.tranche_interest_paid as number | null,
    principal: r.tranche_principal_paid as number | null,
  }));

  const rlCols: Column<Row>[] = (redline.data?.summary.columns ?? []).map((c) => ({
    key: c, header: c.replace(/_/g, ' ').toUpperCase(),
    align: c === 'tranche' ? 'left' : 'right', sortable: false,
    render: (r) => {
      const v = r[c];
      if (typeof v !== 'number') return <span style={{ color: 'var(--text-accent)' }}>{String(v ?? '—')}</span>;
      if (c.includes('pct') || c === 'hit_rate') {
        return <span className={`num mono ${Math.abs(v) > 0.02 && c !== 'hit_rate' ? 'neg' : ''}`}>{pct(v)}</span>;
      }
      if (c.startsWith('cum_') || c.startsWith('end_')) return <span className="num mono">{money(v)}</span>;
      return <span className="num mono">{num(v, 1)}</span>;
    },
  }));

  return (
    <div className="stack">
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {tranches.map((n) => (
          <button key={n} className={`chip ${n === active ? 'chip--active' : ''}`} onClick={() => setTranche(n)}>{n}</button>
        ))}
        <span className="dim" style={{ fontSize: 11, marginLeft: 8 }}>
          shaded = actual months (thru M{boundary}); rest = re-seeded projection
        </span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COLORS.border} vertical={false} />
          <XAxis dataKey="month" tick={{ fill: COLORS.axis, fontSize: 10 }} minTickGap={40} stroke={COLORS.axis} />
          <YAxis yAxisId="bal" tick={{ fill: COLORS.axis, fontSize: 10 }} width={62} stroke={COLORS.axis}
            tickFormatter={(v: number) => money(v)} />
          <YAxis yAxisId="flow" orientation="right" tick={{ fill: COLORS.axis, fontSize: 10 }} width={62}
            stroke={COLORS.axis} tickFormatter={(v: number) => money(v)} />
          {boundary > 0 && <ReferenceArea yAxisId="bal" x1={0} x2={boundary} fill={COLORS.chartPrimary} fillOpacity={0.07} stroke="none" />}
          <Tooltip content={({ active: act, payload, label }) => act && payload?.length ? (
            <TooltipShell title={`MONTH ${label}${Number(label) <= boundary ? ' · ACTUAL' : ''}`}>
              {payload.map((p) => (
                <div key={String(p.name)} style={{ color: String(p.color) }}>
                  {String(p.name)} {money(Number(p.value))}
                </div>
              ))}
            </TooltipShell>
          ) : null} cursor={{ stroke: COLORS.borderBright }} />
          <Bar yAxisId="flow" dataKey="interest" fill="#4a90d9" fillOpacity={0.55} isAnimationActive={false} />
          <Bar yAxisId="flow" dataKey="principal" fill="#00c176" fillOpacity={0.55} isAnimationActive={false} />
          <Line yAxisId="bal" dataKey="balance" stroke={COLORS.chartPrimary} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="grid-2">
        <div>
          <div className="section-label">REALIZED (ACTUAL MONTHS)</div>
          <SimpleTable table={series.data.realized} />
        </div>
        <div>
          <div className="section-label">FORWARD (FROM BOUNDARY)</div>
          <SimpleTable table={series.data.forward} />
        </div>
      </div>

      {redline.data && (
        <div>
          <div className="section-label">BOND REDLINE — TRUSTEE VS MODEL</div>
          <div style={{ overflowX: 'auto' }}>
            <DataTable columns={rlCols} rows={redline.data.summary.records}
              rowKey={(r) => String(r.tranche)} emptyMessage="—" />
          </div>
        </div>
      )}
    </div>
  );
}

function SimpleTable({ table }: { table: { columns: string[]; records: Row[] } }) {
  const cols: Column<Row>[] = table.columns.map((c) => ({
    key: c, header: c.replace(/_/g, ' ').toUpperCase(),
    align: c === 'tranche' ? 'left' : 'right', sortable: false,
    render: (r) => {
      const v = r[c];
      if (typeof v !== 'number') return <span style={{ color: 'var(--text-accent)' }}>{String(v ?? '—')}</span>;
      if (c.includes('xirr') || c.includes('factor')) return <span className="num mono">{c.includes('factor') ? num(v, 3) : pct(v)}</span>;
      if (c.includes('wal')) return <span className="num mono">{walMonths(v)}</span>;
      if (c.includes('moic')) return <span className="num mono">{num(v, 2)}</span>;
      if (Math.abs(v) > 1000) return <span className="num mono">{money(v)}</span>;
      return <span className="num mono">{num(v, 2)}</span>;
    },
  }));
  return <DataTable columns={cols} rows={table.records} rowKey={(r) => String(r.tranche)} emptyMessage="—" />;
}
