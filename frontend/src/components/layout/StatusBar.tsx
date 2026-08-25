// Bottom status bar: backend health, open deal + dirty state, last run,
// active background jobs.

import { useQuery } from '@tanstack/react-query';
import { getHealth, listJobs } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { fmtTime } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import { useRuns } from '../../lib/useRuns';

export default function StatusBar() {
  const { slug, dirty, lastSaved } = useDealDraft();
  const { lastRun, running, currentHash } = useRuns();

  const health = useQuery({
    queryKey: qk.health,
    queryFn: getHealth,
    refetchInterval: 30_000,
    retry: false,
  });

  const jobs = useQuery({
    queryKey: qk.jobs,
    queryFn: listJobs,
    refetchInterval: 4_000,
    retry: false,
  });

  const active = (jobs.data ?? []).filter((j) => j.status === 'queued' || j.status === 'running');
  const stale = lastRun != null && currentHash != null && lastRun.docHash !== currentHash;

  return (
    <footer className="statusbar">
      <span>
        <span className={`dot ${health.data ? 'dot-live' : 'dot-dead'}`} />
        {health.data ? `ENGINE ${health.data.engine_version}` : 'BACKEND UNREACHABLE'}
      </span>
      {health.data?.dirs && (
        <span
          className={health.data.dirs.ok ? 'dim' : 'neg'}
          title={Object.entries(health.data.dirs.folders)
            .map(([name, f]) => `${f.exists ? '✓' : '✗ MISSING'} ${name} → ${f.path}`)
            .join('\n')}
        >
          {health.data.dirs.ok
            ? `⌂ ${health.data.dirs.folders.workspace?.path.replace(/^.*?([^/]+\/workspace)$/, '$1')}`
            : '⚠ FOLDERS MISSING'}
        </span>
      )}
      {slug && (
        <span>
          DEAL {slug.toUpperCase()}
          {dirty ? (
            <span style={{ color: 'var(--warning)' }}> · ● UNSAVED</span>
          ) : lastSaved ? (
            <span className="dim"> · SAVED {fmtTime(lastSaved)}</span>
          ) : null}
        </span>
      )}
      {running && <span style={{ color: 'var(--warning)' }}>RUNNING {running.toUpperCase()}…</span>}
      {lastRun && !running && (
        <span>
          LAST RUN {lastRun.scenario.toUpperCase()} {fmtTime(lastRun.at)}
          {stale && <span style={{ color: 'var(--warning)' }}> ⚠ EDITED SINCE</span>}
        </span>
      )}
      {active.map((j) => (
        <span key={j.job_id} style={{ color: 'var(--warning)' }} className="progress-text">
          {j.kind.toUpperCase()}{' '}
          {j.progress ? `${j.progress.completed}/${j.progress.total}` : j.status.toUpperCase()}
          <span className="loading-cursor" />
        </span>
      ))}
      <span className="topbar-spacer" />
    </footer>
  );
}
