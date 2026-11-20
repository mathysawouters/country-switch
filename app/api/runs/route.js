import { rows } from '@/lib/s2.mjs';
export async function GET() {
  const runs = await rows('SELECT id, created, source_url, status, verdict, product_title, sku, source_store, source_price, best_price, saving, chosen_store, cart_url, gate_same_item FROM cs_runs ORDER BY created DESC LIMIT 25');
  const stats = await rows(`SELECT IF(r.gate_same_item = 1, 'superlinked', 'naive') AS check_mode, COUNT(*) AS runs, SUM(r.status = 'cart_filled') AS carts, SUM(r.status = 'refused') AS refused, SUM(r.status = 'cart_filled' AND o.sku <> r.sku) AS wrong_item, ROUND(SUM(IF(r.status = 'cart_filled' AND o.sku = r.sku, r.saving, 0)), 2) AS honest_saving FROM cs_runs r LEFT JOIN cs_offers o ON o.run_id = r.id AND o.decision = 'chosen' WHERE r.status IN ('cart_filled', 'refused') GROUP BY 1`);
  return Response.json({ runs, stats });
}
