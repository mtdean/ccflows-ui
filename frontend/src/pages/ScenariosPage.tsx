// Scenarios: stress (left) and Monte Carlo (right) — both one click deep.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, X } from 'lucide-react';
import { getStressScenarios, submitStressMatrixJob } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { apiErrorMessage } from '../lib/utils';
import { useDealDraft } from '../lib/useDealDraft';
import { useRuns } from '../lib/useRuns';
import EmptyState from '../components/shared/EmptyState';
import LoadingCursor from '../components/shared/LoadingCursor';
import Panel from '../components/shared/Panel';
import MonteCarloPanel from '../components/scenarios/MonteCarloPanel';

function CustomMultiplierEditor() {
  const { doc, update } = useDealDraft();
  const { runScenario, running } = useRuns();
  const navigate = useNavigate();
  const scenarios = useQuery({ queryKey: qk.schemaScenarios, queryFn: getStressScenarios, staleTime: Infinity });
  const [error, setError] = useState<string | null>(null);

  if (!doc) return null;
  const custom = doc.stress.custom_multipliers ?? {};
  const entries = Object.entries(custom);
  const fields = scenarios.data?.multiplier_fields ?? [];
  const unused = fields.filter((f) => !(f in custom));

  return (
    <div>
      <div className="section-label">CUSTOM MULTIPLIERS</div>
      {entries.length === 0 && (
        <span className="dim" style={{ fontSize: 11 }}>
          Scale any assumption curve (1.0 = unchanged; *_shift fields are month offsets).
        </span>
      )}
      {entries.map(([field, mult]) => (
        <div key={field} className="field-row">
          <label>{field.replace(/_/g, ' ')}</label>
          <span className="field-control">
            <input
              className="input num"
              type="number"
              step={field.endsWith('_shift') ? 1 : 0.05}
              value={Number(mult)}
              onChange={(e) =>
                update((d) => {
                  d.stress.custom_multipliers = {
                    ...(d.stress.custom_multipliers ?? {}),
                    [field]: Number(e.target.value),
                  };
                })
              }
            />
            <span className="dim" style={{ fontSize: 10 }}>{field.endsWith('_shift') ? 'mo' : '×'}</span>
            <button
              className="btn"
              onClick={() =>
                update((d) => {
                  const next = { ...(d.stress.custom_multipliers ?? {}) };
                  delete next[field];
                  d.stress.custom_multipliers = Object.keys(next).length ? next : null;
                })
              }
            >
              <X size={10} />
            </button>
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
        <select
          className="input"
          value=""
          onChange={(e) => {
            const f = e.target.value;
            if (!f) return;
            update((d) => {
              d.stress.custom_multipliers = {
                ...(d.stress.custom_multipliers ?? {}),
                [f]: f.endsWith('_shift') ? 0 : 1.5,
              };
            });
          }}
        >
          <option value="">+ add multiplier…</option>
          {unused.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!entries.length || running != null}
          onClick={() => {
            setError(null);
            runScenario('custom', custom)
              .then(() => navigate('/results'))
              .catch((err) => setError(apiErrorMessage(err, 'Run failed')));
          }}
        >
          <Play size={11} /> RUN CUSTOM
        </button>
      </div>
      {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}
    </div>
  );
}

function StressMatrixConfig() {
  const { doc, slug } = useDealDraft();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cdr, setCdr] = useState('0.5, 1, 1.5, 2, 3');
  const [cpr, setCpr] = useState('0.5, 1, 2');
  const [metric, setMetric] = useState('xirr');
  const [tranche, setTranche] = useState('');

  const notes = (doc?.waterfall.bonds ?? []).filter((b) => b.type === 'bond').map((b) => b.name);

  const submit = useMutation({
    mutationFn: () =>
      submitStressMatrixJob(slug!, {
        doc,
        cdr_multipliers: cdr.split(',').map((t) => Number(t.trim())).filter(Number.isFinite),
        cpr_multipliers: cpr.split(',').map((t) => Number(t.trim())).filter(Number.isFinite),
        metric,
        tranche: tranche || null,
        price: doc?.export.price ?? 100,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.jobs });
      navigate('/results');
    },
  });

  return (
    <div>
      <div className="section-label">STRESS MATRIX (CDR× × CPR×)</div>
      <div className="field-row">
        <label>cdr multipliers</label>
        <input className="input" style={{ width: 160 }} value={cdr} onChange={(e) => setCdr(e.target.value)} />
      </div>
      <div className="field-row">
        <label>cpr multipliers</label>
        <input className="input" style={{ width: 160 }} value={cpr} onChange={(e) => setCpr(e.target.value)} />
      </div>
      <div className="field-row">
        <label>metric</label>
        <select className="input" value={metric} onChange={(e) => setMetric(e.target.value)}>
          <option value="xirr">XIRR</option>
          <option value="wal">WAL</option>
          <option value="moic">MOIC</option>
        </select>
      </div>
      <div className="field-row">
        <label>tranche</label>
        <select className="input" value={tranche} onChange={(e) => setTranche(e.target.value)}>
          <option value="">most junior note</option>
          {notes.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
      <button className="btn" style={{ marginTop: 6 }} disabled={submit.isPending} onClick={() => submit.mutate()}>
        <Play size={11} /> RUN MATRIX
      </button>
      {submit.isError && (
        <div className="field-error-msg" style={{ textAlign: 'left' }}>
          {apiErrorMessage(submit.error, 'Submit failed')}
        </div>
      )}
    </div>
  );
}

export default function ScenariosPage() {
  const { doc, loading } = useDealDraft();
  const { runScenario, running, runs } = useRuns();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set(['base', 'severe_stress']));
  const [error, setError] = useState<string | null>(null);

  const scenarios = useQuery({ queryKey: qk.schemaScenarios, queryFn: getStressScenarios, staleTime: Infinity });

  if (!doc && !loading) return <EmptyState message="OPEN A DEAL FIRST" />;
  if (!doc || scenarios.isLoading) return <LoadingCursor />;

  const names = scenarios.data?.curve_scenarios.map((s) => s.name) ?? [];

  async function runSelected() {
    setError(null);
    try {
      for (const s of names.filter((n) => selected.has(n))) {
        await runScenario(s);
      }
      navigate('/results');
    } catch (err) {
      setError(apiErrorMessage(err, 'Run failed'));
    }
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="stack">
        <Panel
          title="STRESS SCENARIOS"
          subtitle={<span className="dim">{Object.keys(runs).length} run{Object.keys(runs).length === 1 ? '' : 's'} cached</span>}
          actions={
            <button className="btn" disabled={running != null || selected.size === 0} onClick={() => void runSelected()}>
              <Play size={11} /> {running ? `RUNNING ${running.toUpperCase()}` : `RUN SELECTED (${selected.size})`}
            </button>
          }
        >
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {names.map((name) => {
              const scen = scenarios.data?.curve_scenarios.find((s) => s.name === name);
              const desc = Object.entries(scen?.multipliers ?? {})
                .map(([k, v]) => `${k} ${v}${k.endsWith('_shift') ? 'mo' : '×'}`)
                .join(' · ');
              return (
                <button
                  key={name}
                  className={`chip ${selected.has(name) ? 'chip--active' : ''}`}
                  title={desc || 'unstressed base case'}
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(name)) next.delete(name);
                      else next.add(name);
                      return next;
                    })
                  }
                >
                  {name.replace(/_/g, ' ')}
                  {runs[name] && <span className="pos"> ✓</span>}
                </button>
              );
            })}
          </div>
          {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}
          <div style={{ marginTop: 14 }}>
            <CustomMultiplierEditor />
          </div>
          <div style={{ marginTop: 14 }}>
            <StressMatrixConfig />
          </div>
        </Panel>
      </div>
      <MonteCarloPanel />
    </div>
  );
}
