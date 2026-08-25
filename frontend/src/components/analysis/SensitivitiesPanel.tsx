// Sensitivities: factor sweeps + tornado on one tranche (background job).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Play } from 'lucide-react';
import { getAnalysisTranches, getJobResult, listJobs, submitSensitivitiesJob } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { COLORS } from '../../lib/colors';
import { apiErrorMessage, num, pct, walMonths } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import LoadingCursor from '../shared/LoadingCursor';
import TooltipShell from '../charts/TooltipShell';

type Row = Record<string, unknown>;
interface SensResult {
  tranche: string;
  spread_bps: number;
  tornado: Row[];
  factors: Record<string, { records: Row[]; columns: string[]; attrs: Row }>;
}

const FACTORS = ['cdr', 'cpr', 'rate', 'macro'];

export default function SensitivitiesPanel({ runId }: { runId: string }) {
  const { doc, slug } = useDealDraft();
  const queryClient = useQueryClient();
  const [tranche, setTranche] = useState<string | null>(null);
  const [spread, setSpread] = useState(250);
  const [factorTab, setFactorTab] = useState('cdr');

  const tranches = useQuery({
    queryKey: qk.analysis(runId, 'tranches'),
    queryFn: () => getAnalysisTranches(runId),
    staleTime: Infinity,
  });
  const notes = (tranches.data?.tranches ?? []).filter((t) => t.type === 'bond');
  const active = tranche && notes.some((t) => t.name === tranche) ? tranche : notes[0]?.name ?? null;

  const jobs = useQuery({ queryKey: qk.jobs, queryFn: listJobs, refetchInterval: 2500 });
  const done = (jobs.data ?? []).find((j) => j.kind === 'sensitivities' && j.deal === slug && j.status === 'done');
  const running = (jobs.data ?? []).find(
    (j) => j.kind === 'sensitivities' && j.deal === slug && (j.status === 'running' || j.status === 'queued'));
  const failed = (jobs.data ?? []).find((j) => j.kind === 'sensitivities' && j.deal === slug && j.status === 'error');

  const result = useQuery({
    queryKey: done ? qk.jobResult(done.job_id) : ['jobResult', 'none'],
    queryFn: () => getJobResult(done!.job_id) as Promise<unknown> as Promise<SensResult>,
    enabled: done != null,
    staleTime: Infinity,
  });

  const submit = useMutation({
    mutationFn: () => submitSensitivitiesJob(slug!, { doc, tranche: active, spread_bps: spread }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.jobs }),
  });

  const tornado = (result.data?.tornado ?? []).map((r) => ({
    label: `${String(r.factor).toUpperCase()} ${String(r.unit)}`,
    delta: Number(r.price_delta ?? 0),
  }));
  const rateAttrs = result.data?.factors.rate?.attrs;

  const factorRows = result.data?.factors[factorTab]?.records ?? [];
  const factorCols: Column<Row>[] = (result.data?.factors[factorTab]?.columns ?? [])
    .filter((c) => c !== 'factor' && c !== 'is_base')
    .map((c) => ({
      key: c, header: c.replace(/_/g, ' ').toUpperCase(),
      align: c === 'label' ? 'left' : 'right', sortable: false,
      render: (r) => {
        const v = r[c];
        if (typeof v !== 'number') {
          return <span style={r.is_base ? { color: 'var(--text-accent)' } : undefined} className={r.is_base ? '' : 'dim'}>{String(v ?? '—')}</span>;
        }
        if (c === 'xirr' || c === 'cum_loss_rate') return <span className="num mono">{pct(v)}</span>;
        if (c === 'wal') return <span className="num mono">{walMonths(v)}</span>;
        return <span className="num mono">{num(v, 2)}</span>;
      },
    }));

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {notes.map((t) => (
            <button key={t.name} className={`chip ${t.name === active ? 'chip--active' : ''}`}
              onClick={() => setTranche(t.name)}>{t.name}</button>
          ))}
        </div>
        <div className="field-row">
          <label>mark spread (bps)</label>
          <input className="input num" type="number" step={25} value={spread}
            onChange={(e) => setSpread(Number(e.target.value))} />
        </div>
        <button className="btn" disabled={!active || submit.isPending || running != null}
          onClick={() => submit.mutate()}>
          <Play size={11} /> RUN SENSITIVITIES (~20 DEAL RUNS)
        </button>
      </div>
      {submit.isError && <div className="field-error-msg" style={{ textAlign: 'left' }}>{apiErrorMessage(submit.error, 'Submit failed')}</div>}
      {running && (
        <LoadingCursor label={running.progress ? `FACTOR ${running.progress.completed}/${running.progress.total}` : 'RUNNING'} />
      )}
      {failed && !running && !done && (
        <div className="field-error-msg" style={{ textAlign: 'left' }}>{failed.error?.message}</div>
      )}
      {!done && !running && !failed && <EmptyState message="RUN TO SEE THE TORNADO" />}

      {result.data && (
        <>
          <div className="section-label">
            TORNADO — PRICE IMPACT ON {result.data.tranche} (BASE @ +{num(result.data.spread_bps, 0)}BP)
          </div>
          <ResponsiveContainer width="100%" height={40 + tornado.length * 34}>
            <BarChart data={tornado} layout="vertical" margin={{ top: 4, right: 20, bottom: 0, left: 10 }}>
              <CartesianGrid stroke={COLORS.border} horizontal={false} />
              <XAxis type="number" tick={{ fill: COLORS.axis, fontSize: 10 }} stroke={COLORS.axis}
                tickFormatter={(v: number) => num(v, 1)} />
              <YAxis type="category" dataKey="label" width={180}
                tick={{ fill: COLORS.textPrimary, fontSize: 11 }} stroke={COLORS.axis} />
              <ReferenceLine x={0} stroke={COLORS.borderBright} />
              <Tooltip content={({ active: act, payload }) => act && payload?.length ? (
                <TooltipShell title={String((payload[0].payload as { label: string }).label)}>
                  <div style={{ color: COLORS.textPrimary }}>{num(Number(payload[0].value), 3)} pts</div>
                </TooltipShell>
              ) : null} cursor={{ fill: COLORS.borderBright, fillOpacity: 0.12 }} />
              <Bar dataKey="delta" isAnimationActive={false}>
                {tornado.map((t, i) => (
                  <Cell key={i} fill={t.delta >= 0 ? '#00c176' : '#ff3b3b'} fillOpacity={0.75} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {rateAttrs && (
            <div className="mono dim" style={{ fontSize: 11, margin: '4px 0 10px' }}>
              effective duration {num(Number(rateAttrs.effective_duration), 2)}y · DV01 {num(Number(rateAttrs.dv01), 4)} pts/bp
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            {FACTORS.map((f) => (
              <button key={f} className={`chip ${f === factorTab ? 'chip--active' : ''}`}
                onClick={() => setFactorTab(f)}>{f}</button>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <DataTable columns={factorCols} rows={factorRows}
              rowKey={(r) => String(r.label)} emptyMessage="—" />
          </div>
          <div className="dim" style={{ fontSize: 10, marginTop: 4 }}>
            cum_loss_rate is pool-level (identical across tranches); xirr/moic priced at par.
          </div>
        </>
      )}
    </div>
  );
}
