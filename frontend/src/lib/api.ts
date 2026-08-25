// Typed API client — every backend endpoint as a function.

import axios from 'axios';
import type {
  AnalysisTranche,
  DealDoc,
  DealSummary,
  JobStatus,
  LoanPricingRow,
  PortfolioAnalytics,
  PortfolioDoc,
  PortfolioSummary,
  PriceMethod,
  ReplineInline,
  ReplineSchema,
  RunSummary,
  SamplerSchema,
  StepSchema,
  StressScenarioSchema,
  TableData,
  TrancheMark,
  TriggerMetricSchema,
  ValidationResult,
  WaterfallSpec,
} from './types';

const BASE = import.meta.env.VITE_API_URL || '/api';

export const client = axios.create({ baseURL: BASE, timeout: 120_000 });

// ── health ────────────────────────────────────────────────────────────────
export const getHealth = () =>
  client
    .get<{ status: string; engine_version: string;
           dirs?: { root: string; ok: boolean;
                    folders: Record<string, { path: string; exists: boolean }> } }>('/health')
    .then((r) => r.data);

// ── schema ────────────────────────────────────────────────────────────────
export const getReplineSchema = () =>
  client.get<ReplineSchema>('/schema/repline-fields').then((r) => r.data);
export const getStepSchemas = () =>
  client.get<{ steps: StepSchema[] }>('/schema/step-types').then((r) => r.data.steps);
export const getTriggerMetrics = () =>
  client.get<TriggerMetricSchema>('/schema/trigger-metrics').then((r) => r.data);
export const getStressScenarios = () =>
  client.get<StressScenarioSchema>('/schema/stress-scenarios').then((r) => r.data);
export const getSamplerSchemas = () =>
  client.get<SamplerSchema>('/schema/samplers').then((r) => r.data);
export const getCollateralTypes = () =>
  client
    .get<{ types: { class: string; aliases: string[]; doc: string }[] }>('/schema/collateral-types')
    .then((r) => r.data.types);
export const parseValue = (text: string, kind: 'rate' | 'pct' = 'rate') =>
  client
    .post<{ ok: boolean; floating?: boolean; value?: number; error?: string }>('/parse/value', {
      text,
      kind,
    })
    .then((r) => r.data);

// ── deals ─────────────────────────────────────────────────────────────────
export const listDeals = () => client.get<DealSummary[]>('/deals').then((r) => r.data);
export const createDeal = (name: string) =>
  client.post<DealDoc>('/deals', { name }).then((r) => r.data);
export const getDeal = (slug: string) => client.get<DealDoc>(`/deals/${slug}`).then((r) => r.data);
export const putDeal = (slug: string, doc: DealDoc) =>
  client.put<DealDoc>(`/deals/${slug}`, doc).then((r) => r.data);
export const deleteDeal = (slug: string) => client.delete(`/deals/${slug}`).then(() => undefined);
export const duplicateDeal = (slug: string, name: string) =>
  client.post<DealDoc>(`/deals/${slug}/duplicate`, { name }).then((r) => r.data);
export const importDeal = (doc: unknown, overwrite = false) =>
  client
    .post<DealDoc>(`/deals/import`, doc, { params: { overwrite } })
    .then((r) => r.data);

// ── validation / preview ──────────────────────────────────────────────────
export const validateRepline = (repline: ReplineInline) =>
  client.post<ValidationResult>('/validate/repline', { repline }).then((r) => r.data);
export const validateWaterfall = (spec: WaterfallSpec) =>
  client.post<ValidationResult>('/validate/waterfall', spec).then((r) => r.data);
export const validateDeal = (doc: DealDoc) =>
  client.post<ValidationResult>('/validate/deal', doc).then((r) => r.data);
export const waterfallMermaid = (spec: WaterfallSpec) =>
  client.post<{ mermaid: string }>('/waterfall/mermaid', spec).then((r) => r.data.mermaid);
export const waterfallDescribe = (spec: WaterfallSpec) =>
  client.post<{ text: string }>('/waterfall/describe', spec).then((r) => r.data.text);

