// Principal breakevens: the loss-curve multiplier at which each tranche's
// cumulative cash exactly returns its purchase price. Background job.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { getJobResult, listJobs, submitBreakevenJob } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage, num } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import type { BreakevenRow } from '../../lib/types';
import DataTable from '../shared/DataTable';
import type { Column } from '../shared/DataTable';
import EmptyState from '../shared/EmptyState';
import LoadingCursor from '../shared/LoadingCursor';

export default function BreakevenPanel() {
  const { doc, slug } = useDealDraft();
  const queryClient = useQueryClient();
  const [curve, setCurve] = useState<'cdr' | 'cgl'>('cdr');
  const [price, setPrice] = useState(100);
  const [error, setError] = useState<string | null>(null);

  const jobs = useQuery({ queryKey: qk.jobs, queryFn: listJobs, refetchInterval: 2500 });
  const done = (jobs.data ?? []).find((j) => j.kind === 'breakeven' && j.deal === slug && j.status === 'done');
  const active = (jobs.data ?? []).find(
    (j) => j.kind === 'breakeven' && j.deal === slug && (j.status === 'running' || j.status === 'queued'),
  );
  const failed = (jobs.data ?? []).find((j) => j.kind === 'breakeven' && j.deal === slug && j.status === 'error');

  const result = useQuery({
    queryKey: done ? qk.jobResult(done.job_id) : ['jobResult', 'none'],
    queryFn: () => getJobResult(done!.job_id) as Promise<{ curve: string; condition: string; max_multiplier: number; rows: BreakevenRow[] }>,
    enabled: done != null,
    staleTime: Infinity,
  });

  const submit = useMutation({
    mutationFn: () => submitBreakevenJob(slug!, { doc, curve, price }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: qk.jobs });
    },
    onError: (err) => setError(apiErrorMessage(err, 'Submit failed')),
  });

  const maxMult = result.data?.max_multiplier ?? 50;
  const columns: Column<BreakevenRow>[] = [
    { key: 'tranche', header: 'TRANCHE', render: (r) => <span style={{ color: 'var(--text-accent)' }}>{r.tranche}</span> },
    { key: 'price', header: 'PRICE', align: 'right', render: (r) => <span className="num mono">{num(r.price, 2)}</span> },
    {
      key: 'breakeven_multiplier', header: `BREAKEVEN ${curve.toUpperCase()}×`, align: 'right',
      render: (r) => r.breakeven_multiplier == null
        ? <span className="pos" title={`No breakeven within ${maxMult}× — cash never falls below cost`}>&gt;{maxMult}×</span>
        : <span className="num mono">{num(r.breakeven_multiplier, 2)}×</span>,
      sortValue: (r) => r.breakeven_multiplier,
    },
    {
      key: 'cushion_pct', header: 'CUSHION', align: 'right',
      render: (r) => r.cushion_pct == null
        ? <span className="pos">ample</span>
        : <span className={`num mono ${r.cushion_pct > 0 ? 'pos' : 'neg'}`}>{num(r.cushion_pct, 2)}×</span>,
      sortValue: (r) => r.cushion_pct,
    },
    { key: 'base_moic', header: 'BASE MOIC', align: 'right', render: (r) => <span className="num mono">{r.base_moic != null ? num(r.base_moic, 2) : '—'}</span> },
    { key: 'base_net_cash', header: 'BASE NET CASH', align: 'right', render: (r) => <span className="num mono">{r.base_net_cash != null ? `$${num(r.base_net_cash / 1e6, 1)}M` : '—'}</span> },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <div className="field-row">
          <label>loss curve</label>
          <select className="input" value={curve} onChange={(e) => setCurve(e.target.value as 'cdr' | 'cgl')}>
            <option value="cdr">CDR (default curve ×)</option>
            <option value="cgl">CGL (cumulative gross loss ×)</option>
          </select>
        </div>
        <div className="field-row">
          <label>purchase price</label>
          <input className="input num" type="number" step={0.25} value={price}
            onChange={(e) => setPrice(Number(e.target.value))} />
        </div>
        <button className="btn" disabled={submit.isPending || active != null} onClick={() => submit.mutate()}>
          <Play size={11} /> RUN BREAKEVENS
        </button>
      </div>
      {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}
      {failed && !active && !done && (
        <div className="field-error-msg" style={{ textAlign: 'left' }}>{failed.error?.message}</div>
      )}
      {active && <LoadingCursor label="SOLVING BREAKEVENS (re-runs the deal per iterate)" />}
      {!active && !done && !failed && <EmptyState message="RUN TO SOLVE PER-TRANCHE LOSS BREAKEVENS" />}
      {done && result.data && (
        <>
          <DataTable columns={columns} rows={result.data.rows} rowKey={(r) => r.tranche} emptyMessage="—" />
          <div className="dim" style={{ fontSize: 10, marginTop: 6 }}>
            Breakeven condition: {result.data.condition}. Multiplier scales the {result.data.curve.toUpperCase()} curve;
            cushion = multiplier − 1 (headroom above current assumptions).
          </div>
        </>
      )}
    </div>
  );
}
