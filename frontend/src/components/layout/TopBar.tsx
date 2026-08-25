// TopBar: brand, open-deal name, tabs, save / base-JSON download-upload, clock.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FolderCog, Plus, Save, Upload } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { addWorkspace, importDeal, listWorkspaces, switchWorkspace } from '../../lib/api';
import { apiErrorMessage, downloadJson } from '../../lib/utils';
import { useDealDraft } from '../../lib/useDealDraft';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '../../lib/queryKeys';
import RunLauncher from './RunLauncher';
import TabNav from './TabNav';

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="mono dim" style={{ fontSize: 11 }}>
      {now.toLocaleTimeString('en-US', { hour12: false })}
    </span>
  );
}

// Deal-folder switcher: repoints the whole app at another workspace (each
// book is a folder of deal/portfolio/mark/close JSONs). Disabled when
// CCFLOWS_WORKSPACE pins the folder from the environment.
function WorkspaceMenu({ dirty, onSwitched }: { dirty: boolean; onSwitched: () => void }) {
  const [open, setOpen] = useState(false);
  const ws = useQuery({ queryKey: qk.workspaces, queryFn: listWorkspaces, enabled: open });

  const doSwitch = useMutation({
    mutationFn: (path: string) => switchWorkspace(path),
    onSuccess: () => {
      setOpen(false);
      onSwitched();
    },
    onError: (err) => window.alert(apiErrorMessage(err, 'Switch failed')),
  });

  const active = ws.data?.known.find((k) => k.active);
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn" title="Switch deal folder (workspace)"
        onClick={() => setOpen((o) => !o)}>
        <FolderCog size={12} />{active ? ` ${active.name.toUpperCase()}` : ''}
      </button>
      {open && (
        <div className="knob-menu" style={{ right: 0, left: 'auto', minWidth: 320, zIndex: 40 }}
          onMouseLeave={() => setOpen(false)}>
          <div className="knob-menu-group">
            DEAL FOLDER{ws.data?.pinned ? ' — PINNED BY CCFLOWS_WORKSPACE' : ''}
          </div>
          {(ws.data?.known ?? []).map((k) => (
            <button key={k.path} className="knob-menu-item"
              disabled={ws.data?.pinned || doSwitch.isPending}
              onClick={() => {
                if (k.active) { setOpen(false); return; }
                if (dirty && !window.confirm('Discard unsaved deal changes and switch folder?')) return;
                doSwitch.mutate(k.path);
              }}>
              <span style={{ color: k.active ? 'var(--positive)' : undefined }}>
                {k.active ? '■ ' : ''}{k.name}
                {!k.exists && <span className="dim"> (new)</span>}
              </span>
              <span className="item-doc">{k.path} · {k.n_deals} deal{k.n_deals === 1 ? '' : 's'}</span>
            </button>
          ))}
          {!ws.data?.pinned && (
            <button className="knob-menu-item"
              onClick={async () => {
                const path = window.prompt('Folder path for the new/existing book:',
                  '~/ccflows-books/');
                if (!path?.trim()) return;
                try {
                  await addWorkspace(path.trim());
                  if (window.confirm('Added. Switch to it now?')) doSwitch.mutate(path.trim());
                  else setOpen(false);
                } catch (err) {
                  window.alert(apiErrorMessage(err, 'Add failed'));
                }
              }}>
              <span><Plus size={10} /> ADD FOLDER…</span>
              <span className="item-doc">subfolders are created automatically on switch</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TopBar() {
  const { slug, doc, dirty, save, saving, openDeal } = useDealDraft();
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function onUpload(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (dirty && !window.confirm('Discard unsaved changes and load the uploaded deal?')) return;
      let saved;
      try {
        saved = await importDeal(parsed);
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 409 && window.confirm('A deal with this name exists. Overwrite it?')) {
          saved = await importDeal(parsed, true);
        } else {
          throw err;
        }
      }
      queryClient.invalidateQueries({ queryKey: qk.deals });
      queryClient.invalidateQueries({ queryKey: qk.deal(saved.meta.slug) });
      openDeal(saved.meta.slug);
      navigate('/collateral');
    } catch (err) {
      window.alert(apiErrorMessage(err, 'Upload failed'));
    }
  }

  return (
    <header className="topbar">
      <span className="topbar-title">&lt;CCFLOWS&gt;</span>
      {slug && (
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {doc?.meta.name ?? slug}
          {dirty && <span style={{ color: 'var(--warning)' }}> ●</span>}
        </span>
      )}
      <TabNav />
      <span className="topbar-spacer" />
      <div className="topbar-meta" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <WorkspaceMenu
          dirty={dirty}
          onSwitched={() => {
            openDeal(null);          // the open deal belongs to the old book
            queryClient.clear();     // every cached query is another book's data
            navigate('/');
          }}
        />
        {slug && (
          <>
            <RunLauncher />
            <button className="btn" onClick={save} disabled={!dirty || saving} title="Save deal">
              <Save size={12} /> {saving ? 'SAVING' : 'SAVE'}
            </button>
            <button
              className="btn"
              title="Download base JSON"
              onClick={() => doc && downloadJson(doc, `${doc.meta.slug}.deal.json`)}
            >
              <Download size={12} /> JSON
            </button>
          </>
        )}
        <button className="btn" title="Upload base JSON" onClick={() => fileRef.current?.click()}>
          <Upload size={12} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onUpload(f);
          }}
        />
        <Clock />
      </div>
    </header>
  );
}
