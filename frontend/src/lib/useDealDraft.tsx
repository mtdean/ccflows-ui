// The deal draft store: one open deal document, edited locally, saved explicitly.
//
// - `slug` (persisted to localStorage) selects the open deal; the saved doc is
//   fetched via React Query and resets the draft.
// - Editors call `update(mutator)`: the doc is structuredClone'd, mutated, and
//   set — cheap at this data size, keeps immutability without a reducer forest.
// - `dirty` compares against the last saved snapshot; the draft is mirrored to
//   localStorage as crash insurance and restored (with a prompt) on reopen.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getDeal, putDeal } from './api';
import { qk } from './queryKeys';
import type { DealDoc } from './types';

const SLUG_KEY = 'ccflows.openDeal';
const DRAFT_KEY = (slug: string) => `ccflows.draft.${slug}`;

interface DealDraftContextValue {
  slug: string | null;
  openDeal: (slug: string | null) => void;
  doc: DealDoc | null;
  loading: boolean;
  dirty: boolean;
  update: (mutator: (doc: DealDoc) => void) => void;
  replaceDoc: (doc: DealDoc) => void;
  save: () => void;
  saving: boolean;
  saveError: unknown;
  lastSaved: string | null;
}

const DealDraftContext = createContext<DealDraftContextValue | null>(null);

export function DealDraftProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState<string | null>(() => localStorage.getItem(SLUG_KEY));
  const [doc, setDoc] = useState<DealDoc | null>(null);
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const restoredFor = useRef<string | null>(null);

  const query = useQuery({
    queryKey: slug ? qk.deal(slug) : ['deal', 'none'],
    queryFn: () => getDeal(slug!),
    enabled: slug != null,
    staleTime: Infinity,
    retry: false,
  });

  // Server doc arrived (or changed): reset the draft, offering a crash-mirror
  // restore once per open.
  useEffect(() => {
    if (!slug || !query.data) return;
    let next = query.data;
    if (restoredFor.current !== slug) {
      restoredFor.current = slug;
      const mirror = localStorage.getItem(DRAFT_KEY(slug));
      if (mirror && mirror !== JSON.stringify(query.data)) {
        if (window.confirm('Restore unsaved draft for this deal from your last session?')) {
          try {
            next = JSON.parse(mirror);
          } catch {
            // corrupted mirror — fall through to the server doc
          }
        } else {
          localStorage.removeItem(DRAFT_KEY(slug));
        }
      }
    }
    setDoc(next);
    setSavedJson(JSON.stringify(query.data));
  }, [slug, query.data]);

  // Crash mirror (skip when clean so reopening doesn't prompt needlessly).
  useEffect(() => {
    if (!slug || !doc) return;
    const json = JSON.stringify(doc);
    if (json === savedJson) localStorage.removeItem(DRAFT_KEY(slug));
    else localStorage.setItem(DRAFT_KEY(slug), json);
  }, [slug, doc, savedJson]);

  const openDeal = useCallback((next: string | null) => {
    restoredFor.current = null;
    setDoc(null);
    setSavedJson(null);
    setSlug(next);
    if (next) localStorage.setItem(SLUG_KEY, next);
    else localStorage.removeItem(SLUG_KEY);
  }, []);

  const update = useCallback((mutator: (doc: DealDoc) => void) => {
    setDoc((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
  }, []);

  const saveMutation = useMutation({
    mutationFn: (toSave: DealDoc) => putDeal(toSave.meta.slug, toSave),
    onSuccess: (saved, toSave) => {
      setDoc(saved);
      setSavedJson(JSON.stringify(saved));
      setLastSaved(new Date().toISOString());
      localStorage.removeItem(DRAFT_KEY(toSave.meta.slug));
      queryClient.setQueryData(qk.deal(saved.meta.slug), saved);
      queryClient.invalidateQueries({ queryKey: qk.deals });
      if (saved.meta.slug !== toSave.meta.slug) openDeal(saved.meta.slug);
    },
  });

  const save = useCallback(() => {
    if (doc) saveMutation.mutate(doc);
  }, [doc, saveMutation]);

  const dirty = useMemo(
    () => doc != null && savedJson != null && JSON.stringify(doc) !== savedJson,
    [doc, savedJson],
  );

  const value = useMemo(
    () => ({
      slug,
      openDeal,
      doc,
      loading: slug != null && query.isLoading,
      dirty,
      update,
      replaceDoc: (d: DealDoc) => setDoc(d),
      save,
      saving: saveMutation.isPending,
      saveError: saveMutation.error,
      lastSaved,
    }),
    [slug, openDeal, doc, query.isLoading, dirty, update, save, saveMutation.isPending, saveMutation.error, lastSaved],
  );

  return <DealDraftContext.Provider value={value}>{children}</DealDraftContext.Provider>;
}

export function useDealDraft(): DealDraftContextValue {
  const ctx = useContext(DealDraftContext);
  if (!ctx) throw new Error('useDealDraft must be used inside DealDraftProvider');
  return ctx;
}
