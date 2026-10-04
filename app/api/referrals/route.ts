import { guard, bad } from '@/lib/guard';
import { deleteReferralReport, getReferralReport, listReferralReports, referralReport } from '@/lib/referrals';

export const maxDuration = 300;

export async function GET(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const id = new URL(req.url).searchParams.get('id');
  if (id) return Response.json({ report: await getReferralReport(id) });
  return Response.json({ list: await listReferralReports() });
}

// POST {company, role?} → people + emails + referral kit · DELETE {id}
export async function POST(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const b = (await req.json().catch(() => ({}))) as { company?: string; role?: string };
  try {
    return Response.json({ report: await referralReport(String(b.company || '').slice(0, 120), String(b.role || '').slice(0, 160)) });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if (g) return g;
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return bad('id required');
  await deleteReferralReport(id);
  return Response.json({ ok: true });
}
