import { findContacts, type Contact } from './outreach';
import { chatJson, aiConfigured } from './llm';
import { getCv } from './cv';
import { hashId } from './classify';
import { hgetall, hset } from './store';
import { loadVault } from './secrets';
import { track } from './obs';

/**
 * "Reach the decision-maker" for ONE job or post: who actually decides, the fastest honest route to them, and the exact words.
 *  - posts (X / LinkedIn): the author IS usually the hiring person → reply/DM them first (fastest route there is)
 *  - jobs: real people found on the web (hiring manager / founder / CTO / recruiter), emails found or pattern-guessed (labelled),
 *    plus "jugaad" routes: the team's engineers for a referral, their GitHub/blog, events, alumni, the ATS hiring-team field…
 * Honest: never invents a person — every name comes from a search result; guessed emails say "guess".
 */
export interface ReachInput { title: string; company: string; url: string; text?: string; location?: string; author?: string }
export interface ReachPlan {
  id: string; at: string; input: ReachInput;
  decider: { who: string; why: string };
  people: { name: string; role: string; url?: string; email?: string; confidence?: string; why?: string }[];
  inboxes: string[];
  route: { step: string; how: string }[];
  hacks: string[];
  messages: { channel: string; to: string; text: string }[];
  searches: { label: string; url: string }[];
  warnings: string[];
  model?: string;
}

const EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const isPost = (u: string) => /(?:x|twitter)\.com\/[^/]+\/status|linkedin\.com\/(posts|feed\/update)\//i.test(u);

export async function getReach(url: string): Promise<ReachPlan | null> { return (await hgetall<ReachPlan>('reach'))[hashId(url)] || null; }

