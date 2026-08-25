// The bond chart: editable seniority-ordered tranche table + proportional
// size bar. Residual pinned last; size% XOR balance; fixed or floating.

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { ApiFieldError, BondLikeSpec, BondSpec, WaterfallSpec } from '../../lib/types';
import { pct } from '../../lib/utils';
import Panel from '../shared/Panel';
import StructurePresetPicker from './StructurePresetPicker';

interface Props {
  waterfall: WaterfallSpec;
  errors: ApiFieldError[];
  onChange: (mutator: (wf: WaterfallSpec) => void) => void;
}

const BAR_COLORS = ['#4a90d9', '#00c176', '#9b59b6', '#ffaa00', '#ff6b6b', '#4dd0e1'];

function isBond(b: BondLikeSpec): b is BondSpec {
  return b.type === 'bond';
}

export default function BondStackEditor({ waterfall, errors, onChange }: Props) {
  const bonds = waterfall.bonds;
  const notes = bonds.filter(isBond);
  const residual = bonds.find((b) => b.type === 'residual');
  const sizeSum = notes.reduce((s, b) => s + (b.size_pct ?? 0), 0);
  const residualPct = Math.max(0, 1 - sizeSum);

  function updateBond(index: number, mutator: (b: BondSpec) => void) {
    onChange((wf) => {
      const b = wf.bonds[index];
      if (b.type === 'bond') mutator(b);
    });
  }

  function move(index: number, dir: -1 | 1) {
    onChange((wf) => {
      const target = index + dir;
      if (target < 0 || target >= wf.bonds.length) return;
      if (wf.bonds[target].type === 'residual') return;
      const [b] = wf.bonds.splice(index, 1);
      wf.bonds.splice(target, 0, b);
    });
  }

  function addStrip(kind: 'io_strip' | 'wacio_strip') {
    onChange((wf) => {
      const used = new Set(wf.bonds.map((b) => b.name));
      let name = kind === 'wacio_strip' ? 'WACIO' : 'IO';
      let n = 1;
      while (used.has(name)) name = `${kind === 'wacio_strip' ? 'WACIO' : 'IO'}${++n}`;
      const insertAt = wf.bonds.findIndex((b) => b.type === 'residual');
      const firstBond = wf.bonds.find((b) => b.type === 'bond');
      const spec = kind === 'wacio_strip'
        ? { type: 'wacio_strip' as const, name }
        : { type: 'io_strip' as const, name, coupon: 0.02, margin: null,
            floating: false, notional_of: firstBond?.name ?? '' };
      wf.bonds.splice(insertAt < 0 ? wf.bonds.length : insertAt, 0, spec as never);
    });
  }

  function addBond() {
    onChange((wf) => {
      const used = new Set(wf.bonds.map((b) => b.name));
      let name = '';
      for (const c of 'ABCDEFGHJKLM') {
        if (!used.has(c)) { name = c; break; }
      }
      if (!name) name = `N${wf.bonds.length}`;
      const insertAt = wf.bonds.findIndex((b) => b.type === 'residual');
      const spec: BondSpec = {
        type: 'bond', name, size_pct: 0.05, balance: null, coupon: 0.06,
        margin: null, floating: false, pik: false, rate_cap: null, rate_floor: null,
      };
      wf.bonds.splice(insertAt < 0 ? wf.bonds.length : insertAt, 0, spec);
    });
  }

  function removeBond(index: number) {
    onChange((wf) => {
      const name = wf.bonds[index].name;
      wf.bonds.splice(index, 1);
      // scrub references from steps
      const scrub = (steps: typeof wf.steps) => {
        for (const s of steps) {
          if (Array.isArray(s.bonds)) s.bonds = (s.bonds as string[]).filter((b) => b !== name);
          if (s.through === name) s.through = null;
          if (Array.isArray(s.then)) scrub(s.then as typeof wf.steps);
          if (Array.isArray(s.otherwise)) scrub(s.otherwise as typeof wf.steps);
        }
      };
      scrub(wf.steps);
    });
  }

  return (
    <Panel
      title="BOND STACK"
      subtitle={
        <span className={sizeSum > 1 ? 'neg' : 'dim'}>
          notes {pct(sizeSum)} · residual {pct(residualPct)}
        </span>
      }
      actions={
        <div style={{ display: 'flex', gap: 6 }}>
          <StructurePresetPicker onChange={onChange} />
          <button className="btn" onClick={addBond}>
            <Plus size={12} /> BOND
          </button>
          <button className="btn" title="Interest-only strip on a bond's notional"
            onClick={() => addStrip('io_strip')}>
            <Plus size={12} /> IO STRIP
          </button>
        </div>
      }
    >
      {errors.map((e, i) => (
        <div key={i} className="field-error-msg" style={{ textAlign: 'left' }}>{e.msg}</div>
      ))}
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}></th>
            <th>NAME</th>
            <th style={{ textAlign: 'right' }}>SIZE %</th>
            <th>RATE</th>
            <th style={{ textAlign: 'right' }}>CPN / MARGIN</th>
            <th style={{ textAlign: 'center' }}>PIK</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bonds.map((b, i) =>
            isBond(b) ? (
              <tr key={i}>
                <td>
                  <span style={{ display: 'inline-flex' }}>
                    <button className="btn" style={{ padding: '0 3px' }} onClick={() => move(i, -1)} disabled={i === 0}>
                      <ArrowUp size={10} />
                    </button>
                    <button className="btn" style={{ padding: '0 3px' }} onClick={() => move(i, 1)}>
                      <ArrowDown size={10} />
                    </button>
                  </span>
                </td>
                <td>
                  <input
                    className="input"
                    style={{ width: 70, color: 'var(--text-accent)' }}
                    value={b.name}
                    onChange={(e) => {
                      const newName = e.target.value;
                      const oldName = b.name;
                      onChange((wf) => {
                        const target = wf.bonds[i];
                        target.name = newName;
                        const rename = (steps: typeof wf.steps) => {
                          for (const s of steps) {
                            if (Array.isArray(s.bonds)) s.bonds = (s.bonds as string[]).map((n) => (n === oldName ? newName : n));
                            if (s.through === oldName) s.through = newName;
                            if (Array.isArray(s.then)) rename(s.then as typeof wf.steps);
                            if (Array.isArray(s.otherwise)) rename(s.otherwise as typeof wf.steps);
                          }
                        };
                        rename(wf.steps);
                      });
                    }}
                  />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    className="input num"
                    style={{ width: 70 }}
                    type="number"
                    step={0.5}
                    value={b.size_pct == null ? '' : (b.size_pct * 100).toFixed(2).replace(/\.?0+$/, '')}
                    onChange={(e) => updateBond(i, (bond) => {
                      bond.size_pct = e.target.value === '' ? null : Number(e.target.value) / 100;
                      bond.balance = null;
                    })}
                  />
                </td>
                <td>
                  <select
                    className="input"
                    value={b.floating ? 'floating' : 'fixed'}
                    onChange={(e) => updateBond(i, (bond) => {
                      bond.floating = e.target.value === 'floating';
                      if (bond.floating) {
                        bond.margin = bond.margin ?? (typeof bond.coupon === 'number' ? bond.coupon : 0.015);
                        bond.coupon = null;
                      } else {
                        bond.coupon = bond.coupon ?? (typeof bond.margin === 'number' ? bond.margin : 0.05);
                        bond.margin = null;
                      }
                    })}
                  >
                    <option value="fixed">FIXED</option>
                    <option value="floating">FLOAT</option>
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    className="input num"
                    style={{ width: 80 }}
                    type="number"
                    step={0.05}
                    title={b.floating ? 'Margin over index, %' : 'Coupon, %'}
                    value={(() => {
                      const v = b.floating ? b.margin : b.coupon;
                      return typeof v === 'number' ? (v * 100).toFixed(3).replace(/\.?0+$/, '') : '';
                    })()}
                    onChange={(e) => updateBond(i, (bond) => {
                      const v = e.target.value === '' ? null : Number(e.target.value) / 100;
                      if (bond.floating) bond.margin = v;
                      else bond.coupon = v;
                    })}
                  />
                  <span className="dim" style={{ fontSize: 10 }}> {b.floating ? '+IDX' : '%'}</span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={b.pik}
                    onChange={(e) => updateBond(i, (bond) => { bond.pik = e.target.checked; })}
                  />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn"
                    style={{ color: 'var(--warning)' }}
                    title="Remove bond"
                    onClick={() => removeBond(i)}
                  >
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ) : b.type === 'io_strip' || b.type === 'wacio_strip' ? (
              <tr key={i}>
                <td><span className="dim" style={{ fontSize: 10 }}>STRIP</span></td>
                <td>
                  <input className="input" style={{ width: 70, color: '#9b59b6' }} value={b.name}
                    onChange={(e) => onChange((wf) => { wf.bonds[i].name = e.target.value; })} />
                </td>
                <td style={{ textAlign: 'right' }}><span className="dim">—</span></td>
                {b.type === 'io_strip' ? (
                  <>
                    <td>
                      <span className="dim" style={{ fontSize: 10 }}>on notional of </span>
                      <select className="input"
                        value={String((b as { notional_of?: string }).notional_of ?? '')}
                        onChange={(e) => onChange((wf) => {
                          (wf.bonds[i] as { notional_of?: string }).notional_of = e.target.value;
                        })}>
                        {notes.map((n) => <option key={n.name} value={n.name}>{n.name}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input className="input num" style={{ width: 80 }} type="number" step={0.05}
                        title="Strip coupon, % of the referenced notional"
                        value={(() => {
                          const v = (b as { coupon?: number | null }).coupon;
                          return typeof v === 'number' ? (v * 100).toFixed(3).replace(/\.?0+$/, '') : '';
                        })()}
                        onChange={(e) => onChange((wf) => {
                          (wf.bonds[i] as { coupon?: number | null }).coupon =
                            e.target.value === '' ? null : Number(e.target.value) / 100;
                        })} />
                      <span className="dim" style={{ fontSize: 10 }}> %</span>
                    </td>
                  </>
                ) : (
                  <td colSpan={2}>
                    <span className="dim" style={{ fontSize: 11 }}>WAC IO — excess of pool WAC over note coupons</span>
                  </td>
                )}
                <td></td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn" style={{ color: 'var(--warning)' }} title="Remove strip"
                    onClick={() => removeBond(i)}>
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={i}>
                <td></td>
                <td><span className="dim">{b.name}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <span className="num mono dim">{pct(residualPct)}</span>
                </td>
                <td colSpan={4}>
                  <span className="dim" style={{ fontSize: 11 }}>residual — takes what remains</span>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      {residual == null && (
        <div className="field-error-msg" style={{ textAlign: 'left' }}>
          No residual tranche — every waterfall needs exactly one, last.
        </div>
      )}
      <div className="stack-bar">
        {notes.map((b, i) => (
          <div
            key={b.name}
            style={{ width: `${(b.size_pct ?? 0) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }}
            title={`${b.name} ${pct(b.size_pct ?? 0)}`}
          >
            {(b.size_pct ?? 0) > 0.04 ? b.name : ''}
          </div>
        ))}
        <div style={{ width: `${residualPct * 100}%`, background: 'var(--text-dim)' }} title={`R ${pct(residualPct)}`}>
          {residualPct > 0.04 ? 'R' : ''}
        </div>
      </div>
    </Panel>
  );
}
