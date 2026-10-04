import { getCv } from './cv';
import { aiConfigured, chatJson } from './llm';
import { loadVault, secret } from './secrets';
import { availableEngines, webSearch, type WebResult } from './search';
import { getJSON, hdel, hgetall, hset } from './store';
import { hashId } from './classify';

/**
 * Outreach: find founders / CTOs / engineering managers / recruiters at a company and their work email,
 * then draft a short personal cold email from your CV.
 *
 * Where emails come from (best first):
 *   1. Hunter.io domain search (optional key, 25 free searches/month) — real addresses with confidence scores
 *   2. The company's own website (home, about, team, contact, careers pages) — public addresses
 *   3. Web search snippets that contain "@domain"
 *   4. Pattern guesses (first@, first.last@ …) for people found on LinkedIn/X — clearly marked UNVERIFIED
 * Nothing is ever sent automatically: you review, edit and press send yourself.
 */

export type Confidence = 'verified' | 'found' | 'guess';
export interface Contact {
  id: string;
  name: string;
  role: string;
  email: string;
  confidence: Confidence;
  source: string; // hunter | website | search | pattern
  sourceUrl?: string;
  linkedin?: string;
  priority: number; // higher = better person to email
  status: 'new' | 'drafted' | 'sent' | 'replied' | 'skip';
  draft?: { subject: string; body: string; model?: string };
}
export interface Lead {
  id: string;
  company: string;
  domain: string;
  about: string;
  hiringFor?: string; // job title / link you are targeting
  contacts: Contact[];
  people: { name: string; role: string; url: string }[]; // found but no email (yet)
  log: string[];
  createdAt: string;
  updatedAt: string;
}

const SKIP_HOSTS = /linkedin\.|crunchbase\.|wikipedia\.|x\.com|twitter\.|facebook\.|instagram\.|youtube\.|glassdoor\.|indeed\.|naukri\.|ambitionbox|tracxn|pitchbook|zoominfo|rocketreach|apollo\.io|ycombinator\.com|wellfound|angel\.co|github\.com|medium\.com|bloomberg|techcrunch|inc42|yourstory|economictimes|g2\.com|producthunt|reddit\.|quora\.|ashbyhq|lever\.co|greenhouse\.io|workable\.com|smartrecruiters|myworkdayjobs/i;
const GENERIC = /^(info|hello|hi|contact|support|help|admin|sales|team|office|press|media|marketing|privacy|legal|billing|noreply|no-reply|feedback|enquiries|enquiry|partners?|security|abuse|webmaster|careers|jobs|hr|hiring|talent|recruit(ing|ment)?)@/i;
const HIRING_INBOX = /^(careers|jobs|hr|hiring|talent|recruit(ing|ment)?)@/i;
const ROLE_RANK: [RegExp, number][] = [
  [/hiring manager|engineering manager|head of (engineering|ai|ml|deployment|solutions)|vp,? engineering|director of engineering/i, 95],
  [/\bcto\b|chief technology|co-?founder|founder/i, 90],
  [/\bceo\b|chief executive/i, 80],
  [/forward deployed|deployment lead|solutions lead|ai lead|ml lead|tech lead/i, 75],
  [/recruit|talent|people|\bhr\b|hiring/i, 70],
];

export function rankRole(role: string): number {
  for (const [rx, n] of ROLE_RANK) if (rx.test(role)) return n;
  return 40;
}

