// Exports: write run/job artifacts to the target folder with standardized
// names, download them directly, and browse export history.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FolderOutput } from 'lucide-react';
import { client, exportJob, exportRun, listExports, listJobs } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { apiErrorMessage, fmtTime, num } from '../lib/utils';
import { useDealDraft } from '../lib/useDealDraft';
import { useRuns } from '../lib/useRuns';
import DataTable from '../components/shared/DataTable';
import type { Column } from '../components/shared/DataTable';
import EmptyState from '../components/shared/EmptyState';
import Panel from '../components/shared/Panel';

const RUN_ARTIFACTS = [
  { key: 'deal', label: 'FULL DEAL WORKBOOK', formats: ['xlsx'] },
  { key: 'stack', label: 'STACK SUMMARY', formats: ['csv', 'json', 'xlsx'] },
  { key: 'collateral', label: 'MONTHLY COLLATERAL CASHFLOWS', formats: ['csv', 'json', 'xlsx'] },
  { key: 'triggers', label: 'TRIGGER TIMELINES', formats: ['csv', 'json', 'xlsx'] },
] as const;

export default function ExportsPage() {
  const { doc, slug, update, loading } = useDealDraft();
  const { runs } = useRuns();
  const queryClient = useQueryClient();
  const [scenario, setScenario] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<string>('deal');
  const [format, setFormat] = useState<string>('xlsx');
  const [message, setMessage] = useState<string | null>(null);

  const scenarios = Object.keys(runs);
  const activeScenario = scenario && runs[scenario] ? scenario : scenarios[scenarios.length - 1] ?? null;
  const run = activeScenario ? runs[activeScenario] : null;

  const jobs = useQuery({ queryKey: qk.jobs, queryFn: listJobs, refetchInterval: 5000 });
  const doneJobs = (jobs.data ?? []).filter((j) => j.deal === slug && j.status === 'done');

  const history = useQuery({
    queryKey: slug ? qk.exports(slug) : ['exports', 'none'],
    queryFn: () => listExports(slug!),
    enabled: slug != null,
    refetchInterval: 10_000,
  });

  const doExport = useMutation({
    mutationFn: () =>
      exportRun(run!.summary.run_id, {
        format: format as 'xlsx' | 'csv' | 'json',
        artifact,
        folder: doc?.export.folder ?? null,
      }),
    onSuccess: (res) => {
      setMessage(`Wrote ${res.path}`);
      queryClient.invalidateQueries({ queryKey: qk.exports(slug!) });
    },
    onError: (err) => setMessage(apiErrorMessage(err, 'Export failed')),
  });

  const doJobExport = useMutation({
    mutationFn: (jobId: string) =>
      exportJob(jobId, { format: 'csv', artifact: 'auto', folder: doc?.export.folder ?? null }),
    onSuccess: (res) => {
      setMessage(`Wrote ${res.path}`);
      queryClient.invalidateQueries({ queryKey: qk.exports(slug!) });
    },
    onError: (err) => setMessage(apiErrorMessage(err, 'Export failed')),
  });

  if (!doc && !loading) return <EmptyState message="OPEN A DEAL FIRST" />;
  if (!doc) return null;

  const artifactDef = RUN_ARTIFACTS.find((a) => a.key === artifact) ?? RUN_ARTIFACTS[0];
  const validFormat = artifactDef.formats.includes(format as never) ? format : artifactDef.formats[0];

  const historyCols: Column<{ filename: string; path: string; size: number; modified: string }>[] = [
    { key: 'filename', header: 'FILE', render: (r) => <span style={{ color: 'var(--text-accent)' }}>{r.filename}</span> },
    { key: 'size', header: 'SIZE', align: 'right', render: (r) => <span className="num mono">{num(r.size / 1024, 1)} KB</span>, sortValue: (r) => r.size },
    { key: 'modified', header: 'WRITTEN', align: 'right', render: (r) => <span className="num mono dim">{r.modified.slice(0, 10)} {fmtTime(r.modified)}</span>, sortValue: (r) => r.modified },
  ];

  return (
    <div className="stack">
      <Panel
        title="EXPORT RUN RESULTS"
        subtitle={
          <span className="dim">
            files land as {'{date}_{time}_{scenario}_{artifact}.{ext}'} under exports/{slug}/
          </span>
        }
      >
        {scenarios.length === 0 ? (
          <EmptyState message="RUN THE DEAL FIRST — EXPORTS COME FROM RUN RESULTS" />
        ) : (
          <>
            <div className="field-row">
              <label>run</label>
              <span className="field-control">
                {scenarios.map((s) => (
                  <button key={s} className={`chip ${s === activeScenario ? 'chip--active' : ''}`} onClick={() => setScenario(s)}>
                    {s.replace(/_/g, ' ')}
                  </button>
                ))}
              </span>
            </div>
            <div className="field-row">
              <label>artifact</label>
              <span className="field-control">
                <select className="input" value={artifact} onChange={(e) => setArtifact(e.target.value)}>
                  {RUN_ARTIFACTS.map((a) => (
                    <option key={a.key} value={a.key}>{a.label}</option>
                  ))}
                </select>
              </span>
            </div>
            <div className="field-row">
              <label>format</label>
              <span className="field-control">
                {artifactDef.formats.map((f) => (
                  <button key={f} className={`chip ${f === validFormat ? 'chip--active' : ''}`} onClick={() => setFormat(f)}>
                    {f}
                  </button>
                ))}
              </span>
            </div>
            <div className="field-row">
              <label>target folder</label>
              <span className="field-control">
                <input
                  className="input"
                  style={{ width: 260 }}
                  placeholder={`default: exports/${slug}/`}
                  value={doc.export.folder ?? ''}
                  onChange={(e) => update((d) => { d.export.folder = e.target.value || null; })}
                />
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button className="btn" disabled={!run || doExport.isPending} onClick={() => doExport.mutate()}>
                <FolderOutput size={12} /> EXPORT TO FOLDER
              </button>
              <button
                className="btn"
                disabled={!run}
                onClick={() => {
                  const url = `${client.defaults.baseURL}/runs/${run!.summary.run_id}/export/download?format=${validFormat}&artifact=${artifact}`;
                  window.open(url, '_blank');
                }}
              >
                <Download size={12} /> DOWNLOAD
              </button>
            </div>
            {message && (
              <div className="mono" style={{ fontSize: 11, marginTop: 8, color: message.startsWith('Wrote') ? 'var(--positive)' : 'var(--negative)' }}>
                {message}
              </div>
            )}
          </>
        )}
      </Panel>

      {doneJobs.length > 0 && (
        <Panel title="EXPORT JOB RESULTS" subtitle={<span className="dim">monte carlo · stress matrices</span>}>
          {doneJobs.map((j) => (
            <div key={j.job_id} className="field-row">
              <label>
                {j.kind.replace(/-/g, ' ')} · {fmtTime(j.finished)}
                {j.kind === 'monte-carlo' && ` · ${num(Number(j.params.n_sims ?? 0))} sims`}
              </label>
              <span className="field-control">
                <button className="btn" disabled={doJobExport.isPending} onClick={() => doJobExport.mutate(j.job_id)}>
                  <FolderOutput size={11} /> CSV TO FOLDER
                </button>
              </span>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="EXPORT HISTORY" subtitle={<span className="dim">exports/{slug}/</span>}>
        <DataTable
          columns={historyCols}
          rows={history.data ?? []}
          rowKey={(r) => r.filename}
          initialSort="modified"
          emptyMessage="NOTHING EXPORTED YET"
        />
      </Panel>
    </div>
  );
}
