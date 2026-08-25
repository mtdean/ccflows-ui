// Debounced monitor queries: each view re-fetches when the run-relevant parts
// of the draft change, keyed by a content hash.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { qk } from './queryKeys';
import { hashOf } from './utils';
import { useDealDraft } from './useDealDraft';
import type { DealDoc } from './types';

export function useMonitorHash(): string | null {
  const { doc } = useDealDraft();
  const hash = doc
    ? hashOf({ run: doc.run, waterfall: doc.waterfall, rates: doc.rates,
               actuals: doc.actuals, covenants: doc.covenants })
    : null;
  const [debounced, setDebounced] = useState<string | null>(null);
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => setDebounced(hash), 500);
    return () => clearTimeout(t);
  }, [hash]);
  return debounced === hash ? debounced : null;
}

export function useMonitorQuery<T>(
  view: string,
  fetcher: (slug: string, doc: DealDoc) => Promise<T>,
  enabled = true,
): UseQueryResult<T> {
  const { slug, doc } = useDealDraft();
  const hash = useMonitorHash();
  return useQuery({
    queryKey: slug && hash ? qk.monitor(slug, view, hash) : ['monitor', 'none', view],
    queryFn: () => fetcher(slug!, doc!),
    enabled: enabled && slug != null && doc != null && hash != null,
    staleTime: Infinity,
    retry: false,
  });
}

export function hasActuals(doc: DealDoc | null): boolean {
  return Boolean(doc?.actuals?.collateral?.length || doc?.actuals?.bonds?.length);
}
