// Curve helpers: recipes (flat / ramp / vector) <-> resolved 361-month arrays.

import type { CurveSpec } from './types';

export const HORIZON = 361;

/** Expand a curve recipe to a full-length vector. */
export function resolveCurve(spec: CurveSpec, horizon = HORIZON): number[] {
  if (spec.mode === 'flat') return new Array(horizon).fill(spec.value);
  if (spec.mode === 'vector') {
    const values = spec.values.slice(0, horizon);
    const last = values.length ? values[values.length - 1] : 0;
    while (values.length < horizon) values.push(last);
    return values;
  }
  // ramp: sorted (month, value) breakpoints, linear interpolation, flat tails
  const pts = [...spec.points].sort((a, b) => a.month - b.month);
  if (pts.length === 0) return new Array(horizon).fill(0);
  const out = new Array<number>(horizon);
  for (let m = 0; m < horizon; m++) {
    if (m <= pts[0].month) {
      out[m] = pts[0].value;
      continue;
    }
    if (m >= pts[pts.length - 1].month) {
      out[m] = pts[pts.length - 1].value;
      continue;
    }
    let i = 0;
    while (pts[i + 1].month < m) i++;
    const a = pts[i];
    const b = pts[i + 1];
    const t = (m - a.month) / (b.month - a.month);
    out[m] = a.value + t * (b.value - a.value);
  }
  return out;
}

/** Infer a recipe from a raw vector (for docs without curve_specs). */
export function specFromVector(values: number[]): CurveSpec {
  if (values.length === 0) return { mode: 'flat', value: 0 };
  const first = values[0];
  if (values.every((v) => v === first)) return { mode: 'flat', value: first };
  return { mode: 'vector', values };
}

/** Parse pasted text (Excel column / comma / whitespace separated) to numbers. */
export function parsePasted(text: string): { values: number[]; bad: string[] } {
  const tokens = text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const values: number[] = [];
  const bad: string[] = [];
  for (const token of tokens) {
    const v = Number(token.replace(/%$/, ''));
    if (Number.isFinite(v)) values.push(token.endsWith('%') ? v / 100 : v);
    else bad.push(token);
  }
  return { values, bad };
}

/** One-line human summary of a curve for the card row. */
export function curveSummary(spec: CurveSpec | undefined, values: number[] | null): string {
  if (spec?.mode === 'flat') return `${fmtCurveVal(spec.value)} flat`;
  if (spec?.mode === 'ramp' && spec.points.length > 0) {
    const first = spec.points[0];
    const last = spec.points[spec.points.length - 1];
    return `${fmtCurveVal(first.value)}→${fmtCurveVal(last.value)} ramp`;
  }
  if (values && values.length) {
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (max === min) return `${fmtCurveVal(max)} flat`;
    return `${fmtCurveVal(min)}–${fmtCurveVal(max)}`;
  }
  return 'default';
}

export function fmtCurveVal(v: number): string {
  if (v === 0) return '0';
  if (Math.abs(v) < 1) return `${(v * 100).toFixed(2)}%`;
  return v.toFixed(2);
}

/** Downsample a vector for a small sparkline polyline. */
export function sparklinePoints(values: number[], width: number, height: number): string {
  if (!values.length) return '';
  const step = Math.max(1, Math.floor(values.length / width));
  const sampled: number[] = [];
  for (let i = 0; i < values.length; i += step) sampled.push(values[i]);
  const max = Math.max(...sampled);
  const min = Math.min(...sampled);
  const span = max - min || 1;
  return sampled
    .map((v, i) => {
      const x = (i / (sampled.length - 1 || 1)) * width;
      const y = height - 1 - ((v - min) / span) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
