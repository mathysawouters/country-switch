// Senso (the shopper's rules), Superlinked SIE (same-item evidence), Statsig (gate), Amplitude (trace), Cognee (what the agent learned).
const J = { 'Content-Type': 'application/json' };
const T = (ms) => AbortSignal.timeout(ms);

// ---------- Senso: the rules live there, not in the code ----------
export async function sensoRules() {
  const r = await fetch(`${process.env.SENSO_BASE_URL}/org/search/context`, { method: 'POST', signal: T(30000), headers: { ...J, 'X-API-Key': process.env.SENSO_API_KEY }, body: JSON.stringify({ query: 'my shopping rules: home country, shipping, same item, minimum saving, currency, authority', max_results: 6 }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`Senso ${r.status}: ${t.slice(0, 200)}`);
  const chunks = (JSON.parse(t).results ?? []).map((c) => ({ text: c.chunk_text, content_id: c.content_id, version_id: c.version_id, title: c.title, score: c.score }));
  const text = chunks.map((c) => c.text).join('\n');
  const rule = (n) => (text.match(new RegExp(`Rule ${n} \\([^)]*\\):[^\\n]*`)) ?? [null])[0];
  const rules = { home: rule(1), shipping: rule(2), sameItem: rule(3), minSaving: rule(4), currency: rule(5), authority: rule(6) };
  const country = (rules.home?.match(/delivery country is ([A-Z]{2})/) ?? [])[1];
  const minSaving = Number((rules.minSaving?.match(/at least (\d+(?:\.\d+)?) euro/) ?? [])[1]);
  if (!country || Number.isNaN(minSaving)) throw new Error('Senso returned no usable rules: the agent has no authority to act');
  return { rules, country, minSaving, chunks };
}
export async function sensoVerify(text) {
  try {
    const r = await fetch(`${process.env.SENSO_BASE_URL}/org/evals/text`, { method: 'POST', signal: T(45000), headers: { ...J, 'X-API-Key': process.env.SENSO_API_KEY }, body: JSON.stringify({ text, evaluator: 'kb_accuracy', wait: true }) });
    const d = JSON.parse(await r.text());
    return { ok: r.ok, run_id: d.id ?? d.run_id, metrics: d.metrics, claims: (d.claims ?? []).map((c) => ({ text: c.text ?? c.claim, passed: c.passed, bucket: c.bucket })) };
  } catch (e) { return { ok: false, error: String(e).slice(0, 200) }; }
}

// ---------- Superlinked SIE: is it really the same single item? ----------
// Superlinked caps concurrent requests per key: queue to 3 at a time and retry on 429.
let active = 0; const waiting = [];
const slot = () => new Promise((res) => { const go = () => { active += 1; res(); }; active < 3 ? go() : waiting.push(go); });
const release = () => { active -= 1; const n = waiting.shift(); if (n) n(); };
const sie = async (path, body, ms = 40000) => {
  await slot();
  try {
    for (let i = 0; ; i += 1) {
      const r = await fetch('https://api.superlinked.com' + path, { method: 'POST', signal: T(ms), headers: { ...J, Authorization: 'Bearer ' + process.env.SUPERLINKED_API_KEY }, body: JSON.stringify(body) });
      const t = await r.text();
      if (r.status === 429 && i < 4) { await new Promise((x) => setTimeout(x, 600 * (i + 1))); continue; }
      if (!r.ok) throw new Error(`Superlinked ${path} ${r.status}: ${t.slice(0, 200)}`);
      return JSON.parse(t);
    }
  } finally { release(); }
};
// The second-opinion model can be cold (503 for ~20 s). Probe it once per minute; if it is not ready, run without it.
let probe = { at: 0, ok: null };
const decideReady = () => {
  if (Date.now() - probe.at > 60000) probe = { at: Date.now(), ok: fetch('https://api.superlinked.com/v1/decisions', { method: 'POST', signal: T(3500), headers: { ...J, Authorization: 'Bearer ' + process.env.SUPERLINKED_API_KEY }, body: JSON.stringify({ model: 'fastino/GLiNER2.5-Decide', input: 'Reference item: A. Offer: A', questions: [{ type: 'predicate', name: 'same', instructions: 'Same item?' }] }) }).then((r) => r.ok, () => false) };
  return probe.ok;
};
export async function sameItem(ref, offer) {
  const refLine = `${ref.title} (SKU ${ref.sku})`;
  const offLine = `${offer.title}${offer.variantTitle && offer.variantTitle !== 'Default Title' ? ' / ' + offer.variantTitle : ''} (SKU ${offer.sku || 'unknown'})`;
  const useDecide = await decideReady();
  const [dec, chat] = await Promise.all([
    !useDecide ? null : sie('/v1/decisions', { model: 'fastino/GLiNER2.5-Decide', input: `Reference item: ${refLine}. Offer: ${offLine}`, questions: [{ type: 'predicate', name: 'same_single_item', instructions: 'Is the offer exactly the same single product as the reference item, with the same power rating and without extra items bundled?' }] }, 7000).catch(() => null),
    sie('/v1/chat/completions', { model: 'Qwen/Qwen3.5-4B', max_tokens: 160, temperature: 0, messages: [{ role: 'user', content: `Two shop listings in different languages.\nReference: "${refLine}"\nOffer: "${offLine}"\nIs the offer exactly the same single product as the reference (same model, same wattage, same SKU, not a bundle or pack with extra items)? Answer only JSON: {"same": true|false, "reason": "one short sentence in English"}` }] }),
  ]);
  const prob = dec?.answers?.[0]?.probability ?? null;
  let verdict = { same: false, reason: 'no verdict' };
  try { verdict = JSON.parse(chat.choices[0].message.content.match(/\{[\s\S]*\}/)[0]); } catch {}
  return { same: verdict.same === true, reason: verdict.reason, probability: prob, models: ['Qwen/Qwen3.5-4B', ...(dec ? ['fastino/GLiNER2.5-Decide'] : [])] };
}

// ---------- Statsig: the gate that switches the same-item check on ----------
const USER = { userID: 'shopper-be-1', custom: { home_country: 'BE' } };
export const GATE = 'superlinked_same_item_check';
export async function gate(name = GATE) {
  const r = await fetch('https://api.statsig.com/v1/check_gate', { method: 'POST', signal: T(10000), headers: { ...J, 'statsig-api-key': process.env.STATSIG_SERVER_KEY }, body: JSON.stringify({ user: USER, gateName: name }) });
  const d = await r.json();
  return { name, value: d.value === true, rule_id: d.rule_id ?? null };
}
export async function statsigEvent(eventName, value, metadata) {
  try { await fetch('https://events.statsigapi.net/v1/log_event', { method: 'POST', signal: T(10000), headers: { ...J, 'statsig-api-key': process.env.STATSIG_SERVER_KEY }, body: JSON.stringify({ events: [{ eventName, value, metadata, user: USER, time: Date.now() }] }) }); } catch {}
}

// ---------- Amplitude: every run is a session, every tool call an event ----------
export async function amplitude(events) {
  try { await fetch('https://api2.amplitude.com/2/httpapi', { method: 'POST', signal: T(10000), headers: J, body: JSON.stringify({ api_key: process.env.AMPLITUDE_API_KEY, events: events.map((e) => ({ user_id: USER.userID, ...e })) }) }); } catch {}
}

// ---------- Cognee: what the agent learned about each shop ----------
const cg = () => ({ 'X-Api-Key': process.env.COGNEE_API_KEY, 'X-Tenant-Id': process.env.COGNEE_TENANT_ID });
export const DATASET = 'country_switch_v2';
export async function cogneeRemember(text) {
  const fd = new FormData();
  fd.append('datasetName', DATASET); fd.append('raw_data', text); fd.append('run_in_background', 'true');
  const r = await fetch(`${process.env.COGNEE_URL}/api/v1/remember`, { method: 'POST', signal: T(30000), headers: cg(), body: fd });
  return { ok: r.ok, body: (await r.text()).slice(0, 300) };
}
export async function cogneeRecall(query) {
  const r = await fetch(`${process.env.COGNEE_URL}/api/v1/recall`, { method: 'POST', signal: T(40000), headers: { ...J, ...cg() }, body: JSON.stringify({ query, datasets: [DATASET], include_references: true }) });
  const t = await r.text();
  return { ok: r.ok, text: t };
}
