// Covenants: editor (factory-based, JSON-safe) + report + per-covenant chart.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Trash2 } from 'lucide-react';
import { getCovenantSchema, monitorCovenants } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { COLORS } from '../../lib/colors';
import { apiErrorMessage, num, pct } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import { hasActuals, useMonitorQuery } from '../../lib/useMonitor';
import type { CovenantConfig } from '../../lib/types';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import LoadingCursor from '../shared/LoadingCursor';
import TooltipShell from '../charts/TooltipShell';

type Row = Record<string, unknown>;

const STATUS_COLOR: Record<string, string> = {
  COMPLIANT: 'var(--positive)', BREACHING: 'var(--warning)', TRIPPED: 'var(--negative)',
};

export default function CovenantsView() {
  const { doc, update } = useDealDraft();
  const [selected, setSelected] = useState<string | null>(null);

  const schema = useQuery({ queryKey: qk.schemaCovenants, queryFn: getCovenantSchema, staleTime: Infinity });
  const covenants: CovenantConfig[] = doc?.covenants ?? [];
  const report = useMonitorQuery('covenants', monitorCovenants,
    covenants.length > 0 && hasActuals(doc));

  const summaryCols: Column<Row>[] = (report.data?.summary.columns ?? []).map((c) => ({
    key: c,
    header: c.replace(/_/g, ' ').toUpperCase(),
    align: c === 'name' || c === 'level' || c === 'status' ? 'left' : 'right',
    sortable: false,
    render: (r) => {
      const v = r[c];
      if (c === 'status') return <span style={{ color: STATUS_COLOR[String(v)] ?? undefined }}>{String(v)}</span>;
      if (c === 'name') return <span style={{ color: 'var(--text-accent)', cursor: 'pointer' }}
        onClick={() => setSelected(String(v))}>{String(v)}</span>;
      if (typeof v !== 'number') return <span className="dim">{String(v ?? '—')}</span>;
      if (c === 'cushion_pct') return <span className={`num mono ${v >= 0 ? 'pos' : 'neg'}`}>{num(v, 1)}%</span>;
      return <span className="num mono">{num(v, 4)}</span>;
    },
  }));

  const detail = selected ? report.data?.details[selected] : null;
  const chartData = (detail?.records ?? []).map((r) => ({
    month: Number(r.month), observed: r.observed as number | null,
    threshold: r.threshold as number | null, status: String(r.status),
  }));
  const trippedZones: { start: number; end: number }[] = [];
  let zoneStart: number | null = null;
  chartData.forEach((r, i) => {
    const bad = r.status !== 'COMPLIANT';
    if (bad && zoneStart == null) zoneStart = r.month;
    if (!bad && zoneStart != null) { trippedZones.push({ start: zoneStart, end: r.month }); zoneStart = null; }
    if (i === chartData.length - 1 && zoneStart != null) trippedZones.push({ start: zoneStart, end: r.month });
  });

  return (
    <div className="stack">
      <div>
        <div className="section-label">COVENANT PACKAGE</div>
        {covenants.map((cv, i) => {
          const spec = (schema.data?.factories ?? []).find((f) => f.factory === cv.factory) as
            { factory: string; label?: string; params?: { name: string; kind: string; default: unknown; choices?: string[] }[] } | undefined;
          return (
            <div key={i} className="field-row" style={{ flexWrap: 'wrap' }}>
              <label style={{ color: 'var(--text-accent)' }}>{String(spec?.label ?? cv.factory)}</label>
              <span className="field-control" style={{ flexWrap: 'wrap' }}>
                {(spec?.params ?? []).map((p) => (
                  <span key={p.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <span className="dim" style={{ fontSize: 10 }}>{p.name}</span>
                    {p.kind === 'enum' ? (
                      <select className="input" value={String(cv.params[p.name] ?? p.default)}
                        onChange={(e) => update((d) => { (d.covenants![i].params as Record<string, unknown>)[p.name] = e.target.value; })}>
                        {(p.choices ?? []).map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                      </select>
                    ) : (
                      <input className="input num" style={{ width: 70 }} type="number" step="any"
                        value={Number(cv.params[p.name] ?? p.default)}
                        onChange={(e) => update((d) => { d.covenants![i].params[p.name] = Number(e.target.value); })} />
                    )}
                  </span>
                ))}
                <span className="dim" style={{ fontSize: 10 }}>grace</span>
                <input className="input num" style={{ width: 44 }} type="number" min={1}
                  value={cv.grace_months ?? 1}
                  onChange={(e) => update((d) => { d.covenants![i].grace_months = Math.max(1, Number(e.target.value)); })} />
                <span className="dim" style={{ fontSize: 10 }}>cure</span>
                <input className="input num" style={{ width: 44 }} type="number" min={1}
                  value={cv.cure_months ?? 1}
                  onChange={(e) => update((d) => { d.covenants![i].cure_months = Math.max(1, Number(e.target.value)); })} />
                <button className="btn" style={{ color: 'var(--warning)' }}
                  onClick={() => update((d) => { d.covenants!.splice(i, 1); })}>
                  <Trash2 size={10} />
                </button>
              </span>
            </div>
          );
        })}
        <div style={{ marginTop: 6 }}>
          <select
            className="input"
            value=""
            onChange={(e) => {
              const spec = (schema.data?.factories ?? []).find((f) => f.factory === e.target.value) as
                { factory: string; params?: { name: string; default: unknown }[] } | undefined;
              if (!spec) return;
              update((d) => {
                d.covenants ??= [];
                d.covenants.push({
                  factory: spec.factory,
                  params: Object.fromEntries((spec.params ?? []).map((p) => [p.name, p.default as number | string])),
                  severity: 'breach', grace_months: 1, cure_months: 1,
                });
              });
            }}
          >
            <option value="">+ add covenant…</option>
            {(schema.data?.factories ?? []).map((f) => (
              <option key={String(f.factory)} value={String(f.factory)}>{String(f.label ?? f.factory)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="section-label">REPORT</div>
      {!covenants.length ? (
        <EmptyState message="NO COVENANTS DEFINED" />
      ) : !hasActuals(doc) ? (
        <EmptyState message="COVENANTS EVALUATE AGAINST ACTUALS — LOAD A TAPE" />
      ) : report.isError ? (
        <div className="field-error-msg" style={{ textAlign: 'left' }}>{apiErrorMessage(report.error, 'Report failed')}</div>
      ) : !report.data ? (
        <LoadingCursor />
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <DataTable columns={summaryCols} rows={report.data!.summary.records}
              rowKey={(r) => String(r.name)} emptyMessage="—" />
          </div>
          {detail && (
            <>
              <div className="section-label" style={{ marginTop: 8 }}>
                {selected!.toUpperCase()} — OBSERVED VS THRESHOLD
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={COLORS.border} vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: COLORS.axis, fontSize: 10 }} stroke={COLORS.axis} />
                  <YAxis tick={{ fill: COLORS.axis, fontSize: 10 }} width={64} stroke={COLORS.axis}
                    tickFormatter={(v: number) => (Math.abs(v) < 1 ? pct(v) : num(v, 2))} domain={['auto', 'auto']} />
                  {trippedZones.map((z, i) => (
                    <ReferenceArea key={i} x1={z.start} x2={z.end} fill="#ff3b3b" fillOpacity={0.12} stroke="none" />
                  ))}
                  <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                    <TooltipShell title={`MONTH ${label}`}>
                      {payload.map((p) => (
                        <div key={String(p.name)} style={{ color: String(p.color) }}>
                          {String(p.name)}: {Number(p.value).toFixed(4)}
                        </div>
                      ))}
                    </TooltipShell>
                  ) : null} cursor={{ stroke: COLORS.borderBright }} />
                  <Line type="stepAfter" dataKey="observed" stroke={COLORS.chartPrimary} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line type="stepAfter" dataKey="threshold" stroke="#ff3b3b" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </>
          )}
        </>
      )}
    </div>
  );
}
