// One repline as a card: core fields always visible, extra knobs added via
// the [+ ADD FIELD] menu, each removable back to its engine default.

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, Copy, Trash2 } from 'lucide-react';
import { getCurveLib, listCurveLibs, saveCurveLibFromRepline } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { apiErrorMessage } from '../../lib/utils';
import { specFromVector } from '../../lib/curves';
import { useDealDraft } from '../../lib/useDealDraft';
import type { ApiFieldError, CurveSpec, FieldSpec, ReplineEntry, ReplineSchema } from '../../lib/types';
import Panel from '../shared/Panel';
import FieldRow from './FieldRow';
import KnobMenu from './KnobMenu';

interface Props {
  entry: ReplineEntry;
  index: number;
  schema: ReplineSchema;
  errors: ApiFieldError[];
  onChange: (mutator: (entry: ReplineEntry) => void) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
}

function CurveLibMenu({ entry }: { entry: ReplineEntry }) {
  const { doc, update } = useDealDraft();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const libs = useQuery({ queryKey: qk.curveLibs, queryFn: listCurveLibs, enabled: open });
  const replineId = String(entry.inline.repline_id);

  async function saveAsLib() {
    const name = window.prompt('Library name:', `${replineId} curves`);
    if (!name || !doc) return;
    try {
      await saveCurveLibFromRepline({ doc, repline_id: replineId, name, overwrite: true });
      queryClient.invalidateQueries({ queryKey: qk.curveLibs });
      window.alert(`Saved curve library "${name}"`);
    } catch (err) {
      window.alert(apiErrorMessage(err, 'Save failed'));
    }
  }

  async function applyLib(slug: string) {
    try {
      const lib = await getCurveLib(slug);
      update((d) => {
        const target = d.run.replines.find(
          (e) => String(e.inline.repline_id) === replineId);
        if (!target) return;
        for (const [curve, values] of Object.entries(lib.curves)) {
          target.inline[curve] = values;
          target.curve_specs = { ...(target.curve_specs ?? {}), [curve]: specFromVector(values) };
        }
        (target as { ui?: { curves_id?: string } }).ui = {
          ...((target as { ui?: object }).ui ?? {}), curves_id: slug,
        };
      });
      setOpen(false);
    } catch (err) {
      window.alert(apiErrorMessage(err, 'Apply failed'));
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn" title="Curve libraries" onClick={() => setOpen((o) => !o)}>
        <BookMarked size={12} />
      </button>
      {open && (
        <div className="knob-menu" style={{ right: 0, left: 'auto', minWidth: 240 }}
          onMouseLeave={() => setOpen(false)}>
          <button className="knob-menu-item" onClick={() => { setOpen(false); void saveAsLib(); }}>
            <span>SAVE CURVES AS LIBRARY…</span>
            <span className="item-doc">promote this repline's set curves into a reusable library</span>
          </button>
          <div className="knob-menu-group">APPLY LIBRARY</div>
          {(libs.data ?? []).length === 0 && (
            <div className="knob-menu-item dim">no libraries yet</div>
          )}
          {(libs.data ?? []).map((l) => (
            <button key={l.slug} className="knob-menu-item" onClick={() => void applyLib(l.slug)}>
              <span>{l.name}</span>
              <span className="item-doc">{l.specified.join(', ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The loss assumption is one choice: a CDR vector, or CGL + loss-timing
// (the stored loss_timing curve sums to CGL of face; the timing editor edits
// the scaled curve, the CGL % field rescales it, the sum IS lifetime CGL).
const LOSS_FIELDS = new Set(['cdr', 'loss_timing', 'cgl']);

function curveSum(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return (value as unknown[]).reduce<number>(
    (a, v) => a + (typeof v === 'number' ? v : 0), 0);
}

function LossInputRow({ entry, schema, errorsFor, rowProps, onChange }: {
  entry: ReplineEntry;
  schema: ReplineSchema;
  errorsFor: (name: string) => ApiFieldError[];
  rowProps: {
    entry: ReplineEntry;
    onScalar: (name: string, value: unknown) => void;
    onCurve: (name: string, spec: CurveSpec, resolved: number[]) => void;
    onRemove: (name: string) => void;
  };
  onChange: (mutator: (entry: ReplineEntry) => void) => void;
}) {
  const cdrField = schema.fields.find((f) => f.name === 'cdr');
  const timingField = schema.fields.find((f) => f.name === 'loss_timing');
  const cgl = curveSum(entry.inline.loss_timing);
  const mode: 'cdr' | 'cgl' = cgl > 0 ? 'cgl' : 'cdr';

  function toCdr() {
    onChange((en) => {
      en.inline.loss_timing = [0];
      en.inline.cgl = 0;
      if (en.curve_specs) delete en.curve_specs.loss_timing;
      if (curveSum(en.inline.cdr) === 0) {
        const flat = Array(361).fill(0.02 / 12);
        en.inline.cdr = flat;
        en.curve_specs = { ...(en.curve_specs ?? {}), cdr: specFromVector(flat) };
      }
    });
  }

  function toCgl() {
    onChange((en) => {
      en.inline.cdr = [0];
      if (en.curve_specs) delete en.curve_specs.cdr;
      if (curveSum(en.inline.loss_timing) === 0) {
        const seeded = Array(361).fill(0);
        const months = Math.min(48, Number(en.inline.term) || 48);
        for (let m = 1; m <= months; m++) seeded[m] = 0.08 / months;
        en.inline.loss_timing = seeded;
        en.inline.cgl = 0.08;
        en.curve_specs = { ...(en.curve_specs ?? {}), loss_timing: specFromVector(seeded) };
      }
    });
  }

  function setCglPct(pct: number) {
    onChange((en) => {
      const cur = curveSum(en.inline.loss_timing);
      if (cur <= 0 || !Number.isFinite(pct) || pct < 0) return;
      const scale = pct / 100 / cur;
      const next = (en.inline.loss_timing as number[]).map((v) => v * scale);
      en.inline.loss_timing = next;
      en.inline.cgl = pct / 100;
      en.curve_specs = { ...(en.curve_specs ?? {}), loss_timing: specFromVector(next) };
    });
  }

  return (
    <>
      <div className="field-row">
        <label title="One loss assumption: a monthly CDR vector, or a lifetime CGL spread over a loss-timing curve">
          loss input
        </label>
        <span className="field-control" style={{ gap: 4 }}>
          <button className={`chip ${mode === 'cdr' ? 'chip--active' : ''}`} onClick={toCdr}>
            CDR VECTOR
          </button>
          <button className={`chip ${mode === 'cgl' ? 'chip--active' : ''}`}
            style={mode === 'cgl' ? { color: 'var(--warning)', borderColor: 'var(--warning)' } : undefined}
            onClick={toCgl}>
            CGL + TIMING
          </button>
        </span>
      </div>
      {mode === 'cdr' && cdrField && (
        <FieldRow field={cdrField} errors={errorsFor('cdr')} removable={false} {...rowProps} />
      )}
      {mode === 'cgl' && (
        <>
          <div className="field-row">
            <label title="Lifetime cumulative gross loss, % of original face — rescales the timing curve">
              CGL % of face
            </label>
            <span className="field-control">
              <input className="input num" type="number" step={0.25} min={0}
                style={{ width: 80, color: 'var(--warning)' }}
                value={Number((cgl * 100).toFixed(4))}
                onChange={(e) => setCglPct(Number(e.target.value))} />
              <span className="dim" style={{ fontSize: 10 }}>
                = timing curve sum · edit either side
              </span>
            </span>
          </div>
          {timingField && (
            <FieldRow field={timingField} errors={errorsFor('loss_timing')}
              removable={false} {...rowProps} />
          )}
        </>
      )}
    </>
  );
}

function scalarDiffersFromDefault(field: FieldSpec, value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) {
    // engine-native docs serialize every curve explicitly; a constant curve
    // sitting at an engine-neutral level (0, 1, or 100) is just the default
    // and shouldn't clutter the card
    const flat = (value as unknown[]).flat(2).filter((v): v is number => typeof v === 'number');
    if (!flat.length) return false;
    const first = flat[0];
    const constant = flat.every((v) => v === first);
    if (constant && (first === 0 || first === 1 || first === 100)) return false;
    return flat.some((v) => v !== 0);
  }
  return value !== field.default;
}

export default function ReplineCard({
  entry,
  index,
  schema,
  errors,
  onChange,
  onDuplicate,
  onDelete,
  canDelete,
}: Props) {
  const knobs: string[] = ((entry as { ui?: { knobs?: string[] } }).ui?.knobs ?? []) as string[];

  const visible = useMemo(() => {
    const names = new Set<string>(schema.core);
    for (const k of knobs) names.add(k);
    for (const f of schema.fields) {
      if (names.has(f.name)) continue;
      if (f.name in entry.inline && scalarDiffersFromDefault(f, entry.inline[f.name])) {
        names.add(f.name);
      }
    }
    // preserve registry order; loss fields render through the LossInputRow
    return schema.fields.filter((f) => names.has(f.name) && !LOSS_FIELDS.has(f.name));
  }, [schema, knobs, entry]);

  const available = useMemo(
    () => schema.fields.filter(
      (f) => !visible.some((v) => v.name === f.name) && !LOSS_FIELDS.has(f.name)),
    [schema, visible],
  );

  const errorsFor = (name: string) =>
    errors.filter((e) => e.loc[e.loc.length - 1] === name || e.field === name);
  const cardErrors = errors.filter(
    (e) => !visible.some((f) => f.name === e.loc[e.loc.length - 1] || f.name === e.field),
  );

  const coreFields = visible.filter((f) => f.core);
  const extraFields = visible.filter((f) => !f.core);

  function setScalar(name: string, value: unknown) {
    onChange((en) => {
      en.inline[name] = value;
    });
  }

  function setCurve(name: string, spec: CurveSpec, resolved: number[]) {
    onChange((en) => {
      en.inline[name] = resolved;
      en.curve_specs = { ...(en.curve_specs ?? {}), [name]: spec };
    });
  }

  function addKnob(field: FieldSpec) {
    onChange((en) => {
      const ui = ((en as { ui?: { knobs?: string[] } }).ui ??= {});
      ui.knobs = [...(ui.knobs ?? []), field.name];
    });
  }

  function removeKnob(name: string) {
    onChange((en) => {
      delete en.inline[name];
      if (en.curve_specs) delete en.curve_specs[name];
      const ui = (en as { ui?: { knobs?: string[] } }).ui;
      if (ui?.knobs) ui.knobs = ui.knobs.filter((k) => k !== name);
    });
  }

  const rowProps = {
    entry,
    onScalar: setScalar,
    onCurve: setCurve,
    onRemove: removeKnob,
  };

  return (
    <Panel
      className="repline-card"
      title={`REPLINE ${index + 1}`}
      subtitle={
        <span>
          {String(entry.inline.repline_id ?? '')}
          {curveSum(entry.inline.loss_timing) > 0 ? (
            <span className="mono" style={{ color: 'var(--warning)', fontSize: 9, marginLeft: 8 }}
              title={`Losses: lifetime CGL ${(curveSum(entry.inline.loss_timing) * 100).toFixed(2)}% of face over the timing curve`}>
              CGL {(curveSum(entry.inline.loss_timing) * 100).toFixed(1)}%
            </span>
          ) : (
            <span className="mono" style={{ color: 'var(--text-accent)', fontSize: 9, marginLeft: 8 }}
              title="Losses: monthly CDR vector">
              CDR
            </span>
          )}
          {entry.cgl_policy === 'hold_constant' && (
            <span className="mono" style={{ color: 'var(--positive)', fontSize: 9, marginLeft: 6 }}
              title="Roll policy: lifetime CGL held constant against actuals (set on ACTUALS)">
              CGL PINNED
            </span>
          )}
        </span>
      }
      actions={
        <>
          <CurveLibMenu entry={entry} />
          <button className="btn" title="Duplicate repline" onClick={onDuplicate}>
            <Copy size={12} />
          </button>
          <button
            className="btn"
            title="Delete repline"
            style={{ color: 'var(--warning)' }}
            disabled={!canDelete}
            onClick={() => {
              if (window.confirm(`Delete repline "${entry.inline.repline_id}"?`)) onDelete();
            }}
          >
            <Trash2 size={12} />
          </button>
        </>
      }
    >
      {cardErrors.map((e, i) => (
        <div key={i} className="field-error-msg" style={{ textAlign: 'left' }} title={e.hint ?? undefined}>
          {e.msg}
        </div>
      ))}
      {coreFields.map((f) => (
        <FieldRow key={f.name} field={f} errors={errorsFor(f.name)} removable={false} {...rowProps} />
      ))}
      <LossInputRow entry={entry} schema={schema} errorsFor={errorsFor}
        rowProps={rowProps} onChange={onChange} />
      {extraFields.length > 0 && <div className="repline-divider" />}
      {extraFields.map((f) => (
        <FieldRow key={f.name} field={f} errors={errorsFor(f.name)} removable {...rowProps} />
      ))}
      <div style={{ marginTop: 6 }}>
        <KnobMenu available={available} onAdd={addKnob} />
      </div>
    </Panel>
  );
}
