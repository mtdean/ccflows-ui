// Deal workspace: list, create, open, duplicate, delete, upload.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { createDeal, deleteDeal, duplicateDeal, listDeals } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { apiErrorMessage, fmtTime, money, num } from '../lib/utils';
import { useDealDraft } from '../lib/useDealDraft';
import type { DealSummary } from '../lib/types';
import DataTable from '../components/shared/DataTable';
import type { Column } from '../components/shared/DataTable';
import LoadingCursor from '../components/shared/LoadingCursor';
import Panel from '../components/shared/Panel';

export default function DealsPage() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { slug: openSlug, openDeal } = useDealDraft();

  const deals = useQuery({ queryKey: qk.deals, queryFn: listDeals });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.deals });

  const create = useMutation({
    mutationFn: (dealName: string) => createDeal(dealName),
    onSuccess: (doc) => {
      invalidate();
      setName('');
      openDeal(doc.meta.slug);
      navigate('/collateral');
    },
    onError: (err) => setError(apiErrorMessage(err, 'Create failed')),
  });

  const remove = useMutation({
    mutationFn: (slug: string) => deleteDeal(slug),
    onSuccess: (_data, slug) => {
      invalidate();
      if (openSlug === slug) openDeal(null);
    },
    onError: (err) => setError(apiErrorMessage(err, 'Delete failed')),
  });

  const duplicate = useMutation({
    mutationFn: ({ slug, newName }: { slug: string; newName: string }) =>
      duplicateDeal(slug, newName),
    onSuccess: () => invalidate(),
    onError: (err) => setError(apiErrorMessage(err, 'Duplicate failed')),
  });

  function open(row: DealSummary) {
    openDeal(row.slug);
    navigate('/collateral');
  }

  const columns: Column<DealSummary>[] = [
    {
      key: 'name',
      header: 'DEAL',
      render: (r) => (
        <span style={{ color: 'var(--text-accent)' }}>
          {r.name}
          {r.slug === openSlug && <span className="dim"> · OPEN</span>}
          {r.corrupt && <span className="neg"> · CORRUPT</span>}
        </span>
      ),
      sortValue: (r) => r.name,
    },
    {
      key: 'total_upb',
      header: 'POOL UPB',
      align: 'right',
      render: (r) => <span className="num mono">{money(r.total_upb)}</span>,
      sortValue: (r) => r.total_upb,
    },
    {
      key: 'n_replines',
      header: 'REPLINES',
      align: 'right',
      render: (r) => <span className="num mono">{num(r.n_replines)}</span>,
      sortValue: (r) => r.n_replines,
    },
    {
      key: 'n_bonds',
      header: 'BONDS',
      align: 'right',
      render: (r) => <span className="num mono">{num(r.n_bonds)}</span>,
      sortValue: (r) => r.n_bonds,
    },
    {
      key: 'modified',
      header: 'MODIFIED',
      align: 'right',
      render: (r) => (
        <span className="num mono dim">
          {r.modified ? `${r.modified.slice(0, 10)} ${fmtTime(r.modified)}` : '—'}
        </span>
      ),
      sortValue: (r) => r.modified,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      sortable: false,
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <button className="btn" title="Open" onClick={(e) => { e.stopPropagation(); open(r); }}>
            <FolderOpen size={12} />
          </button>
          <button
            className="btn"
            title="Duplicate"
            onClick={(e) => {
              e.stopPropagation();
              const newName = window.prompt('Name for the copy:', `${r.name} Copy`);
              if (newName) duplicate.mutate({ slug: r.slug, newName });
            }}
          >
            <Copy size={12} />
          </button>
          <button
            className="btn"
            title="Delete"
            style={{ color: 'var(--warning)' }}
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Delete deal "${r.name}"? This removes its file from the workspace.`)) {
                remove.mutate(r.slug);
              }
            }}
          >
            <Trash2 size={12} />
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="stack">
      <Panel
        title="DEALS"
        subtitle={deals.data ? `${deals.data.length} in workspace` : undefined}
        actions={
          <form
            style={{ display: 'flex', gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate(name.trim());
            }}
          >
            <input
              className="input"
              style={{ width: 200 }}
              placeholder="new deal name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn" type="submit" disabled={!name.trim() || create.isPending}>
              <Plus size={12} /> NEW DEAL
            </button>
          </form>
        }
      >
        {error && <div className="field-error-msg" style={{ textAlign: 'left' }}>{error}</div>}
        {deals.isLoading ? (
          <LoadingCursor />
        ) : (
          <DataTable
            columns={columns}
            rows={deals.data ?? []}
            rowKey={(r) => r.slug}
            initialSort="modified"
            emptyMessage="NO DEALS — CREATE ONE OR UPLOAD A BASE JSON"
            onRowClick={open}
          />
        )}
      </Panel>
      <Panel title="ABOUT">
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
          Build a collateral pool from repline cards, structure the liabilities as a bond stack
          with an ordered payment waterfall (tests and triggers included), then run base, stress,
          and Monte Carlo scenarios. Everything lives in one base JSON per deal — download it,
          share it, upload it later. Exports land in the exports folder with standardized names.
        </div>
      </Panel>
    </div>
  );
}
