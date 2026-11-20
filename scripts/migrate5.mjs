import { exec, rows } from '../lib/s2.mjs';
try { await exec('CREATE TABLE IF NOT EXISTS cs_embed (id BIGINT AUTO_INCREMENT PRIMARY KEY, run_id VARCHAR(40), kind VARCHAR(10), store VARCHAR(120), variant_id VARCHAR(120), sku VARCHAR(80), title TEXT, v VECTOR(1024) NOT NULL, KEY(run_id))'); console.log('table ok'); } catch (e) { console.log('ERR', e.message.slice(0, 300)); }
const r = await fetch('https://api.superlinked.com/v1/embeddings', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.SUPERLINKED_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'BAAI/bge-m3', input: ['UGREEN Nexode Cargador USB C GaN de 100W con 4 Puertos', 'UGREEN USB-C Ladegerät (100W, 4-Ports, GaN)', 'UGREEN 65W USB-C GaN Ladegerät + 60W USB-C Ladekabel*2', 'eufy X10 Pro Omni robot vacuum'] }) });
const d = await r.json(); const E = d.data.map((x) => x.embedding); console.log('dims', E[0].length, 'norm', Math.sqrt(E[0].reduce((a, b) => a + b * b, 0)).toFixed(3));
await exec('DELETE FROM cs_embed WHERE run_id = ?', ['probe']);
for (let i = 1; i < E.length; i++) await exec('INSERT INTO cs_embed (run_id, kind, title, v) VALUES (?, ?, ?, ?)', ['probe', 'offer', String(i), JSON.stringify(E[i])]);
console.log(await rows('SELECT title, ROUND(DOT_PRODUCT(v, ? :> VECTOR(1024)), 3) AS sim FROM cs_embed WHERE run_id = ? ORDER BY sim DESC', [JSON.stringify(E[0]), 'probe']));
await exec('DELETE FROM cs_embed WHERE run_id = ?', ['probe']);
