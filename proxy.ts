import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from './lib/auth';

// Everything is private except the login page, auth API, cron endpoint (own secret) and health ping.
const PUBLIC = [/^\/login/, /^\/api\/auth\//, /^\/api\/cron/, /^\/api\/health/, /^\/api\/mcp$/, /^\/api\/apply\/runner$/]; // these check their own bearer token

// Owner-only areas: settings, API keys / AI providers, access & limits, sources, refresh of the shared feed,
// digest / test alerts, job alerts for other people, adding companies to the shared boards list.
const OWNER_ONLY = [/^\/api\/(settings|vault|sources|digest|notify|subscribers|companies\/detect|refresh|access)(\/|$)/, /^\/api\/ai\/(profiles|models|test)(\/|$)/];
// shared market data: everyone can read, only the owner can force a rescan / edit
const OWNER_WRITE = [/^\/api\/(discover|intel|trends|platforms|opportunities|directory|radar|obs)(\/|$)/];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  const ok = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) {
    // users (non-owners) never touch settings, keys, access management or shared-data rescans
    if (ok.role !== 'owner' && (OWNER_ONLY.some((r) => r.test(pathname)) || (req.method !== 'GET' && OWNER_WRITE.some((r) => r.test(pathname))))) {
      return NextResponse.json({ error: 'Only the owner can do this' }, { status: 403 });
    }
    return NextResponse.next(); // route handlers re-check the live access list (revocation / lockdown)
  }
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|manifest.webmanifest|sw.js|icon-192.png|icon-512.png|icon-maskable-512.png|apple-touch-icon.png).*)'],
};
