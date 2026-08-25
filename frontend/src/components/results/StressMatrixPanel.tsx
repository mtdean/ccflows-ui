// Stress matrix results: CDR× rows × CPR× columns, colored cells.
// Reads the latest finished stress-matrix job for the open deal.

import { useQuery } from '@tanstack/react-query';
import { getJobResult, listJobs } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { pct } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import EmptyState from '../shared/EmptyState';
import LoadingCursor from '../shared/LoadingCursor';

interface Cell {
  cdr_mult: number;
  cpr_mult: number;
  value: number | null;
}

function heatColor(v: number, min: number, max: number): string {
  if (max === min) return 'transparent';
  const t = (v - min) / (max - min); // 0 = worst, 1 = best
  if (t >= 0.5) return `rgba(0, 193, 118, ${(0.05 + (t - 0.5) * 0.3).toFixed(3)})`;
  return `rgba(255, 59, 59, ${(0.05 + (0.5 - t) * 0.3).toFixed(3)})`;
}

export default function StressMatrixPanel() {
  const { slug } = useDealDraft();
  const jobs = useQuery({ queryKey: qk.jobs, queryFn: listJobs, refetchInterval: 4000 });
  const job = (jobs.data ?? []).find(
    (j) => j.kind === 'stress-matrix' && j.deal === slug && j.status === 'done',
  );
  const running = (jobs.data ?? []).find(
    (j) => j.kind === 'stress-matrix' && j.deal === slug && (j.status === 'running' || j.status === 'queued'),
  );

  const result = useQuery({
    queryKey: job ? qk.jobResult(job.job_id) : ['jobResult', 'none'],
    queryFn: () => getJobResult(job!.job_id),
    enabled: job != null,
    staleTime: Infinity,
  });

  if (running) return <LoadingCursor label={`RUNNING MATRIX`} />;
  if (!job) return <EmptyState message="NO STRESS MATRIX YET — RUN ONE FROM SCENARIOS" />;
  if (result.isLoading) return <LoadingCursor />;

  const data = result.data as { metric?: string; tranche?: string | null; cells?: Cell[] } | undefined;
  const cells = data?.cells ?? [];
  if (!cells.length) return <EmptyState message="EMPTY MATRIX RESULT" />;

  const cdrs = [...new Set(cells.map((c) => c.cdr_mult))].sort((a, b) => a - b);
  const cprs = [...new Set(cells.map((c) => c.cpr_mult))].sort((a, b) => a - b);
  const values = cells.map((c) => c.value).filter((v): v is number => v != null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const lookup = new Map(cells.map((c) => [`${c.cdr_mult}|${c.cpr_mult}`, c.value]));
  const isPctMetric = (data?.metric ?? 'xirr') !== 'wal';

  return (
    <div>
      <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
        {(data?.metric ?? 'xirr').toUpperCase()}
        {data?.tranche ? ` · TRANCHE ${data.tranche}` : ' · DEAL'} — rows CDR×, columns CPR×
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>CDR× \ CPR×</th>
              {cprs.map((c) => (
                <th key={c} style={{ textAlign: 'right' }}>{c}×</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cdrs.map((cdr) => (
              <tr key={cdr}>
                <td className="mono" style={{ color: 'var(--text-accent)' }}>{cdr}×</td>
                {cprs.map((cpr) => {
                  const v = lookup.get(`${cdr}|${cpr}`);
                  return (
                    <td
                      key={cpr}
                      className="heat-cell mono"
                      style={{ background: v == null ? undefined : heatColor(v, min, max) }}
                    >
                      {v == null ? '—' : isPctMetric ? pct(v) : v.toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
