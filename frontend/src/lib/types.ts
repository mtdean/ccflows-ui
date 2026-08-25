// Shared contract types between the ccflows-ui frontend and backend.
// The deal document mirrors backend/core/document.py; engine-native sections
// (waterfall spec, repline dicts) mirror the cashflows package's own codecs.

// ── generic chart point (used by copied situation-monitor components) ──────
export interface MetricPoint {
  date: string;
  value: number | null;
}

// ── schema introspection ───────────────────────────────────────────────────
export type FieldKind =
  | 'str_id'
  | 'str_literal'
  | 'float_scalar'
  | 'int_scalar'
  | 'bool_scalar'
  | 'optional_float_scalar'
  | 'scalar_or_schedule'
  | 'probability_curve'
  | 'ratio_curve'
  | 'dollar_curve'
  | 'seasonality'
  | 'rr_matrix';

export interface FieldSpec {
  name: string;
  kind: FieldKind;
  default: unknown;
  required: boolean;
  base_curve: string | null;
  threshold: number | null;
  doc: string;
  processing: string;
  choices: string[] | null;
  core: boolean;
}

export interface ReplineSchema {
  fields: FieldSpec[];
  core: string[];
  groups: {
    scalars: string[];
    serializable_scalars: string[];
    curves: string[];
    probability_curves: string[];
    ratio_curves: string[];
    dollar_curves: string[];
    seasonality_curves: string[];
    library_curves: string[];
    repline_owned_curves: string[];
  };
}

export interface StepParamSpec {
  name: string;
  kind: 'float' | 'int' | 'bool' | 'enum' | 'bonds' | 'bond' | 'trigger' | 'steps' | 'schedule' | 'str';
  default: unknown;
  choices?: string[];
  optional?: boolean;
  doc?: string;
}

export interface StepSchema {
  type: string;
  label: string;
  group: string;
  doc: string;
  params: StepParamSpec[];
}

export interface TriggerMetricSchema {
  metrics: { name: string; doc: string }[];
  cure_options: string[];
  threshold_modes: string[];
}

export interface StressScenarioSchema {
  curve_scenarios: { name: string; multipliers: Record<string, number> }[];
  macro_scenarios: ({ name: string } & Record<string, unknown>)[];
  multiplier_fields: string[];
}

export interface SamplerSchema {
  samplers: {
    type: string;
    label: string;
    target: 'curve' | 'rr_matrix';
    doc: string;
    params: { name: string; kind: string; default: number; doc?: string }[];
  }[];
}

// ── deal document ──────────────────────────────────────────────────────────
export type CurveSpec =
  | { mode: 'flat'; value: number }
  | { mode: 'ramp'; points: { month: number; value: number }[] }
  | { mode: 'vector'; values: number[] };

/** Engine-native repline dict: scalars + full-length curve arrays. */
export type ReplineInline = Record<string, unknown> & { repline_id: string };

export interface ReplineEntry {
  inline: ReplineInline;
  /** UI recipes per curve field so reopening an editor shows ramp handles. */
  curve_specs?: Record<string, CurveSpec>;
}

export interface BondSpec {
  type: 'bond';
  name: string;
  size_pct: number | null;
  balance: number | null;
  coupon: number | number[] | null;
  margin: number | number[] | null;
  floating: boolean;
  pik: boolean;
  rate_cap: number | null;
  rate_floor: number | null;
}

export interface ResidualSpec {
  type: 'residual';
  name: string;
  balance: number | null;
}

export interface IOStripSpec {
  type: 'io_strip';
  name: string;
  coupon: number | null;
  margin: number | null;
  floating: boolean;
  notional_of: string;
}

export type BondLikeSpec = BondSpec | ResidualSpec | IOStripSpec | { type: 'wacio_strip'; name: string };

export interface TriggerSpec {
  name: string;
  metric: string;
  threshold: number | number[];
  breach_when: 'above' | 'below';
  window: number;
  cure: 'auto' | 'never' | number;
  metric_params?: Record<string, unknown>;
}

/** One waterfall step in the engine's spec encoding: {name, type, ...params}. */
export type StepSpec = { name?: string; type: string } & Record<string, unknown>;

export interface WaterfallSpec {
  schema: 'cashflows.waterfall/1';
  reserve_initial: number;
  bonds: BondLikeSpec[];
  triggers: TriggerSpec[];
  steps: StepSpec[];
}

export type RatesSection =
  | { mode: 'flat'; rate: number; index: string }
  | { mode: 'records'; records: Record<string, unknown>[] }
  | { mode: 'named'; curve: string; index: string };

export interface StressSection {
  scenario: string;
  custom_multipliers: Record<string, number> | null;
  macro_scenario: string | null;
}

export interface SamplerConfig {
  field: string;
  type: string;
  [param: string]: unknown;
}

export interface MonteCarloSection {
  n_sims: number;
  seed: number | null;
  store_paths: boolean;
  samplers: SamplerConfig[];
}

export interface DealDoc {
  schema: string;
  meta: {
    name: string;
    slug: string;
    created?: string;
    modified?: string;
    tags: string[];
    notes: string;
  };
  run: {
    run_date: string;
    replines: ReplineEntry[];
    /** Forward-flow: monthly dollar origination schedule (empty/absent = static pool). */
    originations?: { schedule: number[] } | null;
  };
  /** Remittance tapes; spliced ahead of projections on every run. */
  actuals?: {
    collateral: Record<string, unknown>[];
    bonds: Record<string, unknown>[];
  };
  waterfall: WaterfallSpec;
  rates: RatesSection;
  stress: StressSection;
  monte_carlo: MonteCarloSection;
  export: { folder: string | null; price: number };
  ui_state: Record<string, unknown>;
  covenants?: CovenantConfig[];
  call?: CallConfig;
  reinvestment?: ReinvestmentConfig;
}

