import { exec } from '../lib/s2.mjs';
const tryExec = async (s) => { try { await exec(s); console.log('ok', s.slice(0, 60)); } catch (e) { console.log('skip', String(e.message).slice(0, 90)); } };
await tryExec('ALTER TABLE cs_runs ADD COLUMN shared_by VARCHAR(60)');
await tryExec('ALTER TABLE cs_runs ADD COLUMN watch_id VARCHAR(40)');
await tryExec('ALTER TABLE cs_runs ADD COLUMN target DECIMAL(10,2)');
await tryExec(`CREATE TABLE IF NOT EXISTS cs_watches (id VARCHAR(40) PRIMARY KEY, created DATETIME(6) DEFAULT NOW(6), source_url TEXT, shared_by VARCHAR(60), target DECIMAL(10,2), status VARCHAR(20), last_checked DATETIME(6), checks INT DEFAULT 0, last_best DECIMAL(10,2), last_store VARCHAR(120), last_run_id VARCHAR(40), cart_url TEXT, product_title TEXT)`);