// ── runs ──────────────────────────────────────────────────────────────────
export interface RunRequest {
  scenario?: string;
  custom_multipliers?: Record<string, number> | null;
  price?: number;
  doc?: DealDoc; // run the draft, not the saved file
}
export const runDeal = (slug: string, body: RunRequest) =>
  client.post<RunSummary>(`/deals/${slug}/run`, body).then((r) => r.data);
export const getRunStack = (runId: string, price = 100) =>
  client.get<TableData>(`/runs/${runId}/stack`, { params: { price } }).then((r) => r.data);
export const getTrancheCashflows = (runId: string, name: string) =>
  client
    .get<Record<string, number[]>>(`/runs/${runId}/tranches/${name}/cashflows`)
    .then((r) => r.data);
export const getCollateralCashflows = (runId: string) =>
  client.get<TableData>(`/runs/${runId}/collateral/cashflows`).then((r) => r.data);
export const getRunBalances = (runId: string) =>
  client
    .get<{ months: number[]; pool: number[]; tranches: Record<string, number[]> }>(
      `/runs/${runId}/balances`,
    )
    .then((r) => r.data);
export const getRunTriggers = (runId: string) =>
  client
    .get<Record<string, { values: (number | null)[]; breached: boolean[]; threshold: number | number[] }>>(
      `/runs/${runId}/triggers`,
    )
    .then((r) => r.data);
export const getRunExplain = (runId: string, month: number) =>
  client.get<{ text: string }>(`/runs/${runId}/explain/${month}`).then((r) => r.data.text);

// ── actuals ───────────────────────────────────────────────────────────────
export const getActualsSchema = () =>
  client.get<import('./types').ActualsSchema>('/schema/actuals').then((r) => r.data);
export const validateActuals = (level: 'collateral' | 'bonds', records: Record<string, unknown>[]) =>
  client
    .post<import('./types').ActualsValidation>('/validate/actuals', { level, records })
    .then((r) => r.data);
export const runRedline = (doc: DealDoc) =>
  client
    .post<import('./types').RedlineResult>('/actuals/redline', { doc })
    .then((r) => r.data);
export interface CglStatusRow {
  repline_id: string; loss_type: string; policy: string; face: number;
  lifetime_cgl: number; lifetime_cgl_pct: number | null;
  boundary_month: number | null; realized: number | null;
  planned_to_boundary: number | null; forward_factor: number | null;
}
export const getCglStatus = (doc: DealDoc) =>
  client.post<{ replines: CglStatusRow[] }>('/actuals/cgl-status', { doc })
    .then((r) => r.data.replines);

// ── rates curves + curve libraries + config import ────────────────────────
export interface RatesCurveSummary {
  slug: string; name: string; source?: string; modified?: string;
  columns: string[]; n_rows: number; first_date?: string; last_date?: string;
  corrupt?: boolean;
}
export const listRatesCurves = () =>
  client.get<RatesCurveSummary[]>('/rates-curves').then((r) => r.data);
export const getRatesCurve = (slug: string) =>
  client
    .get<{ meta: Record<string, unknown>; records: Record<string, unknown>[] }>(`/rates-curves/${slug}`)
    .then((r) => r.data);
export const putRatesCurve = (slug: string, doc: Record<string, unknown>) =>
  client.put<RatesCurveSummary>(`/rates-curves/${slug}`, doc).then((r) => r.data);
export const deleteRatesCurve = (slug: string) =>
  client.delete(`/rates-curves/${slug}`).then(() => undefined);
export const buildRatesCurve = (body: Record<string, unknown>) =>
  client.post<RatesCurveSummary>('/rates-curves/build', body).then((r) => r.data);

export interface CurveLibSummary {
  slug: string; name: string; vintage?: string | null; asset_class?: string | null;
  description?: string; specified: string[]; modified?: string; corrupt?: boolean;
}
export const listCurveLibs = () =>
  client.get<CurveLibSummary[]>('/curves-libs').then((r) => r.data);
export const getCurveLib = (slug: string) =>
  client
    .get<CurveLibSummary & { curves: Record<string, number[]> }>(`/curves-libs/${slug}`)
    .then((r) => r.data);
export const deleteCurveLib = (slug: string) =>
  client.delete(`/curves-libs/${slug}`).then(() => undefined);
export const saveCurveLibFromRepline = (body: Record<string, unknown>) =>
  client.post<CurveLibSummary>('/curves-libs/from-repline', body).then((r) => r.data);