export async function reachPlan(input: ReachInput): Promise<ReachPlan> {
  await loadVault();
  const t0 = Date.now();
  const id = hashId(input.url);
  const company = (input.company || '').trim();
  const role = input.title.trim();
  const post = isPost(input.url);
  const textEmails = Array.from(new Set((input.text || '').match(EMAIL_RX) || [])).slice(0, 5);
  const warnings: string[] = [];

  // real people (web + company site + Hunter if set) — capped at 45 s so the button never hangs
  let contacts: Contact[] = [];
  let people: { name: string; role: string; url: string }[] = [];
  let domain = '';
  if (company && !/^(not stated|unknown|confidential|stealth)$/i.test(company)) {
    const lead = await Promise.race([findContacts({ company, hiringFor: role, mode: 'hiring' }).catch((e) => { warnings.push(`people search: ${(e as Error).message.slice(0, 120)}`); return null; }), new Promise<null>((r) => setTimeout(() => r(null), 45000))]);
    if (lead) { contacts = lead.contacts; people = lead.people; domain = lead.domain; }
    else if (!warnings.length) warnings.push('people search took too long — use the search links below');
  } else warnings.push('company not stated in the posting — the poster is your only direct route');

  const q = encodeURIComponent;
  const searches = [
    ...(company ? [
      { label: `LinkedIn: hiring managers at ${company}`, url: `https://www.linkedin.com/search/results/people/?keywords=${q(`${company} engineering manager OR head of AI OR CTO`)}` },
      { label: `LinkedIn: recruiters at ${company}`, url: `https://www.linkedin.com/search/results/people/?keywords=${q(`${company} recruiter OR talent acquisition`)}` },
      { label: `LinkedIn: engineers at ${company} (referrals)`, url: `https://www.linkedin.com/search/results/people/?keywords=${q(`${company} ${/ml|ai|llm/i.test(role) ? 'ML engineer' : 'software engineer'}`)}` },
      { label: 'Google X-ray: decision-makers', url: `https://www.google.com/search?q=${q(`site:linkedin.com/in "${company}" ("hiring manager" OR "engineering manager" OR "head of" OR founder OR CTO)`)}` },
      { label: `X: people at ${company}`, url: `https://x.com/search?q=${q(`"${company}" (founder OR CTO OR "head of" OR hiring)`)}&f=user` },
      { label: `X: ${company} hiring posts`, url: `https://x.com/search?q=${q(`"${company}" hiring`)}&f=live` },
    ] : []),
    ...(post ? [{ label: 'Open the post (reply / DM the author)', url: input.url }] : []),
  ];

  const ranked = contacts.filter((c) => c.status !== 'skip').sort((a, b) => b.priority - a.priority).slice(0, 8);
  const peopleOut: ReachPlan["people"] = [
    ...(post && input.author ? [{ name: input.author, role: 'author of this post', url: input.url, why: 'They posted the opening — usually the hiring manager, founder or recruiter themselves.' }] : []),
    ...ranked.filter((c) => c.name).map((c) => ({ name: c.name, role: c.role, url: c.linkedin || c.sourceUrl, email: c.email, confidence: c.confidence })),
    ...people.filter((p) => !ranked.some((c) => c.name.toLowerCase() === p.name.toLowerCase())).slice(0, 8).map((p) => ({ name: p.name, role: p.role, url: p.url })),
  ].slice(0, 12);
  const inboxes = Array.from(new Set([...textEmails, ...ranked.filter((c) => !c.name).map((c) => c.email)])).slice(0, 6);

  let plan: Partial<ReachPlan> = {};
  if (await aiConfigured()) {
    const cv = await getCv();
    const { data, meta } = await chatJson<{ decider: { who: string; why: string }; route: { step: string; how: string }[]; hacks: string[]; messages: { channel: string; to: string; text: string }[]; people_why?: Record<string, string> }>(
      'You are an elite tech recruiter-turned-coach. You know exactly who decides on a hire at startups vs big companies and the fastest honest route to them. Brutally practical, no fluff, no invented facts.',
      `Job / post: ${role} at ${company || 'company not stated'} (${input.location || 'location not stated'})
URL: ${input.url}${post ? `\nThis is a SOCIAL POST by ${input.author || 'the author'} — they are most likely the hiring person.` : ''}
Text: ${(input.text || '').slice(0, 2500)}
Emails in the text: ${textEmails.join(', ') || 'none'}
Company website: ${domain || 'unknown'}
REAL people found (use ONLY these names; never invent anyone): ${JSON.stringify(peopleOut.map((p) => ({ name: p.name, role: p.role, email: p.email, confidence: p.confidence })))}
Other inboxes found: ${inboxes.join(', ') || 'none'}
Candidate (write messages for them): ${(cv.text || cv.skills.join(', ') || 'no CV uploaded — keep messages generic but specific to the role').slice(0, 2500)}

Return JSON:
{"decider":{"who":"the single person/title who actually makes this hiring decision here (name if in the list) ","why":"1 line"},
"route":[{"step":"1. …","how":"exactly what to do, where to click, what to say — the FASTEST route to the decider, in order (post author DM / reply, email the hiring manager, referral from a team engineer, recruiter last)"}],
"hacks":["5-8 specific smart shortcuts / jugaad for THIS company+role: e.g. comment with a 3-line proof on their latest post, find the engineering manager via the GitHub org / engineering blog authors, the hiring-team box on the LinkedIn job page, Greenhouse/Ashby 'hiring team' names, meetups/hackathons they sponsor, alumni from your college, a tiny demo built on their product sent in the DM… only ones that genuinely apply"],
"messages":[{"channel":"LinkedIn connection note (≤300 chars)","to":"name/title","text":""},{"channel":"Cold email","to":"","text":"Subject: …\\n\\n≤120 words"},{"channel":"X / LinkedIn DM to the post author","to":"","text":"≤280 chars"},{"channel":"Referral ask to an engineer","to":"","text":""},{"channel":"Follow-up after 4 days","to":"","text":""}],
"people_why":{"<name>":"why this person matters"}}`,
      { maxTokens: 2600, timeoutMs: 60000 },
    ).catch((e) => { warnings.push(`AI plan failed: ${(e as Error).message.slice(0, 120)}`); return { data: null, meta: null }; });
    if (data) {
      plan = { decider: data.decider, route: data.route || [], hacks: data.hacks || [], messages: data.messages || [], model: meta ? `${meta.provider} · ${meta.model}` : undefined };
      for (const p of peopleOut) { const w = data.people_why?.[p.name]; if (w) (p as { why?: string }).why = w; }
    }
  } else warnings.push('no AI provider set — route below is the generic playbook');

  const out: ReachPlan = {
    id, at: new Date().toISOString(), input: { ...input, text: (input.text || '').slice(0, 1500) },
    decider: plan.decider || { who: post ? `${input.author || 'The post author'}` : 'Hiring / engineering manager of the team', why: post ? 'They posted it — reply and DM them directly.' : 'At startups the founder/CTO decides; at bigger companies the hiring manager does — recruiters only screen.' },
    people: peopleOut, inboxes,
    route: plan.route?.length ? plan.route : [
      ...(post ? [{ step: '1. Reply + DM the author within hours', how: 'A 2-line reply with one proof link, then a DM with your CV link. Speed beats polish on posts.' }] : []),
      { step: `${post ? '2' : '1'}. Find the hiring manager`, how: 'Use the LinkedIn search links below; message the engineering manager/founder, not the recruiter.' },
      { step: `${post ? '3' : '2'}. Get a referral`, how: 'Ask one engineer on that team with a ready-to-forward blurb + CV link.' },
      { step: `${post ? '4' : '3'}. Apply through the official link the same day`, how: input.url },
    ],
    hacks: plan.hacks || [], messages: plan.messages || [], searches, warnings, model: plan.model,
  };
  await hset('reach', id, out);
  await track('ai', 'reach decision-maker', 'ok', `${role} @ ${company || 'n/a'}: ${peopleOut.length} people, ${inboxes.length} inboxes`, Date.now() - t0);
  return out;
}

export function reachToText(p: ReachPlan): string {
  return [
    `# Reach: ${p.input.title} — ${p.input.company}`, p.input.url, '',
    `Decider: ${p.decider.who} — ${p.decider.why}`, '',
    '## Route', ...p.route.map((r) => `${r.step} — ${r.how}`), '',
    '## People', ...p.people.map((x) => `- ${x.name} (${x.role})${x.email ? ` · ${x.email}${x.confidence === 'guess' ? ' (guess)' : ''}` : ''}${x.url ? ` · ${x.url}` : ''}${x.why ? ` — ${x.why}` : ''}`),
    ...(p.inboxes.length ? ['', `Inboxes: ${p.inboxes.join(', ')}`] : []), '',
    '## Hacks', ...p.hacks.map((h) => `- ${h}`), '',
    '## Messages', ...p.messages.flatMap((m) => [`### ${m.channel}${m.to ? ` → ${m.to}` : ''}`, m.text, '']),
  ].join('\n');
}
