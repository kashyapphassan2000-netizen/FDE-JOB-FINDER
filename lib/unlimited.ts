import { secret } from './secrets';
import { ENGINES, searchStatus, searchUsage } from './search';
import { allProfiles } from './llm';
import { mailerStatus } from './mailer';
import { notifyConfigured } from './notify';

/**
 * UNLIMITED SETUP — every capacity limit in the app, and every way to lift it, ordered:
 * truly unlimited (self-hosted / no quota) → free every month → free once → cheap pay-as-you-go.
 * Free tiers verified October 2026. The app rotates across everything you add, so limits stack.
 */
export type Tier = 'unlimited' | 'monthly' | 'once' | 'paid' | 'closed';
export interface Option { id: string; name: string; tier: Tier; free: string; keys: string[]; url: string; steps: string[]; note?: string; engine?: string; aiPreset?: string }
export interface Capability { id: string; title: string; unlocks: string; options: Option[] }

export const CATALOG: Capability[] = [
  {
    id: 'search', title: '🔍 Web search', unlocks: 'X / LinkedIn posts, all agent tabs, deep research, job-analyzer research, referrals, “Search any role”, Watch-by-name, custom agents',
    options: [
      { id: 'searxng', engine: 'searxng', name: 'Your own SearXNG (Hugging Face Space)', tier: 'unlimited', free: 'No quota — searches Google, Bing, DuckDuckGo, Brave, Startpage, Mojeek, Qwant', keys: ['SEARXNG_URL', 'SEARXNG_TOKEN'], url: 'https://huggingface.co/new-space',
        steps: ['huggingface.co → sign up (free, no card)', 'New Space → name fde-search → SDK: Docker → Blank → Private → Create', 'Upload the 3 files from the repo folder deploy/searxng (Dockerfile, settings.yml, README.md) — it builds in ~3 min', 'Space → Settings → Variables and secrets → new secret SEARXNG_SECRET = any long random text → Restart', 'huggingface.co/settings/tokens → New token (Read) → copy', 'Paste below: SEARXNG_URL = https://<your-username>-fde-search.hf.space and SEARXNG_TOKEN = the token → Test'],
        note: 'Upstream engines may slow very heavy use from one IP — SearXNG spreads queries over 7 engines. Free HF Spaces sleep after 48 h idle; the first search wakes it (~30 s).' },
      { id: 'linkup', engine: 'linkup', name: 'Linkup', tier: 'monthly', free: '$20 credit every month ≈ 4,000 searches', keys: ['LINKUP_API_KEY'], url: 'https://app.linkup.so/', steps: ['app.linkup.so → Sign up', 'Dashboard → API key → copy', 'Paste below → Test'] },
      { id: 'exa', engine: 'exa', name: 'Exa', tier: 'monthly', free: '$10 credit every month (+$10 once) ≈ 1,500+ searches', keys: ['EXA_API_KEY'], url: 'https://dashboard.exa.ai/api-keys', steps: ['dashboard.exa.ai → Sign up', 'API keys → Create key → copy', 'Paste below → Test'] },
      { id: 'tavily', engine: 'tavily', name: 'Tavily', tier: 'monthly', free: '1,000 searches every month', keys: ['TAVILY_API_KEY'], url: 'https://app.tavily.com/', steps: ['app.tavily.com → Sign up', 'Copy the API key', 'Paste below'], note: 'Already connected — resets on the 1st.' },
      { id: 'firecrawl', engine: 'firecrawl', name: 'Firecrawl', tier: 'monthly', free: '1,000 credits every month (~500 searches)', keys: ['FIRECRAWL_API_KEY'], url: 'https://www.firecrawl.dev/app/api-keys', steps: ['firecrawl.dev → Sign up', 'API keys → copy', 'Paste below → Test'] },
      { id: 'brave', engine: 'brave', name: 'Brave Search API', tier: 'monthly', free: '$5 credit every month ≈ 1,000 searches (card required)', keys: ['BRAVE_API_KEY'], url: 'https://api-dashboard.search.brave.com/', steps: ['api-dashboard.search.brave.com → Sign up', 'Subscribe to the Search plan (card on file, $5/month credit covers ~1,000)', 'API keys → copy → paste below'] },
      { id: 'serper', engine: 'serper', name: 'Serper (Google results)', tier: 'once', free: '2,500 searches once, then ~$1 per 1,000', keys: ['SERPER_API_KEY'], url: 'https://serper.dev/api-key', steps: ['serper.dev → Sign up (Google login)', 'API key → copy', 'Paste below → Test'] },
      { id: 'jina', engine: 'jina', name: 'Jina (search + faster page reader)', tier: 'once', free: '10M tokens once (~1,000 searches) + higher reader limits', keys: ['JINA_API_KEY'], url: 'https://jina.ai/', steps: ['jina.ai → the API key box on the homepage is generated for you (or sign in)', 'Copy it → paste below'] },
      { id: 'searchapi', engine: 'searchapi', name: 'SearchApi.io', tier: 'monthly', free: '100 searches every month', keys: ['SEARCHAPI_KEY'], url: 'https://www.searchapi.io/', steps: ['searchapi.io → Sign up', 'Copy API key → paste below'] },
      { id: 'google_cse', engine: 'google_cse', name: 'Google Programmable Search', tier: 'closed', free: 'Closed to new customers; shuts down 1 Jan 2027', keys: ['GOOGLE_CSE_KEY', 'GOOGLE_CSE_CX'], url: 'https://developers.google.com/custom-search/v1/overview', steps: ['Not available for new accounts — skip it'] },
    ],
  },
  {
    id: 'ai', title: '🧠 AI models', unlocks: 'every agent, ranking, analyzer, mentor, outreach drafts, auto-apply answers',
    options: [
      { id: 'ollama', aiPreset: 'ollama', name: 'Ollama on your PC', tier: 'unlimited', free: 'Unlimited, private (needs the app running locally — see Agent studio → 💻 Local LLM)', keys: [], url: 'https://ollama.com/download', steps: ['Install Ollama → ollama pull qwen2.5:14b', 'Run the app locally (npm run dev) → AI & Keys → add “Ollama (local LLM)”'] },
      { id: 'cerebras', aiPreset: 'cerebras', name: 'Cerebras', tier: 'monthly', free: '~1M tokens every day, very fast', keys: [], url: 'https://cloud.cerebras.ai/', steps: ['cloud.cerebras.ai → Sign up → API keys → create', 'AI & Keys → Add provider → Cerebras → paste → Save'] },
      { id: 'groq', aiPreset: 'groq', name: 'Groq', tier: 'monthly', free: '~1,000+ requests / day per big model (14,400 on small ones)', keys: [], url: 'https://console.groq.com/keys', steps: ['Already connected'] },
      { id: 'gemini', aiPreset: 'gemini', name: 'Google Gemini', tier: 'monthly', free: 'Free tier on Flash / Flash-Lite + free embeddings', keys: [], url: 'https://aistudio.google.com/apikey', steps: ['Already connected'] },
      { id: 'mistral', aiPreset: 'mistral', name: 'Mistral', tier: 'monthly', free: 'Free experiment plan, very high monthly volume (~1 req/s)', keys: [], url: 'https://console.mistral.ai/api-keys', steps: ['console.mistral.ai → Sign up → choose Experiment (free) → API keys → create', 'AI & Keys → Add provider → Mistral → paste'] },
      { id: 'openrouter', aiPreset: 'openrouter', name: 'OpenRouter', tier: 'monthly', free: ':free models, 50 req/day each (1,000/day after a one-time $10 top-up)', keys: [], url: 'https://openrouter.ai/keys', steps: ['openrouter.ai → Sign up → Keys → create', 'AI & Keys → Add provider → OpenRouter → paste'] },
      { id: 'nvidia', aiPreset: 'nvidia', name: 'NVIDIA NIM', tier: 'monthly', free: 'Free endpoints (~40 req/min)', keys: [], url: 'https://build.nvidia.com/', steps: ['build.nvidia.com → Sign in → Get API key', 'AI & Keys → Add provider → NVIDIA NIM → paste'] },
      { id: 'github', aiPreset: 'github', name: 'GitHub Models', tier: 'monthly', free: '~150 req/day (GPT-4.1-mini etc.)', keys: [], url: 'https://github.com/settings/personal-access-tokens', steps: ['GitHub → Settings → Developer settings → Fine-grained token → permission models:read', 'AI & Keys → Add provider → GitHub Models → paste'] },
    ],
  },
  {
    id: 'x', title: '𝕏 X / Twitter live', unlocks: 'the live X panel: every hiring tweet from the last 24 h, instantly',
    options: [
      { id: 'twitterapi', name: 'twitterapi.io', tier: 'paid', free: '$0.10 free credit, then $0.15 per 1,000 tweets (≈ ₹13) — no subscription', keys: ['TWITTERAPI_IO_KEY'], url: 'https://twitterapi.io/', steps: ['twitterapi.io → Sign up (no card for the free credit)', 'Dashboard → copy API key → paste below', 'Top up $5 = ~33,000 tweets (months of use)'], note: 'X has no free search API at all; the official API starts at $200/month.' },
    ],
  },
  {
    id: 'linkedin', title: '🔗 LinkedIn', unlocks: 'LinkedIn jobs (live) and heavy LinkedIn scraping',
    options: [
      { id: 'liguest', name: 'LinkedIn public job search', tier: 'unlimited', free: 'No key — already live (last 24 h jobs panel + every refresh)', keys: [], url: 'https://www.linkedin.com/jobs', steps: ['Nothing to do — LinkedIn may briefly rate-limit the server; it recovers on its own'] },
      { id: 'apify', name: 'Apify (LinkedIn scrapers)', tier: 'monthly', free: '$5 platform credit every month', keys: ['APIFY_TOKEN'], url: 'https://console.apify.com/settings/integrations', steps: ['apify.com → Sign up → Settings → Integrations → copy API token → paste below'] },
    ],
  },
  {
    id: 'email', title: '✉ Email to anyone', unlocks: 'users’ sign-in codes, Job alerts for others, agent reports to other people',
    options: [
      { id: 'gmail', name: 'Gmail app password', tier: 'monthly', free: '500 emails / day', keys: ['GMAIL_USER', 'GMAIL_APP_PASSWORD'], url: 'https://myaccount.google.com/apppasswords', steps: ['myaccount.google.com → Security → turn ON 2-Step Verification', 'Open myaccount.google.com/apppasswords → name it “FDE” → Create → copy the 16 letters', 'Paste GMAIL_USER = your Gmail, GMAIL_APP_PASSWORD = the 16 letters → Test'] },
      { id: 'brevo', name: 'Brevo', tier: 'monthly', free: '300 emails / day (stacks with Gmail)', keys: ['BREVO_API_KEY', 'BREVO_SENDER'], url: 'https://app.brevo.com/settings/keys/api', steps: ['brevo.com → Sign up', 'Senders → add your Gmail → verify the email they send', 'SMTP & API → API keys → Generate → paste BREVO_API_KEY + BREVO_SENDER (your Gmail)'] },
    ],
  },
  {
    id: 'alerts', title: '🔔 Instant alerts', unlocks: 'new-job alerts, agent reports, sign-in code relay on your phone',
    options: [
      { id: 'telegram', name: 'Telegram bot', tier: 'unlimited', free: 'Free and unlimited', keys: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'], url: 'https://t.me/BotFather', steps: ['Telegram → open @BotFather → /newbot → copy the token', 'Send any message to your new bot', 'Open https://api.telegram.org/bot<TOKEN>/getUpdates → copy "chat":{"id": …}', 'Paste both below → Test'] },
      { id: 'callmebot', name: 'WhatsApp (CallMeBot)', tier: 'monthly', free: 'Free personal use', keys: ['WHATSAPP_PHONE', 'CALLMEBOT_APIKEY'], url: 'https://www.callmebot.com/blog/free-api-whatsapp-messages/', steps: ['Save +34 694 25 79 94 as a contact (check the site for the current number)', 'WhatsApp it: I allow callmebot to send me messages', 'Paste your number (91…) and the apikey it replies with → Test'] },
    ],
  },
  {
    id: 'signin', title: '🔐 User sign-in', unlocks: 'users sign in with Google — no emails needed',
    options: [
      { id: 'google', name: 'Google sign-in', tier: 'unlimited', free: 'Free, unlimited', keys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], url: 'https://console.cloud.google.com/apis/credentials', steps: ['console.cloud.google.com → new project “FDE Job Finder”', 'APIs & Services → OAuth consent screen → External → app name + your email → Save → Publish app', 'Credentials → Create credentials → OAuth client ID → Web application', 'Authorized redirect URI: https://fde-job-finder.vercel.app/api/auth/google/callback → Create', 'Paste Client ID + Client secret below'] },
    ],
  },
  {
    id: 'other', title: '⚙ Other limits', unlocks: 'zero-day radar, ranking, refresh speed',
    options: [
      { id: 'github_token', name: 'GitHub token (radar)', tier: 'unlimited', free: '5,000 calls / hour (vs 60)', keys: ['GITHUB_TOKEN'], url: 'https://github.com/settings/personal-access-tokens', steps: ['GitHub → Settings → Developer settings → Fine-grained tokens → Generate (no permissions needed) → paste below'] },
      { id: 'cohere', name: 'Cohere Rerank', tier: 'monthly', free: 'Free trial key (~1,000 rerank calls / month)', keys: ['COHERE_API_KEY'], url: 'https://dashboard.cohere.com/api-keys', steps: ['dashboard.cohere.com → Sign up → API keys → copy trial key → paste below'] },
      { id: 'gha', name: 'Refresh every 30 min (GitHub Actions)', tier: 'unlimited', free: 'Free', keys: [], url: 'https://github.com/kashyapphassan2000-netizen/FDE-JOB-FINDER/settings/secrets/actions', steps: ['Open the link → New repository secret APP_URL = https://fde-job-finder.vercel.app', 'New repository secret CRON_SECRET = the same value as CRON_SECRET in Vercel → Settings → Environment Variables'] },
    ],
  },
];

