import { rows } from '@/lib/s2.mjs';
export async function GET(_req, { params }) {
  const { id } = await params;
  const [run] = await rows('SELECT * FROM cs_runs WHERE id = ?', [id]);
  if (!run) return Response.json({ error: 'not found' }, { status: 404 });
  const steps = await rows('SELECT seq, ts, tool, action, status, ms, summary, detail FROM cs_steps WHERE run_id = ? ORDER BY seq', [id]);
  const offers = await rows('SELECT store, store_country, title, sku, price, list_price, currency, same_item, same_item_score, shipping, landed, ship_method, ships_to_buyer, decision, reason, url FROM cs_offers WHERE run_id = ? ORDER BY COALESCE(landed, price), price', [id]);
  return Response.json({ run, steps, offers });
}