export function domainFrom(input: string): string {
  const s = input.trim().toLowerCase();
  if (!/[.]/.test(s) || /\s/.test(s)) return '';
  try {
    return new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function fetchText(url: string, ms = 9000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; job-research)', Accept: 'text/html' } });
    if (!r.ok) return '';
    return (await r.text()).slice(0, 400_000);
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

export function extractEmails(text: string, domain?: string): string[] {
  const deob = text
    .replace(/\s*(\[at\]|\(at\)|\{at\}| at )\s*/gi, '@')
    .replace(/\s*(\[dot\]|\(dot\)|\{dot\})\s*/gi, '.')
    .replace(/&#64;|&#x40;/gi, '@');
  const out = new Set<string>();
  for (const m of deob.matchAll(/[a-z0-9._%+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,24}/gi)) {
    const e = m[0].toLowerCase().replace(/^mailto:/, '').replace(/\.$/, '');
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e) || /sentry|wixpress|example\.|domain\.com|email\.com|yourcompany|@2x/.test(e)) continue;
    if (domain && !e.endsWith(`@${domain}`) && !e.endsWith(`.${domain}`)) continue;
    out.add(e);
  }
  return [...out];
}

const nameKey = (s: string) => s.toLowerCase().replace(/\b(ai|inc|labs?|technologies|tech|pvt|ltd|private|limited|llc|hq)\b/g, '').replace(/[^a-z0-9]/g, '');

async function resolveDomain(company: string, log: (s: string) => void): Promise<{ domain: string; about: string }> {
  const key = nameKey(company);
  const r = await webSearch(`${company} official website`, 10, false);
  const hosts = r.results.map((x) => ({ h: domainFrom(x.url), x })).filter((y) => y.h && !SKIP_HOSTS.test(y.h));
  // 1. a result whose domain contains the company name (bolna.ai for "Bolna AI")
  const named = key.length >= 3 ? hosts.find((y) => nameKey(y.h.split('.').slice(0, -1).join('')).includes(key) || key.includes(nameKey(y.h.split('.')[0]))) : undefined;
  if (named) return { domain: named.h, about: named.x.snippet.slice(0, 300) };
  // 2. try the obvious domains directly
  for (const tld of ['ai', 'com', 'io', 'in', 'co', 'tech']) {
    const d = `${key}.${tld}`;
    const html = await fetchText(`https://${d}`, 6000);
    if (html && html.toLowerCase().includes(company.toLowerCase().split(/\s+/)[0])) return { domain: d, about: '' };
  }
  log(`could not find "${company}"'s website — type the domain instead (e.g. acme.ai)`);
  return { domain: '', about: '' };
}

/** AI pulls real people (name + current role at THIS company) out of search snippets. */
async function aiPeople(company: string, domain: string, results: WebResult[]): Promise<{ name: string; role: string; url: string }[]> {
  if (!results.length || !(await aiConfigured())) return [];
  const list = results.slice(0, 40).map((r, i) => `${i}. ${r.title} | ${r.url} | ${r.snippet.slice(0, 220).replace(/\s+/g, ' ')}`).join('\n');
  try {
    const { data } = await chatJson<{ people: { name: string; role: string; i: number }[] }>(
      'Extract people who CURRENTLY work at the given company from search results. Only real full names. Skip journalists, investors, ex-employees and people at other companies.',
      `Company: ${company} (${domain})\nResults:\n${list}\nJSON: {"people":[{"name":"Full Name","role":"their role at the company","i":<result index>}]}`,
      { maxTokens: 1200, timeoutMs: 45000 },
    );
    return (data?.people || []).map((p) => ({ ...p, name: String(p.name || '').replace(/\(.*?\)|@\w+|\.{2,}|…/g, '').replace(/\s+/g, ' ').trim() })).filter((p) => p.name && p.name.split(' ').length <= 4).map((p) => ({ name: p.name, role: String(p.role || '').slice(0, 120), url: results[p.i]?.url || '' }));
  } catch {
    return [];
  }
}

/** Parses LinkedIn result titles like "Priya Sharma - Co-founder & CTO - Acme AI | LinkedIn". */
function personFromResult(r: WebResult, company: string): { name: string; role: string; url: string } | null {
  if (!/linkedin\.com\/in\//.test(r.url) && !/x\.com\/[A-Za-z0-9_]+$/.test(r.url)) return null;
  const t = r.title.replace(/\s*\|\s*LinkedIn.*$/i, '').replace(/\s+on X.*$/i, '');
  const parts = t.split(/\s+[-–—|]\s+/).map((p) => p.trim()).filter(Boolean);
  if (!parts[0] || parts[0].split(' ').length > 4 || /\d/.test(parts[0])) return null;
  const role = parts.slice(1).join(' · ') || r.snippet.slice(0, 80);
  const c = company.toLowerCase().split(/\s+/)[0];
  if (c && !`${t} ${r.snippet}`.toLowerCase().includes(c)) return null;
  return { name: parts[0], role: role.slice(0, 120), url: r.url };
}

function guessEmails(name: string, domain: string, pattern?: string): string[] {
  const [first, ...rest] = name.toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  const last = rest[rest.length - 1] || '';
  if (!first) return [];
  const fill = (p: string) => p.replace('{first}', first).replace('{last}', last).replace('{f}', first[0]).replace('{l}', last[0] || '');
  if (pattern) return [`${fill(pattern)}@${domain}`];
  return [`${first}@${domain}`, ...(last ? [`${first}.${last}@${domain}`, `${first[0]}${last}@${domain}`] : [])];
}

/** Learns the company's address pattern from a real personal email we found (e.g. priya.s@ → {first}.{l}). */
function learnPattern(found: { email: string; name: string }[]): string | undefined {
  for (const f of found) {
    const [first, ...rest] = f.name.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
    const last = rest[rest.length - 1] || '';
    const local = f.email.split('@')[0];
    if (!first) continue;
    const cands: [string, string][] = [['{first}', first], ['{first}.{last}', `${first}.${last}`], ['{f}{last}', `${first[0]}${last}`], ['{first}{last}', `${first}${last}`], ['{first}_{last}', `${first}_${last}`], ['{first}.{l}', `${first}.${last[0]}`]];
    const hit = cands.find(([, v]) => v === local);
    if (hit) return hit[0];
  }
  return undefined;
}

async function hunter(domain: string, log: (s: string) => void): Promise<{ contacts: Contact[]; pattern?: string }> {
  const key = secret('HUNTER_API_KEY');
  if (!key) return { contacts: [] };
  try {
    const r = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${key}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d?.errors?.[0]?.details || `HTTP ${r.status}`);
    const contacts: Contact[] = (d.data?.emails || []).map((e: any) => {
      const name = [e.first_name, e.last_name].filter(Boolean).join(' ');
      const role = e.position || e.department || '';
      return { id: hashId(e.value), name, role, email: String(e.value).toLowerCase(), confidence: (e.verification?.status === 'valid' || e.confidence >= 90 ? 'verified' : 'found') as Confidence, source: `hunter (${e.confidence}%)`, sourceUrl: e.sources?.[0]?.uri, linkedin: e.linkedin || undefined, priority: rankRole(role) + (name ? 5 : -20), status: 'new' as const };
    });
    log(`Hunter.io: ${contacts.length} emails${d.data?.pattern ? `, pattern ${d.data.pattern}` : ''}`);
    return { contacts, pattern: d.data?.pattern || undefined };
  } catch (e) {
    log(`Hunter.io failed: ${(e as Error).message.slice(0, 120)}`);
    return { contacts: [] };
  }
}

export async function findContacts(input: { company: string; domain?: string; hiringFor?: string }): Promise<Lead> {
  await loadVault();
  const lines: string[] = [];
  const log = (s: string) => lines.push(s);
  if (!availableEngines().length && !secret('HUNTER_API_KEY')) throw new Error('Add a web-search key (Tavily is free) or a Hunter.io key in "AI & Keys" first.');
  let company = input.company.trim();
  let domain = domainFrom(input.domain || '') || domainFrom(company);
  if (domain && company.includes('.')) company = domain.split('.')[0];
  let about = '';
  if (!domain) ({ domain, about } = await resolveDomain(company, log));
  if (!domain) throw new Error(lines.join(' · ') || 'Could not find the company website');
  log(`website: ${domain}`);

  const contacts = new Map<string, Contact>();
  const add = (c: Contact) => {
    const prev = contacts.get(c.email);
    if (!prev || (prev.confidence === 'guess' && c.confidence !== 'guess') || (!prev.name && c.name)) contacts.set(c.email, { ...prev, ...c });
  };

  // 1. Hunter (if key)
  const h = await hunter(domain, log);
  h.contacts.forEach(add);

  // 2. Company website pages
  const pages = ['', '/about', '/about-us', '/team', '/company', '/contact', '/contact-us', '/careers', '/jobs'].map((p) => `https://${domain}${p}`);
  const html = await Promise.all(pages.map((u) => fetchText(u)));
  let siteEmails = 0;
  html.forEach((t, i) => {
    if (!about && i === 0) about = (t.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{20,300})/i)?.[1] || '').trim();
    for (const e of extractEmails(t, domain)) {
      siteEmails++;
      add({ id: hashId(e), name: '', role: HIRING_INBOX.test(e) ? 'Hiring inbox' : GENERIC.test(e) ? 'General inbox' : '', email: e, confidence: 'found', source: 'website', sourceUrl: pages[i], priority: HIRING_INBOX.test(e) ? 60 : GENERIC.test(e) ? 20 : 55, status: 'new' });
    }
  });
  log(`website pages: ${siteEmails} email(s) on ${html.filter(Boolean).length}/${pages.length} pages`);

  // 3. Web search: people + emails in snippets
  const people = new Map<string, { name: string; role: string; url: string }>();
  if (availableEngines().length) {
    // (people come from AI extraction when a provider is set, else LinkedIn result titles)
    const qs = [
      `"@${domain}" email`,
      `${company} founder CEO CTO co-founder`,
      `site:linkedin.com/in ${company} founder OR CTO OR "engineering manager" OR "head of engineering"`,
      `${company} ${domain} recruiter OR "talent acquisition" OR "hiring manager" OR "head of engineering"`,
    ];
    const res = await Promise.allSettled(qs.map((q) => webSearch(q, 10, false)));
    const all: WebResult[] = [];
    for (const r of res) {
      if (r.status !== 'fulfilled') continue;
      for (const x of r.value.results) {
        all.push(x);
        for (const e of extractEmails(`${x.title} ${x.snippet}`, domain)) add({ id: hashId(e), name: '', role: GENERIC.test(e) ? 'General inbox' : '', email: e, confidence: 'found', source: 'search', sourceUrl: x.url, priority: GENERIC.test(e) ? 20 : 50, status: 'new' });
      }
    }
    const viaAi = await aiPeople(company, domain, all);
    for (const p of viaAi) if (!people.has(p.name.toLowerCase())) people.set(p.name.toLowerCase(), p);
    if (!viaAi.length) for (const x of all) { const p = personFromResult(x, company); if (p && !people.has(p.name.toLowerCase())) people.set(p.name.toLowerCase(), p); }
    log(`web search: ${people.size} people found`);
  }

  // match people to found emails by first name; otherwise guess with the learned pattern
  const named = [...contacts.values()].filter((c) => c.name);
  const pattern = h.pattern || learnPattern(named);
  for (const p of [...people.values()].sort((a, b) => rankRole(b.role) - rankRole(a.role)).slice(0, 6)) {
    const first = p.name.toLowerCase().split(' ')[0];
    const match = [...contacts.values()].find((c) => c.email.split('@')[0].startsWith(first));
    if (match) {
      contacts.set(match.email, { ...match, name: match.name || p.name, role: match.role || p.role, linkedin: p.url, priority: rankRole(p.role) + 5 });
      continue;
    }
    const g = guessEmails(p.name, domain, pattern)[0];
    if (g && !contacts.has(g)) add({ id: hashId(g), name: p.name, role: p.role, email: g, confidence: 'guess', source: pattern ? `pattern ${pattern}` : 'pattern (common)', sourceUrl: p.url, linkedin: p.url, priority: rankRole(p.role) - 15, status: 'new' });
  }

  const now = new Date().toISOString();
  const id = hashId(domain);
  const prev = (await hgetall<Lead>('outreach:leads'))[id];
  // keep your status/drafts on contacts you already worked on
  const merged = [...contacts.values()].map((c) => {
    const old = prev?.contacts.find((o) => o.email === c.email);
    return old ? { ...c, status: old.status, draft: old.draft } : c;
  });
  const lead: Lead = {
    id, company: company.replace(/^\w/, (c) => c.toUpperCase()), domain, about: about.slice(0, 300), hiringFor: input.hiringFor || prev?.hiringFor,
    contacts: merged.sort((a, b) => b.priority - a.priority).slice(0, 15),
    people: [...people.values()].slice(0, 10), log: lines, createdAt: prev?.createdAt || now, updatedAt: now,
  };
  await hset('outreach:leads', id, lead);
  return lead;
}