export async function unlimitedStatus() {
  const [ss, usage, profiles] = await Promise.all([searchStatus(), searchUsage(), allProfiles()]);
  const m = mailerStatus();
  const n = notifyConfigured();
  const presets = new Set(profiles.filter((p) => p.enabled).map((p) => p.preset));
  const status: Record<string, { on: boolean; state: string; used?: number }> = {};
  for (const c of CATALOG) for (const o of c.options) {
    const OPTIONAL = new Set(['SEARXNG_TOKEN']); // only the HF token for a private SearXNG Space is optional
    const req = o.keys.filter((k) => !OPTIONAL.has(k));
    let on = req.length ? req.every((k) => Boolean(secret(k))) : false;
    if (o.aiPreset) on = presets.has(o.aiPreset);
    if (o.id === 'liguest') on = true;
    if (o.id === 'gmail') on = m.gmail;
    if (o.id === 'brevo') on = m.brevo;
    if (o.id === 'callmebot') on = n.whatsapp;
    let state = on ? 'connected' : o.tier === 'closed' ? 'not available' : 'not set';
    const parked = o.engine ? ss.parked.find((p) => p.id === o.engine) : undefined;
    if (on && parked) state = `quota used up until ${new Date(parked.until).toISOString().slice(0, 10)}`;
    status[o.id] = { on, state, used: o.engine ? usage.month[o.engine] || 0 : undefined };
  }
  const freeMonthly = ENGINES.filter((e) => ss.live.includes(e.id)).reduce((a, e) => a + e.freeMonthly, 0);
  return { status, search: { live: ss.live, parked: ss.parked.map((p) => p.id), capacity: ss.live.includes('searxng') ? 'unlimited' : `${freeMonthly.toLocaleString('en-IN')} / month` } };
}
