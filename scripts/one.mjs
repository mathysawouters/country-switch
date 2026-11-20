import { startRun } from '../lib/agent.mjs';
import { rows } from '../lib/s2.mjs';
const [from, url] = process.argv.slice(2);
const { id, done } = await startRun(url, { sharedBy: from || undefined });
await done;
const [r] = await rows('SELECT status, product_title, source_store, source_price, chosen_store, best_price, saving, LEFT(verdict, 200) v FROM cs_runs WHERE id = ?', [id]);
console.log(JSON.stringify(r));
for (const s of await rows("SELECT tool, action, ms, LEFT(summary, 170) s FROM cs_steps WHERE run_id = ? AND action IN ('vector_search','same_item_check','find_brand_shop','search_brand_shops') ORDER BY seq", [id])) console.log('  ', s.tool, s.action, s.ms + 'ms', '|', s.s);
