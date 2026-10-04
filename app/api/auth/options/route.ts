import { loadVault, secret } from '@/lib/secrets';
import { mailerStatus } from '@/lib/mailer';

// Public: which sign-in methods are switched on (no user data).
export async function GET() {
  await loadVault();
  return Response.json({ google: Boolean(secret('GOOGLE_CLIENT_ID') && secret('GOOGLE_CLIENT_SECRET')), otp: mailerStatus().canEmailAnyone });
}
