import { getJSON, hgetall, hset, setJSON } from './store';
import { secret } from './secrets';
import { pool } from './http';
import { guessAts } from './atsdetect';
import { relevantForAiFde } from './watch';

/**
 * ZERO-DAY RADAR — signals that come BEFORE a job is posted.
 *  1. GitHub dependency radar: AI companies' recently-pushed repos, their requirements.txt / pyproject.toml diffed daily.
 *     A company that just added vLLM / SGLang / Triton / TensorRT-LLM / Ray … is about to need serving / infra / FDE people.
 *  2. Fresh capital: new SEC Form D filings (US private raises, live EDGAR feed), filtered to tech-looking companies,
 *     each checked for a public job board with AI / FDE roles. (Bengaluru / India raises come from the funding-news scan
 *     in Hidden jobs & startups — India has no Form D equivalent.)
 * Free: GitHub API (60 calls/h without a token, 5,000 with GITHUB_TOKEN) + raw.githubusercontent.com + SEC EDGAR.
 */
export const TARGET_DEPS: Record<string, RegExp> = {
  vllm: /^vllm\b/, sglang: /^sglang\b/, 'tensorrt-llm': /^tensorrt[-_]llm\b/, triton: /^(triton|tritonclient)\b/, 'transformer-engine': /^transformer[-_]engine\b/,
  ray: /^ray(\[|\b)/, deepspeed: /^deepspeed\b/, 'flash-attn': /^flash[-_]attn\b/, xformers: /^xformers\b/, lmdeploy: /^lmdeploy\b/, 'mlc-llm': /^mlc[-_]llm\b/,
  trl: /^trl\b/, peft: /^peft\b/, unsloth: /^unsloth\b/, langgraph: /^langgraph\b/, dspy: /^dspy(-ai)?\b/, 'llama-index': /^llama[-_]index\b/, litellm: /^litellm\b/, outlines: /^outlines\b/,
};
export const DEFAULT_ORGS = ['sarvamai', 'togethercomputer', 'fireworks-ai', 'modal-labs', 'replicate', 'basetenlabs', 'anyscale', 'predibase', 'deepgram', 'AssemblyAI', 'mistralai', 'cohere-ai', 'huggingface', 'lancedb', 'qdrant', 'weaviate', 'chroma-core', 'langchain-ai', 'run-llama', 'crewAIInc', 'e2b-dev', 'browserbase', 'livekit', 'pipecat-ai', 'cartesia-ai', 'perplexityai', 'writer', 'Unstructured-IO', 'truefoundry', 'Portkey-AI', 'Lightning-AI', 'databricks', 'arize-ai', 'langfuse', 'Helicone', 'unslothai', 'pinecone-io', 'neuralmagic', 'NVIDIA', 'ray-project'];

const gh = async (path: string) => {
  const h: Record<string, string> = { 'User-Agent': 'FDE-Job-Finder-radar', Accept: 'application/vnd.github+json' };
  if (secret('GITHUB_TOKEN')) h.Authorization = `Bearer ${secret('GITHUB_TOKEN')}`;
  const r = await fetch(`https://api.github.com${path}`, { headers: h, signal: AbortSignal.timeout(15000) });
  if (r.status === 403 || r.status === 429) throw Object.assign(new Error('GitHub rate limit (add GITHUB_TOKEN for 5,000/h)'), { rl: true });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
};
const raw = async (org: string, repo: string, file: string) => { const r = await fetch(`https://raw.githubusercontent.com/${org}/${repo}/HEAD/${file}`, { signal: AbortSignal.timeout(12000) }); return r.ok ? r.text() : ''; };
function depsOf(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split(/\n/)) {
    const m = line.trim().replace(/^["'\s-]+/, '').toLowerCase().match(/^([a-z0-9][a-z0-9._-]*(\[[^\]]*\])?)/);
    if (!m) continue;
    for (const [dep, rx] of Object.entries(TARGET_DEPS)) if (rx.test(m[1])) names.add(dep);
  }
  return [...names];
}

export interface DepSignal { org: string; repo: string; added: string[]; at: string; url: string }
export async function runGithubRadar(budgetMs = 120000): Promise<{ orgs: number; repos: number; signals: DepSignal[]; note: string }> {
  const t0 = Date.now();
  const orgs = await getJSON<string[]>('radar:orgs', DEFAULT_ORGS);
  const snap = await hgetall<{ deps: string[]; at: string }>('radar:deps');
  const signals: DepSignal[] = [];
  let repos = 0;
  let note = '';
  const cursor = await getJSON<number>('radar:cursor', 0);
  // without a token: ~12 orgs per run (60 calls/h); with a token: all
  const take = secret('GITHUB_TOKEN') ? orgs.length : Math.min(12, orgs.length);
  const batch = Array.from({ length: take }, (_, i) => orgs[(cursor + i) % orgs.length]);
  await setJSON('radar:cursor', (cursor + take) % Math.max(1, orgs.length));
  const res = await pool(batch, 4, async (org) => {
    if (Date.now() - t0 > budgetMs) return;
    const list = (await gh(`/orgs/${org}/repos?sort=pushed&per_page=8&type=public`).catch(async (e) => { if ((e as { rl?: boolean }).rl) throw e; return gh(`/users/${org}/repos?sort=pushed&per_page=8`); })) as { name: string; fork: boolean; archived: boolean; pushed_at: string; html_url: string }[];
    for (const r of list.filter((x) => !x.fork && !x.archived && Date.now() - Date.parse(x.pushed_at) < 45 * 864e5).slice(0, 3)) {
      const files = await Promise.all(['requirements.txt', 'pyproject.toml', 'requirements/base.txt', 'setup.py'].map((f) => raw(org, r.name, f).catch(() => '')));
      const deps = depsOf(files.join('\n'));
      const key = `${org}/${r.name}`;
      const prev = snap[key];
      repos++;
      if (prev) {
        const added = deps.filter((d) => !prev.deps.includes(d));
        if (added.length) signals.push({ org, repo: r.name, added, at: new Date().toISOString(), url: `${r.html_url}/commits` });
      }
      await hset('radar:deps', key, { deps, at: new Date().toISOString() });
    }
  });
  const rl = res.find((r) => r.status === 'rejected' && (r.reason as { rl?: boolean })?.rl);
  if (rl) note = 'GitHub rate limit hit — add a free GITHUB_TOKEN in AI & Keys for full coverage';
  if (signals.length) await setJSON('radar:signals', [...signals, ...(await getJSON<DepSignal[]>('radar:signals', []))].slice(0, 300));
  return { orgs: batch.length, repos, signals, note };
}

// ---------- fresh capital: SEC Form D ----------
export interface FormD { name: string; cik: string; filed: string; link: string; board?: string; roles?: number; aiRoles?: string[]; checkedAt?: string }
const FUNDISH = /\b(fund|feeder|l\.?p\.?|capital|partners|holdings|trust|reit|real estate|propert|ventures|investors|spv|series [a-z]+ of|master|offshore|income|credit|opportunit|equity|portfolio|assets?|acquisition|bancorp|insurance)\b/i;
const TECHISH = /\b(ai|a\.i\.|intelligence|neural|cognit|robot|autonom|machine|learning|data|analytics|labs?|compute|computing|quantum|vision|agent|agents|llm|genai|deep|semantic|tensor|inference|software|technolog(y|ies)|systems|cloud|cyber|bio ?ai|automation|platform)\b/i;
export async function runFormD(budgetMs = 120000): Promise<{ scanned: number; techy: number; withAiRoles: number }> {
  const t0 = Date.now();
  const seen = await hgetall<FormD>('radar:formd');
  // SEC requires automated tools to declare a contact email in the User-Agent (sec.gov/os/accessing-edgar-data)
  const ua = { 'User-Agent': `FDE-Job-Finder personal research ${secret('SEC_CONTACT_EMAIL') || secret('DIGEST_TO') || 'admin@fde-job-finder.vercel.app'}`, Accept: 'application/atom+xml' };
  let scanned = 0;
  const found: FormD[] = [];
  for (let start = 0; start < 400 && Date.now() - t0 < budgetMs / 3; start += 100) {
    const r = await fetch(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=D&company=&dateb=&owner=include&start=${start}&count=100&output=atom`, { headers: ua, signal: AbortSignal.timeout(20000) });
    if (!r.ok) break;
    const xml = await r.text();
    const entries = xml.split('<entry>').slice(1);
    if (!entries.length) break;
    for (const e of entries) {
      scanned++;
      const title = (e.match(/<title>([^<]*)<\/title>/)?.[1] || '').replace(/&amp;/g, '&');
      const m = title.match(/^D - (.+?) \((\d{10})\)/); // new raises only (not D/A amendments)
      if (!m || FUNDISH.test(m[1]) || !TECHISH.test(m[1])) continue;
      if (seen[m[2]]) continue;
      found.push({ name: m[1].replace(/,?\s+(inc|corp|corporation|llc|ltd)\.?$/i, '').trim(), cik: m[2], filed: (e.match(/<updated>([^<]*)/)?.[1] || '').slice(0, 10), link: (e.match(/<link[^>]*href="([^"]+)"/)?.[1] || '').replace(/&amp;/g, '&') });
    }
  }
  // is it hiring AI / FDE people already? (public job board check, 6 per run)
  let withAi = 0;
  const res = await pool(found.slice(0, 6), 3, async (f) => {
    const d = await guessAts(f.name).catch(() => null);
    const ai = (d?.jobs || []).filter((j) => relevantForAiFde(j).ok).map((j) => `${j.title} — ${j.location}`);
    return { ...f, board: d ? `${d.ats}/${d.slug}` : '', roles: d?.total || 0, aiRoles: ai.slice(0, 8), checkedAt: new Date().toISOString() };
  });
  for (const r of res) if (r.status === 'fulfilled') { await hset('radar:formd', r.value.cik, r.value); if (r.value.aiRoles?.length) withAi++; }
  for (const f of found.slice(6)) await hset('radar:formd', f.cik, f);
  await setJSON('radar:meta', { at: new Date().toISOString(), scanned, techy: found.length });
  return { scanned, techy: found.length, withAiRoles: withAi };
}

export async function radarState() {
  const [signals, deps, formd, meta, orgs] = await Promise.all([getJSON<DepSignal[]>('radar:signals', []), hgetall<{ deps: string[]; at: string }>('radar:deps'), hgetall<FormD>('radar:formd'), getJSON('radar:meta', null), getJSON<string[]>('radar:orgs', DEFAULT_ORGS)]);
  const uses: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(deps)) { const org = k.split('/')[0]; uses[org] = Array.from(new Set([...(uses[org] || []), ...v.deps])); }
  return { signals: signals.slice(0, 100), uses, formd: Object.values(formd).sort((a, b) => (b.filed || '').localeCompare(a.filed || '')).slice(0, 150), meta, orgs, tokenSet: Boolean(secret('GITHUB_TOKEN')) };
}
export async function setOrgs(orgs: string[]) { await setJSON('radar:orgs', Array.from(new Set(orgs.map((o) => o.trim().replace(/^https?:\/\/github\.com\//, '').split('/')[0]).filter(Boolean))).slice(0, 150)); }
