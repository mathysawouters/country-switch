import { startRun, createWatch } from '@/lib/agent.mjs';
// The trigger. No chat: a shared link (POST body or ?url=) starts a run that finishes on its own.
// With a target price it becomes a standing order that the server keeps re-checking.
async function go(url, { gate, target, from, title, price } = {}) {
  url = (url || '').trim();
  if (url.length < 4) return Response.json({ error: 'Send a product link or a product name' }, { status: 400 });
  const t = target != null && target !== '' && !Number.isNaN(Number(target)) ? Number(target) : null;
  const watchId = t != null ? await createWatch(url, t, from) : null;
  const { id } = await startRun(url, { forceGate: gate === 'on' ? true : gate === 'off' ? false : undefined, target: t, watchId, sharedBy: from, seen: title || price ? { title: title ? String(title).slice(0, 220) : null, price: price ? Number(String(price).replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) || null : null } : null });
  return Response.json({ id, watchId });
}
export async function POST(req) { const b = await req.json().catch(() => ({})); return go(b.url, b); }
export async function GET(req) { const u = new URL(req.url); const r = await go(u.searchParams.get('url'), { gate: u.searchParams.get('gate'), target: u.searchParams.get('target'), from: u.searchParams.get('from'), title: u.searchParams.get('title'), price: u.searchParams.get('price') }); if (r.status !== 200) return r; const { id } = await r.json(); return Response.redirect(new URL(`/v2?run=${id}`, req.url)); }
