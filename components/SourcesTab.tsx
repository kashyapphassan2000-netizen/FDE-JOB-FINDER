'use client';
import { useCallback, useEffect, useState } from 'react';
import type { SourceHealth } from '@/lib/types';
import { ago, api } from './api';
import ExportButton from './ExportButton';

type Src = {
  id: string; name: string; group: string; keyless: boolean; envKeys: string[]; optionalEnv: string[]; configured: boolean;
  intervalMin: number; covers: string; docs: string; health: SourceHealth | null;
};
type Infra = { auth: boolean; authSecret: boolean; cronSecret: boolean; store: { ok: boolean; mode: string; error?: string }; blob: boolean; notify: { telegram: boolean; webhook: boolean } };

function Status({ s }: { s: Src }) {
  if (!s.configured) return <span className="badge b-skip">needs key</span>;
  const h = s.health;
  if (!h || !h.lastRun) return <span className="badge b-skip">not run yet</span>;
  if (!h.ok) return <span className="badge b-err">error</span>;
  if (h.error) return <span className="badge b-warn">partial</span>;
  return <span className="badge b-ok">OK</span>;
}

export default function SourcesTab({ toast, reload }: { toast: (s: string) => void; reload: () => void }) {
  const [d, setD] = useState<{ sources: Src[]; infra: Infra } | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => api('/api/sources').then(setD).catch((e) => toast(e.message)), [toast]);
  useEffect(() => { load(); }, [load]);

  async function runOne(id: string) {
    setBusy(id);
    try {
      const r = await api<{ health: Record<string, SourceHealth>; added: number }>('/api/refresh', { method: 'POST', body: JSON.stringify({ only: [id], force: true }) });
      const h = r.health[id];
      toast(h?.ok ? `${id}: ${h.count} fetched, ${h.relevant} relevant, ${r.added} new` : `${id} failed: ${h?.error || h?.skipped}`);
      await load();
      reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  if (!d) return <div className="panel muted">Loading…</div>;
  const i = d.infra;
  const Item = ({ ok, label, fix }: { ok: boolean; label: string; fix: string }) => (
    <div className="row small" style={{ marginBottom: 4 }}>
      <span className={`badge ${ok ? 'b-ok' : 'b-err'}`}>{ok ? '✓' : '✗'}</span> <b>{label}</b> {!ok && <span className="muted">— {fix}</span>}
    </div>
  );
  const groups = Array.from(new Set(d.sources.map((s) => s.group)));
  const okCount = d.sources.filter((s) => s.health?.ok).length;

  return (
    <>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Platform checklist</h3>
        <Item ok={i.auth} label="APP_PASSWORD" fix="set in Vercel → Settings → Environment Variables" />
        <Item ok={i.authSecret} label="AUTH_SECRET" fix="random 64-char string (falls back to APP_PASSWORD if missing)" />
        <Item ok={i.cronSecret} label="CRON_SECRET" fix="needed for the daily Vercel cron + 30-min GitHub Action" />
        <Item ok={i.store.ok} label={`Redis storage (${i.store.mode})`} fix={i.store.error || 'connect Upstash for Redis in Vercel → Storage'} />
        <Item ok={i.blob} label="Vercel Blob (private) for CV" fix="Vercel → Storage → Create → Blob → Private → connect" />
        <Item ok={i.notify.telegram || i.notify.webhook} label="Alerts (Telegram / webhook)" fix="optional: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID" />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <ExportButton title="Sources & APIs — health" subtitle={`${okCount}/${d.sources.length} sources healthy`} filename="sources-health"
          cols={[{ header: 'Source', get: (x: Src) => x.name, width: 120, link: (x) => x.docs }, { header: 'Group', get: (x) => x.group, width: 80 }, { header: 'Status', get: (x) => (!x.configured ? 'needs key' : !x.health?.lastRun ? 'not run yet' : x.health.ok ? (x.health.error ? 'partial' : 'OK') : 'error'), width: 55 },
            { header: 'Last run', get: (x) => (x.health?.lastRun ? new Date(x.health.lastRun).toLocaleString('en-IN') : ''), width: 90 }, { header: 'Fetched', get: (x) => x.health?.count ?? '', width: 45 }, { header: 'Relevant', get: (x) => x.health?.relevant ?? '', width: 45 },
            { header: 'Error', get: (x) => x.health?.error || '' }, { header: 'Covers', get: (x) => x.covers, width: 150 }]}
          rows={d.sources} />
      </div>
      <div className="muted small" style={{ marginBottom: 8 }}>
        {okCount}/{d.sources.length} sources healthy · keyless sources run on every refresh; key-based ones respect a cooldown so you stay inside free quotas.
      </div>
      {groups.map((g) => (
        <div key={g} style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '6px 0' }}>{g}</h3>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Source</th><th>Status</th><th>Last run</th><th>Fetched / relevant</th><th className="hide-sm">Needs</th><th></th></tr>
              </thead>
              <tbody>
                {d.sources.filter((s) => s.group === g).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <b>{s.name}</b> <span className="mono muted">{s.id}</span>
                      <div className="small muted">{s.covers}</div>
                      {s.health?.error && <div className="small" style={{ color: 'var(--err)' }}>{s.health.error}</div>}
                      {s.health?.skipped && <div className="small muted">{s.health.skipped}</div>}
                    </td>
                    <td><Status s={s} /></td>
                    <td className="small">{s.health?.lastRun ? `${ago(s.health.lastRun)} ago` : '—'}{s.health?.ms ? <div className="muted">{(s.health.ms / 1000).toFixed(1)}s</div> : null}{s.intervalMin ? <div className="muted">every {s.intervalMin}m</div> : null}</td>
                    <td className="small">{s.health ? `${s.health.count} / ${s.health.relevant}` : '—'}</td>
                    <td className="hide-sm small">
                      {s.keyless ? <span className="badge b-ok">no key</span> : s.envKeys.map((k) => <div key={k} className="mono">{k}</div>)}
                      {s.optionalEnv.map((k) => <div key={k} className="mono muted">{k} (optional)</div>)}
                      <a href={s.docs.startsWith('http') ? s.docs : undefined} target="_blank" rel="noreferrer noopener" className="small">{s.docs.startsWith('http') ? 'docs ↗' : s.docs}</a>
                    </td>
                    <td><button disabled={!!busy || !s.configured} onClick={() => runOne(s.id)}>{busy === s.id ? 'Running…' : 'Run now'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
