import { exec } from '../lib/s2.mjs';
import fs from 'node:fs';
const ddl = [
  `CREATE TABLE IF NOT EXISTS cs_runs (id VARCHAR(40) PRIMARY KEY, created DATETIME(6) DEFAULT NOW(6), source_url TEXT, buyer_country VARCHAR(4), status VARCHAR(20), verdict TEXT, product_title TEXT, sku VARCHAR(80), source_store VARCHAR(120), source_price DECIMAL(10,2), best_price DECIMAL(10,2), saving DECIMAL(10,2), chosen_store VARCHAR(120), cart_url TEXT, gate_same_item TINYINT, summary JSON)`,
  `CREATE TABLE IF NOT EXISTS cs_steps (id BIGINT AUTO_INCREMENT PRIMARY KEY, run_id VARCHAR(40), seq INT, ts DATETIME(6) DEFAULT NOW(6), tool VARCHAR(40), action VARCHAR(80), status VARCHAR(20), ms INT, summary TEXT, detail JSON, KEY(run_id))`,
  `CREATE TABLE IF NOT EXISTS cs_offers (id BIGINT AUTO_INCREMENT PRIMARY KEY, run_id VARCHAR(40), ts DATETIME(6) DEFAULT NOW(6), store VARCHAR(120), store_country VARCHAR(4), title TEXT, sku VARCHAR(80), variant_id VARCHAR(120), price DECIMAL(10,2), list_price DECIMAL(10,2), currency VARCHAR(4), available TINYINT, same_item TINYINT, same_item_score DOUBLE, ships_to_buyer TINYINT, decision VARCHAR(20), reason TEXT, url TEXT, KEY(run_id), KEY(sku))`,
];
for (const s of ddl) console.log(JSON.stringify(await exec(s)).slice(0, 100));
const r = await fetch(`${process.env.SENSO_BASE_URL}/org/kb/raw`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.SENSO_API_KEY }, body: JSON.stringify({ title: 'My shopping rules (Country Switch)', text: fs.readFileSync(new URL('./rules.md', import.meta.url), 'utf8') }) });
console.log('senso', r.status, (await r.text()).slice(0, 300));
