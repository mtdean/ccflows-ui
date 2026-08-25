// Results: run selector + sub-tabs over the selected run's outputs.

import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus } from 'lucide-react';
import { getRunBalances, saveScenarioRun } from '../lib/api';
import { apiErrorMessage } from '../lib/utils';
import { qk } from '../lib/queryKeys';
import { fmtTime } from '../lib/utils';
import { useDealDraft } from '../lib/useDealDraft';
import { useRuns } from '../lib/useRuns';
import EmptyState from '../components/shared/EmptyState';
import LoadingCursor from '../components/shared/LoadingCursor';
import Panel from '../components/shared/Panel';
import ExplainInspector from '../components/results/ExplainInspector';
import StackSummaryTable from '../components/results/StackSummaryTable';
import StressMatrixPanel from '../components/results/StressMatrixPanel';
import McResultsPanel from '../components/results/McResultsPanel';
import TrancheMcPanel from '../components/results/TrancheMcPanel';
import TrancheBalanceChart from '../components/results/TrancheBalanceChart';
import TrancheCashflowView from '../components/results/TrancheCashflowView';
import TriggerTimelinePanel from '../components/results/TriggerTimelinePanel';

export default function ResultsPage() {
  const { slug, doc, loading } = useDealDraft();
  const { runs, currentHash } = useRuns();
  const queryClient = useQueryClient();
  const scenarios = Object.keys(runs);
  const [selected, setSelected] = useState<string | null>(null);
  const [tranche, setTranche] = useState<string | null>(null);

  const scenario = selected && runs[selected] ? selected : scenarios[scenarios.length - 1] ?? null;
  const run = scenario ? runs[scenario] : null;
  const runId = run?.summary.run_id;

  const bondOrder = useMemo(
    () => (doc?.waterfall.bonds ?? []).map((b) => b.name),
    [doc],
  );
  const activeTranche = tranche && bondOrder.includes(tranche) ? tranche : bondOrder[0] ?? null;

  const balances = useQuery({
    queryKey: runId ? qk.runData(runId, 'balances') : ['balances', 'none'],
    queryFn: () => getRunBalances(runId!),
    enabled: runId != null,
    staleTime: Infinity,
    retry: false,
  });

  const saveScenario = useMutation({
    mutationFn: (name: string) =>
      saveScenarioRun(slug!, {
        name,
        doc,
        scenario: run && run.scenario !== 'custom' ? run.scenario : 'base',
        custom_multipliers: run?.scenario === 'custom'
          ? doc?.stress.custom_multipliers ?? null : null,
        price: doc?.export.price ?? 100,
      }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: qk.scenarioRuns(slug!) });
      queryClient.invalidateQueries({ queryKey: qk.dealSources(slug!) });
      window.alert(`Scenario '${saved.name}' saved — loadable from DEALS → OPEN FROM…`);
    },
    onError: (err) => window.alert(apiErrorMessage(err, 'Scenario save failed')),
  });

  if (!doc && !loading) return <EmptyState message="OPEN A DEAL FIRST" />;
  if (!doc) return <LoadingCursor />;

  const stale = run != null && currentHash != null && run.docHash !== currentHash;
  const baseRun = runs['base'] ?? null;

  return (
    <div className="stack">
      <Panel
        title="RESULTS"
        subtitle={
          run ? (
            <span className="mono dim">
              {run.scenario.toUpperCase()} · ran {fmtTime(run.at)}
              {run.summary.boundary_month != null && (
                <span style={{ color: 'var(--text-accent)' }}> · ACTUALS THRU M{run.summary.boundary_month}</span>
              )}
              {run.summary.is_portfolio && <span> · FORWARD-FLOW POOL</span>}
              {stale && <span style={{ color: 'var(--warning)' }}> · ⚠ DEAL EDITED SINCE RUN</span>}
            </span>
          ) : (
            <span className="dim">no runs yet — hit RUN ▸ in the top bar</span>
          )
        }
        actions={
          scenarios.length > 0 && (
            <div style={{ display: 'flex', gap: 4 }}>
              {scenarios.map((s) => {
                const sevColor = s === 'base' ? 'var(--positive)'
                  : /severe|recession/.test(s) ? 'var(--negative)'
                  : 'var(--warning)';
                return (
                  <button
                    key={s}
                    className={`chip ${s === scenario ? 'chip--active' : ''}`}
                    onClick={() => setSelected(s)}
                  >
                    <span style={{ color: sevColor, marginRight: 3 }}>●</span>
                    {s.replace(/_/g, ' ')}
                  </button>
                );
              })}
              <button className="btn" disabled={!run || saveScenario.isPending}
                title="Freeze this run (deal doc + stress + metrics) under a scenario name — loadable later from DEALS"
                onClick={() => {
                  const name = window.prompt('Save this run as scenario:',
                    scenario === 'base' ? '' : (scenario ?? ''));
                  if (name?.trim()) saveScenario.mutate(name.trim());
                }}>
                <BookmarkPlus size={11} /> SAVE SCENARIO
              </button>
            </div>
          )
        }
        bodyStyle={run ? { padding: 0, background: 'transparent', border: 'none' } : undefined}
      >
        {!run ? (
          <EmptyState message="RUN THE DEAL TO SEE RESULTS" />
        ) : (
          <Tabs.Root defaultValue="stack">
            <Tabs.List className="subtabs" style={{ padding: '0 10px' }}>
              <Tabs.Trigger value="stack">STACK</Tabs.Trigger>
              <Tabs.Trigger value="cashflows">CASHFLOWS</Tabs.Trigger>
              <Tabs.Trigger value="triggers">TRIGGERS</Tabs.Trigger>
              <Tabs.Trigger value="explain">EXPLAIN</Tabs.Trigger>
              <Tabs.Trigger value="matrix">STRESS MATRIX</Tabs.Trigger>
              <Tabs.Trigger value="mc">MONTE CARLO</Tabs.Trigger>
            </Tabs.List>
            <div style={{ padding: 10 }}>
              <Tabs.Content value="stack">
                {run.summary.warnings.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {run.summary.warnings.map((w, i) => (
                      <div key={i} style={{ color: 'var(--warning)', fontSize: 11 }}>{w}</div>
                    ))}
                  </div>
                )}
                <StackSummaryTable
                  data={run.summary.summary}
                  base={run.scenario !== 'base' ? baseRun?.summary.summary : null}
                />
              </Tabs.Content>
              <Tabs.Content value="cashflows">
                {balances.data && (
                  <TrancheBalanceChart
                    months={balances.data.months}
                    tranches={balances.data.tranches}
                    order={bondOrder}
                  />
                )}
                <div style={{ display: 'flex', gap: 4, margin: '10px 0 6px' }}>
                  {bondOrder.map((n) => (
                    <button
                      key={n}
                      className={`chip ${n === activeTranche ? 'chip--active' : ''}`}
                      onClick={() => setTranche(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {runId && activeTranche && (
                  <TrancheCashflowView runId={runId} tranche={activeTranche} />
                )}
              </Tabs.Content>
              <Tabs.Content value="triggers">
                {runId && <TriggerTimelinePanel runId={runId} />}
              </Tabs.Content>
              <Tabs.Content value="explain">
                {runId && <ExplainInspector runId={runId} />}
              </Tabs.Content>
              <Tabs.Content value="matrix">
                <StressMatrixPanel />
              </Tabs.Content>
              <Tabs.Content value="mc">
                <div className="section-label">TRANCHE MONTE CARLO (WATERFALL PER PATH)</div>
                <TrancheMcPanel />
                <div className="section-label" style={{ marginTop: 16 }}>COLLATERAL MONTE CARLO</div>
                <McResultsPanel />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        )}
      </Panel>
    </div>
  );
}
