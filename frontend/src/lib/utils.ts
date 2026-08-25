// Formatting helpers — Bloomberg conventions: tabular figures, em-dash nulls.

import axios from 'axios';

/** Human-readable message from an API error. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (detail?.errors?.length) return detail.errors.map((e: { msg: string }) => e.msg).join('; ');
    if (err.response?.status) return `Request failed (${err.response.status}).`;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Decimal rate -> "12.50%". */
export function pct(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

/** Already-in-percent level -> "12.5%". */
export function pctLevel(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Basis points from a decimal, e.g. 0.0180 -> "180bp". */
export function bps(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 10_000)}bp`;
}

/** Dollar amount with compact millions/billions, e.g. 1234567890 -> "$1.23B". */
export function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

/** Full-precision dollars with separators. */
export function moneyFull(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

/** Plain number with separators. */
export function num(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

/** Months -> "3.2y" / "18mo". */
export function walMonths(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value >= 24 ? `${(value / 12).toFixed(1)}y` : `${value.toFixed(0)}mo`;
}

/** ISO date -> "Jan 26" (used by copied chart components). */
export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

/** ISO timestamp -> "21:58" local. */
export function fmtTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

/** Stable JSON hash for debounced structure/validation queries. */
export function hashOf(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36) + ':' + s.length.toString(36);
}

/** Trigger a browser download of a JSON-able object. */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