export const listDealTemplates = () =>
  client
    .get<{ key: string; label: string; description: string }[]>('/deal-templates')
    .then((r) => r.data);
export const getDealTemplate = (key: string) =>
  client.get<DealDoc>(`/deal-templates/${key}`).then((r) => r.data);

export const importConfig = (path: string, name?: string, overwrite = false) =>
  client
    .post<DealDoc>('/deals/import-config', { path, name, overwrite })
    .then((r) => r.data);

export interface WhatIfResult {
  boundary_month: number;
  scenario: string;
  forward: Record<string, unknown>[];
  series: { months: number[]; tranches: Record<string, (number | null)[]> };
}
export const forwardWhatIf = (runId: string, body: { month: number; scenario: string | null }) =>
  client.post<WhatIfResult>(`/runs/${runId}/analysis/forward-whatif`, body).then((r) => r.data);

// ── monitor ───────────────────────────────────────────────────────────────
type Rec = Record<string, unknown>;
const post = <T,>(url: string, body: Rec) => client.post<T>(url, body).then((r) => r.data);

export const getCovenantSchema = () =>
  client
    .get<{ factories: Rec[]; common: Rec[] }>('/schema/covenants')
    .then((r) => r.data);
export const monitorOverview = (slug: string, doc: DealDoc) =>
  post<{ status: Rec; bond_status: TableData; realized: Rec | null }>(
    `/deals/${slug}/monitor/overview`, { doc });
export const monitorCovenants = (slug: string, doc: DealDoc) =>
  post<{ summary: TableData; details: Record<string, TableData>; all_clear: boolean }>(
    `/deals/${slug}/monitor/covenants`, { doc });
export const monitorSurveillance = (slug: string, doc: DealDoc) =>
  post<{ flags: TableData; summary: TableData; all_clear: boolean }>(
    `/deals/${slug}/monitor/surveillance`, { doc });
export const monitorBondRedline = (slug: string, doc: DealDoc) =>
  post<{ summary: TableData; details: Record<string, TableData> }>(
    `/deals/${slug}/monitor/bond-redline`, { doc });
export const monitorTrancheSeries = (slug: string, doc: DealDoc) =>
  post<{ boundary_month: number; tranches: string[]; series: TableData; realized: TableData; forward: TableData }>(
    `/deals/${slug}/monitor/tranche-series`, { doc });
export const monitorPerformanceSeries = (slug: string, doc: DealDoc) =>
  post<{ boundary_month: number; rows: Rec[]; dollars: Record<string, TableData> }>(
    `/deals/${slug}/monitor/performance-series`, { doc });
export const monitorPnl = (slug: string, doc: DealDoc, spreads: number | Record<string, number>, freq: string, useBook = false) =>
  post<{ freq: string; statements: Record<string, { rollforward: TableData; summary: Rec; price_series: TableData }>; book_used?: string[] }>(
    `/deals/${slug}/monitor/pnl`, { doc, spreads, freq, use_book: useBook });
export const closeMonth = (slug: string, body: Rec) =>
  post<Rec>(`/deals/${slug}/close`, body);
export const listCloses = (slug: string) =>
  client.get<{ history: TableData }>(`/deals/${slug}/closes`).then((r) => r.data.history);
export const closeDrift = (slug: string, month: number) =>
  post<{ clean: boolean; rows: TableData }>(`/deals/${slug}/closes/${month}/drift`, {});
export const submitSensitivitiesJob = (slug: string, body: Rec) =>
  post<JobStatus>(`/deals/${slug}/jobs/sensitivities`, body);
export const submitTrancheMcJob = (slug: string, body: Rec) =>
  post<JobStatus>(`/deals/${slug}/jobs/tranche-mc`, body);
export const getReinvestmentSeries = (runId: string) =>
  client
    .get<{ months: number[]; spend: number[]; faces: number[] | null; info: Rec }>(
      `/runs/${runId}/reinvestment`)
    .then((r) => r.data);

// ── analysis ──────────────────────────────────────────────────────────────
export const getAnalysisTranches = (runId: string) =>
  client
    .get<{ tranches: AnalysisTranche[]; scenario: string }>(`/runs/${runId}/analysis/tranches`)
    .then((r) => r.data);
