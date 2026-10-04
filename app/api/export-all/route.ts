import { guard } from '@/lib/guard';
import { getJobs } from '@/lib/refresh';
import { getIntel } from '@/lib/intel';
import { computeTrends, type MarketReport } from '@/lib/trends';
import { getDiscovered } from '@/lib/discover';
import { getDirectory } from '@/lib/directory';
import { getJSON, hgetall } from '@/lib/store';
import { isFreshFind, MISSIONS, type Find } from '@/lib/agent';
import { locationAllowed, locationTags, regionRank } from '@/lib/classify';
import type { Opp } from '@/lib/opportunities';
import type { TrackEntry } from '@/lib/types';
import type { Lead } from '@/lib/outreach';

export const maxDuration = 60;

type Section = { title: string; text?: string; headers?: string[]; rows?: string[][] };
const d10 = (s?: string | null) => (s ? s.slice(0, 10) : '');

// "Export everything": every page's current data as ready-to-print sections (one PDF, built in the browser).
export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const [jobs, findsH, intel, trends, report, opps, disc, track, leads] = await Promise.all([
    getJobs(), hgetall<Find>('agent:finds'), getIntel(), computeTrends(), getJSON<MarketReport | null>('trends:report', null),
    getJSON<{ at: string; items: Opp[] } | null>('opps', null), getDiscovered(), hgetall<TrackEntry>('track'), hgetall<Lead>('outreach:leads'),
  ]);
  const S: Section[] = [];
  const sortedJobs = [...jobs].sort((a, b) => regionRank(a.locTags) - regionRank(b.locTags) || Date.parse(b.postedAt || b.firstSeen) - Date.parse(a.postedAt || a.firstSeen));
  S.push({ title: `Jobs (${jobs.length}) — Bengaluru first, then remote (India OK), newest first`, headers: ['Role', 'Company', 'Location', 'Posted', 'Exp (yrs)', 'Pay', 'Link'],
    rows: sortedJobs.slice(0, 600).map((j) => [j.title, j.company, j.location, d10(j.postedAt || j.firstSeen), j.exp ? `${j.exp.min}-${j.exp.max}${j.exp.estimated ? '?' : ''}` : '', j.salary || j.payBand || '', j.url]) });

  const finds = Object.values(findsH).filter((f) => f.status !== 'dismissed' && isFreshFind(f))
    .map((f) => ({ ...f, locTags: locationTags({ title: f.title, company: f.company, location: f.location, url: f.url }) }))
    .filter((f) => f.kind !== 'job' || !f.location || locationAllowed(f.locTags, f.location));
  for (const m of MISSIONS) {
    const list = finds.filter((f) => f.mission === m.id).sort((a, b) => Date.parse(b.postedAt || b.foundAt) - Date.parse(a.postedAt || a.foundAt));
    if (!list.length) continue;
    S.push({ title: `Agent — ${m.title} (${list.length})`, headers: ['Type', 'Title', 'Company / author', 'Location', 'Date', 'How to apply', 'Link'],
      rows: list.slice(0, 200).map((f) => [f.kind, f.title, f.author || f.company, f.location, d10(f.postedAt || f.foundAt), f.applyHow || f.why || '', f.url]) });
  }
  const custom = finds.filter((f) => !MISSIONS.some((m) => m.id === f.mission));
  if (custom.length) S.push({ title: `Agent — custom searches (${custom.length})`, headers: ['Type', 'Title', 'Company', 'Location', 'Date', 'Link'], rows: custom.slice(0, 200).map((f) => [f.kind, f.title, f.author || f.company, f.location, d10(f.postedAt || f.foundAt), f.url]) });

  if (report) {
    S.push({ title: `Trends — market report (news from the last ${report.days || 7} days, built ${d10(report.at)})`, text: report.summary || '' });
    S.push({ title: 'Trends — headlines', headers: ['Date', 'Headline', 'Summary', 'Region', 'Link'], rows: report.headlines.map((h) => [h.date || '', h.title, h.summary, h.region, h.url]) });
    S.push({ title: 'Trends — hot skills & new roles', headers: ['Skill / role', 'Why / what', 'Region / who hires'], rows: [...report.hot_skills.map((h) => [h.skill, h.why, h.region]), ...report.new_roles.map((r) => [`ROLE: ${r.role}`, r.what, r.who_hires])] });
    S.push({ title: 'Trends — your next moves', text: report.your_moves.map((m, i) => `${i + 1}. ${m}`).join('\n') });
  }
  S.push({ title: `Trends — live job data (${trends.total} jobs & posts)`, headers: ['Top skills', 'n', 'Roles', 'n', 'Companies', 'n'],
    rows: Array.from({ length: 20 }, (_, i) => [trends.skills[i]?.key || '', String(trends.skills[i]?.n ?? ''), trends.roles[i]?.key || '', String(trends.roles[i]?.n ?? ''), trends.companies[i]?.key || '', String(trends.companies[i]?.n ?? '')]).filter((r) => r.some(Boolean)) });

  S.push({ title: `Hiring radar (${intel.hiring.length} companies)`, text: intel.hiringMeta?.brief || '', headers: ['Company', 'Date', 'Signal', 'Likely roles', 'Region', 'When', 'Link'],
    rows: intel.hiring.slice(0, 150).flatMap((c) => c.hiring.slice(0, 2).map((h) => [c.name, h.date, h.signal, h.roles, h.region, h.timeframe, h.url])) });
  S.push({ title: `Layoffs (${intel.layoffs.length} companies)`, text: intel.layoffsMeta?.brief || '', headers: ['Company', 'Date', 'Cut', 'Why', 'Next', 'For you', 'Link'],
    rows: intel.layoffs.slice(0, 150).flatMap((c) => c.layoffs.slice(0, 2).map((l) => [c.name, l.date, l.count, l.reason, l.next, l.forYou || '', l.url])) });

  const dir = await getDirectory();
  const hiring = dir.companies.filter((c) => c.fde + c.aiml > 0 || c.roles.length);
  S.push({ title: `Companies hiring (${hiring.length} with FDE/AI roles; ${dir.counts.fdeNow} with FDE roles)`, headers: ['Company', 'FDE', 'AI/ML', 'BLR', 'Remote', 'New 24h', 'Open roles', 'Careers page'],
    rows: hiring.slice(0, 400).map((c) => [c.name, String(c.fde), String(c.aiml), String(c.blr), String(c.remoteIn), String(c.new24h || ''), c.roles.slice(0, 3).map((r) => r.title).join('; '), c.careersUrl]) });

  const withRoles = disc.filter((c) => c.roles.length).slice(0, 200);
  S.push({ title: `Hidden jobs & new startups (${withRoles.length} with open FDE/AI roles)`, headers: ['Company', 'Location', 'Source', 'Funding', 'Open roles', 'Link'],
    rows: withRoles.map((c) => [c.name, c.location, `${c.source}${c.fundedAt ? ` ${d10(c.fundedAt)}` : ''}`, c.fundingNews || '', c.roles.map((r) => r.title).join('; '), c.roles[0]?.url || c.website || '']) });

  if (opps) S.push({ title: `Opportunities (${opps.items.length}, updated ${d10(opps.at)})`, headers: ['Type', 'Title', 'Org', 'Pay / prize', 'Deadline', 'Link'],
    rows: opps.items.filter((o) => !o.deadline || Date.parse(o.deadline) > Date.now()).map((o) => [o.kind, o.title, o.org, o.pay || o.prize || '', d10(o.deadline), o.url]) });

  const t = Object.values(track);
  if (t.length) S.push({ title: `Tracker (${t.length})`, headers: ['Status', 'Role', 'Company', 'Updated', 'Notes', 'Link'], rows: t.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((e) => [e.status, e.job.title, e.job.company, d10(e.updatedAt), e.notes || '', e.job.url]) });
  const contacts = Object.values(leads).flatMap((l) => l.contacts.map((c) => [l.company, c.name, c.role, c.email, c.confidence, c.status]));
  if (contacts.length) S.push({ title: `Outreach (${contacts.length} people)`, headers: ['Company', 'Name', 'Role', 'Email', 'Confidence', 'Status'], rows: contacts });

  return Response.json({ generatedAt: new Date().toISOString(), sections: S.filter((s) => s.text || s.rows?.length) });
}
