import { exec } from '@/lib/s2.mjs';
import { tickWatches } from '@/lib/agent.mjs';
// Change a standing order (new target, stop) or force a check now.
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (b.tick) { if (globalThis.__csTicking) return Response.json({ started: [], busy: true }); globalThis.__csTicking = true; try { return Response.json({ started: await tickWatches(Number(b.min) || 0) }); } finally { globalThis.__csTicking = false; } }
  if (!b.id) return Response.json({ error: 'id missing' }, { status: 400 });
  if (b.stop) await exec('UPDATE cs_watches SET status = ? WHERE id = ?', ['stopped', b.id]);
  else if (b.target != null && !Number.isNaN(Number(b.target))) await exec('UPDATE cs_watches SET target = ?, status = ?, last_checked = NULL WHERE id = ?', [Number(b.target), 'watching', b.id]);
  return Response.json({ ok: true });
}
