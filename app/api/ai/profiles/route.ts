import { guard, bad } from '@/lib/guard';
import { PRESETS, deleteProfile, moveProfile, publicProfiles, saveProfile } from '@/lib/llm';

const presets = PRESETS.map(({ prefer, ...p }) => p);

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  return Response.json({ profiles: await publicProfiles(), presets });
}

// create / update: { id?, preset, label, wire?, baseUrl?, model?, apiKey?, enabled? }
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  try {
    await saveProfile(await req.json());
    return Response.json({ profiles: await publicProfiles() });
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function PATCH(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { id, dir } = (await req.json()) as { id: string; dir: -1 | 1 };
  await moveProfile(id, dir);
  return Response.json({ profiles: await publicProfiles() });
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { id } = (await req.json()) as { id: string };
  await deleteProfile(id);
  return Response.json({ profiles: await publicProfiles() });
}
