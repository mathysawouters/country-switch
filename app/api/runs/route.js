import { rows } from '@/lib/s2.mjs';
export async function GET() {
  const [runs, stats, watches, totals] = await Promise.all([
    rows('SELECT id, created, source_url, status, verdict, product_title, sku, source_store, source_price, best_price, saving, chosen_store, cart_url, gate_same_item, shared_by, watch_id, target FROM cs_runs ORDER BY created DESC LIMIT 30'),
    rows(`SELECT IF(r.gate_same_item = 1, 'superlinked', 'naive') AS check_mode, COUNT(*) AS runs, SUM(r.status = 'cart_filled') AS carts, SUM(r.status = 'refused') AS refused, SUM(r.status = 'cart_filled' AND o.sku <> r.sku) AS wrong_item, ROUND(SUM(IF(r.status = 'cart_filled' AND o.sku = r.sku, r.saving, 0)), 2) AS honest_saving FROM cs_runs r LEFT JOIN cs_offers o ON o.run_id = r.id AND o.decision = 'chosen' WHERE r.status IN ('cart_filled', 'refused') GROUP BY 1`),
    rows('SELECT id, created, source_url, shared_by, target, status, last_checked, checks, last_best, last_store, last_run_id, cart_url, product_title FROM cs_watches WHERE status <> ? ORDER BY created DESC LIMIT 12', ['stopped']),
    rows(`SELECT COUNT(*) AS links, SUM(best > 0) AS helped, ROUND(SUM(best), 2) AS saved, (SELECT COUNT(DISTINCT shared_by) FROM cs_runs WHERE shared_by IS NOT NULL AND shared_by <> '') AS people FROM (SELECT source_url, MAX(IF(status = 'cart_filled' AND gate_same_item = 1, saving, 0)) AS best FROM cs_runs WHERE status IN ('cart_filled', 'refused', 'waiting') GROUP BY source_url) t`),
  ]);
  return Response.json({ runs, stats, watches, totals: totals[0] });
}
