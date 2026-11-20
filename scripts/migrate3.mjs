import { exec } from '../lib/s2.mjs';
for (const s of ['ALTER TABLE cs_offers ADD COLUMN shipping DECIMAL(10,2)', 'ALTER TABLE cs_offers ADD COLUMN landed DECIMAL(10,2)', 'ALTER TABLE cs_offers ADD COLUMN ship_method VARCHAR(160)']) { try { await exec(s); console.log('ok', s.slice(27)); } catch (e) { console.log('skip', String(e.message).slice(0, 80)); } }
const r = await fetch(`${process.env.SENSO_BASE_URL}/org/kb/raw`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.SENSO_API_KEY }, body: JSON.stringify({ title: 'My delivery details (Country Switch)', text: 'Rule 7 (delivery): My postal code is 3500. Compare the total cost delivered to my door, shipping included, not the shelf price.' }) });
console.log('senso', r.status);
