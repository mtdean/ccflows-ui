// Deal workspace: list, create, open, duplicate, delete, upload.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FolderOpen, History, Plus, Trash2 } from 'lucide-react';
import {
  createDeal, deleteDeal, duplicateDeal, getDealSources, getDealTemplate, importConfig,
  listDealTemplates, listDeals, loadDealSource,
} from '../lib/api';
import WorkspaceLibraries from '../components/collateral/WorkspaceLibraries';
import { qk } from '../lib/queryKeys';
import { apiErrorMessage, downloadJson, fmtTime, money, num } from '../lib/utils';
import { useDealDraft } from '../lib/useDealDraft';
import type { DealSummary } from '../lib/types';
import DataTable from '../components/shared/DataTable';
import type { Column } from '../components/shared/DataTable';
import LoadingCursor from '../components/shared/LoadingCursor';
import Panel from '../components/shared/Panel';

function TemplatesMenu() {
  const [open, setOpen] = useState(false);
  const templates = useQuery({
    queryKey: ['dealTemplates'],
    queryFn: listDealTemplates,
    staleTime: Infinity,
    enabled: open,
  });
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn" type="button"
        title="Download a starter deal JSON to author your own and upload it"
        onClick={() => setOpen((o) => !o)}>
        TEMPLATES ▾
      </button>
      {open && (
        <div className="knob-menu" style={{ right: 0, left: 'auto', minWidth: 300 }}
          onMouseLeave={() => setOpen(false)}>
          <div className="knob-menu-group">DOWNLOAD A STARTER DEAL JSON</div>
          {(templates.data ?? []).map((t) => (
            <button key={t.key} className="knob-menu-item" type="button"
              onClick={async () => {
                setOpen(false);
                const doc = await getDealTemplate(t.key);
                downloadJson(doc, `${t.key}-template.deal.json`);
              }}>
              <span>{t.label}</span>
              <span className="item-doc">{t.description}</span>
            </button>
          ))}
          <div className="knob-menu-item dim" style={{ cursor: 'default', fontSize: 10 }}>
            Curve arrays may be any length (engine pads); authoring notes are in
            meta.notes. Edit the file, then upload it with the ⬆ button up top.
          </div>
        </div>
      )}
    </div>
  );
}

// Open a deal starting from a frozen artifact: an FM-approved close, an ABF
// close, or a named scenario — the "load a month, pick the file" flow.
function OpenFromMenu({ row }: { row: DealSummary }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { openDealWith } = useDealDraft();
  const sources = useQuery({
    queryKey: qk.dealSources(row.slug),
    queryFn: () => getDealSources(row.slug),
    enabled: open,
  });

  async function load(kind: 'scenario' | 'book_close', ref: string) {
    setOpen(false);
    try {
      const { doc, origin } = await loadDealSource(row.slug, kind, ref);
      openDealWith(row.slug, doc);
      navigate('/collateral');
      window.setTimeout(() => window.alert(
        `Loaded ${origin} as the working draft (unsaved). SAVE to adopt it, or edit for the new month.`), 50);
    } catch (err) {
      window.alert(apiErrorMessage(err, 'Load failed'));
    }
  }

  const closes = sources.data?.book_closes ?? [];
  const scens = sources.data?.scenarios ?? [];
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button className="btn" title="Open from a close or saved scenario"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <History size={12} />
      </button>
      {open && (
        <div className="knob-menu" style={{ right: 0, left: 'auto', minWidth: 280, zIndex: 30 }}
          onClick={(e) => e.stopPropagation()} onMouseLeave={() => setOpen(false)}>
          <div className="knob-menu-group">OPEN {row.name.toUpperCase()} FROM…</div>
          {sources.isLoading && <div className="knob-menu-item dim">loading…</div>}
          {closes.map((c) => (
            <button key={c.month} className="knob-menu-item"
              onClick={() => void load('book_close', c.month)}>
              <span style={{ color: c.status === 'fm_approved' ? 'var(--positive)' : 'var(--warning)' }}>
                {c.status === 'fm_approved' ? '■ FM CLOSE' : '□ ABF CLOSE'} {c.month}
              </span>
              <span className="item-doc">
                {c.status === 'fm_approved' ? `approved ${c.approved_at ?? ''}` : `built ${c.created_at ?? ''}`}
              </span>
            </button>
          ))}
          {scens.map((s) => (
            <button key={s.slug} className="knob-menu-item"
              onClick={() => void load('scenario', s.slug)}>
              <span style={{ color: 'var(--text-accent)' }}>◆ SCENARIO {s.name}</span>
              <span className="item-doc">
                {s.stress.scenario}{s.stress.macro_scenario ? ` + ${s.stress.macro_scenario}` : ''} · saved {s.saved_at?.slice(0, 10)}
              </span>
            </button>
          ))}
          {!sources.isLoading && closes.length === 0 && scens.length === 0 && (
            <div className="knob-menu-item dim" style={{ cursor: 'default' }}>
              no closes or saved scenarios yet
            </div>
          )}
        </div>
      )}
    </span>
  );
}

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
      key: 'status',
      header: 'STATUS',
      sortable: false,
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {r.tape_through ? (
            <span className="mono" title={`Remittance tape loaded through month ${r.tape_through} — runs splice actuals ahead of projections`}
              style={{ color: 'var(--positive)', border: '1px solid var(--positive)', padding: '0 4px', fontSize: 9 }}>
              TAPE m{r.tape_through}
            </span>
          ) : (
            <span className="mono dim" title="No actuals loaded — pure projection"
              style={{ border: '1px solid var(--border)', padding: '0 4px', fontSize: 9 }}>
              PROJECTION
            </span>
          )}
          {r.call_enabled && (
            <span className="mono" title="Call mechanics enabled"
              style={{ color: 'var(--warning)', border: '1px solid var(--warning)', padding: '0 4px', fontSize: 9 }}>
              CALL
            </span>
          )}
          {r.reinvest_enabled && (
            <span className="mono" title="Reinvestment period enabled"
              style={{ color: 'var(--text-accent)', border: '1px solid var(--text-accent)', padding: '0 4px', fontSize: 9 }}>
              REINVEST
            </span>
          )}
          {r.originations && (
            <span className="mono" title="Forward-flow origination schedule"
              style={{ color: 'var(--text-accent)', border: '1px solid var(--text-accent)', padding: '0 4px', fontSize: 9 }}>
              FWD FLOW
            </span>
          )}
          {r.uses_cgl && (
            <span className="mono" title="Losses modeled as CGL + loss timing"
              style={{ color: 'var(--warning)', border: '1px solid var(--warning)', padding: '0 4px', fontSize: 9 }}>
              CGL
            </span>
          )}
        </span>
      ),
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
          <OpenFromMenu row={r} />
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
            <TemplatesMenu />
            <button
              className="btn"
              type="button"
              title="Import an existing ccflows .run.json / .repline.json by file path"
              onClick={async () => {
                const path = window.prompt(
                  'Path to a ccflows config (.run.json / .repline.json):',
                  '/Users/td/ccflows/tests/fixtures/modular_json/base_case.run.json',
                );
                if (!path) return;
                try {
                  const doc = await importConfig(path);
                  queryClient.invalidateQueries({ queryKey: qk.deals });
                  openDeal(doc.meta.slug);
                  navigate('/collateral');
                } catch (err) {
                  setError(apiErrorMessage(err, 'Config import failed'));
                }
              }}
            >
              IMPORT CONFIG
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
      <WorkspaceLibraries />
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