export interface PriceRequest {
  tranche: string;
  method: PriceMethod;
  value?: number;
  nodes?: { date: string; rate: number }[];
  as_of_month?: number;
}
export const priceTranche = (runId: string, body: PriceRequest) =>
  client.post<TrancheMark>(`/runs/${runId}/analysis/price`, body).then((r) => r.data);
export const getYieldTable = (runId: string, tranche: string, prices?: string) =>
  client
    .get<TableData & { attrs: Record<string, unknown> }>(`/runs/${runId}/analysis/yield-table`, {
      params: { tranche, ...(prices ? { prices } : {}) },
    })
    .then((r) => r.data);
export const getPriceTable = (runId: string, tranche: string) =>
  client
    .get<TableData & { attrs: Record<string, unknown>; axis: string }>(
      `/runs/${runId}/analysis/price-table`,
      { params: { tranche } },
    )
    .then((r) => r.data);
export const getLoanPricing = (runId: string, spreadBps: number, price: number) =>
  client
    .get<{ rows: LoanPricingRow[] }>(`/runs/${runId}/analysis/loan-pricing`, {
      params: { spread_bps: spreadBps, price },
    })
    .then((r) => r.data.rows);
export const markDeal = (runId: string, body: { method: string; values: Record<string, number> | number; as_of_month?: number }) =>
  client
    .post<{ method: string; rows: TrancheMark[] }>(`/runs/${runId}/analysis/marks`, body)
    .then((r) => r.data);
export const submitBreakevenJob = (slug: string, body: Record<string, unknown>) =>
  client.post<JobStatus>(`/deals/${slug}/jobs/breakeven`, body).then((r) => r.data);

// ── portfolios ────────────────────────────────────────────────────────────
export const listPortfolios = () =>
  client.get<PortfolioSummary[]>('/portfolios').then((r) => r.data);
export const createPortfolio = (name: string) =>
  client.post<PortfolioDoc>('/portfolios', { name }).then((r) => r.data);
export const getPortfolio = (slug: string) =>
  client.get<PortfolioDoc>(`/portfolios/${slug}`).then((r) => r.data);
export const putPortfolio = (slug: string, doc: PortfolioDoc) =>
  client.put<PortfolioDoc>(`/portfolios/${slug}`, doc).then((r) => r.data);
export const deletePortfolio = (slug: string) =>
  client.delete(`/portfolios/${slug}`).then(() => undefined);
export const getPortfolioAnalytics = (slug: string) =>
  client.get<PortfolioAnalytics>(`/portfolios/${slug}/analytics`).then((r) => r.data);
export const getFmFinal = (slug: string) =>
  client
    .get<{ close_month: string; approved_at?: string; approved_by?: string;
           name?: string; analytics: PortfolioAnalytics;
           marks: Record<string, { tranches: Record<string, MarkNoteEntry> }> }>(
      `/portfolios/${slug}/fm-final`)
    .then((r) => r.data);

// ── artifacts: scenario runs + book closes ────────────────────────────────
export interface ScenarioRunSummary {
  name: string; slug: string; saved_at: string; notes?: string;
  stress: { scenario: string; custom_multipliers?: Record<string, number> | null;
            macro_scenario?: string | null };
  price: number; boundary_month: number | null;
}
export const saveScenarioRun = (slug: string, body: Rec) =>
  post<ScenarioRunSummary & { metrics: Rec }>(`/deals/${slug}/scenario-runs`, body);
export const listScenarioRuns = (slug: string) =>
  client
    .get<{ scenarios: ScenarioRunSummary[] }>(`/deals/${slug}/scenario-runs`)
    .then((r) => r.data.scenarios);
export const deleteScenarioRun = (slug: string, scenarioSlug: string) =>
  client.delete(`/deals/${slug}/scenario-runs/${scenarioSlug}`).then(() => undefined);