export async function listLeads(): Promise<Lead[]> {
  return Object.values(await hgetall<Lead>('outreach:leads')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteLead(id: string) {
  await hdel('outreach:leads', id);
}

export async function updateContact(leadId: string, contactId: string, patch: Partial<Pick<Contact, 'status' | 'draft' | 'email' | 'name' | 'role'>>): Promise<Lead> {
  const lead = (await hgetall<Lead>('outreach:leads'))[leadId];
  if (!lead) throw new Error('Lead not found');
  lead.contacts = lead.contacts.map((c) => (c.id === contactId ? { ...c, ...patch } : c));
  lead.updatedAt = new Date().toISOString();
  await hset('outreach:leads', leadId, lead);
  return lead;
}

export async function draftEmail(leadId: string, contactId: string, extra?: string): Promise<Lead> {
  await loadVault();
  if (!(await aiConfigured())) throw new Error('Add an AI provider in "AI & Keys" to draft emails.');
  const lead = (await hgetall<Lead>('outreach:leads'))[leadId];
  const c = lead?.contacts.find((x) => x.id === contactId);
  if (!lead || !c) throw new Error('Contact not found');
  const cv = await getCv();
  if (!cv.text && !cv.skills.length) throw new Error('Upload your CV in the CV tab first, so the email uses your real experience (nothing is invented).');
  const profile = await getJSON<{ name?: string }>('profile', {});
  const { data, meta } = await chatJson<{ subject: string; body: string }>(
    `You write short, specific cold emails from a job seeker to a person at a company. Rules: max 120 words in the body; no flattery, no buzzwords, no "I hope this email finds you well"; open with why THIS company; give 2 concrete proof points from the CV with numbers if present; one clear ask (15-min call or referral to the right person); sign off with the candidate's name taken from the CV. NEVER invent facts, numbers, employers or names: use only what is in the CV; if something is missing write a [placeholder] in square brackets. Plain text, no markdown.`,
    `Candidate CV:\n${(cv.text || `Skills: ${cv.skills.join(', ')}`).slice(0, 5000)}\n\nCompany: ${lead.company} (${lead.domain}) — ${lead.about || 'no description'}\nRole the candidate wants: ${lead.hiringFor || 'Forward Deployed Engineer / AI Engineer'}\nRecipient: ${c.name || 'the team'}${c.role ? `, ${c.role}` : ''}\nLocation rule: candidate works from Bengaluru office or remote only.\n${extra ? `Extra instructions: ${extra}\n` : ''}${profile.name ? `Candidate name: ${profile.name}\n` : ''}\nJSON: {"subject":"<= 8 words","body":"..."}`,
    { maxTokens: 900 },
  );
  if (!data?.body) throw new Error('AI returned no draft, try again');
  return updateContact(leadId, contactId, { draft: { subject: String(data.subject || '').slice(0, 120), body: String(data.body).slice(0, 2500), model: `${meta.provider} · ${meta.model}` }, status: c.status === 'new' ? 'drafted' : c.status });
}
