import { guard, bad } from '@/lib/guard';
import { setVault, vaultStatus } from '@/lib/secrets';
import { ENGINES } from '@/lib/search';

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  return Response.json({ keys: await vaultStatus(), engines: ENGINES.map((e) => ({ id: e.id, label: e.label, needs: e.needs })) });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { name, value } = (await req.json()) as { name: string; value: string | null };
  try {
    await setVault(name, value);
    return Response.json({ keys: await vaultStatus() });
  } catch (e) {
    return bad((e as Error).message);
  }
}
