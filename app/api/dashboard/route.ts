import { guard } from '@/lib/guard';
import { getJobs, getMeta } from '@/lib/refresh';
import { getIntel } from '@/lib/intel';
import { computeTrends, type MarketReport } from '@/lib/trends';
import { getJSON, hgetall } from '@/lib/store';
import type { TrackEntry } from '@/lib/types';
import { findTime, isFreshFind, withRealDate, type Find } from '@/lib/agent';
import type { Lead } from '@/lib/outreach';

export const maxDuration = 60;

// One payload for "My dashboard": jobs + agent posts + tracker + outreach + radar + layoffs + trends + market report.
export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const [jobs, meta, finds, track, leads, intel, trends, report] = await Promise.all([
    getJobs(), getMeta(), hgetall<Find>('agent:finds'), hgetall<TrackEntry>('track'), hgetall<Lead>('outreach:leads'), getIntel(), computeTrends(), getJSON<MarketReport | null>('trends:report', null),
  ]);
  const posts = Object.values(finds).filter((f) => f.kind === 'post' && f.status !== 'dismissed' && isFreshFind(f)).map(withRealDate).sort((a, b) => (findTime(b) || 0) - (findTime(a) || 0)).slice(0, 40);
  const funnel: Record<string, number> = {};
  for (const t of Object.values(track)) funnel[t.status] = (funnel[t.status] || 0) + 1;
  const contacts = Object.values(leads).flatMap((l) => l.contacts);
  return Response.json({
    jobs, meta, posts, funnel,
    outreach: { companies: Object.keys(leads).length, contacts: contacts.length, sent: contacts.filter((c) => c.status === 'sent' || c.status === 'replied').length, replied: contacts.filter((c) => c.status === 'replied').length },
    radar: intel.hiring.slice(0, 15).map((c) => ({ name: c.name, signal: c.hiring[0]?.signal, date: c.hiring[0]?.date, region: c.hiring[0]?.region, confidence: c.hiring[0]?.confidence, url: c.hiring[0]?.url })),
    layoffs: intel.layoffs.slice(0, 12).map((c) => ({ name: c.name, count: c.layoffs[0]?.count, date: c.layoffs[0]?.date, reason: c.layoffs[0]?.reason, next: c.layoffs[0]?.next, url: c.layoffs[0]?.url, inYourTracker: c.inYourTracker })),
    trends: { skills: trends.skills.slice(0, 15), roles: trends.roles.slice(0, 10), regions: trends.regions, yourSkills: trends.yourSkills },
    report: report ? { at: report.at, summary: report.summary, headlines: report.headlines.slice(0, 6), moves: report.your_moves } : null,
    freshness: { hiringScanned: intel.hiringScanned, layoffsScanned: intel.layoffsScanned, reportAt: report?.at || null },
  });
}
