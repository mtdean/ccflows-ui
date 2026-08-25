// Standard-structure dropdown: A/B/R, A/B/C/R, A/B/C/D/E/R, CLO, facility.
// Selecting replaces the stack + steps + triggers after a confirm.

import { useEffect, useRef, useState } from 'react';
import { PRESETS } from '../../lib/presets';
import type { WaterfallSpec } from '../../lib/types';

interface Props {
  onChange: (mutator: (wf: WaterfallSpec) => void) => void;
}

export default function StructurePresetPicker({ onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn" onClick={() => setOpen((o) => !o)}>
        PRESET ▾
      </button>
      {open && (
        <div className="knob-menu" style={{ right: 0, left: 'auto', minWidth: 280 }}>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className="knob-menu-item"
              onClick={() => {
                setOpen(false);
                if (!window.confirm(`Replace the current bond stack, steps, and triggers with the ${p.label} preset?`)) return;
                const built = p.build();
                onChange((wf) => {
                  wf.bonds = built.bonds;
                  wf.steps = built.steps.map((s, i) => ({ name: s.name ?? `step_${i + 1}`, ...s }));
                  wf.triggers = built.triggers;
                  wf.reserve_initial = built.reserve_initial ?? 0;
                });
              }}
            >
              <span>{p.label}</span>
              <span className="item-doc">{p.doc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
