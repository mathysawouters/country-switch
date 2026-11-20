import { startRun, createWatch } from '@/lib/agent.mjs';
// The trigger. No chat: a shared link (POST body or ?url=) starts a run that finishes on its own.
// With a target price it becomes a standing order that the server keeps re-checking.
async function go(url, { gate, target, from } = {}) {
  url = (url || '').trim();
  if (!/^https?:\/\/[^/\s]+\//.test(url)) return Response.json({ error: 'Send a product link' }, { status: 400 });
  const t = target != null && target !== '' && !Number.isNaN(Number(target)) ? Number(target) : null;
  const watchId = t != null ? await createWatch(url, t, from) : null;
  const { id } = await startRun(url, { forceGate: gate === 'on' ? true : gate === 'off' ? false : undefined, target: t, watchId, sharedBy: from });
  return Response.json({ id, watchId });
}
export async function POST(req) { const b = await req.json().catch(() => ({})); return go(b.url, b); }
export async function GET(req) { const u = new URL(req.url); const r = await go(u.searchParams.get('url'), { gate: u.searchParams.get('gate'), target: u.searchParams.get('target'), from: u.searchParams.get('from') }); if (r.status !== 200) return r; const { id } = await r.json(); return Response.redirect(new URL(`/?run=${id}`, req.url)); }
