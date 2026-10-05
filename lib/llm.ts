import { countAi, track } from './obs';
import { decrypt, encrypt } from './secrets';
import { getJSON, hgetall, hset, setJSON } from './store';

/**
 * Bring-your-own AI. Any provider works with two wire formats:
 *   - "anthropic"  : Anthropic Messages API (Claude, or any third party that speaks it)
 *   - "openai"     : OpenAI Chat Completions (OpenAI, Gemini, Groq, OpenRouter, DeepSeek, Mistral, Together,
 *                    Cerebras, xAI, NVIDIA, Fireworks, Ollama/LM Studio via tunnel, ANY third-party proxy)
 * Profiles are tried in order; if one hits a rate limit / error, the next one is used (free-tier stacking).
 */
export type Wire = 'anthropic' | 'openai';
export interface Preset { id: string; label: string; wire: Wire; baseUrl: string; keyUrl: string; free: string; prefer: RegExp[]; defaultModel?: string; keyless?: boolean; local?: boolean }

export const PRESETS: Preset[] = [
  { id: 'gemini', label: 'Google Gemini', wire: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey', free: 'Free tier on Flash models (limits shown in AI Studio)', prefer: [/flash-lite-latest/, /\d-flash-lite$/, /flash-latest/, /\d-flash$/] },
  { id: 'groq', label: 'Groq', wire: 'openai', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', free: 'Free, no card: ~1,000 req/day per big model, 14,400/day on llama-3.1-8b-instant; rotates models', prefer: [/gpt-oss-120b/, /qwen/, /gpt-oss-20b/, /llama-3\.3-70b/, /llama-4/, /llama-3\.1-8b-instant/] },
  { id: 'openrouter', label: 'OpenRouter (300+ models)', wire: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', free: 'Free, no card: ":free" models 50 req/day each (1,000/day after a one-time $10 top-up)', prefer: [/^openrouter\/free$/, /:free$/], defaultModel: 'openrouter/free' },
  { id: 'anthropic', label: 'Anthropic Claude', wire: 'anthropic', baseUrl: 'https://api.anthropic.com', keyUrl: 'https://console.anthropic.com/settings/keys', free: 'Paid (pay as you go)', prefer: [/haiku/, /sonnet/] },
  { id: 'openai', label: 'OpenAI', wire: 'openai', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', free: 'Paid (pay as you go)', prefer: [/mini/, /^gpt-/] },
  { id: 'cerebras', label: 'Cerebras', wire: 'openai', baseUrl: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai/', free: 'Free, no card: ~1M tokens/day, very fast', prefer: [/gpt-oss/, /qwen/, /glm/, /llama/], defaultModel: 'gpt-oss-120b' },
  { id: 'mistral', label: 'Mistral', wire: 'openai', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', free: 'Free mode, no card (≈1 req/s, very high monthly volume)', prefer: [/small-latest/, /medium-latest/, /ministral/], defaultModel: 'mistral-small-latest' },
  { id: 'deepseek', label: 'DeepSeek', wire: 'openai', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys', free: 'Very cheap paid', prefer: [/chat/] },
  { id: 'together', label: 'Together AI', wire: 'openai', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.ai/settings/api-keys', free: 'Paid; some free models', prefer: [/Free/, /Llama-3\.3-70B/] },
  { id: 'xai', label: 'xAI Grok', wire: 'openai', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai/', free: 'Paid', prefer: [/mini/, /grok/] },
  { id: 'nvidia', label: 'NVIDIA NIM (build.nvidia.com)', wire: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1', keyUrl: 'https://build.nvidia.com/', free: 'Free endpoints for testing (~40 req/min)', prefer: [/nemotron-3-super/, /kimi-k2/, /deepseek-v4/, /gpt-oss-120b/, /nemotron-3\.5-lightning/, /gpt-oss-20b/] },
  { id: 'github', label: 'GitHub Models', wire: 'openai', baseUrl: 'https://models.github.ai/inference', keyUrl: 'https://github.com/settings/personal-access-tokens', free: 'Free with any GitHub account (token with models:read): 150 req/day low-tier', prefer: [], defaultModel: 'openai/gpt-4.1-mini' },
  { id: 'cloudflare', label: 'Cloudflare Workers AI', wire: 'openai', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1', keyUrl: 'https://dash.cloudflare.com/profile/api-tokens', free: 'Free, no card: 10,000 neurons/day (resets 00:00 UTC). Base URL needs your Account ID (dashboard → right sidebar)', prefer: [/gpt-oss-120b/, /llama-4/, /qwen/, /llama-3\.3-70b/], defaultModel: '@cf/openai/gpt-oss-120b' },
  { id: 'huggingface', label: 'Hugging Face Inference Providers', wire: 'openai', baseUrl: 'https://router.huggingface.co/v1', keyUrl: 'https://huggingface.co/settings/tokens', free: 'Free, no card: small monthly credit across many open models (token with “Inference Providers” permission)', prefer: [/gpt-oss-120b/, /qwen3/, /deepseek/, /llama/], defaultModel: 'openai/gpt-oss-120b' },
  { id: 'cohere', label: 'Cohere (trial key)', wire: 'openai', baseUrl: 'https://api.cohere.ai/compatibility/v1', keyUrl: 'https://dashboard.cohere.com/api-keys', free: 'Free trial key, no card: ~1,000 calls/month (non-commercial)', prefer: [/command-a/, /command-r-plus/, /command-r/], defaultModel: 'command-a-03-2025' },
  { id: 'chutes', label: 'Chutes (open models)', wire: 'openai', baseUrl: 'https://llm.chutes.ai/v1', keyUrl: 'https://chutes.ai/app/api', free: 'Community free tier on many open models', prefer: [/deepseek/, /qwen3/, /gpt-oss/, /llama/] },
  { id: 'pollinations', label: 'Pollinations (no key needed)', wire: 'openai', baseUrl: 'https://text.pollinations.ai/openai', keyUrl: 'https://pollinations.ai/', free: 'Free, anonymous, slow (~1 request / 15 s) — last-resort fallback', prefer: [], defaultModel: 'openai', keyless: true },
  { id: 'ovh', label: 'OVHcloud AI Endpoints (no key needed)', wire: 'openai', baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', keyUrl: 'https://endpoints.ai.cloud.ovh.net/', free: 'Free anonymous tier, 2 req/min per model — last-resort fallback', prefer: [/gpt-oss-120b/i, /llama-3_3-70b/i, /qwen/i], defaultModel: 'gpt-oss-120b', keyless: true },
  { id: 'ollama', label: 'Ollama (local LLM on your machine)', wire: 'openai', baseUrl: 'http://localhost:11434/v1', keyUrl: 'https://ollama.com/download', free: 'Free, runs on your PC/GPU — works when the app runs on localhost (or via an https tunnel)', prefer: [], keyless: true, local: true },
  { id: 'lmstudio', label: 'LM Studio (local LLM)', wire: 'openai', baseUrl: 'http://localhost:1234/v1', keyUrl: 'https://lmstudio.ai/', free: 'Free, local — start its server (Developer → Start server)', prefer: [], keyless: true, local: true },
  { id: 'llamacpp', label: 'llama.cpp / vLLM / LocalAI server (local)', wire: 'openai', baseUrl: 'http://localhost:8080/v1', keyUrl: 'https://github.com/ggml-org/llama.cpp', free: 'Free, local', prefer: [], keyless: true, local: true },
  { id: 'fcc', label: 'Free Claude Code proxy (FCC — any model behind it)', wire: 'anthropic', baseUrl: 'http://localhost:8082', keyUrl: 'https://github.com/alishahryar1/free-claude-code', free: 'Free: FCC routes to NVIDIA NIM / OpenRouter / Groq / Ollama / LM Studio / llama.cpp… Paste the proxy URL from FCC’s server log; key = FCC proxy token if you enabled Proxy Authentication, else leave empty', prefer: [], defaultModel: 'claude-sonnet-4-5', keyless: true, local: true },
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
  const simple: [string, string][] = [['GEMINI_API_KEY', 'gemini'], ['GROQ_API_KEY', 'groq'], ['CEREBRAS_API_KEY', 'cerebras'], ['MISTRAL_API_KEY', 'mistral'], ['OPENROUTER_API_KEY', 'openrouter'], ['GITHUB_MODELS_TOKEN', 'github'], ['NVIDIA_API_KEY', 'nvidia'], ['ANTHROPIC_API_KEY', 'anthropic'], ['OPENAI_API_KEY', 'openai']];
  for (const [envName, pid] of simple) {
    if (!process.env[envName]) continue;
    const p = PRESETS.find((x) => x.id === pid)!;
    out.push({ id: `env-${pid}`, preset: pid, label: `${p.label} (env)`, wire: p.wire, baseUrl: p.baseUrl, model: process.env[`${envName.replace('_API_KEY', '')}_MODEL`] || '', key: process.env[envName]!, enabled: true });
  }
  // local LLM via env (localhost runs): OLLAMA_BASE_URL=http://localhost:11434/v1, OLLAMA_MODEL=qwen2.5:14b
  if (process.env.OLLAMA_BASE_URL) out.push({ id: 'env-ollama', preset: 'ollama', label: 'Ollama (env, local)', wire: 'openai', baseUrl: trimSlash(process.env.OLLAMA_BASE_URL), model: process.env.OLLAMA_MODEL || '', key: 'keyless', enabled: true });
  // keyless last-resort providers so the AI never fully stops (set NO_KEYLESS_AI=1 to disable)
  if (!process.env.NO_KEYLESS_AI) for (const pid of ['pollinations', 'ovh']) {
    const p = PRESETS.find((x) => x.id === pid)!;
    out.push({ id: `free-${pid}`, preset: pid, label: p.label, wire: p.wire, baseUrl: p.baseUrl, model: '', key: 'keyless', enabled: true });
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
    ...env.map(({ key, ...p }) => ({ ...p, keyHint: key === 'keyless' ? 'no key needed' : `env …${key.slice(-4)}`, fromEnv: true })),
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
    key: input.apiKey ? encrypt(input.apiKey.trim()) : prev?.key || (preset.keyless ? encrypt('keyless') : ''),
    enabled: input.enabled ?? prev?.enabled ?? true,
  };
  if (!next.key) throw new Error('API key required');
  if (preset.local && process.env.VERCEL && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(baseUrl)) throw new Error('This app is running on Vercel (cloud) — it cannot reach localhost on your PC. Run the app locally (npm run dev) or expose your local LLM with an https tunnel (e.g. cloudflared) and paste that URL.');
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
    if (!r.ok) {
      const ra = Number(r.headers.get('retry-after'));
      const m = text.match(/(?:retry|try again) in\s*(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?/i);
      const retryAfterSec = Number.isFinite(ra) && ra > 0 ? ra : m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Math.ceil(Number(m[3] || 0)) : undefined;
      throw Object.assign(new Error(`${r.status}: ${text.slice(0, 600)}`), { status: r.status, retryAfterSec });
    }
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
  const headers: Record<string, string> = p.wire === 'anthropic' ? { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' } : p.key === 'keyless' ? {} : { Authorization: `Bearer ${p.key}` };
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const arr: any[] = d.data || d.models || [];
  return arr.map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).sort();
}

const modelListCache = new Map<string, { at: number; models: string[] }>();
const isGone = (e: unknown) => (e as any)?.status === 404 || (e as any)?.status === 410 || /no longer available|not found for api version|model_not_found|does not exist|decommissioned/i.test((e as Error)?.message || '');
const isTooBig = (e: unknown) => ((e as any)?.status === 413 || (e as any)?.status === 400) && /too large|tokens per minute|\btpm\b|context.{0,20}(length|window)|maximum context|reduce the length/i.test((e as Error)?.message || '');
const isRateLimit = (e: unknown) => (e as any)?.status === 429 || /quota|rate.?limit|resource.?exhausted|too many requests/i.test((e as Error)?.message || '');

/** The profile's own model first, then other good models of the same provider (each has its own free quota). */
async function modelCandidates(p: Profile): Promise<string[]> {
  const preset = PRESETS.find((x) => x.id === p.preset);
  const prefer = preset?.prefer || [];
  let models: string[] = [];
  if (!p.model || (prefer.length && !p.preset.startsWith('custom'))) {
    const c = modelListCache.get(p.id);
    if (c && Date.now() - c.at < 6 * 36e5) models = c.models;
    else {
      try {
        models = await listModels(p);
        modelListCache.set(p.id, { at: Date.now(), models });
      } catch {}
    }
  }
  const ranked: string[] = [];
  // Gemini: newest versions first (older names stay listed after Google retires them for new keys)
  const ordered = p.preset === 'gemini' ? [...models].sort((x, y) => y.localeCompare(x, undefined, { numeric: true })) : models;
  for (const rx of prefer) for (const m of ordered) if (rx.test(m) && !ranked.includes(m) && !/image|tts|audio|live|embed|guard|whisper|orpheus|vision/i.test(m)) ranked.push(m);
  const out = Array.from(new Set([p.model, ...ranked.slice(0, 4)].filter(Boolean)));
  if (!out.length && models[0]) out.push(models[0]);
  if (!out.length && preset?.defaultModel) out.push(preset.defaultModel);
  else if (preset?.defaultModel && !out.includes(preset.defaultModel) && !models.length) out.push(preset.defaultModel);
  if (!out.length) throw new Error('No model available — set one in AI & Keys');
  return out;
}

/** Tries the provider's models in order; a rate-limited model rests (until its reset time) and the next one answers. */
async function callOne(p: Profile, system: string, user: string, maxTokens: number, timeoutMs: number): Promise<{ text: string; model: string }> {
  const cands = await modelCandidates(p);
  let lastErr: unknown = null;
  for (let pass = 0; pass < 2; pass++) {
    const cool = await hgetall<number>('ai:cool');
    let soonest = Infinity;
    for (const model of cands) {
      const until = cool[`${p.id}|${model}`] || 0;
      if (until > Date.now()) { soonest = Math.min(soonest, until); continue; }
      try {
        return await callModel(p, model, system, user, maxTokens, timeoutMs);
      } catch (e) {
        // a retired / unknown model (404, "no longer available") or a request too big for this model's free window → try the next model
        if (isGone(e) || isTooBig(e)) { lastErr = e; await hset('ai:cool', `${p.id}|${model}`, Date.now() + (isGone(e) ? 24 * 36e5 : 60000)); continue; }
        if (!isRateLimit(e)) throw e;
        lastErr = e;
        const sec = (e as any).retryAfterSec ?? (/per.?day|daily|quota/i.test((e as Error).message) ? 6 * 3600 : 60);
        await hset('ai:cool', `${p.id}|${model}`, Date.now() + Math.min(sec, 24 * 3600) * 1000 + 500);
        if (sec <= 15) soonest = Math.min(soonest, Date.now() + sec * 1000);
      }
    }
    // every model resting: wait once if one frees up within 15 s
    const wait = soonest - Date.now();
    if (pass === 0 && wait > 0 && wait <= 15000) await new Promise((r) => setTimeout(r, wait + 300));
    else break;
  }
  throw lastErr || new Error(`all ${p.label} models are resting after hitting free-tier limits`);
}

async function callModel(p: Profile, model: string, system: string, user: string, maxTokens: number, timeoutMs: number): Promise<{ text: string; model: string }> {
  const base = trimSlash(p.baseUrl);
  if (p.wire === 'anthropic') {
    const auth: Record<string, string> = p.key === 'keyless' ? {} : p.preset === 'fcc' ? { 'x-api-key': p.key, Authorization: `Bearer ${p.key}` } : { 'x-api-key': p.key };
    const d = await post(`${base}/v1/messages`, { ...auth, 'anthropic-version': '2023-06-01' }, { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, timeoutMs);
    return { text: (d.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''), model };
  }
  const headers: Record<string, string> = p.key === 'keyless' ? {} : { Authorization: `Bearer ${p.key}` };
  if (p.preset === 'openrouter') Object.assign(headers, { 'HTTP-Referer': 'https://fde-job-finder.vercel.app', 'X-Title': 'FDE Job Finder' });
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const reasoningStyle = p.preset === 'openai' && /^(o\d|gpt-5)/.test(model);
  // Thinking models (Gemini 2.5+/3, gpt-oss, DeepSeek-R1…) spend tokens on hidden reasoning first; a small budget returns nothing.
  maxTokens = Math.max(maxTokens, 1024);
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
  const extract = (r: any) => {
    const msg = r.choices?.[0]?.message;
    return typeof msg?.content === 'string' ? msg.content : Array.isArray(msg?.content) ? msg.content.map((c: any) => c.text || '').join('') : '';
  };
  let text = extract(d);
  // still cut off while thinking → one retry with a bigger budget
  if (!text.trim() && d.choices?.[0]?.finish_reason === 'length') {
    text = extract(await post(`${base}/chat/completions`, headers, { ...body, ...(reasoningStyle ? { max_completion_tokens: maxTokens * 8 } : { max_tokens: maxTokens * 4 }) }, timeoutMs));
  }
  return { text, model };
}

export interface ChatResult { text: string; provider: string; model: string; tried: string[] }

/** Runs through enabled profiles in order until one answers. */
export interface ChatOpts {
  maxTokens?: number; timeoutMs?: number;
  /** pin a provider (AI & Keys entry) … */ profileId?: string;
  /** … and optionally an exact model of it */ model?: string;
  /** true = only the pinned provider/model, never fall back to others (e.g. a local-only agent) */ strict?: boolean;
}
export async function chat(system: string, user: string, opts: ChatOpts = {}): Promise<ChatResult> {
  const all = (await allProfiles()).filter((p) => p.enabled && p.key);
  // pinned provider first; others follow as fallback unless strict
  const pinned = opts.profileId ? all.filter((p) => p.id === opts.profileId) : [];
  if (opts.profileId && !pinned.length && opts.strict) throw new Error(`The model this agent is mapped to (${opts.profileId}) is not configured or disabled — fix it in AI & Keys`);
  const profiles = opts.strict && pinned.length ? pinned : [...pinned, ...all.filter((p) => p.id !== opts.profileId)];
  if (!profiles.length) throw new Error('No AI provider configured. Add one in the "AI & Keys" tab (Gemini / Groq / OpenRouter have free tiers).');
  const tried: string[] = [];
  for (const p of profiles) {
    const t1 = Date.now();
    try {
      const r = opts.model && p.id === opts.profileId
        ? await callModel(p, opts.model, system, user, Math.max(opts.maxTokens ?? 1500, 1024), opts.timeoutMs ?? 60000)
        : await callOne(p, system, user, opts.maxTokens ?? 1500, opts.timeoutMs ?? 60000);
      if (!r.text.trim()) throw new Error('empty response');
      await countAi(p.label, r.model, true, Date.now() - t1);
      return { text: r.text, provider: p.label, model: r.model, tried };
    } catch (e) {
      await countAi(p.label, p.model || 'auto', false, Date.now() - t1);
      tried.push(`${p.label}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  await track('ai', 'all AI providers failed', 'fail', tried.join(' | '));
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

export async function chatJson<T = any>(system: string, user: string, opts: ChatOpts = {}): Promise<{ data: T | null; meta: ChatResult }> {
  const meta = await chat(`${system}\nReturn ONLY valid JSON. No prose, no markdown fences.`, user, opts);
  return { data: parseJson<T>(meta.text), meta };
}

/** Models sometimes return a bare array instead of {key:[...]} — accept both. */
export function listOf<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  const v = (data as Record<string, unknown> | null)?.[key];
  if (Array.isArray(v)) return v as T[];
  // {anyKey:[...]} with a different name
  const arr = data && typeof data === 'object' ? Object.values(data).find(Array.isArray) : null;
  return (arr as T[]) || [];
}
