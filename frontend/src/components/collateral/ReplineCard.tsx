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
    // preserve registry order
    return schema.fields.filter((f) => names.has(f.name));
  }, [schema, knobs, entry]);

  const available = useMemo(
    () => schema.fields.filter((f) => !visible.some((v) => v.name === f.name)),
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
      subtitle={String(entry.inline.repline_id ?? '')}
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
