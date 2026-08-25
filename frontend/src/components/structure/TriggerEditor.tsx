// Deal triggers: metric, breach direction, scalar or stepped threshold
// schedule, rolling window, cure policy. Steps reference triggers by name.

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, Table2, Trash2, X } from 'lucide-react';
import type { StepSpec, TriggerMetricSchema, TriggerSpec, WaterfallSpec } from '../../lib/types';
import Panel from '../shared/Panel';

interface Props {
  waterfall: WaterfallSpec;
  metrics: TriggerMetricSchema | undefined;
  onChange: (mutator: (wf: WaterfallSpec) => void) => void;
}

function triggerRefs(steps: StepSpec[], name: string): number {
  let count = 0;
  for (const s of steps) {
    if (s.trigger === name) count++;
    if (Array.isArray(s.then)) count += triggerRefs(s.then as StepSpec[], name);
    if (Array.isArray(s.otherwise)) count += triggerRefs(s.otherwise as StepSpec[], name);
  }
  return count;
}

/** Expand (from_month, value) breakpoints into the engine's month-indexed list. */
function expandSchedule(rows: { month: number; value: number }[]): number[] {
  const sorted = [...rows].sort((a, b) => a.month - b.month);
  if (!sorted.length) return [0];
  const last = sorted[sorted.length - 1].month;
  const out: number[] = [];
  for (let m = 0; m <= last; m++) {
    let v = sorted[0].value;
    for (const r of sorted) if (r.month <= m) v = r.value;
    out.push(v);
  }
  return out;
}

/** Recover breakpoints from a month-indexed list. */
function scheduleRows(threshold: number[]): { month: number; value: number }[] {
  const rows: { month: number; value: number }[] = [];
  threshold.forEach((v, m) => {
    if (m === 0 || v !== threshold[m - 1]) rows.push({ month: m, value: v });
  });
  return rows.length ? rows : [{ month: 0, value: 0 }];
}

