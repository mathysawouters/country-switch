// Price history lives in the same SingleStore ledger. Seeded with the real prices captured on 19 Nov (evening, SF) and every run since.
import { exec, rows } from '../lib/s2.mjs';
import fs from 'node:fs';
await exec(`CREATE TABLE IF NOT EXISTS cs_prices (id BIGINT AUTO_INCREMENT PRIMARY KEY, sku VARCHAR(80), store VARCHAR(120), price DECIMAL(10,2), list_price DECIMAL(10,2), seen DATETIME(6) DEFAULT NOW(6), source VARCHAR(40), KEY(sku, store))`);
const [{ n }] = await rows('SELECT COUNT(*) AS n FROM cs_prices');
if (Number(n) > 0) { console.log('already seeded', n); process.exit(0); }
const f = process.argv[2];
if (f && fs.existsSync(f)) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const ts = d.generated_utc.replace('T', ' ').replace('Z', ':00');
  for (const c of d.cases) for (const o of c.offers) await exec('INSERT INTO cs_prices (sku, store, price, list_price, seen, source) VALUES (?,?,?,?,?,?)', [o.sku, o.store, o.price, o.list_price ?? o.price, ts, 'capture_19nov']);
}
await exec(`INSERT INTO cs_prices (sku, store, price, list_price, seen, source) SELECT sku, store, price, list_price, ts, run_id FROM cs_offers WHERE same_item = 1 AND same_item_score = 1`);
console.log(await rows('SELECT source LIKE "run_%" AS from_runs, COUNT(*) AS n FROM cs_prices GROUP BY 1'));
