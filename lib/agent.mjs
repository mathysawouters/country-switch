// Country Switch: one run = one product link, handled end to end without a chat window.
import { exec, rows } from './s2.mjs';
import * as ucp from './ucp.mjs';
import * as sp from './sponsors.mjs';

const eur = (n) => `€${Number(n).toFixed(2)}`;

export async function startRun(sourceUrl, opts = {}) {
  const id = 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await exec('INSERT INTO cs_runs (id, source_url, status) VALUES (?, ?, ?)', [id, sourceUrl, 'running']);
  const p = run(id, sourceUrl, opts).catch(async (e) => {
    await exec('UPDATE cs_runs SET status = ?, verdict = ? WHERE id = ?', ['error', String(e.message ?? e).slice(0, 500), id]).catch(() => {});
  });
  return { id, done: p };
}

async function run(id, sourceUrl, opts) {
  let seq = 0;
  const session = Date.now();
  const amp = [];
  let gateOn = false;
  // Every tool call lands in SingleStore (the trail) and in Amplitude (the trace).
  const step = async (tool, action, fn, describe) => {
    const t0 = Date.now();
    let status = 'ok', out, summary;
    try { out = await fn(); summary = describe ? describe(out) : ''; }
    catch (e) { status = 'error'; summary = String(e.message ?? e).slice(0, 400); out = { error: summary }; }
    const ms = Date.now() - t0;
    seq += 1;
    await exec('INSERT INTO cs_steps (run_id, seq, tool, action, status, ms, summary, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, seq, tool, action, status, ms, summary, JSON.stringify(out ?? null).slice(0, 60000)]);
    amp.push({ event_type: '[Agent] Tool Call', session_id: session, time: Date.now(), insert_id: `${id}-${seq}`, event_properties: { run_id: id, tool, action, status, latency_ms: ms, summary, same_item_check: gateOn ? 'superlinked' : 'naive' } });
    if (status === 'error') throw new Error(`${tool}.${action}: ${summary}`);
    return out;
  };
  const note = (tool, action, summary, detail, status = 'ok') => step(tool, action, async () => detail ?? {}, () => summary).then((x) => x, (e) => { if (status !== 'ok') return null; throw e; });

  // 0. Policy: is the Superlinked same-item check switched on? (Statsig gate)
  const g = await step('statsig', 'check_gate', () => sp.gate(), (o) => `Gate ${o.name} is ${o.value ? 'ON' : 'OFF'} (rule ${o.rule_id ?? 'default'})`);
  gateOn = opts.forceGate ?? g.value;
  await exec('UPDATE cs_runs SET gate_same_item = ? WHERE id = ?', [gateOn ? 1 : 0, id]);

  // 1. Authority: the shopper's own rules, read from Senso. No rules, no action.
  const R = await step('senso', 'read_rules', () => sp.sensoRules(), (o) => `Read ${o.chunks.length} rule passages. Home country ${o.country}, minimum saving ${eur(o.minSaving)}`);
  const buyer = R.country;
  await exec('UPDATE cs_runs SET buyer_country = ? WHERE id = ?', [buyer, id]);

  // 2. What is the shopper looking at?
  const src = ucp.parseProductUrl(sourceUrl);
  const ref = await step('shopify', 'read_product', () => ucp.readProduct(src), (o) => `${o.title} · SKU ${o.sku} · ${eur(o.price)} at ${src.host}`);
  await exec('UPDATE cs_runs SET product_title = ?, sku = ?, source_store = ?, source_price = ? WHERE id = ?', [ref.title, ref.sku, src.host, ref.price, id]);

  // 3. Memory: what did earlier runs learn about this brand's shops? (Cognee)
  const memP = step('cognee', 'recall', async () => {
    const r = await sp.cogneeRecall(`Which ${src.brand} country shops do not ship to ${buyer}? List the shop hostnames.`);
    const text = r.text ?? '';
    const known = [...new Set((text.match(/[a-z]{2,3}\.[a-z0-9-]+\.[a-z.]{2,6}/g) ?? []).filter((h) => h.endsWith(src.brand)))];
    const noShip = known.filter((h) => new RegExp(`${h.replace(/\./g, '\\.')}[^.\\n]{0,80}(does not|doesn't|not) (ship|deliver|offer)`, 'i').test(text));
    return { ok: r.ok, noShip, excerpt: text.slice(0, 1500) };
  }, (o) => o.noShip.length ? `Remembered: ${o.noShip.join(', ')} did not ship to ${buyer} last time` : 'Nothing remembered yet about these shops').catch(() => ({ noShip: [] }));

  // Senso checks the rule claims in the background while the agent works; awaited before the run closes.
  const checkP = step('senso', 'verify_verdict', () => sp.sensoVerify(`My shopping rules say: I live in Belgium and my delivery country is BE. I only buy from a shop that ships to Belgium. I only switch country when I save at least 5 euro. The agent may fill a cart by itself and I pay myself.`), (o) => o.ok ? `Rules the agent acted on were checked against the knowledge base in Senso (eval ${o.run_id ?? 'recorded'}${o.metrics?.accuracy_pct != null ? ', accuracy ' + o.metrics.accuracy_pct + '%' : ''})` : `Senso check not available: ${o.error ?? 'no result'}`).catch(() => null);

  // 4. Which sibling country shops exist and speak the agent protocol?
  const stores = await step('shopify', 'discover_shops', () => ucp.siblingStores(src), (o) => `${o.length} country shops of ${src.brand}: ${o.map((s) => s.host).join(', ')}`);

  // 5. Ask each shop for this item, priced for a buyer in the home country.
  const found = await step('shopify', 'search_catalog', async () => {
    const lists = await Promise.all(stores.map((s) => ucp.searchStore(s.host, ref.sku || ref.title, buyer).then((l) => l.map((o) => ({ ...o, storeCountry: s.country })), () => [])));
    const seen = new Set();
    return lists.flat().filter((o) => o.available).filter((o) => (seen.has(o.variantId) ? false : seen.add(o.variantId))).map((o) => { try { const u = new URL(o.url); u.hostname = o.store; return { ...o, url: u.toString() }; } catch { return o; } });
  }, (o) => `${o.length} distinct offers found across ${stores.length} shop addresses (mirrors of the same shop counted once)`);

  // 6. Same item? Gate ON: Superlinked decides with evidence. Gate OFF: naive "same brand shop, same search" match.
  const judged = [];
  await step(gateOn ? 'superlinked' : 'naive', 'same_item_check', async () => {
    if (gateOn) {
      // Identical manufacturer SKU is proof on its own; everything else (bundles, regional variants) goes to Superlinked.
      const vs = await Promise.all(found.map((o) => o.sku === ref.sku ? { same: true, probability: 1, reason: `Identical manufacturer SKU ${ref.sku}` } : sp.sameItem(ref, o).catch((e) => ({ same: false, probability: null, reason: 'check failed: ' + String(e.message).slice(0, 80) }))));
      found.forEach((o, i) => judged.push({ ...o, same: vs[i].same, score: vs[i].probability, why: vs[i].reason }));
    }
    else for (const o of found) judged.push({ ...o, same: true, score: null, why: 'Naive match: appeared in the search for this item' });
    return judged.map((o) => ({ store: o.store, title: o.title, sku: o.sku, price: o.price, same: o.same, probability: o.score, why: o.why }));
  }, (o) => `${o.filter((x) => x.same).length} of ${o.length} offers judged the same item${gateOn ? ' (identical SKU, or Qwen3.5-4B on Superlinked, with GLiNER2.5-Decide as second opinion when warm)' : ' (no check: gate is off)'}`);

  // 7. Apply the shopper's rules, cheapest first. Every refusal quotes the rule.
  const mem = await memP;
  const cands = judged.filter((o) => o.same).sort((a, b) => (a.currency === 'EUR' ? 0 : 1) - (b.currency === 'EUR' ? 0 : 1) || a.price - b.price);
  let chosen = null;
  const lessons = [];
  for (const o of judged.filter((x) => !x.same)) { o.decision = 'not_same_item'; o.reason = `${o.why} · ${R.rules.sameItem}`; }
  for (const o of cands) {
    const saving = ref.price - o.price;
    if (o.store === src.host) { o.decision = 'source'; o.reason = 'This is the shop you were looking at'; o.ships = null; continue; }
    if (o.currency && o.currency !== 'EUR') { o.decision = 'refused'; o.reason = `Priced in ${o.currency} · ${R.rules.currency}`; continue; }
    if (chosen) { o.decision = 'not_needed'; o.reason = o.price === chosen.price ? `Same price as ${chosen.store}, which already passed every rule` : `Dearer than ${chosen.store}, which already passed every rule`; continue; }
    if (saving <= 0) { o.decision = 'not_cheaper'; o.reason = `Not cheaper than ${src.host}`; continue; }
    if (o.currency && o.currency !== 'EUR') { o.decision = 'refused'; o.reason = `Priced in ${o.currency} · ${R.rules.currency}`; continue; }
    if (saving < R.minSaving) { o.decision = 'refused'; o.reason = `Saves only ${eur(saving)} · ${R.rules.minSaving}`; continue; }
    if (mem.noShip?.includes(o.store)) { o.ships = false; o.decision = 'refused'; o.reason = `Remembered from an earlier run: no delivery to ${buyer} · ${R.rules.shipping}`; await note('cognee', 'memory_hit', `Skipped the shipping lookup for ${o.store}: memory says it does not ship to ${buyer}`, { store: o.store }); continue; }
    const s = await step('shopify', 'ships_to_check', () => ucp.offeredTo(o.url, buyer), (x) => `${o.store} ${x.offered ? 'offers' : 'does NOT offer'} this item to a buyer in ${buyer}`);
    o.ships = s.offered;
    if (!s.offered) { o.decision = 'refused'; o.reason = `${eur(o.price)} but no delivery to ${buyer} · ${R.rules.shipping}`; lessons.push(`${o.store} does not ship to ${buyer}: the Shop catalog did not offer "${o.title}" (SKU ${o.sku}) to a buyer in ${buyer} on ${new Date().toISOString().slice(0, 10)}.`); continue; }
    lessons.push(`${o.store} ships to ${buyer}: "${o.title}" (SKU ${o.sku}) was offered at ${eur(o.price)} on ${new Date().toISOString().slice(0, 10)}.`);
    o.decision = 'chosen'; o.reason = `Same item, ships to ${buyer}, saves ${eur(saving)}`; chosen = o;
  }
  for (const o of judged) {
    await exec('INSERT INTO cs_offers (run_id, store, store_country, title, sku, variant_id, price, list_price, currency, available, same_item, same_item_score, ships_to_buyer, decision, reason, url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, o.store, o.storeCountry, o.title, o.sku, o.variantId, o.price, o.listPrice, o.currency ?? 'EUR', 1, o.same ? 1 : 0, o.score, o.ships == null ? null : (o.ships ? 1 : 0), o.decision ?? 'not_needed', o.reason ?? '', o.url]);
  }

  // 7b. Timing: is this a good moment to buy? Price history comes from the same ledger (every run adds observations).
  const timing = await step('singlestore', 'price_history', async () => {
    const exact = judged.filter((o) => o.sku === ref.sku);
    for (const o of exact) await exec('INSERT INTO cs_prices (sku, store, price, list_price, source) VALUES (?,?,?,?,?)', [o.sku, o.store, o.price, o.listPrice || o.price, id]);
    const pick = chosen ?? exact.find((o) => o.store === src.host) ?? { store: src.host, price: ref.price, listPrice: ref.listPrice };
    const hist = await rows('SELECT store, DATE_FORMAT(seen, "%Y-%m-%d %H:%i") AS seen, price, list_price FROM cs_prices WHERE sku = ? ORDER BY seen', [ref.sku]);
    const mine = hist.filter((h) => h.store === pick.store).map((h) => ({ ...h, price: Number(h.price) }));
    const low = mine.reduce((m, h) => (h.price < m.price ? h : m), mine[0] ?? { price: pick.price, seen: 'now' });
    const high = mine.reduce((m, h) => (h.price > m.price ? h : m), mine[0] ?? { price: pick.price, seen: 'now' });
    const list = Number(pick.listPrice) || pick.price;
    const off = list > 0 ? Math.round(((list - pick.price) / list) * 100) : 0;
    const since = (mine[0]?.seen ?? '').slice(0, 10);
    let moment, why;
    if (pick.price > low.price) { moment = 'wait'; why = `It was ${eur(low.price)} at ${pick.store} on ${low.seen.slice(0, 10)}; today ${eur(pick.price)}. You could wait.`; }
    else if (off >= 15) { moment = 'good'; why = `${off}% under the list price of ${eur(list)} and the lowest price seen at ${pick.store} in ${mine.length} observations since ${since}.`; }
    else { moment = 'fair'; why = `At the lowest price seen at ${pick.store} since ${since}, but only ${off}% under list. No promotion right now.`; }
    return { store: pick.store, price: pick.price, list_price: list, pct_under_list: off, lowest_seen: low.price, highest_seen: high.price, observations: mine.length, since, moment, why, history: hist.slice(-60) };
  }, (o) => `${o.moment === 'good' ? 'Good moment to buy' : o.moment === 'wait' ? 'Not the best moment' : 'Fair moment'}: ${o.why}`).catch(() => null);

  // 8. Act: fill a real cart at the winning shop, or refuse and say why.
  let status, verdict, cartUrl = null;
  if (chosen) {
    const cart = await step('shopify', 'create_cart', () => ucp.createCart(chosen.store, chosen.variantId, buyer), (c) => `Real cart at ${chosen.store}: ${c?.line_items?.[0]?.item?.title ?? chosen.title}, total ${eur((c?.totals?.find((t) => t.type === 'total')?.amount ?? chosen.price * 100) / 100)}`);
    cartUrl = cart?.continue_url ?? chosen.checkoutUrl;
    status = 'cart_filled';
    verdict = `Cart filled at ${chosen.store}: ${eur(chosen.price)} instead of ${eur(ref.price)}. You save ${eur(ref.price - chosen.price)}. ${R.rules.authority}`;
  } else {
    const refused = cands.filter((o) => o.decision === 'refused');
    status = 'refused';
    verdict = refused.length ? `No switch. ${[...new Set(refused.map((o) => `${o.store}: ${o.reason}`))].join(' | ')}` : `No switch. ${src.host} already has the best price that passes your rules.`;
    await note('agent', 'refuse', verdict, { refused: refused.map((o) => ({ store: o.store, price: o.price, reason: o.reason })) });
  }

  // 9. Check the verdict against the rules in Senso, then remember what was learned.
  const check = await checkP;
  if (lessons.length) await step('cognee', 'remember', () => sp.cogneeRemember(lessons.join('\n')), () => `Stored ${lessons.length} lessons: ${lessons.map((l) => l.split(':')[0]).join('; ')}`).catch(() => null);

  const saving = chosen ? ref.price - chosen.price : 0;
  await exec('UPDATE cs_runs SET status = ?, verdict = ?, best_price = ?, saving = ?, chosen_store = ?, cart_url = ?, summary = ? WHERE id = ?', [status, verdict, chosen?.price ?? ref.price, saving, chosen?.store ?? null, cartUrl, JSON.stringify({ rules: R.rules, senso_chunks: R.chunks.slice(0, 3), offers: judged.length, senso_eval: check?.run_id ?? null, timing }), id]);
  amp.push({ event_type: '[Agent] Run Completed', session_id: session, time: Date.now(), insert_id: `${id}-done`, event_properties: { run_id: id, outcome: status, saving_eur: saving, buy_moment: timing?.moment ?? null, pct_under_list: timing?.pct_under_list ?? null, same_item_check: gateOn ? 'superlinked' : 'naive', chosen_store: chosen?.store ?? null, sku: ref.sku, chosen_sku: chosen?.sku ?? null, wrong_item: chosen ? chosen.sku !== ref.sku : false, tool_calls: seq } });
  await sp.amplitude(amp);
  await sp.statsigEvent('run_completed', saving, { outcome: status, same_item_check: gateOn ? 'superlinked' : 'naive', wrong_item: String(chosen ? chosen.sku !== ref.sku : false) });
  return { id, status, verdict, cartUrl };
}
