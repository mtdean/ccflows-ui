// Deal rates: flat rate, or a named workspace curve (multi-index) with a
// preview chart. Bloomberg later = another named-curve source.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getRatesCurve, listRatesCurves } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { COLORS } from '../../lib/colors';
import { pct } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import Panel from '../shared/Panel';
import TooltipShell from '../charts/TooltipShell';

export default function RatesPanel() {
  const { doc, update } = useDealDraft();
  const rates = doc?.rates ?? { mode: 'flat', rate: 0.043, index: 'sofr_1m' };
  const mode = rates.mode;

  const curves = useQuery({ queryKey: qk.ratesCurves, queryFn: listRatesCurves });
  const namedSlug = mode === 'named' ? rates.curve : null;
  const curveDoc = useQuery({
    queryKey: namedSlug ? qk.ratesCurve(namedSlug) : ['ratesCurve', 'none'],
    queryFn: () => getRatesCurve(namedSlug!),
    enabled: namedSlug != null && namedSlug !== '',
  });

  const index = mode === 'named' || mode === 'flat' ? rates.index : 'sofr_1m';
  const columns = useMemo(() => {
    const summary = (curves.data ?? []).find((c) => c.slug === namedSlug);
    return summary?.columns ?? [];
  }, [curves.data, namedSlug]);

  const chartData = useMemo(() => {
    if (mode !== 'named' || !curveDoc.data) return null;
    return (curveDoc.data.records as Record<string, unknown>[])
      .filter((r) => typeof r[index] === 'number')
      .map((r) => ({ date: String(r.date).slice(0, 7), value: (r[index] as number) * 100 }));
  }, [mode, curveDoc.data, index]);

  if (!doc) return null;

  return (
    <Panel
      title="RATES"
      subtitle={
        <span className="mono dim">
          {mode === 'flat' && `flat ${pct((rates as { rate: number }).rate)} ${index}`}
          {mode === 'named' && `${namedSlug || '—'} · ${index}`}
          {mode === 'records' && `${(rates as { records: unknown[] }).records.length} uploaded records`}
        </span>
      }
    >
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {(['flat', 'named'] as const).map((m) => (
          <button
            key={m}
            className={`chip ${mode === m ? 'chip--active' : ''}`}
            onClick={() =>
              update((d) => {
                if (m === 'flat') d.rates = { mode: 'flat', rate: 0.043, index: 'sofr_1m' };
                else d.rates = { mode: 'named', curve: (curves.data ?? [])[0]?.slug ?? '', index: 'sofr_1m' };
              })
            }
          >
            {m === 'flat' ? 'FLAT RATE' : 'NAMED CURVE'}
          </button>
        ))}
        {mode === 'records' && <span className="chip chip--active">UPLOADED RECORDS</span>}
      </div>

      {mode === 'flat' && (
        <div className="field-row" style={{ maxWidth: 380 }}>
          <label>flat annual rate (decimal)</label>
          <input
            className="input num"
            type="number"
            step={0.0025}
            value={(rates as { rate: number }).rate}
            onChange={(e) => update((d) => { d.rates = { mode: 'flat', rate: Number(e.target.value), index }; })}
          />
        </div>
      )}

      {mode === 'named' && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="field-row">
              <label>curve</label>
              <select
                className="input"
                value={namedSlug ?? ''}
                onChange={(e) => update((d) => { d.rates = { mode: 'named', curve: e.target.value, index }; })}
              >
                <option value="">— pick a curve —</option>
                {(curves.data ?? []).map((c) => (
                  <option key={c.slug} value={c.slug}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label>index column</label>
              <select
                className="input"
                value={index}
                onChange={(e) => update((d) => { d.rates = { mode: 'named', curve: namedSlug ?? '', index: e.target.value }; })}
              >
                {(columns.length ? columns : [index]).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <span className="dim" style={{ fontSize: 10, alignSelf: 'center' }}>
              manage curves on the DEALS page
            </span>
          </div>
          {chartData && chartData.length > 1 && (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: COLORS.axis, fontSize: 9 }} minTickGap={40} stroke={COLORS.axis} />
                <YAxis tick={{ fill: COLORS.axis, fontSize: 10 }} width={48} stroke={COLORS.axis}
                  tickFormatter={(v: number) => `${v.toFixed(2)}%`} domain={['auto', 'auto']} />
                <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                  <TooltipShell title={String(label)}>
                    <div style={{ color: COLORS.textPrimary }}>{Number(payload[0].value).toFixed(3)}%</div>
                  </TooltipShell>
                ) : null} cursor={{ stroke: COLORS.borderBright }} />
                <Line dataKey="value" stroke={COLORS.chartPrimary} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </Panel>
  );
}
