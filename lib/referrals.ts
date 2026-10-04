import { randomBytes } from 'node:crypto';
import { findContacts, guessEmails, learnPattern, personFromResult, type Contact, type Lead } from './outreach';
import { webSearch } from './search';
import { pool } from './http';
import { aiConfigured, chatJson } from './llm';
import { getCv } from './cv';
import { hgetall, hset, hdel } from './store';
import { loadVault } from './secrets';

/**
 * Recruiters & referrals: paste a company (and the role) →
 *  - REAL people found on public LinkedIn / web results, grouped: recruiters · hiring managers / leaders · engineers who can refer
 *  - emails: found on the web / company site (verified or found), else guessed from the company's learned email pattern (marked "guess")
 *  - a referral kit written from YOUR CV: who to ask first, exact messages, how to make the referrer's job easy, follow-ups
 * Honest: nobody can guarantee a referral; this finds the right people and gives you the best possible ask.
 */
export interface Person { name: string; title: string; url: string; group: 'recruiter' | 'manager' | 'referrer'; email?: string; emailConfidence?: 'verified' | 'found' | 'guess' }
export interface ReferralReport {
  id: string; at: string; company: string; domain: string; role: string; people: Person[]; inboxes: { email: string; confidence: string }[];
  kit: { ladder: { step: string; who: string; why: string }[]; messages: { kind: string; to: string; text: string }[]; makeItEasy: string[]; hacks: string[]; searches: { label: string; url: string }[] } | null;
  log: string[];
}

const groupOf = (title: string): Person['group'] =>
  /hiring manager/i.test(title) ? 'manager'
    : /recruit|talent|sourc|people partner|\bhr\b|human resources|\bhiring\b/i.test(title) ? 'recruiter'
    : /manager|head of|director|vp|vice president|lead|founder|cto|ceo|chief|principal/i.test(title) ? 'manager' : 'referrer';