function ScheduleDialog({ trigger, onApply, onClose }: {
  trigger: TriggerSpec;
  onApply: (threshold: number[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(
    Array.isArray(trigger.threshold)
      ? scheduleRows(trigger.threshold)
      : [{ month: 0, value: Number(trigger.threshold) || 0 }],
  );
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" style={{ width: 420 }} aria-describedby={undefined}>
          <Dialog.Title className="dialog-title">
            <span>{trigger.name.toUpperCase()} — THRESHOLD SCHEDULE</span>
            <button className="btn" onClick={onClose}><X size={12} /></button>
          </Dialog.Title>
          <div className="dialog-body">
            <div className="dim" style={{ fontSize: 11, marginBottom: 8 }}>
              Each row sets the threshold from that month onward (padded with the last value).
            </div>
            <div className="ramp-points">
              {rows.map((r, i) => (
                <div key={i} className="ramp-point-row">
                  <span className="dim">FROM MONTH</span>
                  <input className="input num" style={{ width: 70 }} type="number" min={0} value={r.month}
                    onChange={(e) => setRows((rs) => rs.map((q, j) => (j === i ? { ...q, month: Number(e.target.value) } : q)))} />
                  <span className="dim">THRESHOLD</span>
                  <input className="input num" style={{ width: 90 }} type="number" step="any" value={r.value}
                    onChange={(e) => setRows((rs) => rs.map((q, j) => (j === i ? { ...q, value: Number(e.target.value) } : q)))} />
                  <button className="btn" disabled={rows.length <= 1}
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                    <X size={10} />
                  </button>
                </div>
              ))}
              <div>
                <button className="btn" onClick={() => setRows((rs) => [...rs, { month: (rs[rs.length - 1]?.month ?? 0) + 12, value: rs[rs.length - 1]?.value ?? 0 }])}>
                  <Plus size={10} /> ROW
                </button>
              </div>
            </div>
          </div>
          <div className="dialog-footer">
            <button className="btn" onClick={onClose}>CANCEL</button>
            <button className="btn" style={{ color: 'var(--text-accent)', borderColor: 'var(--text-accent)' }}
              onClick={() => { onApply(expandSchedule(rows)); onClose(); }}>
              APPLY
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function TriggerEditor({ waterfall, metrics, onChange }: Props) {
  const [scheduleFor, setScheduleFor] = useState<number | null>(null);
  const triggers = waterfall.triggers;

  function mutate(i: number, fn: (t: TriggerSpec) => void) {
    onChange((wf) => fn(wf.triggers[i]));
  }

  return (
    <Panel
      title="TESTS & TRIGGERS"
      subtitle={<span className="dim">{triggers.length} defined</span>}
      actions={
        <button
          className="btn"
          onClick={() =>
            onChange((wf) => {
              let n = wf.triggers.length + 1;
              const names = new Set(wf.triggers.map((t) => t.name));
              while (names.has(`trigger_${n}`)) n++;
              wf.triggers.push({
                name: `trigger_${n}`, metric: 'cnl', threshold: 0.05,
                breach_when: 'above', window: 1, cure: 'auto',
              });
            })
          }
        >
          <Plus size={12} /> TRIGGER
        </button>
      }
    >
      {triggers.length === 0 && (
        <span className="dim" style={{ fontSize: 11 }}>
          No triggers. Add one, then reference it from an IF or TRAP DEPOSIT step.
        </span>
      )}
      {triggers.map((t, i) => {
        const refs = triggerRefs(waterfall.steps, t.name);
        const scheduled = Array.isArray(t.threshold);
        return (
          <div key={i} className="step-card">
            <div className="step-card-head" style={{ flexWrap: 'wrap' }}>
              <input
                className="input"
                style={{ width: 110, color: 'var(--text-accent)' }}
                value={t.name}
                onChange={(e) => {
                  const oldName = t.name;
                  const newName = e.target.value;
                  onChange((wf) => {
                    wf.triggers[i].name = newName;
                    const rename = (steps: StepSpec[]) => {
                      for (const s of steps) {
                        if (s.trigger === oldName) s.trigger = newName;
                        if (Array.isArray(s.then)) rename(s.then as StepSpec[]);
                        if (Array.isArray(s.otherwise)) rename(s.otherwise as StepSpec[]);
                      }
                    };
                    rename(wf.steps);
                  });
                }}
              />
              <select className="input" value={t.metric}
                onChange={(e) => mutate(i, (tr) => { tr.metric = e.target.value; })}>
                {(metrics?.metrics ?? [{ name: t.metric, doc: '' }]).map((m) => (
                  <option key={m.name} value={m.name} title={m.doc}>{m.name}</option>
                ))}
              </select>
              <select className="input" value={t.breach_when}
                onChange={(e) => mutate(i, (tr) => { tr.breach_when = e.target.value as 'above' | 'below'; })}>
                <option value="above">breach ≥</option>
                <option value="below">breach ≤</option>
              </select>
              {scheduled ? (
                <button className="btn" onClick={() => setScheduleFor(i)}>
                  <Table2 size={11} /> SCHEDULE ({(t.threshold as number[]).length}mo)
                </button>
              ) : (
                <input className="input num" style={{ width: 90 }} type="number" step="any"
                  value={Number(t.threshold)}
                  onChange={(e) => mutate(i, (tr) => { tr.threshold = Number(e.target.value); })} />
              )}
              <button className="btn" title="Toggle stepped schedule"
                onClick={() => {
                  if (scheduled) mutate(i, (tr) => { tr.threshold = (tr.threshold as number[])[0] ?? 0; });
                  else setScheduleFor(i);
                }}>
                {scheduled ? 'SCALAR' : 'STEPPED'}
              </button>
              <span className="dim" style={{ fontSize: 10 }}>window</span>
              <input className="input num" style={{ width: 44 }} type="number" min={1} value={t.window}
                onChange={(e) => mutate(i, (tr) => { tr.window = Math.max(1, Math.trunc(Number(e.target.value))); })} />
              <span className="dim" style={{ fontSize: 10 }}>cure</span>
              <select className="input" value={typeof t.cure === 'number' ? 'N' : t.cure}
                onChange={(e) => mutate(i, (tr) => { tr.cure = e.target.value === 'N' ? 3 : (e.target.value as 'auto' | 'never'); })}>
                <option value="auto">auto</option>
                <option value="never">never</option>
                <option value="N">N months</option>
              </select>
              {typeof t.cure === 'number' && (
                <input className="input num" style={{ width: 44 }} type="number" min={1} value={t.cure}
                  onChange={(e) => mutate(i, (tr) => { tr.cure = Math.max(1, Math.trunc(Number(e.target.value))); })} />
              )}
              <span className="dim" style={{ fontSize: 10, flex: 1, textAlign: 'right' }}>
                {refs > 0 ? `${refs} step ref${refs > 1 ? 's' : ''}` : 'unused'}
              </span>
              <button className="btn" style={{ color: 'var(--warning)' }}
                onClick={() => {
                  if (refs > 0) {
                    window.alert(`"${t.name}" is referenced by ${refs} step(s) — remove those references first.`);
                    return;
                  }
                  onChange((wf) => { wf.triggers.splice(i, 1); });
                }}>
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        );
      })}
      {scheduleFor != null && triggers[scheduleFor] && (
        <ScheduleDialog
          trigger={triggers[scheduleFor]}
          onApply={(threshold) => mutate(scheduleFor, (tr) => { tr.threshold = threshold; })}
          onClose={() => setScheduleFor(null)}
        />
      )}
    </Panel>
  );
}
