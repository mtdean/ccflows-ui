// The payment waterfall as an ordered, drag-to-reorder step list.
// If-steps render THEN/ELSE branches one level deep (matching the engine);
// branch steps reorder with arrows instead of nested drag containers.

import { useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { StepSchema, StepSpec, WaterfallSpec } from '../../lib/types';
import { pct } from '../../lib/utils';
import StepParamsForm from './StepParamsForm';

interface Props {
  waterfall: WaterfallSpec;
  schemas: StepSchema[];
  onChange: (mutator: (wf: WaterfallSpec) => void) => void;
}

export function stepSummary(step: StepSpec): string {
  const bonds = Array.isArray(step.bonds) && step.bonds.length ? (step.bonds as string[]).join(',') : '';
  switch (step.type) {
    case 'fee':
      return step.fixed_annual != null
        ? `$${Number(step.fixed_annual).toLocaleString()}/yr on ${step.basis}`
        : `${pct(Number(step.annual_rate ?? 0))} on ${step.basis}`;
    case 'pay_interest':
      return `${bonds || 'all'}${step.reserve_draw ? ' · reserve draw' : ''}`;
    case 'pay_principal':
      return `${bonds || 'all'} · ${step.rule}${step.amount === 'all' ? ' · all cash' : ''}`;
    case 'turbo':
      return `${bonds || 'all'} · ${pct(Number(step.fraction ?? 1))} of remaining`;
    case 'priority_principal':
      return `through ${step.through ?? '?'}`;
    case 'target_oc':
      return `target ${pct(Number(step.target_pct ?? 0))}`;
    case 'reserve_deposit':
      return step.target != null
        ? `$${Number(step.target).toLocaleString()} target`
        : `${pct(Number(step.target_pct ?? 0))} of pool`;
    case 'trap_deposit':
      return `${step.trigger ?? '?'} · trap ${pct(Number(step.pct ?? 1))}`;
    case 'if':
      return `${step.trigger ?? '?'} breached`;
    case 'coverage_diversion':
      return `through ${step.through ?? '?'} · OC ${step.oc_trigger ?? '—'} IC ${step.ic_trigger ?? '—'}`;
    case 'swap':
      return `fixed ${pct(Number(step.fixed_rate ?? 0))} on ${step.notional}`;
    case 'rate_cap':
      return `strike ${pct(Number(step.strike ?? 0))}`;
    case 'incentive_fee':
      return `hurdle ${pct(Number(step.hurdle ?? 0))} · share ${pct(Number(step.share ?? 0))}`;
    case 'liquidate':
      return `severity ${pct(Number(step.severity ?? 0))}`;
    case 'borrowing_base':
      return `through ${step.through ?? '?'} · AR ${pct(Number(step.advance_rate ?? 0))}`;
    case 'draw':
      return `${step.bond ?? '?'} until m${step.until}`;
    case 'retain_collections':
      return `until m${step.until}`;
    default:
      return '';
  }
}

function AddStepMenu({ schemas, onAdd, label = 'ADD STEP' }: {
  schemas: StepSchema[];
  onAdd: (type: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const g = new Map<string, StepSchema[]>();
    for (const s of schemas) {
      const list = g.get(s.group) ?? [];
      list.push(s);
      g.set(s.group, list);
    }
    return [...g.entries()];
  }, [schemas]);
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button className="btn" onClick={() => setOpen((o) => !o)}>
        <Plus size={11} /> {label} ▾
      </button>
      {open && (
        <div className="knob-menu" style={{ minWidth: 300 }} onMouseLeave={() => setOpen(false)}>
          {groups.map(([group, steps]) => (
            <div key={group}>
              <div className="knob-menu-group">{group}</div>
              {steps.map((s) => (
                <button
                  key={s.type}
                  className="knob-menu-item"
                  onClick={() => {
                    onAdd(s.type);
                    setOpen(false);
                  }}
                >
                  <span>{s.label}</span>
                  <span className="item-doc">{s.doc}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function newStep(type: string, schemas: StepSchema[], existingNames: Set<string>): StepSpec {
  const schema = schemas.find((s) => s.type === type);
  const step: StepSpec = { type };
  for (const p of schema?.params ?? []) {
    step[p.name] = p.kind === 'steps' ? [] : p.default;
  }
  let n = 1;
  while (existingNames.has(`${type}_${n}`)) n++;
  step.name = `${type}_${n}`;
  return step;
}

function collectNames(steps: StepSpec[]): Set<string> {
  return new Set(steps.map((s) => s.name).filter(Boolean) as string[]);
}

interface BranchProps {
  parentIndex: number;
  branch: 'then' | 'otherwise';
  steps: StepSpec[];
  schemas: StepSchema[];
  waterfall: WaterfallSpec;
  onChange: Props['onChange'];
}

function BranchList({ parentIndex, branch, steps, schemas, waterfall, onChange }: BranchProps) {
  const mutateBranch = (fn: (list: StepSpec[]) => void) =>
    onChange((wf) => {
      const parent = wf.steps[parentIndex];
      if (!Array.isArray(parent[branch])) parent[branch] = [];
      fn(parent[branch] as StepSpec[]);
    });

  return (
    <div className="step-branch">
      <div className="step-branch-label">{branch === 'then' ? '▸ THEN (on breach)' : '▸ OTHERWISE'}</div>
      {steps.map((s, i) => {
        const schema = schemas.find((x) => x.type === s.type);
        return (
          <div key={i} className="step-card">
            <div className="step-card-head">
              <span className="step-name">{schema?.label ?? s.type}</span>
              <span className="step-sum">{stepSummary(s)}</span>
              <button className="btn" style={{ padding: '0 3px' }} disabled={i === 0}
                onClick={() => mutateBranch((l) => { [l[i - 1], l[i]] = [l[i], l[i - 1]]; })}>
                <ArrowUp size={10} />
              </button>
              <button className="btn" style={{ padding: '0 3px' }} disabled={i === steps.length - 1}
                onClick={() => mutateBranch((l) => { [l[i + 1], l[i]] = [l[i], l[i + 1]]; })}>
                <ArrowDown size={10} />
              </button>
              <button className="btn" style={{ color: 'var(--warning)', padding: '0 3px' }}
                onClick={() => mutateBranch((l) => l.splice(i, 1))}>
                <Trash2 size={10} />
              </button>
            </div>
            {schema && schema.params.some((p) => p.kind !== 'steps') && (
              <div className="step-card-body">
                <StepParamsForm
                  step={s}
                  schema={schema}
                  waterfall={waterfall}
                  onParam={(name, value) => mutateBranch((l) => { l[i][name] = value; })}
                />
              </div>
            )}
          </div>
        );
      })}
      <AddStepMenu
        schemas={schemas.filter((s) => s.type !== 'if' && s.type !== 'pay_residual')}
        label="ADD"
        onAdd={(type) =>
          mutateBranch((l) => {
            const step = newStep(type, schemas, new Set());
            delete step.name; // branch steps are unnamed in the engine spec
            l.push(step);
          })
        }
      />
    </div>
  );
}

function SortableStepCard({
  step,
  index,
  schemas,
  waterfall,
  onChange,
}: {
  step: StepSpec;
  index: number;
  schemas: StepSchema[];
  waterfall: WaterfallSpec;
  onChange: Props['onChange'];
}) {
  const [expanded, setExpanded] = useState(false);
  const id = String(step.name ?? index);
  const pinned = step.type === 'pay_residual';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: pinned,
  });
  const schema = schemas.find((s) => s.type === step.type);
  const hasParams = (schema?.params ?? []).some((p) => p.kind !== 'steps');

  return (
    <div
      ref={setNodeRef}
      className={`step-card${isDragging ? ' step-card--dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="step-card-head">
        <span className="drag-handle" {...attributes} {...listeners}>
          {pinned ? '🔒' : <GripVertical size={12} />}
        </span>
        <span className="dim mono" style={{ fontSize: 10, width: 16, textAlign: 'right' }}>{index + 1}</span>
        <input
          className="input"
          style={{ width: 110, fontSize: 11 }}
          value={String(step.name ?? '')}
          title="Step name (unique)"
          onChange={(e) => onChange((wf) => { wf.steps[index].name = e.target.value; })}
        />
        <span className="step-name">{schema?.label ?? step.type}</span>
        <span className="step-sum">{stepSummary(step)}</span>
        {(hasParams || step.type === 'if') && (
          <button className="btn" style={{ padding: '0 3px' }} onClick={() => setExpanded((x) => !x)}>
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        )}
        <button
          className="btn"
          style={{ color: 'var(--warning)', padding: '0 3px' }}
          disabled={pinned}
          onClick={() => onChange((wf) => { wf.steps.splice(index, 1); })}
        >
          <Trash2 size={10} />
        </button>
      </div>
      {expanded && (
        <div className="step-card-body">
          {schema && hasParams && (
            <StepParamsForm
              step={step}
              schema={schema}
              waterfall={waterfall}
              onParam={(name, value) => onChange((wf) => { wf.steps[index][name] = value; })}
            />
          )}
          {step.type === 'if' && (
            <>
              <BranchList
                parentIndex={index}
                branch="then"
                steps={(step.then as StepSpec[]) ?? []}
                schemas={schemas}
                waterfall={waterfall}
                onChange={onChange}
              />
              <BranchList
                parentIndex={index}
                branch="otherwise"
                steps={(step.otherwise as StepSpec[]) ?? []}
                schemas={schemas}
                waterfall={waterfall}
                onChange={onChange}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function StepList({ waterfall, schemas, onChange }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const ids = waterfall.steps.map((s, i) => String(s.name ?? i));

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange((wf) => {
      wf.steps = arrayMove(wf.steps, from, to);
      // keep pay_residual pinned last
      const ri = wf.steps.findIndex((s) => s.type === 'pay_residual');
      if (ri >= 0 && ri !== wf.steps.length - 1) {
        const [r] = wf.steps.splice(ri, 1);
        wf.steps.push(r);
      }
    });
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {waterfall.steps.map((step, i) => (
            <SortableStepCard
              key={ids[i]}
              step={step}
              index={i}
              schemas={schemas}
              waterfall={waterfall}
              onChange={onChange}
            />
          ))}
        </SortableContext>
      </DndContext>
      <AddStepMenu
        schemas={schemas}
        onAdd={(type) =>
          onChange((wf) => {
            const step = newStep(type, schemas, collectNames(wf.steps));
            const ri = wf.steps.findIndex((s) => s.type === 'pay_residual');
            wf.steps.splice(ri < 0 ? wf.steps.length : ri, 0, step);
          })
        }
      />
    </div>
  );
}
