import { handleRpc, tenantForToken } from '@/lib/mcp';
import { runAs } from '@/lib/tenant';
import { loadVault } from '@/lib/secrets';
import { allow, clientIp } from '@/lib/ratelimit';

export const maxDuration = 300;

// MCP endpoint (Streamable HTTP, JSON responses). Auth = personal bearer token from Agent studio → Connect Claude Code.
export async function POST(req: Request) {
  if (!(await allow('mcp-ip', clientIp(req), 120, 60))) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'rate limited' } }, { status: 429 });
  const t = await tenantForToken(req.headers.get('authorization'));
  if (!t) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: create a token in Agent studio → Connect Claude Code' } }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
  await loadVault();
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, { status: 400 });
  return runAs(t, async () => {
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handleRpc(m)))).filter((x) => x !== null);
      return out.length ? Response.json(out) : new Response(null, { status: 202 });
    }
    const r = await handleRpc(body);
    return r === null ? new Response(null, { status: 202 }) : Response.json(r);
  });
}

// No server-initiated stream: tell clients to use plain POST.
export async function GET() {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}
