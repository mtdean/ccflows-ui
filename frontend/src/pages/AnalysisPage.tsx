// Analysis: pricing & valuation on a completed run — tranche pricing at
// manual yields/DMs/spreads/custom curves, loan pricing, breakevens, marks.

import { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { fmtTime } from '../lib/utils';
import { useDealDraft } from '../lib/useDealDraft';
import { useRuns } from '../lib/useRuns';
import EmptyState from '../components/shared/EmptyState';
import LoadingCursor from '../components/shared/LoadingCursor';
import Panel from '../components/shared/Panel';
import BreakevenPanel from '../components/analysis/BreakevenPanel';
import LoanPricingPanel from '../components/analysis/LoanPricingPanel';
import MarksPanel from '../components/analysis/MarksPanel';
import ResidualSolverPanel from '../components/analysis/ResidualSolverPanel';
import SensitivitiesPanel from '../components/analysis/SensitivitiesPanel';
import TranchePricingPanel from '../components/analysis/TranchePricingPanel';

export default function AnalysisPage() {
  const { doc, loading } = useDealDraft();
  const { runs, currentHash } = useRuns();
  const scenarios = Object.keys(runs);
  const [selected, setSelected] = useState<string | null>(null);

  const scenario = selected && runs[selected] ? selected : scenarios[scenarios.length - 1] ?? null;
  const run = scenario ? runs[scenario] : null;
  const runId = run?.summary.run_id;

  if (!doc && !loading) return <EmptyState message="OPEN A DEAL FIRST" />;
  if (!doc) return <LoadingCursor />;

  const stale = run != null && currentHash != null && run.docHash !== currentHash;

  return (
    <div className="stack">
      <Panel
        title="ANALYSIS"
        subtitle={
          run ? (
            <span className="mono dim">
              {run.scenario.toUpperCase()} · ran {fmtTime(run.at)}
              {stale && <span style={{ color: 'var(--warning)' }}> · ⚠ DEAL EDITED SINCE RUN</span>}
            </span>
          ) : (
            <span className="dim">no runs yet — hit RUN ▸ in the top bar</span>
          )
        }
        actions={
          scenarios.length > 0 && (
            <div style={{ display: 'flex', gap: 4 }}>
              {scenarios.map((s) => (
                <button key={s} className={`chip ${s === scenario ? 'chip--active' : ''}`} onClick={() => setSelected(s)}>
                  {s.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          )
        }
        bodyStyle={run ? { padding: 0, background: 'transparent', border: 'none' } : undefined}
      >
        {!run || !runId ? (
          <EmptyState message="RUN THE DEAL TO ANALYZE IT" />
        ) : (
          <Tabs.Root defaultValue="pricing">
            <Tabs.List className="subtabs" style={{ padding: '0 10px' }}>
              <Tabs.Trigger value="pricing">TRANCHE PRICING</Tabs.Trigger>
              <Tabs.Trigger value="loans">COLLATERAL</Tabs.Trigger>
              <Tabs.Trigger value="solver">RESIDUAL SOLVER</Tabs.Trigger>
              <Tabs.Trigger value="sensitivities">SENSITIVITIES</Tabs.Trigger>
              <Tabs.Trigger value="breakevens">BREAKEVENS</Tabs.Trigger>
              <Tabs.Trigger value="marks">MARKS</Tabs.Trigger>
            </Tabs.List>
            <div style={{ padding: 10 }}>
              <Tabs.Content value="pricing">
                <TranchePricingPanel runId={runId} />
              </Tabs.Content>
              <Tabs.Content value="loans">
                <LoanPricingPanel runId={runId} />
              </Tabs.Content>
              <Tabs.Content value="solver">
                <ResidualSolverPanel runId={runId} />
              </Tabs.Content>
              <Tabs.Content value="sensitivities">
                <SensitivitiesPanel runId={runId} />
              </Tabs.Content>
              <Tabs.Content value="breakevens">
                <BreakevenPanel />
              </Tabs.Content>
              <Tabs.Content value="marks">
                <MarksPanel runId={runId} />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        )}
      </Panel>
    </div>
  );
}
