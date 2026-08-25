// Monte Carlo config + launch: n_sims chips, seed, per-curve sampler rows.
// Settings persist into the deal JSON (monte_carlo section).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, X } from 'lucide-react';
import { cancelJob, getReplineSchema, getSamplerSchemas, listJobs, submitMonteCarloJob } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage, num } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import Panel from '../shared/Panel';

const SIM_PRESETS = [100, 500, 1000, 5000];

export default function MonteCarloPanel() {
  const { doc, slug, update } = useDealDraft();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const samplerSchemas = useQuery({ queryKey: qk.schemaSamplers, queryFn: getSamplerSchemas, staleTime: Infinity });
  const replineSchema = useQuery({ queryKey: qk.schemaReplines, queryFn: getReplineSchema, staleTime: Infinity });
  const jobs = useQuery({ queryKey: qk.jobs, queryFn: listJobs, refetchInterval: 2000 });

  const active = (jobs.data ?? []).find(
    (j) => j.kind === 'monte-carlo' && j.deal === slug && (j.status === 'running' || j.status === 'queued'),
  );

  const submit = useMutation({
    mutationFn: () => submitMonteCarloJob(slug!, { doc }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: qk.jobs });
      navigate('/results');
    },
    onError: (err) => setError(apiErrorMessage(err, 'Submit failed')),
  });

  if (!doc) return null;
  const mc = doc.monte_carlo;
  const curveFields = replineSchema.data?.groups.curves ?? ['cdr', 'cpr'];
  const usedFields = new Set(mc.samplers.map((s) => s.field));
  const samplerTypes = samplerSchemas.data?.samplers.filter((s) => s.target === 'curve') ?? [];

  return (
    <Panel
      title="MONTE CARLO"
      subtitle={<span className="dim">collateral distributions · VaR · fan chart</span>}
      actions={
        active ? (
          <button className="btn" style={{ color: 'var(--warning)' }} onClick={() => void cancelJob(active.job_id)}>
            CANCEL
          </button>
        ) : (
          <button
            className="btn"
            style={{ color: 'var(--text-accent)', borderColor: 'var(--text-accent)' }}
            disabled={mc.samplers.length === 0 || submit.isPending}
            onClick={() => submit.mutate()}
          >
            <Play size={11} /> RUN {num(mc.n_sims)} SIMS
          </button>
        )
      }
    >
      {active && (
        <div className="progress-text" style={{ color: 'var(--warning)', marginBottom: 8 }}>
          {active.progress
            ? `SIMULATING ${active.progress.completed}/${active.progress.total}`
            : `JOB ${active.status.toUpperCase()}`}
          <span className="loading-cursor" />
        </div>
      )}
      <div className="field-row">
        <label>simulations</label>
        <span className="field-control">
          {SIM_PRESETS.map((n) => (
            <button
              key={n}
              className={`chip ${mc.n_sims === n ? 'chip--active' : ''}`}
              onClick={() => update((d) => { d.monte_carlo.n_sims = n; })}
            >
              {num(n)}
            </button>
          ))}
          <input
            className="input num"
            style={{ width: 80 }}
            type="number"
            min={1}
            value={mc.n_sims}
            onChange={(e) => update((d) => { d.monte_carlo.n_sims = Math.max(1, Math.trunc(Number(e.target.value))); })}
          />
        </span>
      </div>
      <div className="field-row">
        <label>seed</label>
        <span className="field-control">
          <input
            className="input num"
            type="number"
            placeholder="random"
            value={mc.seed ?? ''}
            onChange={(e) =>
              update((d) => { d.monte_carlo.seed = e.target.value === '' ? null : Math.trunc(Number(e.target.value)); })
            }
          />
        </span>
      </div>
      <div className="field-row">
        <label>store cashflow paths</label>
        <input
          type="checkbox"
          checked={mc.store_paths}
          onChange={(e) => update((d) => { d.monte_carlo.store_paths = e.target.checked; })}
        />
      </div>

      <div className="section-label" style={{ marginTop: 10 }}>SAMPLERS</div>
      {mc.samplers.map((s, i) => (
        <div key={i} className="field-row">
          <label>{s.field.replace(/_/g, ' ')}</label>
          <span className="field-control">
            <select
              className="input"
              value={s.type}
              onChange={(e) => update((d) => { d.monte_carlo.samplers[i].type = e.target.value; })}
            >
              {samplerTypes.map((t) => (
                <option key={t.type} value={t.type} title={t.doc}>{t.label}</option>
              ))}
            </select>
            <span className="dim" style={{ fontSize: 10 }}>σ</span>
            <input
              className="input num"
              style={{ width: 60 }}
              type="number"
              step={0.05}
              value={Number(s.sigma ?? 0.25)}
              onChange={(e) => update((d) => { d.monte_carlo.samplers[i].sigma = Number(e.target.value); })}
            />
            <span className="dim" style={{ fontSize: 10 }}>ρ</span>
            <input
              className="input num"
              style={{ width: 60 }}
              type="number"
              step={0.05}
              min={-0.95}
              max={0.95}
              value={Number(s.rho ?? 0)}
              onChange={(e) => update((d) => { d.monte_carlo.samplers[i].rho = Number(e.target.value); })}
            />
            <button className="btn" onClick={() => update((d) => { d.monte_carlo.samplers.splice(i, 1); })}>
              <X size={10} />
            </button>
          </span>
        </div>
      ))}
      <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          className="input"
          value=""
          onChange={(e) => {
            const f = e.target.value;
            if (!f) return;
            update((d) => {
              d.monte_carlo.samplers.push({ field: f, type: 'lognormal', sigma: 0.25, rho: 0 });
            });
          }}
        >
          <option value="">+ add sampled curve…</option>
          {curveFields.filter((f) => !usedFields.has(f)).map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <span className="dim" style={{ fontSize: 10 }}>
          each sampled curve gets an independent draw per simulation
        </span>
      </div>
      {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}
    </Panel>
  );
}
