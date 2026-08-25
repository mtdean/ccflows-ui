// Debounced live validation of the current draft against POST /validate/deal.
// Exposes an error map keyed by dotted path ("run.replines.0.upb") so each
// field row can subscribe to its own messages.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { validateDeal } from './api';
import { qk } from './queryKeys';
import { hashOf } from './utils';
import { useDealDraft } from './useDealDraft';
import type { ApiFieldError, ValidationResult } from './types';

export function pathKey(loc: (string | number)[]): string {
  return loc.join('.');
}

export interface DealValidation {
  result: ValidationResult | null;
  errorMap: Map<string, ApiFieldError[]>;
  errorCount: number;
  warnings: string[];
  lint: string[];
  /** Errors at or under the given path prefix. */
  errorsAt: (prefix: (string | number)[]) => ApiFieldError[];
}

export function useDealValidation(): DealValidation {
  const { doc, slug } = useDealDraft();
  const [debouncedHash, setDebouncedHash] = useState<string | null>(null);
  const hash = doc ? hashOf({ run: doc.run, waterfall: doc.waterfall, rates: doc.rates }) : null;

  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => setDebouncedHash(hash), 600);
    return () => clearTimeout(t);
  }, [hash]);

  const query = useQuery({
    queryKey: slug && debouncedHash ? qk.validation(slug, debouncedHash) : ['validation', 'none'],
    queryFn: () => validateDeal(doc!),
    enabled: doc != null && debouncedHash != null && debouncedHash === hash,
    staleTime: Infinity,
    retry: false,
  });

  return useMemo(() => {
    const result = query.data ?? null;
    const errorMap = new Map<string, ApiFieldError[]>();
    for (const err of result?.errors ?? []) {
      const key = pathKey(err.loc);
      const list = errorMap.get(key) ?? [];
      list.push(err);
      errorMap.set(key, list);
    }
    return {
      result,
      errorMap,
      errorCount: result?.errors.length ?? 0,
      warnings: result?.warnings ?? [],
      lint: result?.lint ?? [],
      errorsAt: (prefix) => {
        const p = pathKey(prefix);
        return (result?.errors ?? []).filter(
          (e) => pathKey(e.loc) === p || pathKey(e.loc).startsWith(p + '.'),
        );
      },
    };
  }, [query.data]);
}
