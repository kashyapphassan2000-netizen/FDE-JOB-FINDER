import { currentUser, unauthorized } from '@/lib/auth';

export async function GET(req: Request) {
  const u = await currentUser(req);
  if (!u) return unauthorized();
  return Response.json({ email: u.email, role: u.role });
}