export interface BookCloseSummary {
  month: string; status: 'abf' | 'fm_approved'; created_at?: string;
  approved_at?: string | null; approved_by?: string | null; notes?: string;
  n_deals: number; n_skipped: number;
  changes: { replines: string[]; structure: string[]; marks: string[] };
  new_deals: string[]; has_changes: boolean;
}
export interface MarkNoteEntry {
  method?: string | null; schedule?: Record<string, number> | null;
  note?: string; value_at_boundary?: number | null;
}
export interface BookClose {
  month: string; status: 'abf' | 'fm_approved'; created_at?: string;
  approved_at?: string; approved_by?: string; notes?: string;
  deals: Record<string, { name?: string; boundary_month: number | null;
                          warnings: string[]; metrics: Record<string, Rec>;
                          doc: DealDoc }>;
  skipped: Record<string, string>;
  marks: Record<string, { tranches: Record<string, MarkNoteEntry> }>;
  portfolios: Record<string, { name?: string; positions: Rec[];
                               analytics: PortfolioAnalytics }>;
  engine_closes?: Record<string, string>;
}
export const createBookClose = (body: Rec) =>
  post<BookCloseSummary>('/book-closes', body);
export const listBookCloses = () =>
  client.get<{ closes: BookCloseSummary[] }>('/book-closes').then((r) => r.data.closes);
export const getBookClose = (month: string) =>
  client.get<BookClose>(`/book-closes/${month}`).then((r) => r.data);
export const approveBookClose = (month: string, body: Rec) =>
  post<BookCloseSummary & { engine_closes: Record<string, string> }>(
    `/book-closes/${month}/approve`, body);
export const deleteBookClose = (month: string, force = false) =>
  client.delete(`/book-closes/${month}`, { params: { force } }).then(() => undefined);

export interface DealSources {
  scenarios: ScenarioRunSummary[];
  book_closes: { month: string; status: 'abf' | 'fm_approved';
                 approved_at?: string | null; created_at?: string }[];
}
export const getDealSources = (slug: string) =>
  client.get<DealSources>(`/deals/${slug}/sources`).then((r) => r.data);
export const loadDealSource = (slug: string, kind: 'scenario' | 'book_close', ref: string) =>
  post<{ doc: DealDoc; origin: string }>(`/deals/${slug}/load-source`, { kind, ref });

// ── pensford crawler ──────────────────────────────────────────────────────
export interface PensfordStatus {
  enabled: boolean; running: boolean; interval_hours: number;
  last_attempt?: string | null; last_success?: string | null;
  last_error?: string | null; curve_slug: string; curve_exists: boolean;
  fetched_at?: string | null;
}
export const getPensfordStatus = () =>
  client.get<PensfordStatus>('/pensford/status').then((r) => r.data);
export const refreshPensford = () =>
  client.post<PensfordStatus>('/pensford/refresh').then((r) => r.data);

// ── jobs ──────────────────────────────────────────────────────────────────
export const submitMonteCarloJob = (slug: string, body: Record<string, unknown>) =>
  client.post<JobStatus>(`/deals/${slug}/jobs/monte-carlo`, body).then((r) => r.data);
export const submitStressMatrixJob = (slug: string, body: Record<string, unknown>) =>
  client.post<JobStatus>(`/deals/${slug}/jobs/stress-matrix`, body).then((r) => r.data);
export const listJobs = () => client.get<JobStatus[]>('/jobs').then((r) => r.data);
export const getJob = (jobId: string) => client.get<JobStatus>(`/jobs/${jobId}`).then((r) => r.data);
export const getJobResult = (jobId: string) =>
  client.get<Record<string, unknown>>(`/jobs/${jobId}/result`).then((r) => r.data);
export const cancelJob = (jobId: string) => client.delete(`/jobs/${jobId}`).then(() => undefined);

// ── exports ───────────────────────────────────────────────────────────────
export interface ExportRequest {
  format: 'xlsx' | 'csv' | 'json';
  artifact: string;
  folder?: string | null;
}
export const exportRun = (runId: string, body: ExportRequest) =>
  client
    .post<{ path: string; filename: string }>(`/runs/${runId}/export`, body)
    .then((r) => r.data);
export const exportJob = (jobId: string, body: ExportRequest) =>
  client
    .post<{ path: string; filename: string }>(`/jobs/${jobId}/export`, body)
    .then((r) => r.data);
export const listExports = (slug: string) =>
  client
    .get<{ filename: string; path: string; size: number; modified: string }[]>(
      `/deals/${slug}/exports`,
    )
    .then((r) => r.data);
