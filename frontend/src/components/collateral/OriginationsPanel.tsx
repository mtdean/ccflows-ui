// Forward-flow originations: monthly dollar purchase schedule. When enabled,
// the pool is built up vintage-by-vintage along this schedule (replines act
// as templates mixed by their `distribution` weights).

import { useMemo, useState } from 'react';
import { parsePasted, sparklinePoints } from '../../lib/curves';
import { money } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import Panel from '../shared/Panel';

export default function OriginationsPanel() {
  const { doc, update } = useDealDraft();
  const [text, setText] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const schedule = useMemo(() => doc?.run.originations?.schedule ?? [], [doc]);
  const spark = useMemo(
    () => (schedule.length > 1 ? sparklinePoints(schedule, 160, 24) : ''),
    [schedule],
  );

  if (!doc) return null;
  const enabled = schedule.length > 0;
  const total = schedule.reduce((s, v) => s + v, 0);
  const editText = text ?? schedule.map((v) => (v / 1e6).toFixed(2)).join(', ');

  function apply() {
    const { values, bad } = parsePasted(editText);
    if (!values.length) {
      setMsg('No numbers found');
      return;
    }
    // entered in $MM for ergonomics
    const dollars = values.map((v) => v * 1e6);
    update((d) => {
      d.run.originations = { schedule: dollars };
    });
    setMsg(`${dollars.length} months · Σ ${money(dollars.reduce((s, v) => s + v, 0))}${bad.length ? ` · ${bad.length} tokens skipped` : ''}`);
    setText(null);
  }

  return (
    <Panel
      title="FORWARD FLOW / ORIGINATIONS"
      subtitle={
        enabled ? (
          <span className="mono">
            {schedule.length}mo ramp · Σ {money(total)}
          </span>
        ) : (
          <span className="dim">static pool</span>
        )
      }
      actions={
        enabled && (
          <button
            className="btn"
            style={{ color: 'var(--warning)' }}
            onClick={() => {
              update((d) => { d.run.originations = null; });
              setText(null);
              setMsg(null);
            }}
          >
            DISABLE
          </button>
        )
      }
    >
      <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
        Monthly purchase volumes in <b>$MM</b>, comma separated (month 0 first). Replines become
        vintage templates weighted by their <span className="mono">distribution</span> field;
        pair with a warehouse structure (Draw / Retain Collections steps) for a revolving deal.
        Breakevens and Monte Carlo are unavailable on build-up pools.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="input input-wide"
          style={{ maxWidth: 520 }}
          placeholder="e.g. 2, 2.5, 3, 3.5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3…"
          value={editText}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn" onClick={apply} disabled={text == null}>
          APPLY
        </button>
        {spark && (
          <svg width={160} height={24}>
            <polyline points={spark} fill="none" stroke="var(--text-accent)" strokeWidth={1} />
          </svg>
        )}
      </div>
      {msg && <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{msg}</div>}
    </Panel>
  );
}
