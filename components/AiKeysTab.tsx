'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

type Preset = { id: string; label: string; wire: 'anthropic' | 'openai'; baseUrl: string; keyUrl: string; free: string; keyless?: boolean; local?: boolean };
type Profile = { id: string; preset: string; label: string; wire: 'anthropic' | 'openai'; baseUrl: string; model: string; enabled: boolean; keyHint: string; fromEnv?: boolean };
type VKey = { name: string; label: string; group: string; url: string; source: 'env' | 'vault' | null; hint: string };

type Form = { id: string; preset: string; label: string; wire: 'anthropic' | 'openai'; baseUrl: string; model: string; apiKey: string };
const EMPTY: Form = { id: '', preset: 'gemini', label: '', wire: 'openai', baseUrl: '', model: '', apiKey: '' };

export default function AiKeysTab({ toast }: { toast: (s: string) => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [keys, setKeys] = useState<VKey[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const a = await api<{ profiles: Profile[]; presets: Preset[] }>('/api/ai/profiles');
      setProfiles(a.profiles);
      setPresets(a.presets);
      const v = await api<{ keys: VKey[] }>('/api/vault');
      setKeys(v.keys);
    } catch (e) {
      toast((e as Error).message);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const preset = presets.find((p) => p.id === form.preset);
  function pickPreset(id: string) {
    const p = presets.find((x) => x.id === id);
    setForm({ ...form, preset: id, label: p && !id.startsWith('custom') ? p.label : form.label, wire: p?.wire || 'openai', baseUrl: p?.baseUrl || '' });
    setModels([]);
  }
  async function loadModels() {
    setBusy('models');
    try {
      const r = await api<{ models: string[] }>('/api/ai/models', { method: 'POST', body: JSON.stringify(form.id && !form.apiKey ? { id: form.id } : { preset: form.preset, baseUrl: form.baseUrl || preset?.baseUrl, wire: form.wire, apiKey: form.apiKey }) });
      setModels(r.models);
      toast(`${r.models.length} models available`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function save() {
    setBusy('save');
    try {
      const r = await api<{ profiles: Profile[] }>('/api/ai/profiles', { method: 'POST', body: JSON.stringify({ ...form, id: form.id || undefined, baseUrl: form.baseUrl || preset?.baseUrl }) });
      setProfiles(r.profiles);
      setForm(EMPTY);
      setModels([]);
      toast('Provider saved (key encrypted). Click Test.');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function test(id?: string) {
    setBusy(`test${id || ''}`);
    try {
      const r = await api<{ reply: string; provider: string; model: string; ms: number }>('/api/ai/test', { method: 'POST', body: JSON.stringify({ id }) });
      toast(`✓ ${r.provider} · ${r.model} answered "${r.reply}" in ${(r.ms / 1000).toFixed(1)}s`);
    } catch (e) {
      toast(`✗ ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }
  async function patch(method: 'PATCH' | 'DELETE', body: object) {
    const r = await api<{ profiles: Profile[] }>('/api/ai/profiles', { method, body: JSON.stringify(body) });
    setProfiles(r.profiles);
  }
  async function toggle(p: Profile) {
    const r = await api<{ profiles: Profile[] }>('/api/ai/profiles', { method: 'POST', body: JSON.stringify({ id: p.id, preset: p.preset, enabled: !p.enabled }) });
    setProfiles(r.profiles);
  }
  async function setKey(name: string, value: string | null) {
    try {
      const r = await api<{ keys: VKey[] }>('/api/vault', { method: 'POST', body: JSON.stringify({ name, value }) });
      setKeys(r.keys);
      setVals({ ...vals, [name]: '' });
      toast(value ? `${name} saved (encrypted)` : `${name} removed`);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const groups = Array.from(new Set(keys.map((k) => k.group)));
  return (
    <>
      <PriorityPanel profiles={profiles} toast={toast} />
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>AI providers (bring any model)</h3>
        <p className="small muted">Pick a provider or <b>any third party</b> (OpenAI- or Anthropic-compatible): who provides it, base URL, model, API key. Your <b>Primary</b> and <b>Secondary</b> (above) answer first; after them every provider here is the <b>default</b>, tried <b>top → bottom</b>; if one is rate-limited the next answers — stack several free tiers (Gemini + Groq + OpenRouter) for near-unlimited free use. Keys are AES-encrypted in your Redis and never shown again.</p>
        {profiles.length === 0 && <div className="notice warn small">No provider yet. Fastest free start: <b>Google Gemini</b> → get a key at aistudio.google.com/apikey → paste below → Save → Test.</div>}
        {profiles.map((p, i) => (
          <div key={p.id} className="card row" style={{ justifyContent: 'space-between' }}>
            <div>
              <b>{i + 1}. {p.label}</b> <span className="badge b-dom">{p.wire}</span> {p.enabled ? <span className="badge b-ok">on</span> : <span className="badge b-skip">off</span>}
              <div className="small muted mono">{p.baseUrl} · model: {p.model || 'auto'} · key {p.keyHint}</div>
            </div>
            <div className="row">
              <button className="small-btn" disabled={busy === `test${p.id}`} onClick={() => test(p.id)}>{busy === `test${p.id}` ? '…' : 'Test'}</button>
              {!p.fromEnv && <>
                <button className="small-btn" onClick={() => patch('PATCH', { id: p.id, dir: -1 })}>↑</button>
                <button className="small-btn" onClick={() => patch('PATCH', { id: p.id, dir: 1 })}>↓</button>
                <button className="small-btn" onClick={() => toggle(p)}>{p.enabled ? 'Disable' : 'Enable'}</button>
                <button className="small-btn" onClick={() => { setForm({ id: p.id, preset: p.preset, label: p.label, wire: p.wire, baseUrl: p.baseUrl, model: p.model, apiKey: '' }); setModels([]); }}>Edit</button>
                <button className="small-btn danger" onClick={() => confirm(`Delete ${p.label}?`) && patch('DELETE', { id: p.id })}>Delete</button>
              </>}
              {p.fromEnv && <span className="small muted">from Vercel env</span>}
            </div>
          </div>
        ))}
        {profiles.length > 0 && <button disabled={busy === 'test'} onClick={() => test()}>Test the whole chain</button>}

        <h4>{form.id ? 'Edit provider' : 'Add provider'}</h4>
        <div className="grid2">
          <label className="small">Provider<br />
            <select value={form.preset} onChange={(e) => pickPreset(e.target.value)} style={{ width: '100%' }}>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {preset?.local && <div className="notice warn" style={{ margin: '4px 0' }}>Local LLM: run the app on your PC (<code>npm run dev</code>, see README “Run on localhost”) and start {preset.label.split(' (')[0]} first. The cloud site cannot reach localhost — for that, expose the LLM with an https tunnel and paste the tunnel URL as Base URL.</div>}
            {preset && <div className="muted">{preset.free}{preset.keyUrl && <> · <a href={preset.keyUrl} target="_blank" rel="noreferrer noopener">get key ↗</a></>}</div>}
          </label>
          <label className="small">Name (who is providing)<br /><input style={{ width: '100%' }} value={form.label} placeholder={preset?.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          <label className="small">Base URL<br /><input style={{ width: '100%' }} className="mono" value={form.baseUrl} placeholder={preset?.baseUrl || 'https://api.your-provider.com/v1'} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></label>
          <label className="small">API format<br />
            <select value={form.wire} onChange={(e) => setForm({ ...form, wire: e.target.value as 'openai' | 'anthropic' })} style={{ width: '100%' }}>
              <option value="openai">OpenAI-compatible (/chat/completions)</option><option value="anthropic">Anthropic-compatible (/v1/messages)</option>
            </select>
          </label>
          <label className="small">API key {form.id ? <span className="muted">(leave empty to keep current)</span> : preset?.keyless ? <span className="muted">(not needed)</span> : null}<br /><input style={{ width: '100%' }} type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></label>
          <label className="small">Model <span className="muted">(empty = auto-pick)</span><br />
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="mono" style={{ flex: 1 }} list="models" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="e.g. gemini-flash-latest" />
              <button className="small-btn" disabled={busy === 'models'} onClick={loadModels}>{busy === 'models' ? '…' : 'Load models'}</button>
            </div>
            <datalist id="models">{models.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={busy === 'save' || (!form.apiKey && !form.id && !preset?.keyless)} onClick={save}>{form.id ? 'Update' : 'Save provider'}</button>
          {form.id && <button onClick={() => { setForm(EMPTY); setModels([]); }}>Cancel</button>}
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>API keys vault</h3>
        <p className="small muted">Paste or replace any key here — no redeploy needed. A key set in Vercel env vars always wins. Values are encrypted with your AUTH_SECRET; only the last 4 characters are ever shown.</p>
        {groups.map((g) => (
          <div key={g} style={{ marginBottom: 12 }}>
            <h4 style={{ margin: '8px 0' }}>{g}</h4>
            <div className="tablewrap">
              <table>
                <tbody>
                  {keys.filter((k) => k.group === g).map((k) => (
                    <tr key={k.name}>
                      <td><b>{k.label}</b><div className="mono muted">{k.name}</div></td>
                      <td className="small">{k.source ? <span className="badge b-ok">{k.hint}</span> : <span className="badge b-skip">not set</span>}</td>
                      <td>
                        {k.source !== 'env' && (
                          <div className="row" style={{ flexWrap: 'nowrap' }}>
                            <input type={k.name.endsWith('_URL') || k.name.endsWith('_ID') ? 'text' : 'password'} placeholder={k.source ? 'replace…' : 'paste key…'} value={vals[k.name] || ''} onChange={(e) => setVals({ ...vals, [k.name]: e.target.value })} />
                            <button className="small-btn" disabled={!vals[k.name]} onClick={() => setKey(k.name, vals[k.name])}>Save</button>
                            {k.source === 'vault' && <button className="small-btn danger" onClick={() => setKey(k.name, null)}>Remove</button>}
                          </div>
                        )}
                      </td>
                      <td className="small"><a href={k.url} target="_blank" rel="noreferrer noopener">get ↗</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

type Pick = { profileId: string; model?: string } | null;
type Last = { at: string; provider: string; model: string; tier: string; tried: number } | null;
const TIER: Record<string, string> = { primary: '🥇 Primary', secondary: '🥈 Secondary', default: '🔁 Default rotation', pinned: '📌 Pinned' };

/** 🥇 Primary → 🥈 Secondary → 🔁 Default: you choose who answers first. */
function PriorityPanel({ profiles, toast }: { profiles: Profile[]; toast: (s: string) => void }) {
  const [pri, setPri] = useState<{ primary: Pick; secondary: Pick }>({ primary: null, secondary: null });
  const [last, setLast] = useState<Last>(null);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const usable = profiles.filter((p) => p.enabled);
  useEffect(() => {
    api<{ priority: { primary?: Pick; secondary?: Pick }; last: Last }>('/api/ai/priority')
      .then((r) => { setPri({ primary: r.priority.primary || null, secondary: r.priority.secondary || null }); setLast(r.last); })
      .catch(() => null);
  }, []);
  const loadModels = async (id: string) => {
    if (!id || models[id]) return;
    try { const r = await api<{ models: string[] }>('/api/ai/models', { method: 'POST', body: JSON.stringify({ id }) }); setModels((m) => ({ ...m, [id]: r.models })); }
    catch { setModels((m) => ({ ...m, [id]: [] })); }
  };
  useEffect(() => { if (pri.primary?.profileId) loadModels(pri.primary.profileId); if (pri.secondary?.profileId) loadModels(pri.secondary.profileId); }, [pri.primary?.profileId, pri.secondary?.profileId]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (next = pri) => {
    setBusy('save');
    try {
      const r = await api<{ priority: { primary?: Pick; secondary?: Pick } }>('/api/ai/priority', { method: 'POST', body: JSON.stringify(next) });
      setPri({ primary: r.priority.primary || null, secondary: r.priority.secondary || null });
      toast('AI priority saved — every AI feature now asks your Primary first');
    } catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  };
  const test = async () => {
    setBusy('test'); setResult('');
    try {
      const r = await api<{ reply: string; provider: string; model: string; tier?: string; ms: number; tried: string[] }>('/api/ai/test', { method: 'POST', body: JSON.stringify({}) });
      setResult(`✓ ${TIER[r.tier || 'default'] || r.tier} answered: ${r.provider} · ${r.model} in ${(r.ms / 1000).toFixed(1)} s${r.tried.length ? `\nSkipped first (not available): ${r.tried.join(' · ')}` : ''}`);
      setLast({ at: new Date().toISOString(), provider: r.provider, model: r.model, tier: r.tier || 'default', tried: r.tried.length });
    } catch (e) { setResult(`✗ ${(e as Error).message}`); } finally { setBusy(''); }
  };
  const row = (slot: 'primary' | 'secondary', title: string, hint: string) => {
    const v = pri[slot];
    const list = v?.profileId ? models[v.profileId] || [] : [];
    return (
      <div className="card" style={{ display: 'grid', gap: 6 }}>
        <b>{title}</b>
        <span className="small muted">{hint}</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select value={v?.profileId || ''} onChange={(e) => setPri({ ...pri, [slot]: e.target.value ? { profileId: e.target.value } : null })} style={{ minWidth: 220 }}>
            <option value="">— none (skip) —</option>
            {usable.map((p) => <option key={p.id} value={p.id}>{p.label}{p.fromEnv ? ' (env)' : ''}</option>)}
          </select>
          {v?.profileId && (
            <select value={v.model || ''} onChange={(e) => setPri({ ...pri, [slot]: { profileId: v.profileId, model: e.target.value || undefined } })} style={{ minWidth: 220, maxWidth: 360 }}>
              <option value="">auto — best model of this provider</option>
              {v.model && !list.includes(v.model) && <option value={v.model}>{v.model}</option>}
              {list.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {v?.profileId && !models[v.profileId] && <span className="small muted">loading models…</span>}
        </div>
      </div>
    );
  };
  const others = usable.filter((p) => p.id !== pri.primary?.profileId && p.id !== pri.secondary?.profileId);
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>🎚 Your AI priority</h3>
      <p className="small muted" style={{ marginTop: 0 }}>Every AI feature (agents, ranking, analyzer, mentor, outreach, board reader…) asks in this order. If your Primary is down, out of quota or too slow, the Secondary answers; if that fails too, the default rotation takes over automatically. A provider that fails twice in a row rests 3 minutes and is retried on its own.</p>
      {row('primary', '🥇 1 · Primary', 'Used first, always.')}
      {row('secondary', '🥈 2 · Secondary', 'Used only when the Primary is not available.')}
      <div className="card small"><b>🔁 3 · Default</b> <span className="muted">— everything else, top → bottom from the list below:</span> {others.length ? others.map((p) => p.label).join(' → ') : <span className="muted">no other providers</span>}</div>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="primary" disabled={busy === 'save'} onClick={() => save()}>{busy === 'save' ? 'Saving…' : 'Save priority'}</button>
        <button disabled={busy === 'test'} onClick={test}>{busy === 'test' ? 'Testing…' : 'Test the order now'}</button>
        <button className="small-btn" onClick={() => { const n = { primary: null, secondary: null }; setPri(n); save(n); }}>Reset to default</button>
      </div>
      {result && <div className={`notice small ${result.startsWith('✓') ? '' : 'err'}`} style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{result}</div>}
      {last && <div className="small muted" style={{ marginTop: 6 }}>Last answer: {TIER[last.tier] || last.tier} · {last.provider} · <span className="mono">{last.model}</span>{last.tried ? ` (after ${last.tried} unavailable)` : ''} · {new Date(last.at).toLocaleString()}</div>}
    </div>
  );
}
