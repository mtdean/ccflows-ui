// Roll-rate transition matrix editor: 9x9 grid with state labels + paste box.
// Setting a matrix switches the repline's loss framework to roll_rate.

import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { parsePasted } from '../../lib/curves';

const STATES = ['CUR', 'DQ30', 'DQ60', 'DQ90', 'DQ120', 'DQ150', 'DQ180', 'MOD', 'C/O'];

const DEFAULT_MATRIX: number[][] = [
  [0.95, 0.05, 0, 0, 0, 0, 0, 0, 0],
  [0.40, 0.30, 0.30, 0, 0, 0, 0, 0, 0],
  [0.20, 0.10, 0.30, 0.40, 0, 0, 0, 0, 0],
  [0.10, 0.05, 0.05, 0.30, 0.50, 0, 0, 0, 0],
  [0.05, 0, 0, 0.05, 0.30, 0.60, 0, 0, 0],
  [0.03, 0, 0, 0, 0.05, 0.30, 0.62, 0, 0],
  [0.02, 0, 0, 0, 0, 0.05, 0.23, 0, 0.70],
  [0, 0, 0, 0, 0, 0, 0, 1.0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 1.0],
];

interface Props {
  initial: number[][] | null;
  open: boolean;
  onClose: () => void;
  onApply: (matrix: number[][] | null) => void;
}

export default function RrMatrixDialog({ initial, open, onClose, onApply }: Props) {
  const [matrix, setMatrix] = useState<number[][]>(
    initial && initial.length === 9 ? initial.map((r) => [...r]) : DEFAULT_MATRIX.map((r) => [...r]),
  );
  const [pasteText, setPasteText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const rowSums = useMemo(() => matrix.map((r) => r.reduce((s, v) => s + v, 0)), [matrix]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" style={{ width: 860 }} aria-describedby={undefined}>
          <Dialog.Title className="dialog-title">
            <span>ROLL-RATE MATRIX <span className="dim">· rows = from-state, monthly transition probabilities</span></span>
            <button className="btn" onClick={onClose}><X size={12} /></button>
          </Dialog.Title>
          <div className="dialog-body">
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ fontSize: 10 }}>
                <thead>
                  <tr>
                    <th>FROM \ TO</th>
                    {STATES.map((s) => <th key={s} style={{ textAlign: 'right' }}>{s}</th>)}
                    <th style={{ textAlign: 'right' }}>Σ</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--text-accent)' }}>{STATES[i]}</td>
                      {row.map((v, j) => (
                        <td key={j} style={{ padding: 1 }}>
                          <input
                            className="input num"
                            style={{ width: 58, fontSize: 10, padding: '1px 3px' }}
                            type="number" step={0.01} min={0}
                            value={v}
                            disabled={i === 8}
                            onChange={(e) => setMatrix((m) =>
                              m.map((r, ri) => ri === i ? r.map((c, ci) => ci === j ? Number(e.target.value) : c) : r))}
                          />
                        </td>
                      ))}
                      <td className={`num mono ${Math.abs(rowSums[i] - 1) < 1e-6 ? 'pos' : 'neg'}`}>
                        {rowSums[i].toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="dim" style={{ fontSize: 10, margin: '6px 0' }}>
              Rows are re-normalized to 1.0 by the engine; the charge-off row is forced absorbing.
              A modified (MOD) row of all zeros defaults to inert.
            </div>
            <textarea
              className="input input-wide"
              style={{ height: 60, resize: 'vertical' }}
              placeholder="Or paste 81 numbers (9 rows × 9 cols, row-major — tabs/commas/newlines ok)…"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
              <button className="btn" disabled={!pasteText.trim()}
                onClick={() => {
                  const { values } = parsePasted(pasteText);
                  if (values.length !== 81) {
                    setMsg(`Need exactly 81 numbers, got ${values.length}`);
                    return;
                  }
                  setMatrix(Array.from({ length: 9 }, (_, i) => values.slice(i * 9, i * 9 + 9)));
                  setMsg('Pasted 9×9 grid');
                }}>
                PARSE PASTE
              </button>
              {msg && <span className="dim" style={{ fontSize: 11 }}>{msg}</span>}
            </div>
          </div>
          <div className="dialog-footer">
            <button className="btn" style={{ color: 'var(--warning)' }}
              onClick={() => { onApply(null); onClose(); }}>
              CLEAR (framework off)
            </button>
            <button className="btn" onClick={onClose}>CANCEL</button>
            <button className="btn" style={{ color: 'var(--text-accent)', borderColor: 'var(--text-accent)' }}
              onClick={() => { onApply(matrix); onClose(); }}>
              APPLY
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
