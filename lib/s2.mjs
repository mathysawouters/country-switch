// SingleStore over the HTTP Data API: the ledger behind the audit trail.
const url = (kind) => `https://${process.env.SINGLESTORE_HOST}/api/v2/${kind}`;
const auth = () => 'Basic ' + Buffer.from(`${process.env.SINGLESTORE_USER}:${process.env.SINGLESTORE_PASSWORD}`).toString('base64');
async function call(kind, sql, args = []) {
  const r = await fetch(url(kind), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth() }, body: JSON.stringify({ sql, args, database: process.env.SINGLESTORE_DATABASE }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`SingleStore ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
export const exec = (sql, args) => call('exec', sql, args);
export const rows = async (sql, args) => (await call('query/rows', sql, args)).results[0].rows;
