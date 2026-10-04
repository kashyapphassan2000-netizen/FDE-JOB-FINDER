import { bindTenant, currentUser, unauthorized } from '@/lib/auth';
import { accessUntil } from '@/lib/access';
import { profileIsSet } from '@/lib/profile';
import { limitsFor, usedToday } from '@/lib/limits';
import { tenant } from '@/lib/tenant';

// Who am I + my plan (role, access end, today's AI actions, whether I mapped my job role yet).
export async function GET(req: Request) {
  const u = await currentUser(req);
  if (!u) return unauthorized();
  bindTenant(req);
  const t = tenant();
  const owner = u.role === 'owner';
  const [until, set, used, lim] = await Promise.all([owner ? null : accessUntil(u.email), profileIsSet(), owner ? 0 : usedToday(t.ns), owner ? null : limitsFor(t.ns)]);
  return Response.json({ email: u.email, role: u.role, until: until ? new Date(until).toISOString() : null, profileSet: owner || set, used, limit: lim?.actionsPerDay ?? null, maxAgents: lim?.maxAgents ?? null });
}
