// One field row on a repline card. Dispatches the input control on the
// registry kind; curves render as sparkline + summary + [EDIT].

import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { curveSummary, specFromVector } from '../../lib/curves';
import type { ApiFieldError, CurveSpec, FieldSpec, ReplineEntry } from '../../lib/types';
import CurveEditorDialog from './CurveEditorDialog';
import CurveSparkline from './CurveSparkline';

interface Props {
  field: FieldSpec;
  entry: ReplineEntry;
  errors: ApiFieldError[];
  removable: boolean;
  onScalar: (name: string, value: unknown) => void;
  onCurve: (name: string, spec: CurveSpec, resolved: number[]) => void;
  onRemove: (name: string) => void;
}

const CURVE_KINDS = new Set(['probability_curve', 'ratio_curve', 'dollar_curve', 'seasonality']);

export default function FieldRow({ field, entry, errors, removable, onScalar, onCurve, onRemove }: Props) {
  const [editing, setEditing] = useState(false);
  const value = entry.inline[field.name];
  const hasError = errors.length > 0;

  function control() {
    if (CURVE_KINDS.has(field.kind)) {
      const values = Array.isArray(value) ? (value as number[]) : null;
      const spec: CurveSpec =
        entry.curve_specs?.[field.name] ?? (values ? specFromVector(values) : { mode: 'flat', value: 0 });
      return (
        <span className="field-control">
          {values && <CurveSparkline values={values} />}
          <span className="dim" style={{ fontSize: 11 }}>
            {values ? curveSummary(entry.curve_specs?.[field.name], values) : 'engine default'}
          </span>
          <button className="btn" title="Edit curve" onClick={() => setEditing(true)}>
            <Pencil size={10} />
          </button>
          {editing && (
            <CurveEditorDialog
              field={field}
              initial={spec}
              open={editing}
              onClose={() => setEditing(false)}
              onApply={(s, resolved) => onCurve(field.name, s, resolved)}
            />
          )}
        </span>
      );
    }

    switch (field.kind) {
      case 'bool_scalar':
        return (
          <input
            type="checkbox"
            checked={Boolean(value ?? field.default)}
            onChange={(e) => onScalar(field.name, e.target.checked)}
          />
        );
      case 'str_literal':
        return (
          <select
            className="input"
            value={String(value ?? field.default ?? '')}
            onChange={(e) => onScalar(field.name, e.target.value)}
          >
            {(field.choices ?? [String(field.default)]).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        );
      case 'str_id':
        return (
          <input
            className={`input${hasError ? ' input-error' : ''}`}
            value={String(value ?? '')}
            onChange={(e) => onScalar(field.name, e.target.value)}
          />
        );
      case 'int_scalar':
        return (
          <input
            className={`input num${hasError ? ' input-error' : ''}`}
            type="number"
            step={1}
            value={value == null ? '' : Number(value)}
            onChange={(e) => onScalar(field.name, e.target.value === '' ? field.default : Math.trunc(Number(e.target.value)))}
          />
        );
      case 'optional_float_scalar':
        return (
          <input
            className={`input num${hasError ? ' input-error' : ''}`}
            type="number"
            step="any"
            placeholder="—"
            value={value == null ? '' : Number(value)}
            onChange={(e) => onScalar(field.name, e.target.value === '' ? null : Number(e.target.value))}
          />
        );
      case 'scalar_or_schedule': {
        const text = Array.isArray(value) ? (value as number[]).join(', ') : String(value ?? field.default ?? 0);
        return (
          <input
            className={`input num${hasError ? ' input-error' : ''}`}
            title="A number, or a comma-separated schedule"
            defaultValue={text}
            key={text}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw.includes(',')) {
                const vals = raw.split(',').map((t) => Number(t.trim())).filter(Number.isFinite);
                onScalar(field.name, vals);
              } else {
                const v = Number(raw);
                onScalar(field.name, Number.isFinite(v) ? v : field.default);
              }
            }}
          />
        );
      }
      case 'rr_matrix':
        return <span className="dim" style={{ fontSize: 11 }}>edit via JSON upload (matrix UI TBD)</span>;
      default:
        // float_scalar
        return (
          <input
            className={`input num${hasError ? ' input-error' : ''}`}
            type="number"
            step="any"
            value={value == null ? Number(field.default ?? 0) : Number(value)}
            onChange={(e) => onScalar(field.name, e.target.value === '' ? field.default : Number(e.target.value))}
          />
        );
    }
  }

  return (
    <>
      <div className={`field-row${hasError ? ' has-error' : ''}`}>
        <label title={field.doc}>{field.name.replace(/_/g, ' ')}</label>
        <span className="field-control">
          {control()}
          {removable && (
            <button className="btn" title="Reset to default and hide" onClick={() => onRemove(field.name)}>
              <X size={10} />
            </button>
          )}
        </span>
      </div>
      {errors.map((e, i) => (
        <div key={i} className="field-error-msg" title={e.hint ?? undefined}>
          {e.msg}
        </div>
      ))}
    </>
  );
}
