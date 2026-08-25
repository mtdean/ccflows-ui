// Run registry: results of engine runs for the open deal, keyed by scenario.
// Run results are ephemeral on the server (in-memory LRU) — the UI treats
// run_ids as re-runnable, and stamps each run with the draft hash it was run
// against so results views can flag "deal edited since run".

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { runDeal } from './api';
import { hashOf } from './utils';
import { useDealDraft } from './useDealDraft';
import type { DealDoc, RunSummary } from './types';

export interface RunRecord {
  scenario: string;
  summary: RunSummary;
  docHash: string;
  at: string;
}

interface RunsContextValue {
  runs: Record<string, RunRecord>; // keyed by scenario
  runScenario: (scenario: string, custom?: Record<string, number> | null) => Promise<RunSummary>;
  running: string | null; // scenario currently running
  runError: unknown;
  lastRun: RunRecord | null;
  currentHash: string | null;
  clear: () => void;
}

const RunsContext = createContext<RunsContextValue | null>(null);

/** The parts of the doc that affect run results (ui_state/meta excluded). */
export function runRelevantHash(doc: DealDoc): string {
  return hashOf({ run: doc.run, waterfall: doc.waterfall, rates: doc.rates });
}

export function RunsProvider({ children }: { children: ReactNode }) {
  const { slug, doc } = useDealDraft();
  const [runsBySlug, setRunsBySlug] = useState<Record<string, Record<string, RunRecord>>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [lastScenario, setLastScenario] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ scenario, custom }: { scenario: string; custom?: Record<string, number> | null }) =>
      runDeal(slug!, {
        scenario,
        custom_multipliers: custom ?? null,
        price: doc?.export.price ?? 100,
        doc: doc ?? undefined,
      }),
  });

  const runScenario = useCallback(
    async (scenario: string, custom?: Record<string, number> | null) => {
      if (!slug || !doc) throw new Error('No open deal');
      setRunning(scenario);
      try {
        const summary = await mutation.mutateAsync({ scenario, custom });
        const record: RunRecord = {
          scenario,
          summary,
          docHash: runRelevantHash(doc),
          at: new Date().toISOString(),
        };
        setRunsBySlug((prev) => ({
          ...prev,
          [slug]: { ...(prev[slug] ?? {}), [scenario]: record },
        }));
        setLastScenario(scenario);
        return summary;
      } finally {
        setRunning(null);
      }
    },
    [slug, doc, mutation],
  );

  const runs = useMemo(() => (slug ? runsBySlug[slug] ?? {} : {}), [slug, runsBySlug]);
  const lastRun = lastScenario ? runs[lastScenario] ?? null : null;
  const currentHash = doc ? runRelevantHash(doc) : null;

  const value = useMemo(
    () => ({
      runs,
      runScenario,
      running,
      runError: mutation.error,
      lastRun,
      currentHash,
      clear: () => slug && setRunsBySlug((prev) => ({ ...prev, [slug]: {} })),
    }),
    [runs, runScenario, running, mutation.error, lastRun, currentHash, slug],
  );

  return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>;
}

export function useRuns(): RunsContextValue {
  const ctx = useContext(RunsContext);
  if (!ctx) throw new Error('useRuns must be used inside RunsProvider');
  return ctx;
}
