import { bindTenant } from '@/lib/auth';
import { spendGuard } from '@/lib/limits';
import { guard, bad } from '@/lib/guard';
import { deleteLead, draftEmail, findContacts, listLeads, updateContact } from '@/lib/outreach';
import { getJSON } from '@/lib/store';
import type { DiscoveredCompany } from '@/lib/discover';

export const maxDuration = 120;

// GET → saved leads + suggested startups (from the Hidden jobs & startups scan)
export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const [leads, disc] = await Promise.all([listLeads(), getJSON<Record<string, DiscoveredCompany> | DiscoveredCompany[]>('disc:companies', [])]);
  const companies = (Array.isArray(disc) ? disc : Object.values(disc))
    .filter((c) => c.status !== 'dismissed' && c.website)
    .sort((a, b) => (b.fundedAt ? 1 : 0) - (a.fundedAt ? 1 : 0) || b.roles.length - a.roles.length || b.hiddenScore - a.hiddenScore)
    .slice(0, 24)
    .map((c) => ({ name: c.name, website: c.website, why: c.fundingNews || c.source, roles: c.roles.length, region: c.region }));
  return Response.json({ leads, suggestions: companies });
}

// POST {action:"find", company, domain?, hiringFor?} | {action:"draft", leadId, contactId, extra?} | {action:"update", leadId, contactId, patch} | {action:"delete", leadId}
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const lim = await spendGuard(1); // per-user daily AI budget (owner unlimited)
  if (lim) return lim;
  const b = (await req.json().catch(() => ({}))) as any;
  try {
    if (b.action === 'find') {
      if (!String(b.company || b.domain || '').trim()) return bad('Enter a company name or website');
      return Response.json({ lead: await findContacts({ company: String(b.company || b.domain).slice(0, 120), domain: b.domain, hiringFor: b.hiringFor?.slice(0, 200), mode: b.mode === 'referral' ? 'referral' : 'hiring' }) });
    }
    if (b.action === 'draft') return Response.json({ lead: await draftEmail(b.leadId, b.contactId, b.extra?.slice(0, 400), b.type) });
    if (b.action === 'update') return Response.json({ lead: await updateContact(b.leadId, b.contactId, b.patch || {}) });
    if (b.action === 'delete') { await deleteLead(b.leadId); return Response.json({ ok: true }); }
    return bad('unknown action');
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
