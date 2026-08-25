// Structure: bond stack -> ordered step list with live diagram -> triggers.

import { useQuery } from '@tanstack/react-query';
import { getStepSchemas, getTriggerMetrics } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useDealDraft } from '../lib/useDealDraft';
import { useDealValidation } from '../lib/useDealValidation';
import type { WaterfallSpec } from '../lib/types';
import EmptyState from '../components/shared/EmptyState';
import LoadingCursor from '../components/shared/LoadingCursor';
import Panel from '../components/shared/Panel';
import BondStackEditor from '../components/structure/BondStackEditor';
import CallReinvestPanel from '../components/structure/CallReinvestPanel';
import TakeoutPanel from '../components/structure/TakeoutPanel';
import MermaidPreview from '../components/structure/MermaidPreview';
import StepList from '../components/structure/StepList';
import TriggerEditor from '../components/structure/TriggerEditor';

export default function StructurePage() {
  const { doc, update, loading } = useDealDraft();
  const validation = useDealValidation();

  const stepSchemas = useQuery({
    queryKey: qk.schemaSteps,
    queryFn: getStepSchemas,
    staleTime: Infinity,
  });
  const triggerMetrics = useQuery({
    queryKey: qk.schemaTriggers,
    queryFn: getTriggerMetrics,
    staleTime: Infinity,
  });

  if (!doc && !loading) return <EmptyState message="OPEN A DEAL FIRST" />;
  if (!doc || stepSchemas.isLoading) return <LoadingCursor />;

  const waterfall = doc.waterfall;
  const onWaterfall = (mutator: (wf: WaterfallSpec) => void) =>
    update((d) => mutator(d.waterfall));

  const wfErrors = validation.errorsAt(['waterfall']);
  const structureOk = wfErrors.length === 0;

  return (
    <div className="stack">
      <BondStackEditor waterfall={waterfall} errors={wfErrors} onChange={onWaterfall} />
      <div className="grid-2" style={{ alignItems: 'stretch' }}>
        <Panel
          title="WATERFALL STEPS"
          style={{ minHeight: 560 }}
          subtitle={
            <span className={structureOk ? 'pos' : 'neg'}>
              {structureOk
                ? validation.lint.length
                  ? `✓ valid · ${validation.lint.length} lint note${validation.lint.length > 1 ? 's' : ''}`
                  : '✓ structure ok'
                : `${wfErrors.length} error${wfErrors.length > 1 ? 's' : ''}`}
            </span>
          }
          actions={
            <label className="field-row" style={{ gap: 6 }}>
              <span className="dim" style={{ fontSize: 11 }}>RESERVE $</span>
              <input
                className="input num"
                type="number"
                step={1000}
                value={waterfall.reserve_initial}
                onChange={(e) => onWaterfall((wf) => { wf.reserve_initial = Number(e.target.value) || 0; })}
              />
            </label>
          }
        >
          {wfErrors.map((e, i) => (
            <div key={i} className="field-error-msg" style={{ textAlign: 'left' }} title={e.hint ?? undefined}>
              {e.msg}
            </div>
          ))}
          <StepList waterfall={waterfall} schemas={stepSchemas.data ?? []} onChange={onWaterfall} />
          {validation.lint.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="section-label">LINT</div>
              {validation.lint.map((l, i) => (
                <div key={i} style={{ color: 'var(--warning)', fontSize: 11, padding: '1px 0' }}>
                  {l}
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="FLOW" subtitle={<span className="dim">from the engine's own diagram</span>}>
          <MermaidPreview waterfall={waterfall} />
        </Panel>
      </div>
      <TriggerEditor waterfall={waterfall} metrics={triggerMetrics.data} onChange={onWaterfall} />
      <CallReinvestPanel />
      <TakeoutPanel />
    </div>
  );
}
