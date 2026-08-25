// Centralized React Query cache keys — one registry so invalidation stays sane.

export const qk = {
  health: ['health'] as const,
  deals: ['deals'] as const,
  deal: (slug: string) => ['deal', slug] as const,
  schemaReplines: ['schema', 'replines'] as const,
  schemaSteps: ['schema', 'steps'] as const,
  schemaTriggers: ['schema', 'triggers'] as const,
  schemaScenarios: ['schema', 'scenarios'] as const,
  schemaSamplers: ['schema', 'samplers'] as const,
  schemaCollateral: ['schema', 'collateral'] as const,
  validation: (slug: string, hash: string) => ['validation', slug, hash] as const,
  mermaid: (hash: string) => ['mermaid', hash] as const,
  waterfallCheck: (hash: string) => ['wfcheck', hash] as const,
  run: (slug: string, scenario: string) => ['run', slug, scenario] as const,
  runData: (runId: string, view: string, ...rest: (string | number)[]) =>
    ['runData', runId, view, ...rest] as const,
  jobs: ['jobs'] as const,
  job: (jobId: string) => ['job', jobId] as const,
  jobResult: (jobId: string) => ['jobResult', jobId] as const,
  exports: (slug: string) => ['exports', slug] as const,
  analysis: (runId: string, view: string, ...rest: (string | number)[]) =>
    ['analysis', runId, view, ...rest] as const,
  portfolios: ['portfolios'] as const,
  portfolio: (slug: string) => ['portfolio', slug] as const,
  portfolioAnalytics: (slug: string) => ['portfolioAnalytics', slug] as const,
  monitor: (slug: string, view: string, hash: string) => ['monitor', slug, view, hash] as const,
  closes: (slug: string) => ['closes', slug] as const,
  schemaCovenants: ['schema', 'covenants'] as const,
};
