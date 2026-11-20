import { rows } from '../lib/s2.mjs';
const runs = await rows("SELECT id, shared_by, product_title, sku, source_store, source_price, status FROM cs_runs WHERE shared_by IS NOT NULL AND status IN ('cart_filled','refused') ORDER BY created");
for (const r of runs) {
  console.log(`\n## ${r.shared_by}: ${r.product_title?.slice(0, 50)} | SKU ${r.sku} | ${r.source_store} €${r.source_price} | ${r.status}`);
  const st = await rows("SELECT LEFT(summary,150) s FROM cs_steps WHERE run_id = ? AND action IN ('discover_shops','search_catalog') ORDER BY seq", [r.id]);
  for (const s of st) console.log('   ', s.s);
  for (const o of await rows('SELECT store, sku, price, shipping, same_item, ships_to_buyer, decision, LEFT(reason, 70) reason, LEFT(title, 38) t FROM cs_offers WHERE run_id = ? ORDER BY price LIMIT 12', [r.id])) console.log('   ', o.store.padEnd(16), String(o.sku).padEnd(18).slice(0, 18), String(o.price).padStart(8), 'same=' + o.same_item, (o.decision ?? '').padEnd(13), '|', o.t, '|', o.reason);
}
