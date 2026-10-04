// Public, minimal: lets you (or an uptime monitor) see the app is alive. Exposes no data.
export async function GET() {
  return Response.json({ ok: true, time: new Date().toISOString() });
}
