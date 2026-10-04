import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getJSON, setJSON } from './store';

/**
 * Keys vault: lets you paste/replace API keys from the app UI (no redeploy).
 * Values are AES-256-GCM encrypted with a key derived from AUTH_SECRET before they reach Redis,
 * and are NEVER sent back to the browser (only "set ✓ …last4").
 * Resolution order: Vercel env var  →  vault value.
 */
export const VAULT_KEYS: { name: string; label: string; group: string; url: string }[] = [
  // job APIs
  { name: 'RAPIDAPI_KEY', label: 'JSearch (RapidAPI)', group: 'Job APIs', url: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch' },
  { name: 'SERPAPI_KEY', label: 'SerpApi (Google Jobs + Google web search)', group: 'Job APIs', url: 'https://serpapi.com/manage-api-key' },
  { name: 'ADZUNA_APP_ID', label: 'Adzuna App ID', group: 'Job APIs', url: 'https://developer.adzuna.com/' },
  { name: 'ADZUNA_APP_KEY', label: 'Adzuna App Key', group: 'Job APIs', url: 'https://developer.adzuna.com/' },
  { name: 'JOOBLE_API_KEY', label: 'Jooble', group: 'Job APIs', url: 'https://jooble.org/api/about' },
  { name: 'APIFY_TOKEN', label: 'Apify (LinkedIn scraper)', group: 'Job APIs', url: 'https://console.apify.com/settings/integrations' },
  { name: 'X_BEARER_TOKEN', label: 'X official API bearer', group: 'Job APIs', url: 'https://developer.x.com/' },
  { name: 'TWITTERAPI_IO_KEY', label: 'twitterapi.io', group: 'Job APIs', url: 'https://twitterapi.io/' },
  { name: 'THEMUSE_API_KEY', label: 'The Muse (optional)', group: 'Job APIs', url: 'https://www.themuse.com/developers/api/v2' },
  // web search for the AI agent
  { name: 'TAVILY_API_KEY', label: 'Tavily (1,000 free searches / month)', group: 'Web search (AI agent)', url: 'https://app.tavily.com/' },
  { name: 'EXA_API_KEY', label: 'Exa (free monthly credits)', group: 'Web search (AI agent)', url: 'https://dashboard.exa.ai/api-keys' },
  { name: 'FIRECRAWL_API_KEY', label: 'Firecrawl search (free monthly credits)', group: 'Web search (AI agent)', url: 'https://www.firecrawl.dev/app/api-keys' },
  { name: 'LINKUP_API_KEY', label: 'Linkup (free monthly credits)', group: 'Web search (AI agent)', url: 'https://app.linkup.so/' },
  { name: 'SERPER_API_KEY', label: 'Serper.dev Google (2,500 free once)', group: 'Web search (AI agent)', url: 'https://serper.dev/api-key' },
  { name: 'BRAVE_API_KEY', label: 'Brave Search API', group: 'Web search (AI agent)', url: 'https://api-dashboard.search.brave.com/' },
  { name: 'JINA_API_KEY', label: 'Jina (search + page reader)', group: 'Web search (AI agent)', url: 'https://jina.ai/api-dashboard/' },
  { name: 'GOOGLE_CSE_KEY', label: 'Google Programmable Search API key (100 free/day)', group: 'Web search (AI agent)', url: 'https://developers.google.com/custom-search/v1/introduction' },
  { name: 'GOOGLE_CSE_CX', label: 'Google Programmable Search engine ID (cx) — set to search the whole web', group: 'Web search (AI agent)', url: 'https://programmablesearchengine.google.com/controlpanel/all' },
  { name: 'SEARCHAPI_KEY', label: 'SearchApi.io (100 free/month)', group: 'Web search (AI agent)', url: 'https://www.searchapi.io/' },
  { name: 'SEARXNG_TOKEN', label: 'Hugging Face token for your PRIVATE SearXNG Space (optional)', group: 'Web search (AI agent)', url: 'https://huggingface.co/settings/tokens' },
  { name: 'SEARXNG_URL', label: 'Your SearXNG instance URL (self-hosted = unlimited)', group: 'Web search (AI agent)', url: 'https://docs.searxng.org/' },
  // outreach (find people's work emails)
  { name: 'HUNTER_API_KEY', label: 'Hunter.io (finds work emails, 25 free searches/month)', group: 'Outreach', url: 'https://hunter.io/api-keys' },
  // sign-in emails to people you give access (any address; Gmail app password: myaccount.google.com/apppasswords)
  { name: 'BREVO_API_KEY', label: 'Brevo API key — free 300 emails/day to anyone (alternative to Gmail)', group: 'Access', url: 'https://app.brevo.com/settings/keys/api' },
  { name: 'BREVO_SENDER', label: 'Brevo verified sender email (your Gmail is fine — verify it in Brevo → Senders)', group: 'Access', url: 'https://app.brevo.com/senders' },
  { name: 'GITHUB_TOKEN', label: 'GitHub token (free, no scopes needed) — zero-day dependency radar covers all orgs (5,000 calls/h instead of 60)', group: 'AI', url: 'https://github.com/settings/personal-access-tokens' },
  { name: 'SEC_CONTACT_EMAIL', label: 'Contact email SEC requires for automated EDGAR reads (zero-day funding radar) — defaults to your digest email', group: 'AI', url: 'https://www.sec.gov/os/accessing-edgar-data' },
  { name: 'COHERE_API_KEY', label: 'Cohere (optional) — Rerank v3.5 for the semantic job ranking (free trial key)', group: 'AI', url: 'https://dashboard.cohere.com/api-keys' },
  { name: 'GOOGLE_CLIENT_ID', label: 'Google sign-in: OAuth Client ID (Web application)', group: 'Access', url: 'https://console.cloud.google.com/apis/credentials' },
  { name: 'GOOGLE_CLIENT_SECRET', label: 'Google sign-in: OAuth Client secret', group: 'Access', url: 'https://console.cloud.google.com/apis/credentials' },
  { name: 'GMAIL_USER', label: 'Gmail address that sends sign-in links', group: 'Access', url: 'https://myaccount.google.com/apppasswords' },
  { name: 'GMAIL_APP_PASSWORD', label: 'Gmail app password (16 letters)', group: 'Access', url: 'https://myaccount.google.com/apppasswords' },
  // daily email digest
  { name: 'RESEND_API_KEY', label: 'Resend API key (daily job email, free 100/day)', group: 'Email digest', url: 'https://resend.com/api-keys' },
  { name: 'DIGEST_TO', label: 'Send the daily job email to (your email)', group: 'Email digest', url: 'https://resend.com/docs' },
  { name: 'WATCH_NOTIFY_TO', label: 'Email for Watch-companies alerts (optional — defaults to DIGEST_TO)', group: 'Email digest', url: 'https://resend.com/docs' },
  { name: 'DIGEST_FROM', label: 'From address (optional; needs a verified domain in Resend)', group: 'Email digest', url: 'https://resend.com/domains' },
  // alerts
  { name: 'WHATSAPP_PHONE', label: 'Your WhatsApp number with country code (e.g. 919876543210)', group: 'Alerts', url: 'https://www.callmebot.com/blog/free-api-whatsapp-messages/' },
  { name: 'CALLMEBOT_APIKEY', label: 'CallMeBot API key for WhatsApp (free — send the opt-in message first)', group: 'Alerts', url: 'https://www.callmebot.com/blog/free-api-whatsapp-messages/' },
  { name: 'TWILIO_SID', label: 'Twilio Account SID (optional WhatsApp alternative)', group: 'Alerts', url: 'https://console.twilio.com/' },
  { name: 'TWILIO_TOKEN', label: 'Twilio Auth Token (optional)', group: 'Alerts', url: 'https://console.twilio.com/' },
  { name: 'TWILIO_WHATSAPP_FROM', label: 'Twilio WhatsApp sender, e.g. +14155238886 (optional)', group: 'Alerts', url: 'https://console.twilio.com/' },
  { name: 'TELEGRAM_BOT_TOKEN', label: 'Telegram bot token', group: 'Alerts', url: 'https://t.me/BotFather' },
  { name: 'TELEGRAM_CHAT_ID', label: 'Telegram chat id', group: 'Alerts', url: 'https://core.telegram.org/bots/api#getupdates' },
  { name: 'ALERT_WEBHOOK_URL', label: 'Discord/Slack webhook', group: 'Alerts', url: 'https://support.discord.com/hc/en-us/articles/228383668' },
];
const ALLOWED = new Set(VAULT_KEYS.map((k) => k.name));

function key(): Buffer {
  const s = process.env.AUTH_SECRET || process.env.APP_PASSWORD || 'fde-job-finder-dev';
  return createHash('sha256').update(`vault:${s}`).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(blob: string): string | null {
  try {
    const [v, iv, tag, data] = blob.split(':');
    if (v !== 'v1') return null;
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null; // AUTH_SECRET changed → re-enter keys
  }
}

const g = globalThis as unknown as { __fjVault?: Map<string, string>; __fjVaultAt?: number };

/** Load vault into memory (call at the start of any request that runs sources/agent). Cached 60s per instance. */
export async function loadVault(force = false): Promise<void> {
  if (!force && g.__fjVault && Date.now() - (g.__fjVaultAt || 0) < 60000) return;
  const raw = await getJSON<Record<string, string>>('vault', {});
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(raw)) {
    const p = decrypt(v);
    if (p) m.set(k, p);
  }
  g.__fjVault = m;
  g.__fjVaultAt = Date.now();
}

/** Synchronous lookup: env var first, then vault. */
export function secret(name: string): string {
  return process.env[name] || g.__fjVault?.get(name) || '';
}

export async function vaultStatus() {
  await loadVault(true);
  return VAULT_KEYS.map((k) => {
    const env = Boolean(process.env[k.name]);
    const v = g.__fjVault?.get(k.name);
    return { ...k, source: env ? 'env' : v ? 'vault' : null, hint: env ? 'set in Vercel env' : v ? `…${v.slice(-4)}` : '' };
  });
}

export async function setVault(name: string, value: string | null): Promise<void> {
  if (!ALLOWED.has(name)) throw new Error('Unknown key name');
  const raw = await getJSON<Record<string, string>>('vault', {});
  if (value && value.trim()) raw[name] = encrypt(value.trim());
  else delete raw[name];
  await setJSON('vault', raw);
  await loadVault(true);
}