export async function referralReport(companyIn: string, roleIn = ''): Promise<ReferralReport> {
  await loadVault();
  const company = companyIn.trim();
  const role = roleIn.trim() || 'Forward Deployed Engineer / AI Engineer';
  if (!company) throw new Error('Type a company name or website');
  const log: string[] = [];
  const kw = /forward|deploy/i.test(role) ? '"forward deployed" OR "solutions engineer" OR "applied AI"' : `"${role.split(/[\/,(]/)[0].trim()}" OR "AI engineer" OR "machine learning"`;
  const qs = [
    `site:linkedin.com/in "${company}" (recruiter OR "talent acquisition" OR "technical recruiter")`,
    `site:linkedin.com/in "${company}" ("engineering manager" OR "head of engineering" OR "director of engineering" OR "hiring manager")`,
    `site:linkedin.com/in "${company}" (${kw})`,
    `site:linkedin.com/in "${company}" (Bengaluru OR Bangalore OR India) engineer`,
  ];
  // in parallel: people search + the outreach engine (company site, Hunter, emails, pattern) in both modes
  const [srch, hire, ref] = await Promise.allSettled([
    pool(qs, 4, (q) => webSearch(q, 15, 'any')),
    findContacts({ company, hiringFor: role, mode: 'hiring' }),
    findContacts({ company, hiringFor: role, mode: 'referral' }),
  ]);
  const leads = [hire, ref].filter((r): r is PromiseFulfilledResult<Lead> => r.status === 'fulfilled').map((r) => r.value);
  if (!leads.length) log.push(`email search failed: ${hire.status === 'rejected' ? (hire.reason as Error).message : ''}`);
  const domain = leads[0]?.domain || '';
  const contacts: Contact[] = leads.flatMap((l) => l.contacts);
  const pattern = learnPattern(contacts.filter((c) => c.name && c.confidence !== 'guess').map((c) => ({ email: c.email, name: c.name })));
  const people = new Map<string, Person>();
  const add = (p: Person) => { const k = p.name.toLowerCase(); if (!people.has(k)) people.set(k, p); };
  if (srch.status === 'fulfilled') for (const r of srch.value) if (r.status === 'fulfilled') for (const x of r.value.results) {
    const p = personFromResult(x, company);
    if (p) { const title = p.role.replace(/#+/g, '').split('\n').map((x) => x.trim()).filter((x) => x && x !== p.name).join(' · ').slice(0, 120); add({ name: p.name, title, url: p.url, group: groupOf(title) }); }
  }
  for (const l of leads) for (const p of l.people) add({ name: p.name, title: p.role, url: p.url, group: groupOf(p.role) });
  for (const c of contacts) if (c.name) add({ name: c.name, title: c.role, url: c.linkedin || c.sourceUrl || '', group: c.kind === 'referrer' ? 'referrer' : groupOf(c.role) });
  // attach emails: found ones first, else the company pattern (marked guess)
  for (const p of people.values()) {
    const first = p.name.split(' ')[0].toLowerCase();
    const hit = contacts.find((c) => c.name && c.name.toLowerCase() === p.name.toLowerCase()) || contacts.find((c) => c.confidence !== 'guess' && c.email.toLowerCase().startsWith(first));
    if (hit) { p.email = hit.email; p.emailConfidence = hit.confidence; }
    else if (domain) { const g = guessEmails(p.name, domain, pattern)[0]; if (g) { p.email = g; p.emailConfidence = 'guess'; } }
  }
  const inboxes = contacts.filter((c) => !c.name && /careers|jobs|hr|talent|recruit|hiring/i.test(c.email)).map((c) => ({ email: c.email, confidence: c.confidence }));
  const list = [...people.values()].sort((a, b) => ['recruiter', 'manager', 'referrer'].indexOf(a.group) - ['recruiter', 'manager', 'referrer'].indexOf(b.group));
  log.push(`${list.length} people (${list.filter((p) => p.group === 'recruiter').length} recruiters, ${list.filter((p) => p.group === 'manager').length} managers/leaders, ${list.filter((p) => p.group === 'referrer').length} possible referrers)${domain ? ` · domain ${domain}` : ''}${pattern ? ` · email pattern ${pattern}` : ''}`);
  for (const l of leads) log.push(...l.log.slice(-3));

  const enc = encodeURIComponent;
  const searches = [
    { label: 'LinkedIn: recruiters at the company', url: `https://www.linkedin.com/search/results/people/?keywords=${enc(`${company} recruiter`)}` },
    { label: 'LinkedIn: people in this role there', url: `https://www.linkedin.com/search/results/people/?keywords=${enc(`${company} ${role.split(/[\/,(]/)[0]}`)}` },
    { label: 'LinkedIn: your 2nd-degree connections there', url: `https://www.linkedin.com/search/results/people/?keywords=${enc(company)}&network=%5B%22S%22%5D` },
    { label: 'LinkedIn: alumni of your college there (edit school)', url: `https://www.linkedin.com/search/results/people/?keywords=${enc(`${company} alumni`)}` },
    { label: 'X: people from the company', url: `https://x.com/search?q=${enc(`"${company}" (hiring OR "we're hiring")`)}&f=live` },
  ];

  let kit: ReferralReport['kit'] = null;
  if (await aiConfigured()) {
    const cv = await getCv();
    const { data } = await chatJson<NonNullable<ReferralReport['kit']>>(
      'You are an elite referral strategist. Write genuine, short, specific messages — never fake familiarity, never invent candidate experience beyond the CV. Optimise for reply rate.',
      `COMPANY: ${company} (${domain || 'domain unknown'}) · TARGET ROLE: ${role}
PEOPLE FOUND: ${list.slice(0, 25).map((p) => `${p.name} — ${p.title} [${p.group}]`).join('; ') || 'none found'}
CANDIDATE: ${cv.text ? cv.text.slice(0, 3500) : `CV not uploaded; skills: ${cv.skills.join(', ') || 'AI engineering, moving into FDE / AI-ML'}`}
JSON: {"ladder":[{"step":"1","who":"name or title from the list","why":""}],"messages":[{"kind":"LinkedIn connection note (<300 chars) to an engineer","to":"","text":""},{"kind":"Referral ask (after they accept)","to":"","text":""},{"kind":"Recruiter email","to":"","text":""},{"kind":"Hiring manager email","to":"","text":""},{"kind":"Follow-up (day 5)","to":"","text":""},{"kind":"Thank-you after referral","to":"","text":""}],"makeItEasy":["what to send the referrer so referring you takes 2 minutes"],"hacks":["genuine tactics: alumni, open-source contribution to their repo, comment on their posts, meetups, etc."]}`,
      { maxTokens: 3500, timeoutMs: 100000 },
    ).catch(() => ({ data: null }));
    kit = data ? { ...data, searches } : { ladder: [], messages: [], makeItEasy: [], hacks: [], searches };
  } else kit = { ladder: [], messages: [], makeItEasy: [], hacks: [], searches };

  const rep: ReferralReport = { id: randomBytes(5).toString('hex'), at: new Date().toISOString(), company, domain, role, people: list.slice(0, 60), inboxes, kit, log };
  await hset('referrals', rep.id, rep);
  return rep;
}

export async function listReferralReports() {
  return Object.values(await hgetall<ReferralReport>('referrals')).sort((a, b) => b.at.localeCompare(a.at)).map((r) => ({ id: r.id, at: r.at, company: r.company, role: r.role, people: r.people.length }));
}
export async function getReferralReport(id: string) { return (await hgetall<ReferralReport>('referrals'))[id] || null; }
export async function deleteReferralReport(id: string) { await hdel('referrals', id); }
