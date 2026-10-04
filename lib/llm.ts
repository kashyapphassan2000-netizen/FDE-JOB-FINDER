import { decrypt, encrypt } from './secrets';
import { getJSON, setJSON } from './store';

/**
 * Bring-your-own AI. Any provider works with two wire formats:
 *   - "anthropic"  : Anthropic Messages API (Claude, or any third party that speaks it)
 *   - "openai"     : OpenAI Chat Completions (OpenAI, Gemini, Groq, OpenRouter, DeepSeek, Mistral, Together,
 *                    Cerebras, xAI, NVIDIA, Fireworks, Ollama/LM Studio via tunnel, ANY third-party proxy)
 * Profiles are tried in order; if one hits a rate limit / error, the next one is used (free-tier stacking).
 */
export type Wire = 'anthropic' | 'openai';
export interface Preset { id: string; label: string; wire: Wire; baseUrl: string; keyUrl: string; free: string; prefer: RegExp[] }

export const PRESETS: Preset[] = [
  { id: 'gemini', label: 'Google Gemini', wire: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey', free: 'Free tier on Flash models (limits shown in AI Studio)', prefer: [/flash-latest/, /flash(?!.*(image|tts|live|audio))/] },
  { id: 'groq', label: 'Groq', wire: 'openai', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', free: 'Free: ~1,000 requests/day per model, 30/min', prefer: [/gpt-oss-120b/, /llama-3\.3-70b/, /qwen/] },
  { id: 'openrouter', label: 'OpenRouter (300+ models)', wire: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', free: '":free" models: 50 req/day (1,000/day after a one-time $10 top-up)', prefer: [/:free$/] },
  { id: 'anthropic', label: 'Anthropic Claude', wire: 'anthropic', baseUrl: 'https://api.anthropic.com', keyUrl: 'https://console.anthropic.com/settings/keys', free: 'Paid (pay as you go)', prefer: [/haiku/, /sonnet/] },
  { id: 'openai', label: 'OpenAI', wire: 'openai', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', free: 'Paid (pay as you go)', prefer: [/mini/, /^gpt-/] },
  { id: 'cerebras', label: 'Cerebras', wire: 'openai', baseUrl: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai/', free: 'Trial credits; very fast', prefer: [/gpt-oss/, /qwen/, /llama/] },
  { id: 'mistral', label: 'Mistral', wire: 'openai', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', free: 'Free plan monthly credits', prefer: [/small-latest/, /medium-latest/] },
  { id: 'deepseek', label: 'DeepSeek', wire: 'openai', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys', free: 'Very cheap paid', prefer: [/chat/] },
  { id: 'together', label: 'Together AI', wire: 'openai', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.ai/settings/api-keys', free: 'Paid; some free models', prefer: [/Free/, /Llama-3\.3-70B/] },
  { id: 'xai', label: 'xAI Grok', wire: 'openai', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai/', free: 'Paid', prefer: [/mini/, /grok/] },
  { id: 'nvidia', label: 'NVIDIA NIM (build.nvidia.com)', wire: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1', keyUrl: 'https://build.nvidia.com/', free: 'Free endpoints for testing (~40 req/min)', prefer: [/llama-3\.3-70b/, /nemotron/] },
  { id: 'custom-openai', label: 'Any third party (OpenAI-compatible)', wire: 'openai', baseUrl: '', keyUrl: '', free: 'Whatever your provider gives', prefer: [] },
  { id: 'custom-anthropic', label: 'Any third party (Anthropic-compatible)', wire: 'anthropic', baseUrl: '', keyUrl: '', free: 'Whatever your provider gives', prefer: [] },
];

export interface Profile {
  id: string;
  preset: string;
  label: string; // "who is providing"
  wire: Wire;
  baseUrl: string;
  model: string;
  key: string; // encrypted at rest
  enabled: boolean;
}
export type PublicProfile = Omit<Profile, 'key'> & { keyHint: string; fromEnv?: boolean };

const trimSlash = (u: string) => u.replace(/\/+$/, '');

/** Env-based profiles (optional): LLM_*, or plain ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY */
function envProfiles(): Profile[] {
  const out: Profile[] = [];
  if (process.env.LLM_API_KEY) {
    const p = PRESETS.find((x) => x.id === process.env.LLM_PROVIDER) || PRESETS.find((x) => x.id === 'custom-openai')!;
    out.push({ id: 'env-llm', preset: p.id, label: `${p.label} (env)`, wire: (process.env.LLM_WIRE as Wire) || p.wire, baseUrl: process.env.LLM_BASE_URL || p.baseUrl, model: process.env.LLM_MODEL || '', key: process.env.LLM_API_KEY, enabled: true });
  }
  const simple: [string, string][] = [['GEMINI_API_KEY', 'gemini'], ['GROQ_API_KEY', 'groq'], ['OPENROUTER_API_KEY', 'openrouter'], ['ANTHROPIC_API_KEY', 'anthropic'], ['OPENAI_API_KEY', 'openai']];
  for (const [envName, pid] of simple) {
    if (!process.env[envName]) continue;
    const p = PRESETS.find((x) => x.id === pid)!;
    out.push({ id: `env-${pid}`, preset: pid, label: `${p.label} (env)`, wire: p.wire, baseUrl: p.baseUrl, model: process.env[`${envName.replace('_API_KEY', '')}_MODEL`] || '', key: process.env[envName]!, enabled: true });
  }
  return out;
}

async function storedProfiles(): Promise<Profile[]> {
  const list = await getJSON<Profile[]>('ai:profiles', []);
  return list.map((p) => ({ ...p, key: decrypt(p.key) || '' }));
}

export async function allProfiles(): Promise<Profile[]> {
  return [...(await storedProfiles()), ...envProfiles()];
}

export async function publicProfiles(): Promise<PublicProfile[]> {
  const stored = await storedProfiles();
  const env = envProfiles();
  return [
    ...stored.map(({ key, ...p }) => ({ ...p, keyHint: key ? `…${key.slice(-4)}` : '(no key — check AUTH_SECRET)' })),
    ...env.map(({ key, ...p }) => ({ ...p, keyHint: `env …${key.slice(-4)}`, fromEnv: true })),
  ];
}

export async function saveProfile(input: Partial<Profile> & { apiKey?: string }): Promise<void> {
  const raw = await getJSON<Profile[]>('ai:profiles', []);
  const preset = PRESETS.find((p) => p.id === input.preset) || PRESETS.find((p) => p.id === 'custom-openai')!;
  const idx = raw.findIndex((p) => p.id === input.id);
  const prev = idx >= 0 ? raw[idx] : null;
  const baseUrl = trimSlash(input.baseUrl || prev?.baseUrl || preset.baseUrl);
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('Base URL must start with https:// (http:// only for your own tunnel)');
  const next: Profile = {
    id: prev?.id || `p${Date.now().toString(36)}`,
    preset: preset.id,
    label: (input.label || prev?.label || preset.label).slice(0, 60),
    wire: (input.wire as Wire) || prev?.wire || preset.wire,
    baseUrl,
    model: (input.model ?? prev?.model ?? '').trim(),
    key: input.apiKey ? encrypt(input.apiKey.trim()) : prev?.key || '',
    enabled: input.enabled ?? prev?.enabled ?? true,
  };
  if (!next.key) throw new Error('API key required');
  if (idx >= 0) raw[idx] = next;
  else raw.push(next);
  await setJSON('ai:profiles', raw);
}

export async function deleteProfile(id: string) {
  const raw = await getJSON<Profile[]>('ai:profiles', []);
  await setJSON('ai:profiles', raw.filter((p) => p.id !== id));
}

export async function moveProfile(id: string, dir: -1 | 1) {
  const raw = await getJSON<Profile[]>('ai:profiles', []);
  const i = raw.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= raw.length) return;
  [raw[i], raw[j]] = [raw[j], raw[i]];
  await setJSON('ai:profiles', raw);
}

// ---------------------------------------------------------------- calls

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`${r.status}: ${text.slice(0, 300)}`), { status: r.status });
    return JSON.parse(text);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`timeout after ${timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function listModels(p: Pick<Profile, 'wire' | 'baseUrl' | 'key'>): Promise<string[]> {
  const base = trimSlash(p.baseUrl);
  const url = p.wire === 'anthropic' ? `${base}/v1/models?limit=100` : `${base}/models`;
  const headers: Record<string, string> = p.wire === 'anthropic' ? { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${p.key}` };
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const arr: any[] = d.data || d.models || [];
  return arr.map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).sort();
}

const modelCache = new Map<string, string>();
async function resolveModel(p: Profile): Promise<string> {
  if (p.model) return p.model;
  if (modelCache.has(p.id)) return modelCache.get(p.id)!;
  const models = await listModels(p);
  const prefer = PRESETS.find((x) => x.id === p.preset)?.prefer || [];
  let pick = '';
  for (const rx of prefer) {
    pick = models.find((m) => rx.test(m)) || '';
    if (pick) break;
  }
  pick ||= models[0];
  if (!pick) throw new Error('No model available — set one in AI & Keys');
  modelCache.set(p.id, pick);
  return pick;
}

async function callOne(p: Profile, system: string, user: string, maxTokens: number, timeoutMs: number): Promise<{ text: string; model: string }> {
  const model = await resolveModel(p);
  const base = trimSlash(p.baseUrl);
  if (p.wire === 'anthropic') {
    const d = await post(`${base}/v1/messages`, { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, timeoutMs);
    return { text: (d.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''), model };
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${p.key}` };
  if (p.preset === 'openrouter') Object.assign(headers, { 'HTTP-Referer': 'https://fde-job-finder.vercel.app', 'X-Title': 'FDE Job Finder' });
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const reasoningStyle = p.preset === 'openai' && /^(o\d|gpt-5)/.test(model);
  const body: Record<string, unknown> = reasoningStyle ? { model, messages, max_completion_tokens: maxTokens * 4 } : { model, messages, max_tokens: maxTokens, temperature: 0.2 };
  let d;
  try {
    d = await post(`${base}/chat/completions`, headers, body, timeoutMs);
  } catch (e) {
    // some models reject max_tokens / temperature → retry in the newer format
    if ((e as any).status === 400 && /max_tokens|temperature|max_completion_tokens/i.test((e as Error).message)) {
      d = await post(`${base}/chat/completions`, headers, { model, messages, max_completion_tokens: maxTokens * 4 }, timeoutMs);
    } else throw e;
  }
  const msg = d.choices?.[0]?.message;
  const text = typeof msg?.content === 'string' ? msg.content : Array.isArray(msg?.content) ? msg.content.map((c: any) => c.text || '').join('') : '';
  return { text, model };
}

export interface ChatResult { text: string; provider: string; model: string; tried: string[] }

/** Runs through enabled profiles in order until one answers. */
export async function chat(system: string, user: string, opts: { maxTokens?: number; timeoutMs?: number; profileId?: string } = {}): Promise<ChatResult> {
  const profiles = (await allProfiles()).filter((p) => p.enabled && p.key && (!opts.profileId || p.id === opts.profileId));
  if (!profiles.length) throw new Error('No AI provider configured. Add one in the "AI & Keys" tab (Gemini / Groq / OpenRouter have free tiers).');
  const tried: string[] = [];
  for (const p of profiles) {
    try {
      const r = await callOne(p, system, user, opts.maxTokens ?? 1500, opts.timeoutMs ?? 60000);
      if (!r.text.trim()) throw new Error('empty response');
      return { text: r.text, provider: p.label, model: r.model, tried };
    } catch (e) {
      tried.push(`${p.label}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  throw new Error(`All AI providers failed → ${tried.join(' | ')}`);
}

export async function aiConfigured(): Promise<boolean> {
  return (await allProfiles()).some((p) => p.enabled && p.key);
}

/** Pulls the first JSON object/array out of a model reply (handles ```json fences and chatter). */
export function parseJson<T = any>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = cleaned.indexOf(open);
    const b = cleaned.lastIndexOf(close);
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(cleaned.slice(a, b + 1)) as T;
      } catch {}
    }
  }
  return null;
}

export async function chatJson<T = any>(system: string, user: string, opts: Parameters<typeof chat>[2] = {}): Promise<{ data: T | null; meta: ChatResult }> {
  const meta = await chat(`${system}\nReturn ONLY valid JSON. No prose, no markdown fences.`, user, opts);
  return { data: parseJson<T>(meta.text), meta };
}
