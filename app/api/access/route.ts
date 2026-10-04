import { currentUser, unauthorized } from '@/lib/auth';
import { bad } from '@/lib/guard';
import { addMember, getLockdown, makeLinkToken, members, ownerEmails, removeMember, roleOf, setLockdown, setPassword } from '@/lib/access';

async function owner(req: Request) {
  const u = await currentUser(req);
  return u && u.role === 'owner' ? u : null;
}

export async function GET(req: Request) {
  const u = await owner(req);
  if (!u) return unauthorized();
  return Response.json({ members: await members(), lockdown: await getLockdown(), owners: ownerEmails(), you: u.email, ownersConfigured: ownerEmails().length > 0 });
}

// POST {action:"add",email,role?} | {action:"remove",email} | {action:"invite",email} | {action:"lockdown",on} | {action:"password",password}
export async function POST(req: Request) {
  const u = await owner(req);
  if (!u) return Response.json({ error: 'Only owners can manage access' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; email?: string; role?: 'owner' | 'member'; on?: boolean; password?: string };
  try {
    if (b.action === 'add') { await addMember(b.email || '', b.role || 'member', u.email); return Response.json({ ok: true }); }
    if (b.action === 'remove') { await removeMember(b.email || ''); return Response.json({ ok: true }); }
    if (b.action === 'lockdown') { await setLockdown(Boolean(b.on)); return Response.json({ ok: true }); }
    if (b.action === 'password') { await setPassword(b.password || ''); return Response.json({ ok: true, note: 'Password changed — everyone has to sign in again.' }); }
    if (b.action === 'invite') {
      const e = (b.email || '').trim().toLowerCase();
      if (!(await roleOf(e))) return bad('Add this email first (or lockdown is on)');
      return Response.json({ link: `${new URL(req.url).origin}/api/auth/magic?t=${await makeLinkToken(e, 7 * 24 * 60)}`, note: 'Single use, valid 7 days. Send it only to that person.' });
    }
    return bad('unknown action');
  } catch (e) {
    return bad((e as Error).message);
  }
}
