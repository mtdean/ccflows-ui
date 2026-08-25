// Curve editor: FLAT / RAMP / VECTOR / PASTE-CSV modes with a live preview.
// Edits a recipe (CurveSpec); the resolved full-length vector is what the
// engine consumes, the recipe is stored alongside so reopening shows handles.

import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import Papa from 'papaparse';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Plus, X } from 'lucide-react';
import { COLORS } from '../../lib/colors';
import { HORIZON, parsePasted, resolveCurve } from '../../lib/curves';
import type { CurveSpec, FieldSpec } from '../../lib/types';
import TooltipShell from '../charts/TooltipShell';

interface Props {
  field: FieldSpec;
  initial: CurveSpec;
  open: boolean;
  onClose: () => void;
  onApply: (spec: CurveSpec, resolved: number[]) => void;
}

const MODES = ['flat', 'ramp', 'vector', 'paste'] as const;
type Mode = (typeof MODES)[number];

function isPercentish(field: FieldSpec): boolean {
  return field.kind === 'probability_curve' && (field.threshold ?? 1) <= 2;
}

export default function CurveEditorDialog({ field, initial, open, onClose, onApply }: Props) {
  const pct = isPercentish(field);
  const horizon = field.kind === 'seasonality' ? 12 : HORIZON;

  const [mode, setMode] = useState<Mode>(initial.mode === 'vector' ? 'vector' : initial.mode);
  const [flatValue, setFlatValue] = useState(initial.mode === 'flat' ? initial.value : 0);
  const [points, setPoints] = useState<{ month: number; value: number }[]>(
    initial.mode === 'ramp' ? initial.points : [{ month: 0, value: 0.01 }, { month: 24, value: 0.03 }],
  );
  const [vector, setVector] = useState<number[]>(
    initial.mode === 'vector' ? initial.values : resolveCurve(initial, horizon),
  );
  const [pasteText, setPasteText] = useState('');
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);

  const spec: CurveSpec = useMemo(() => {
    if (mode === 'flat') return { mode: 'flat', value: flatValue };
    if (mode === 'ramp') return { mode: 'ramp', points };
    return { mode: 'vector', values: vector };
  }, [mode, flatValue, points, vector]);

  const resolved = useMemo(() => resolveCurve(spec, horizon), [spec, horizon]);

  const chartData = useMemo(
    () => resolved.map((value, month) => ({ month, value: pct ? value * 100 : value })),
    [resolved, pct],
  );

  function applyPaste(values: number[], badCount: number) {
    if (!values.length) {
      setPasteMsg('No numbers found');
      return;
    }
    // Percent-convention convenience: a pasted CDR column of "2.1, 2.3" means
    // percents; the doc stores decimals.
    const converted = pct && values.some((v) => v > (field.threshold ?? 1)) ? values.map((v) => v / 100) : values;
    const msgs: string[] = [];
    if (converted !== values) msgs.push('interpreted as percents (÷100)');
    if (values.length > horizon) msgs.push(`truncated to ${horizon}`);
    if (values.length < horizon) msgs.push(`extended last value to ${horizon}`);
    if (badCount) msgs.push(`${badCount} tokens skipped`);
    setPasteMsg(msgs.join(' · ') || null);
    setVector(converted.slice(0, horizon));
    setMode('vector');
  }

  function onFile(file: File) {
    Papa.parse(file, {
      complete: (res) => {
        const flatVals: number[] = [];
        let bad = 0;
        for (const row of res.data as unknown[][]) {
          for (const cell of Array.isArray(row) ? row : [row]) {
            const v = Number(cell);
            if (Number.isFinite(v)) flatVals.push(v);
            else if (cell != null && String(cell).trim() !== '') bad++;
          }
        }
        applyPaste(flatVals, bad);
      },
    });
  }

  const inputStep = pct ? 0.001 : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" aria-describedby={undefined}>
          <Dialog.Title className="dialog-title">
            <span>
              {field.name.toUpperCase()} <span className="dim">· {field.doc}</span>
            </span>
            <button className="btn" onClick={onClose}>
              <X size={12} />
            </button>
          </Dialog.Title>
          <div className="dialog-body">
            <div className="curve-mode-row">
              {MODES.map((m) => (
                <button
                  key={m}
                  className={`chip${mode === m || (m === 'paste' && false) ? '' : ''} ${mode === m ? 'chip--active' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>

            {mode === 'flat' && (
              <div className="field-row">
                <label>{pct ? 'VALUE (DECIMAL, E.G. 0.002 = 0.2%/MO)' : 'VALUE'}</label>
                <input
                  className="input num"
                  type="number"
                  step={inputStep}
                  value={flatValue}
                  onChange={(e) => setFlatValue(Number(e.target.value))}
                />
              </div>
            )}

            {mode === 'ramp' && (
              <div className="ramp-points">
                {points.map((p, i) => (
                  <div key={i} className="ramp-point-row">
                    <span className="dim">MONTH</span>
                    <input
                      className="input num"
                      style={{ width: 70 }}
                      type="number"
                      min={0}
                      max={horizon - 1}
                      value={p.month}
                      onChange={(e) =>
                        setPoints((ps) => ps.map((q, j) => (j === i ? { ...q, month: Number(e.target.value) } : q)))
                      }
                    />
                    <span className="dim">VALUE</span>
                    <input
                      className="input num"
                      style={{ width: 90 }}
                      type="number"
                      step={inputStep}
                      value={p.value}
                      onChange={(e) =>
                        setPoints((ps) => ps.map((q, j) => (j === i ? { ...q, value: Number(e.target.value) } : q)))
                      }
                    />
                    <button
                      className="btn"
                      disabled={points.length <= 1}
                      onClick={() => setPoints((ps) => ps.filter((_, j) => j !== i))}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                <div>
                  <button
                    className="btn"
                    onClick={() =>
                      setPoints((ps) => {
                        const last = ps[ps.length - 1];
                        return [...ps, { month: Math.min((last?.month ?? 0) + 12, horizon - 1), value: last?.value ?? 0 }];
                      })
                    }
                  >
                    <Plus size={10} /> SEGMENT
                  </button>
                </div>
              </div>
            )}

            {mode === 'vector' && (
              <div className="vector-grid">
                {vector.map((v, i) => (
                  <div key={i} className="vector-cell">
                    <span>{i}</span>
                    <input
                      className="input num"
                      type="number"
                      step={inputStep}
                      value={v}
                      onChange={(e) =>
                        setVector((vs) => vs.map((q, j) => (j === i ? Number(e.target.value) : q)))
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            {mode === 'paste' && (
              <div className="stack" style={{ gap: 6 }}>
                <textarea
                  className="input input-wide"
                  style={{ height: 100, resize: 'vertical' }}
                  placeholder={'Paste a column of values from Excel (one per line, or comma separated)…'}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    className="btn"
                    disabled={!pasteText.trim()}
                    onClick={() => {
                      const { values, bad } = parsePasted(pasteText);
                      applyPaste(values, bad.length);
                    }}
                  >
                    PARSE
                  </button>
                  <label className="btn" style={{ cursor: 'pointer' }}>
                    CSV FILE…
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) onFile(f);
                      }}
                    />
                  </label>
                  {pasteMsg && <span className="dim" style={{ fontSize: 11 }}>{pasteMsg}</span>}
                </div>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={COLORS.border} vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: COLORS.axis, fontSize: 10 }}
                    minTickGap={40}
                    stroke={COLORS.axis}
                  />
                  <YAxis
                    tick={{ fill: COLORS.axis, fontSize: 10 }}
                    width={54}
                    stroke={COLORS.axis}
                    tickFormatter={(v: number) => (pct ? `${v.toFixed(2)}%` : String(v))}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <TooltipShell title={`MONTH ${label}`}>
                          <div style={{ color: COLORS.textPrimary }}>
                            {pct ? `${Number(payload[0].value).toFixed(3)}%` : String(payload[0].value)}
                          </div>
                        </TooltipShell>
                      ) : null
                    }
                    cursor={{ stroke: COLORS.borderBright }}
                  />
                  <Line
                    type="stepAfter"
                    dataKey="value"
                    stroke={COLORS.chartPrimary}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="dialog-footer">
            <button className="btn" onClick={onClose}>
              CANCEL
            </button>
            <button
              className="btn"
              style={{ color: 'var(--text-accent)', borderColor: 'var(--text-accent)' }}
              onClick={() => {
                onApply(spec, resolveCurve(spec, HORIZON));
                onClose();
              }}
            >
              APPLY
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
