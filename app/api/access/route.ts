import { bindTenant } from '@/lib/auth';
import { currentUser, unauthorized } from '@/lib/auth';
import { bad } from '@/lib/guard';
import { getLimits, saveLimits, usageToday } from '@/lib/limits';
import { hgetall } from '@/lib/store';
import { accessUntil, addMember, setMemberExpiry, setMemberLimits, getLockdown, makeLinkToken, members, ownerEmails, removeMember, roleOf, setLockdown, setPassword } from '@/lib/access';

async function owner(req: Request) {
  const u = await currentUser(req);
  return u && u.role === 'owner' ? u : null;
}

export async function GET(req: Request) {
  const u = await owner(req);
  if (!u) return unauthorized();
  bindTenant(req);
  const [ms, limits, usage, agents] = await Promise.all([members(), getLimits(), usageToday(), hgetall<{ owner: string }>('studio:agents')]);
  const agentCount: Record<string, number> = {};
  for (const a of Object.values(agents)) agentCount[a.owner] = (agentCount[a.owner] || 0) + 1;
  return Response.json({ members: ms.map((m) => ({ ...m, usedToday: usage[m.email] || 0, agents: agentCount[m.email] || 0 })), limits, lockdown: await getLockdown(), owners: ownerEmails(), you: u.email, ownersConfigured: ownerEmails().length > 0 });
}

// POST {action:"add",email,role?} | {action:"remove",email} | {action:"invite",email} | {action:"lockdown",on} | {action:"password",password}
export async function POST(req: Request) {
  const u = await owner(req);
  if (!u) return Response.json({ error: 'Only owners can manage access' }, { status: 403 });
  bindTenant(req);
  const b = (await req.json().catch(() => ({}))) as { action?: string; email?: string; role?: 'owner' | 'member'; on?: boolean; password?: string; hours?: number | null; limits?: Record<string, number>; memberLimits?: { actionsPerDay?: number | null; maxAgents?: number | null } };
  try {
    if (b.action === 'add') { await addMember(b.email || '', b.role || 'member', u.email, b.hours ?? null); return Response.json({ ok: true }); }
    if (b.action === 'limits') return Response.json({ limits: await saveLimits(b.limits || {}) });
    if (b.action === 'member-limits') { await setMemberLimits(b.email || '', b.memberLimits || {}); return Response.json({ ok: true }); }
    if (b.action === 'expiry') { await setMemberExpiry(b.email || '', b.hours ?? null); return Response.json({ ok: true }); }
    if (b.action === 'remove') { await removeMember(b.email || ''); return Response.json({ ok: true }); }
    if (b.action === 'lockdown') { await setLockdown(Boolean(b.on)); return Response.json({ ok: true }); }
    if (b.action === 'password') { await setPassword(b.password || ''); return Response.json({ ok: true, note: 'Password changed — everyone has to sign in again.' }); }
    if (b.action === 'invite') {
      const e = (b.email || '').trim().toLowerCase();
      if (await getLockdown() && !ownerEmails().includes(e)) return bad('Lockdown is ON — turn it off first, otherwise this person cannot get in');
      if (!(await roleOf(e))) { const until = await accessUntil(e); return bad(until && until < Date.now() ? 'Their access has expired — use “Extend…” on their row first' : 'Add this email first'); }
      const until = await accessUntil(e);
      const minutes = Math.max(5, Math.min(7 * 24 * 60, until ? Math.floor((until - Date.now()) / 60000) : 7 * 24 * 60));
      return Response.json({ link: `${new URL(req.url).origin}/api/auth/magic?t=${await makeLinkToken(e, minutes)}`, note: until ? `Single use. Works until their access ends (${new Date(until).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST).` : 'Single use, valid 7 days. Send it only to that person.' });
    }
    return bad('unknown action');
  } catch (e) {
    return bad((e as Error).message);
  }
}
