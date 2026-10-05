import { bindTenant } from '@/lib/auth';
import { guard } from '@/lib/guard';
import { getProfile, profileIsSet, saveProfile } from '@/lib/profile';
import { LOCATION_LIB, ROLE_LIB } from '@/lib/relevance';

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  return Response.json({ profile: await getProfile(), isSet: await profileIsSet(), roleLib: Object.keys(ROLE_LIB), locationLib: LOCATION_LIB });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  return Response.json({ profile: await saveProfile(await req.json().catch(() => ({}))) });
}
