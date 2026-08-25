// The [+ ADD FIELD] popover: every registry field not already shown, grouped
// by kind, type-to-filter, docstring hints. Generated entirely from the
// backend schema endpoint — nothing hardcoded.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { FieldSpec } from '../../lib/types';

interface Props {
  available: FieldSpec[];
  onAdd: (field: FieldSpec) => void;
}

const GROUP_LABELS: [string, (f: FieldSpec) => boolean][] = [
  ['SCALARS', (f) => !f.kind.includes('curve') && f.kind !== 'seasonality' && f.kind !== 'rr_matrix'],
  ['CURVES', (f) => f.kind.includes('curve') || f.kind === 'seasonality'],
  ['MATRICES', (f) => f.kind === 'rr_matrix'],
];

export default function KnobMenu({ available, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return available;
    return available.filter(
      (f) => f.name.toLowerCase().includes(q) || f.doc.toLowerCase().includes(q),
    );
  }, [available, filter]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn" onClick={() => setOpen((o) => !o)}>
        <Plus size={12} /> ADD FIELD ▾
      </button>
      {open && (
        <div className="knob-menu">
          <input
            className="input knob-menu-filter"
            placeholder="filter…"
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {GROUP_LABELS.map(([label, match]) => {
            const fields = filtered.filter(match);
            if (!fields.length) return null;
            return (
              <div key={label}>
                <div className="knob-menu-group">{label}</div>
                {fields.map((f) => (
                  <button
                    key={f.name}
                    className="knob-menu-item"
                    onClick={() => {
                      onAdd(f);
                      setOpen(false);
                      setFilter('');
                    }}
                  >
                    <span>{f.name}</span>
                    {f.doc && <span className="item-doc">{f.doc}</span>}
                  </button>
                ))}
              </div>
            );
          })}
          {!filtered.length && <div className="knob-menu-item dim">no matches</div>}
        </div>
      )}
    </div>
  );
}
