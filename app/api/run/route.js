import { startRun } from '@/lib/agent.mjs';
// The trigger. No chat: a shared link (POST body or ?url=) starts a run that finishes on its own.
async function go(url, gate) {
  if (!url || !/^https:\/\/[^/]+\/.*products\//.test(url)) return Response.json({ error: 'Send a product link' }, { status: 400 });
  const { id } = await startRun(url, { forceGate: gate === 'on' ? true : gate === 'off' ? false : undefined });
  return Response.json({ id });
}
export async function POST(req) { const b = await req.json().catch(() => ({})); return go(b.url, b.gate); }
export async function GET(req) { const u = new URL(req.url); const r = await go(u.searchParams.get('url'), u.searchParams.get('gate')); if (r.status !== 200) return r; const { id } = await r.json(); return Response.redirect(new URL(`/?run=${id}`, req.url)); }
