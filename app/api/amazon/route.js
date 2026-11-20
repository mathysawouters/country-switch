import { exec } from '@/lib/s2.mjs';
import { sensoRules, sensoWriteDecision } from '@/lib/sponsors.mjs';

// The browser add-on reads the same ASIN on Amazon in the neighbouring countries, in the shopper's own browser,
// and posts what it saw here. This route applies the shopper's rules, writes the run to the ledger and answers the add-on.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body, status = 200) => Response.json(body, { status, headers: CORS });
const eur = (n) => '€' + Number(n).toFixed(2);
const short = (site) => String(site ?? '').replace(/^www\./, '');
const price = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const round = (n) => Math.round(n * 100) / 100;

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(req) {
  const b = await req.json().catch(() => null);
  const asin = String(b?.asin ?? '').trim().toUpperCase();
  if (!b || !/^[A-Z0-9]{10}$/.test(asin) || !b.source?.site) return json({ error: 'Send { asin, title, source: { site, ... }, offers: [...] }' }, 400);
  const title = String(b.title ?? '').slice(0, 220) || `Amazon item ${asin}`;
  const image = b.image ?? null;
  const source = { ...b.source, price: price(b.source.price), url: b.source.url || `https://${b.source.site}/dp/${asin}` };
  const offers = (Array.isArray(b.offers) ? b.offers : []).filter((o) => o?.site).map((o) => ({ ...o, price: price(o.price) }));

  const id = 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  const trail_url = `http://localhost:3311/v2?run=${id}`;
  try {
    await exec('INSERT INTO cs_runs (id, source_url, status, product_title, sku, source_store, source_price) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, source.url, 'running', title, asin, source.site, source.price]);
  } catch (e) { return json({ error: `The ledger is not reachable: ${String(e.message ?? e).slice(0, 200)}` }, 500); }

  let seq = 0;
  const step = async (tool, action, fn, describe) => {
    const t0 = Date.now();
    seq += 1; const n = seq;
    let status = 'ok', out, summary, err = null;
    try { out = await fn(); summary = describe(out); }
    catch (e) { status = 'error'; summary = String(e.message ?? e).slice(0, 400); out = { error: summary }; err = e; }
    await exec('INSERT INTO cs_steps (run_id, seq, tool, action, status, ms, summary, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, n, tool, action, status, Date.now() - t0, summary, JSON.stringify(out ?? null).slice(0, 60000)]);
    if (err) throw err;
    return out;
  };

  try {
    // 1. The shopper's rules, from Senso. Without rules the agent does not act.
    let R;
    try {
      R = await step('senso', 'read_rules', () => sensoRules(), (o) => `Read ${o.chunks.length} rule passages. Home country ${o.country ?? 'unknown'}, minimum saving ${eur(Number.isFinite(o.minSaving) ? o.minSaving : 0)}`);
      if (!R.chunks.length || !Number.isFinite(R.minSaving)) throw new Error('no usable rules');
    } catch {
      const verdict = 'The agent could not read your rules from Senso. Without rules it has no authority, so it will not act.';
      await exec('UPDATE cs_runs SET status = ?, verdict = ?, gate_same_item = 1 WHERE id = ?', ['refused', verdict, id]);
      return json({ id, status: 'refused', headline: 'No rules, no action', verdict, cart_url: null, chosen_site: null, saving: 0, trail_url });
    }
    const rules = R.rules;

    // 2. What the shopper's own browser read.
    const say = (o) => `${String(o.country ?? short(o.site)).toLowerCase()} ${o.robot ? 'robot check' : o.error ? 'not readable' : o.price == null || o.available === false ? 'not available' : eur(o.price)}`;
    await step('amazon', 'read_in_your_browser', async () => ({ asin, source, offers }), () => `Your own browser read ASIN ${asin} on ${offers.length + 1} Amazon country sites: ${[source, ...offers].map(say).join(', ')}`);

    // 3. Decide.
    const ok = (o) => o.price != null && o.available === true && !o.robot && !o.error;
    const candidates = offers.filter(ok).sort((a, c) => a.price - c.price);
    const best = candidates[0] ?? null;
    const why = (o) => (o.robot ? 'Amazon asked for a robot check; not read' : o.error ? `Could not read this Amazon site: ${String(o.error).slice(0, 100)}` : 'Not available on this Amazon site');
    let status, headline, verdict, chosen = null, saving = 0;
    const judged = [];

    if (source.price == null && best) {
      status = 'cart_filled'; chosen = best; headline = 'Available next door';
      verdict = `Same item (ASIN ${asin}) has no price on ${source.site}, but ${best.site} has it for ${eur(best.price)}. Amazon shows delivery to: ${best.deliver || 'not shown'}. Check on Amazon that it delivers to your address before you pay. ${rules.authority ?? ''}`.trim();
    } else if (source.price == null) {
      status = 'refused'; headline = 'Not available';
      verdict = `ASIN ${asin} has no price on ${source.site} and no other Amazon country site has it available. Nothing to switch to.`;
    } else {
      saving = best ? round(source.price - best.price) : 0;
      if (!best || saving < R.minSaving) {
        status = 'refused'; headline = 'Stay here';
        const found = !best ? 'No other Amazon country site has this item available.' : saving > 0 ? `Best price elsewhere is ${eur(best.price)} on ${best.site}, a saving of ${eur(saving)}, which is below your minimum.` : `Best price elsewhere is ${eur(best.price)} on ${best.site}, which is not cheaper than ${eur(source.price)} on ${source.site}. Saving ${eur(0)}.`;
        verdict = `Stay on ${source.site} at ${eur(source.price)} (ASIN ${asin}). ${found} ${rules.minSaving ?? ''}`.trim();
        saving = best && saving > 0 ? saving : 0;
      } else {
        status = 'cart_filled'; chosen = best; headline = `Cheaper next door: you save ${eur(saving)}`;
        verdict = `Same item (ASIN ${asin}) on ${best.site}: ${eur(best.price)} instead of ${eur(source.price)} on ${source.site}. You save ${eur(saving)}. Amazon shows delivery to: ${best.deliver || 'not shown'}. Check on Amazon that it delivers to your address before you pay. ${rules.authority ?? ''}`.trim();
      }
    }
    const cart_url = chosen ? `https://${chosen.site}/gp/aws/cart/add.html?ASIN.1=${asin}&Quantity.1=1` : null;

    judged.push({ ...source, decision: 'source', reason: source.price == null ? 'The Amazon page you are on. No price shown here.' : 'The Amazon page you are on.' });
    for (const o of offers) {
      if (!ok(o)) { judged.push({ ...o, decision: 'refused', reason: why(o) }); continue; }
      if (o === chosen) { judged.push({ ...o, decision: 'chosen', reason: source.price == null ? 'Cheapest Amazon site that has it.' : `Cheapest: saves ${eur(saving)}.` }); continue; }
      if (source.price != null && o.price >= source.price) { judged.push({ ...o, decision: 'not_cheaper', reason: `${eur(o.price)} is not cheaper than ${eur(source.price)} on ${source.site}.` }); continue; }
      if (status === 'refused') { judged.push({ ...o, decision: 'refused', reason: `Saves only ${eur(source.price - o.price)}. ${rules.minSaving ?? ''}`.trim() }); continue; }
      judged.push({ ...o, decision: 'not_needed', reason: `${chosen.site} is cheaper.` });
    }
    for (const o of judged) {
      await exec('INSERT INTO cs_offers (run_id, store, store_country, title, sku, price, landed, currency, available, same_item, same_item_score, decision, reason, url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, o.site, o.country ?? null, String(o.title || title).slice(0, 400), asin, o.price, o.price, 'EUR', o.price != null && o.available !== false && !o.robot && !o.error ? 1 : 0, 1, 1, o.decision, o.reason, o.url ?? `https://${o.site}/dp/${asin}`]);
    }
    await step('agent', 'decide', async () => ({ status, headline, saving, chosen: chosen?.site ?? null, min_saving: R.minSaving, offers: judged.map((o) => ({ site: o.site, price: o.price, decision: o.decision, reason: o.reason })) }), () => verdict);

    // 4. Price history.
    const priced = judged.filter((o) => o.price != null);
    await step('singlestore', 'price_history', async () => {
      for (const o of priced) await exec('INSERT INTO cs_prices (sku, store, price, list_price, source) VALUES (?,?,?,?,?)', [asin, o.site, o.price, o.price, id]);
      return { stored: priced.length, sites: priced.map((o) => ({ store: o.site, price: o.price })) };
    }, (o) => `Stored ${o.stored} price observations for ASIN ${asin}`);

    // 5. Decision memory in Senso. A failure here never breaks the run.
    const today = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const record = `Decision record ${id}, ${today} UTC. Item: ${title}, SKU ${asin}. Read in the shopper's own browser on ${source.site} at ${source.price == null ? 'no price' : eur(source.price)}. Outcome: ${status === 'cart_filled' ? `add-to-cart link prepared for ${chosen.site} at ${eur(chosen.price)}, saving ${eur(saving)}` : 'no switch, the agent refused'}. Amazon sites compared: ${judged.map((o) => `${o.site} ${o.price == null ? 'no price' : eur(o.price)} (${o.decision})`).join('; ')}.`;
    await step('senso', 'write_decision', () => sensoWriteDecision(`Decision ${today}: ${title.slice(0, 60)} (SKU ${asin})`, record), (o) => (o.ok ? `Decision written back to Senso as document ${String(o.content_id).slice(0, 8)}.` : `Senso write-back failed (${o.status})`)).catch(() => null);

    // 6. Close the run.
    const summary = { rules, senso_chunks: R.chunks.slice(0, 3), image, via: { amazon: { asin, host: source.site, price: source.price, title, fromBrowser: true, sites: [source, ...offers].map((o) => ({ site: short(o.site), url: o.url ?? `https://${o.site}/dp/${asin}` })) }, shared: source.site, query: title, brand_shop: chosen?.site ?? source.site, ignored: [] } };
    await exec('UPDATE cs_runs SET status = ?, verdict = ?, buyer_country = ?, best_price = ?, saving = ?, chosen_store = ?, cart_url = ?, gate_same_item = 1, summary = ? WHERE id = ?', [status, verdict, R.country ?? source.country ?? null, chosen?.price ?? best?.price ?? source.price, saving, chosen?.site ?? null, cart_url, JSON.stringify(summary), id]);
    return json({ id, status, headline, verdict, cart_url, chosen_site: chosen?.site ?? null, saving, trail_url });
  } catch (e) {
    const verdict = `The run stopped on an error: ${String(e.message ?? e).slice(0, 300)}`;
    await exec('UPDATE cs_runs SET status = ?, verdict = ? WHERE id = ?', ['error', verdict, id]).catch(() => {});
    return json({ id, status: 'error', headline: 'Something went wrong', verdict, error: verdict, cart_url: null, chosen_site: null, saving: 0, trail_url }, 500);
  }
}
