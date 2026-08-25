// Tranche-level Monte Carlo results: per-tranche outcome distributions from
// running the same waterfall over sampled collateral paths.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Play } from 'lucide-react';
import { getJobResult, listJobs, submitTrancheMcJob } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { COLORS } from '../../lib/colors';
import { apiErrorMessage, money, num, pct, walMonths } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import LoadingCursor from '../shared/LoadingCursor';
import TooltipShell from '../charts/TooltipShell';

type Stats = Record<string, number>;
interface TrancheRow {
  tranche: string;
  xirr: Stats; moic: Stats; wal: Stats; writedown: Stats;
  prob_writedown: number;
}
interface TmcResult {
  n_sims: number; seed: number;
  tranches: TrancheRow[];
  histograms: Record<string, { bin_left: number; bin_right: number; count: number }[]>;
  residual_cash: Stats | null;
  price_distribution: Record<string, Stats> | null;
}

export default function TrancheMcPanel() {
  const { doc, slug } = useDealDraft();
  const queryClient = useQueryClient();
  const [nSims, setNSims] = useState(300);
  const [histTranche, setHistTranche] = useState<string | null>(null);

  const jobs = useQuery({ queryKey: qk.jobs, queryFn: listJobs, refetchInterval: 2500 });
  const done = (jobs.data ?? []).find((j) => j.kind === 'tranche-mc' && j.deal === slug && j.status === 'done');
  const running = (jobs.data ?? []).find(
    (j) => j.kind === 'tranche-mc' && j.deal === slug && (j.status === 'running' || j.status === 'queued'));
  const failed = (jobs.data ?? []).find((j) => j.kind === 'tranche-mc' && j.deal === slug && j.status === 'error');

  const result = useQuery({
    queryKey: done ? qk.jobResult(done.job_id) : ['jobResult', 'none'],
    queryFn: () => getJobResult(done!.job_id) as Promise<unknown> as Promise<TmcResult>,
    enabled: done != null,
    staleTime: Infinity,
  });

  const submit = useMutation({
    mutationFn: () =>
      submitTrancheMcJob(slug!, {
        doc, n_sims: nSims,
        seed: doc?.monte_carlo.seed ?? 42,
        samplers: doc?.monte_carlo.samplers ?? [],
        spreads: 200,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.jobs }),
  });

  const statCols = (metric: 'xirr' | 'moic' | 'wal' | 'writedown'): Column<TrancheRow>[] =>
    (['p5', 'p50', 'p95'] as const).map((q) => ({
      key: `${metric}_${q}`,
      header: q.toUpperCase(),
      align: 'right',
      sortable: false,
      render: (r) => {
        const v = r[metric]?.[q];
        if (v == null) return <span className="dim">—</span>;
        if (metric === 'xirr') return <span className="num mono">{pct(v)}</span>;
        if (metric === 'wal') return <span className="num mono">{walMonths(v)}</span>;
        if (metric === 'writedown') return <span className="num mono">{money(v)}</span>;
        return <span className="num mono">{num(v, 2)}</span>;
      },
    }));

  const columns: Column<TrancheRow>[] = [
    { key: 'tranche', header: 'TRANCHE', render: (r) => <span style={{ color: 'var(--text-accent)' }}>{r.tranche}</span> },
    ...statCols('xirr').map((c, i) => ({ ...c, header: `XIRR ${['P5', 'P50', 'P95'][i]}` })),
    ...statCols('wal').map((c, i) => ({ ...c, header: `WAL ${['P5', 'P50', 'P95'][i]}` })),
    ...statCols('writedown').map((c, i) => ({ ...c, header: `WD ${['P5', 'P50', 'P95'][i]}` })),
    {
      key: 'prob_writedown', header: 'P(WRITEDOWN)', align: 'right', sortable: false,
      render: (r) => (
        <span className={`num mono ${r.prob_writedown > 0.05 ? 'neg' : 'pos'}`}>
          {pctLevelish(r.prob_writedown)}
        </span>
      ),
    },
  ];

  const activeHist = histTranche && result.data?.histograms[histTranche]
    ? histTranche
    : Object.keys(result.data?.histograms ?? {})[0];
  const hist = (result.data?.histograms[activeHist ?? ''] ?? []).map((b) => ({
    label: pct((b.bin_left + b.bin_right) / 2, 1),
    count: b.count,
  }));

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="dim" style={{ fontSize: 11 }}>
          Runs the SAME waterfall over {num(nSims)} sampled collateral paths (uses the deal's MC samplers).
        </span>
        <input className="input num" style={{ width: 80 }} type="number" min={10} max={2000}
          value={nSims} onChange={(e) => setNSims(Number(e.target.value))} />
        <button className="btn" disabled={submit.isPending || running != null || !(doc?.monte_carlo.samplers.length)}
          onClick={() => submit.mutate()}>
          <Play size={11} /> RUN TRANCHE MC
        </button>
      </div>
      {submit.isError && <div className="field-error-msg" style={{ textAlign: 'left' }}>{apiErrorMessage(submit.error, 'Submit failed')}</div>}
      {running && (
        <LoadingCursor label={running.progress
          ? `${running.progress.completed}/${running.progress.total} (sample + run)` : 'RUNNING'} />
      )}
      {failed && !running && !done && (
        <div className="field-error-msg" style={{ textAlign: 'left' }}>{failed.error?.message}</div>
      )}
      {!done && !running && !failed && <EmptyState message="RUN FOR PER-TRANCHE OUTCOME DISTRIBUTIONS" />}
      {result.data && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <DataTable columns={columns} rows={result.data.tranches}
              rowKey={(r) => r.tranche} emptyMessage="—" />
          </div>
          <div style={{ display: 'flex', gap: 4, margin: '10px 0 4px' }}>
            {Object.keys(result.data.histograms).map((n) => (
              <button key={n} className={`chip ${n === activeHist ? 'chip--active' : ''}`}
                onClick={() => setHistTranche(n)}>{n} XIRR</button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={hist} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: COLORS.axis, fontSize: 9 }} minTickGap={26} stroke={COLORS.axis} />
              <YAxis tick={{ fill: COLORS.axis, fontSize: 10 }} width={40} stroke={COLORS.axis} />
              <Tooltip content={({ active, payload }) => active && payload?.length ? (
                <TooltipShell title={String((payload[0].payload as { label: string }).label)}>
                  <div style={{ color: COLORS.textPrimary }}>{String(payload[0].value)} sims</div>
                </TooltipShell>
              ) : null} cursor={{ fill: COLORS.borderBright, fillOpacity: 0.15 }} />
              <Bar dataKey="count" fill={COLORS.chartPrimary} fillOpacity={0.7} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div className="grid-2" style={{ marginTop: 8 }}>
            {result.data.residual_cash && (
              <div>
                <div className="section-label">RESIDUAL CASH DISTRIBUTION</div>
                <span className="mono" style={{ fontSize: 12 }}>
                  P5 {money(result.data.residual_cash.p5)} · P50{' '}
                  <span style={{ color: 'var(--text-accent)' }}>{money(result.data.residual_cash.p50)}</span>{' '}
                  · P95 {money(result.data.residual_cash.p95)}
                </span>
              </div>
            )}
            {result.data.price_distribution && (
              <div>
                <div className="section-label">PRICE DISTRIBUTION (AT 200BP MARK)</div>
                {Object.entries(result.data.price_distribution).map(([n, s]) => (
                  <div key={n} className="mono" style={{ fontSize: 11 }}>
                    {n}: P5 {num(s.p5, 2)} · P50 {num(s.p50, 2)} · P95 {num(s.p95, 2)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function pctLevelish(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