export interface CovenantConfig {
  factory: string;
  params: Record<string, number | string>;
  name?: string;
  severity?: 'watch' | 'alert' | 'breach';
  grace_months?: number;
  cure_months?: number;
}

export interface CallConfig {
  enabled: boolean;
  call_month: number | null;
  nc_months: number;
  call_price_pct: number;
  clean_up_call: boolean;
  clean_up_call_pct: number;
}

export interface ReinvestmentConfig {
  enabled: boolean;
  reinvest_months: number;
  template_repline_id: string | null;
  purchase_price_pct: number;
  reinvest_share: number;
  max_iterations: number;
}

export interface DealSummary {
  slug: string;
  name: string;
  modified: string | null;
  tags: string[];
  n_replines: number;
  n_bonds: number;
  total_upb: number;
  corrupt?: boolean;
}

// ── validation ─────────────────────────────────────────────────────────────
export interface ApiFieldError {
  loc: (string | number)[];
  field: string | null;
  msg: string;
  hint: string | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: ApiFieldError[];
  warnings: string[];
  lint?: string[];
}

// ── runs / results ─────────────────────────────────────────────────────────
export interface RunSummary {
  run_id: string;
  scenario: string;
  summary: { columns: string[]; records: Record<string, unknown>[] };
  tranche_metrics: Record<string, TrancheMetrics>;
  warnings: string[];
  is_portfolio?: boolean;
  boundary_month?: number | null;
  reinvestment?: {
    total_spend?: number;
    total_faces?: number;
    iterations?: number;
    call_month_effective?: number | null;
  } | null;
}

// ── actuals ────────────────────────────────────────────────────────────────
export interface ActualsSchema {
  collateral: { required: string[]; optional: string[]; notes: Record<string, string> };
  bonds: { required: string[]; optional: string[]; notes: Record<string, string> };
}

export interface ActualsValidation {
  ok: boolean;
  errors: ApiFieldError[];
  warnings: string[];
  ids?: string[];
  months?: { first: number; last: number; count: number };
  n_rows?: number;
}

export interface RedlineResult {
  summary: TableData;
  details: Record<string, TableData>;
}

export interface TrancheMetrics {
  wal: number | null;
  xirr: number | null;
  discount_margin: number | null;
  moic: number | null;
  credit_enhancement: number | null;
  attach: number | null;
  detach: number | null;
}

export interface JobStatus {
  job_id: string;
  kind: string;
  deal: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  progress: { completed: number; total: number } | null;
  error: { type: string; message: string } | null;
  params: Record<string, unknown>;
  submitted: string;
  finished: string | null;
}

export interface TableData {
  columns: string[];
  records: Record<string, unknown>[];
}

// ── analysis ───────────────────────────────────────────────────────────────
export interface AnalysisTranche {
  name: string;
  type: string;
  floating: boolean;
  coupon: number | number[] | null;
  margin: number | number[] | null;
  priceable: boolean;
}

export type PriceMethod = 'yield' | 'dm' | 'spread' | 'zero_curve';

export interface TrancheMark {
  name?: string;
  tranche?: string;
  method: string;
  price: number | null;
  clean_price?: number | null;
  dirty_price?: number | null;
  par_value?: number | null;
  market_value?: number | null;
  accrued_interest?: number | null;
  wal_remaining?: number | null;
  spread_dv01?: number | null;
  modified_duration?: number | null;
  mixin_price?: number | null;
  note?: string;
  [key: string]: unknown;
}

export interface LoanPricingRow {
  repline_id: string;
  engine: string;
  wal_months: number | null;
  duration_years: number | null;
  price_at_spread: number | null;
  dm_bps_at_price: number | null;
  xirr: number | null;
  moic: number | null;
}

export interface BreakevenRow {
  tranche: string;
  curve: string;
  breakeven_multiplier: number | null;
  cushion_pct: number | null;
  base_net_cash: number | null;
  base_moic: number | null;
  price: number | null;
}

// ── portfolios ─────────────────────────────────────────────────────────────
export interface PortfolioPosition {
  deal: string;
  tranche: string;
  face: number;
  cost_basis: number;
  acquired_month?: number;
}

export interface PortfolioDoc {
  schema: string;
  meta: { name: string; slug: string; notes?: string; created?: string; modified?: string };
  positions: PortfolioPosition[];
  marks: {
    method: 'spread' | 'yield' | 'dm';
    default: number;
    per_tranche: Record<string, Record<string, number>>;
  };
}

export interface PortfolioSummary {
  slug: string;
  name: string;
  modified: string | null;
  n_positions: number;
  deals: string[];
  corrupt?: boolean;
}

export interface PortfolioAnalyticsRow {
  irr_to_live?: number | null;
  fm_irr?: number | null;
  index: number;
  deal: string;
  tranche: string;
  face: number;
  cost_basis: number;
  error?: string;
  mark_value?: number;
  factor?: number | null;
  par_value?: number | null;
  price?: number | null;
  market_value?: number | null;
  accrued?: number | null;
  cost_value?: number | null;
  pnl?: number | null;
  wal?: number | null;
  duration?: number | null;
  dv01?: number | null;
}

export interface PortfolioAnalytics {
  portfolio: { name: string; slug: string };
  method: string;
  rows: PortfolioAnalyticsRow[];
  totals: {
    face: number;
    par_value: number;
    market_value: number;
    accrued: number;
    cost_value: number;
    pnl: number;
    wal: number | null;
    duration: number | null;
    irr_to_live?: number | null;
    fm_irr?: number | null;
  };
  deals: Record<string, { reran?: boolean; run_at?: string; scenario?: string; error?: string; boundary_month?: number }>;
}
