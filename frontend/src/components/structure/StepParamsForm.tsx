// Per-step-type parameter form, generated from the backend step schema.
// The "steps" kind (If branches) is rendered by StepList, not here.

import type { StepParamSpec, StepSchema, StepSpec, TriggerSpec, WaterfallSpec } from '../../lib/types';

interface Props {
  step: StepSpec;
  schema: StepSchema;
  waterfall: WaterfallSpec;
  onParam: (name: string, value: unknown) => void;
}

function bondNames(wf: WaterfallSpec): string[] {
  return wf.bonds.filter((b) => b.type === 'bond').map((b) => b.name);
}

export default function StepParamsForm({ step, schema, waterfall, onParam }: Props) {
  const notes = bondNames(waterfall);
  const triggers: TriggerSpec[] = waterfall.triggers;

  function control(param: StepParamSpec) {
    const value = step[param.name];
    switch (param.kind) {
      case 'bool':
        return (
          <input
            type="checkbox"
            checked={Boolean(value ?? param.default)}
            onChange={(e) => onParam(param.name, e.target.checked)}
          />
        );
      case 'enum':
        return (
          <select
            className="input"
            value={String(value ?? param.default ?? '')}
            onChange={(e) => onParam(param.name, e.target.value)}
          >
            {(param.choices ?? []).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        );
      case 'bonds':
        return (
          <span className="field-control" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {notes.map((n) => {
              const selected = Array.isArray(value) ? (value as string[]).includes(n) : false;
              return (
                <button
                  key={n}
                  className={`chip ${selected ? 'chip--active' : ''}`}
                  onClick={() => {
                    const current = Array.isArray(value) ? (value as string[]) : [];
                    onParam(param.name, selected ? current.filter((x) => x !== n) : [...current, n]);
                  }}
                >
                  {n}
                </button>
              );
            })}
            <span className="dim" style={{ fontSize: 10 }}>
              {Array.isArray(value) && value.length ? '' : 'empty = all'}
            </span>
          </span>
        );
      case 'bond':
        return (
          <select
            className="input"
            value={String(value ?? '')}
            onChange={(e) => onParam(param.name, e.target.value || null)}
          >
            <option value="">—</option>
            {notes.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        );
      case 'trigger':
        return (
          <select
            className="input"
            value={String(value ?? '')}
            onChange={(e) => onParam(param.name, e.target.value || null)}
          >
            <option value="">— pick trigger —</option>
            {triggers.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        );
      case 'int':
        return (
          <input
            className="input num"
            type="number"
            step={1}
            value={value == null ? '' : Number(value)}
            onChange={(e) => onParam(param.name, e.target.value === '' ? param.default : Math.trunc(Number(e.target.value)))}
          />
        );
      case 'str':
        return (
          <input
            className="input"
            value={String(value ?? param.default ?? '')}
            onChange={(e) => onParam(param.name, e.target.value)}
          />
        );
      case 'steps':
        return null; // branches rendered by StepList
      default: // float
        return (
          <input
            className="input num"
            type="number"
            step="any"
            placeholder={param.optional ? '—' : undefined}
            value={value == null ? '' : Number(value)}
            onChange={(e) =>
              onParam(param.name, e.target.value === '' ? (param.optional ? null : param.default) : Number(e.target.value))
            }
          />
        );
    }
  }

  return (
    <div>
      {schema.params
        .filter((p) => p.kind !== 'steps')
        .map((p) => (
          <div key={p.name} className="field-row">
            <label title={p.doc}>{p.name.replace(/_/g, ' ')}</label>
            <span className="field-control">{control(p)}</span>
          </div>
        ))}
      {schema.params.length === 0 && <span className="dim" style={{ fontSize: 11 }}>no parameters</span>}
    </div>
  );
}
