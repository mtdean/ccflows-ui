// TopBar: brand, open-deal name, tabs, save / base-JSON download-upload, clock.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Save, Upload } from 'lucide-react';
import { importDeal } from '../../lib/api';
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
