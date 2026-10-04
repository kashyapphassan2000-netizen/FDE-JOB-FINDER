import { bindTenant } from '@/lib/auth';
import { guard, bad } from '@/lib/guard';
import { blobConfigured, deleteCv, getCv, setActive, setSkills, uploadCv } from '@/lib/cv';

export const maxDuration = 30;

const pub = (s: Awaited<ReturnType<typeof getCv>>) => ({ versions: s.versions, active: s.active, skills: s.skills, textChars: s.text.length, preview: s.text.slice(0, 1200) });

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  return Response.json({ ...pub(await getCv()), blob: blobConfigured() });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  if (!blobConfigured()) return bad('Vercel Blob is not connected. Storage → Create → Blob (Private) → connect to this project, then redeploy.', 500);
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return bad('file missing');
  try {
    return Response.json(pub(await uploadCv(file, String(form.get('skills') || ''))));
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function PATCH(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const { active, skills } = (await req.json()) as { active?: string; skills?: string };
  try {
    if (active) return Response.json(pub(await setActive(active)));
    if (typeof skills === 'string') return Response.json(pub(await setSkills(skills)));
    return bad('nothing to update');
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if (g) return g;
  bindTenant(req);
  const { pathname } = (await req.json()) as { pathname: string };
  return Response.json(pub(await deleteCv(pathname)));
}
