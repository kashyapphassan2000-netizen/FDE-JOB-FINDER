import { getJSON, setJSON } from './store';
import { DEFAULT_PROFILE, ROLE_LIB, type Profile } from './relevance';

export async function getProfile(): Promise<Profile> {
  return { ...DEFAULT_PROFILE, ...(await getJSON<Partial<Profile>>('profile', {})) };
}

/** Has this user mapped their own job role / locations yet? (new users start from the defaults) */
export async function profileIsSet(): Promise<boolean> {
  return (await getJSON<Partial<Profile> | null>('profile', null)) !== null;
}

export async function saveProfile(p: Partial<Profile>): Promise<Profile> {
  const cur = await getProfile();
  const clean = (xs: unknown, n: number) => (Array.isArray(xs) ? xs.map((x) => String(x).trim()).filter(Boolean).slice(0, n) : undefined);
  const next: Profile = {
    roles: clean(p.roles, 20) ?? cur.roles,
    locations: clean(p.locations, 12) ?? cur.locations,
    exclude: (clean(p.exclude, 30) ?? cur.exclude).map((x) => x.toLowerCase()),
    mustAny: clean(p.mustAny, 15) ?? cur.mustAny,
    tech: clean(p.tech, 30) ?? cur.tech,
    expMin: Math.max(0, Math.min(30, Number(p.expMin ?? cur.expMin) || 0)),
    expMax: Math.max(0, Math.min(40, Number(p.expMax ?? cur.expMax) || 30)),
  };
  if (!next.roles.length) next.roles = DEFAULT_PROFILE.roles;
  await setJSON('profile', next);
  return next;
}

export { ROLE_LIB };
