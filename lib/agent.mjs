// Country Switch: one run = one product link, handled end to end without a chat window.
import { exec, rows } from './s2.mjs';
import * as ucp from './ucp.mjs';
import * as sp from './sponsors.mjs';

const eur = (n) => `€${Number(n).toFixed(2)}`;

export async function startRun(sourceUrl, opts = {}) {
  const id = 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await exec('INSERT INTO cs_runs (id, source_url, status, shared_by, watch_id, target) VALUES (?, ?, ?, ?, ?, ?)', [id, sourceUrl, 'running', opts.sharedBy || null, opts.watchId || null, opts.target ?? null]);
  const p = run(id, sourceUrl, opts).catch(async (e) => {
    // A link the agent cannot work with is an honest outcome, not a crash: say why and count it.
    const msg = String(e.message ?? e);
    const cannot = e.cannotHelp || /read_product|Not a product link|Could not read/.test(msg);
    let host = ''; try { host = new URL(sourceUrl).hostname; } catch {}
    const verdict = e.cannotHelp ? msg : cannot ? `I cannot help with this link. ${host || 'This page'} is not a brand webshop I can read (it works for brands that run their own shop per country, such as UGREEN, Anker, eufy, soundcore, Shokz or xTool; not for retailers like bol.com, Coolblue or Amazon).` : msg.slice(0, 500);
    await exec('UPDATE cs_runs SET status = ?, verdict = ?, source_store = COALESCE(source_store, ?) WHERE id = ?', [cannot ? 'cannot_help' : 'error', verdict, host, id]).catch(() => {});
    if (opts.watchId) await exec('UPDATE cs_watches SET last_checked = NOW(6), checks = checks + 1, last_run_id = ? WHERE id = ?', [id, opts.watchId]).catch(() => {});
  });
  return { id, done: p };
}

async function run(id, sourceUrl, opts) {
  let seq = 0;
  const session = Date.now();
  const amp = [];
  const stepLog = [];
  const startedAt = Date.now();
  let gateOn = false;
  // Every tool call lands in SingleStore (the trail) and in Amplitude (the trace).
  const step = async (tool, action, fn, describe) => {
    const t0 = Date.now();
    seq += 1; const n = seq; // numbered when it starts, so steps that run in the background keep a stable place
    let status = 'ok', out, summary;
    try { out = await fn(); summary = describe ? describe(out) : ''; }
    catch (e) { status = 'error'; summary = String(e.message ?? e).slice(0, 400); out = { error: summary }; }
    const ms = Date.now() - t0;
    await exec('INSERT INTO cs_steps (run_id, seq, tool, action, status, ms, summary, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, n, tool, action, status, ms, summary, JSON.stringify(out ?? null).slice(0, 60000)]);
    stepLog.push({ n, tool, action, status, ms, summary });
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
  // A simulated shopper (Firedrill) can live in another country: the rules stay the same, the home country and postal code are theirs.
  const buyer = opts.country ?? R.country;
  if (opts.country && opts.country !== R.country) { R.postal = opts.postal ?? R.postal; R.pickups = []; }
  await exec('UPDATE cs_runs SET buyer_country = ? WHERE id = ?', [buyer, id]);

  // 2. What is the shopper looking at?
  // A brand-shop link is read directly. A retailer link or a plain product name is first traced to the brand's own shop.
  let src = null, ref = null, via = null;
  try { src = ucp.parseProductUrl(sourceUrl); ref = await ucp.readProduct(src); } catch { src = null; }
  if (!ref && /^https?:/i.test(sourceUrl)) {
    // The link is on the brand's own site but not on a shop the agent can read: look for the same product page on its country shops.
    try { const u = new URL(sourceUrl); const h = (u.pathname.match(/\/products\/([^/?#]+)/) ?? [])[1]; const dom = u.hostname.split('.').slice(-2).join('.');
      const hit = h ? await ucp.sameHandleElsewhere(h, dom, u.searchParams.get('variant')) : null;
      if (hit) { src = hit.src; ref = hit.ref; via = { shared: u.hostname, query: h, brand_shop: src.host, ignored: [] }; }
    } catch {}
  }
  let amazon = null;
  if (!ref) {
    let { query, retailer, hostBrand } = ucp.queryFromInput(sourceUrl);
    const az = ucp.amazonAsin(sourceUrl);
    if (az?.asin) {
      amazon = opts.seen?.title ? await step('amazon', 'read_listing', async () => ({ asin: az.asin, host: az.host, title: opts.seen.title, price: opts.seen.price, fromBrowser: true, sites: ['amazon.com.be', 'amazon.de', 'amazon.nl', 'amazon.fr'].map((d) => ({ site: d, url: `https://www.${d}/dp/${az.asin}` })) }), (o) => `Sent from your own browser while you were on the Amazon page: "${o.title.slice(0, 80)}"${o.price ? ', ' + eur(o.price) + ' on ' + az.host.replace('www.', '') : ''}. Amazon has no agent endpoint, so I look for the same product at the brand's own shop.`) : await step('amazon', 'read_listing', () => ucp.readAmazon(az), (o) => o.title ? `Amazon ${az.host.replace('www.', '')} item ${o.asin}: "${o.title.slice(0, 80)}"${o.price ? ', shown at ' + eur(o.price) : ', price not readable from here'}. Amazon has no agent endpoint, so I look for the same product at the brand's own shop.` : `Amazon blocked the automated read of ${o.asin}; using the words in the link instead`).catch(() => null);
      if (amazon?.title) query = amazon.title.replace(/[,(|\[–-].*$/, '').replace(/[^\p{L}\p{N}\s.]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 7).join(' ');
      hostBrand = null;
    }
    // A link on the brand's own site that is not a product page (a landing page, another market): keep the brand from the address.
    if (hostBrand && !query.toLowerCase().split(' ').includes(hostBrand) && (await ucp.siblingStores({ brand: `${hostBrand}.com` }).catch(() => [])).length) query = `${hostBrand} ${query}`;
    if (!query || query.length < 3) { const e = new Error('I cannot help with this link: I could not read a product name from it.'); e.cannotHelp = true; throw e; }
    const found = await step('shopify', 'find_brand_shop', () => ucp.findBrandProduct(query, buyer), (o) => `Searched every shop that ships to ${buyer} for "${query}": ${o.official.length} listing${o.official.length === 1 ? '' : 's'} in the brand's own webshop, ${o.others.length} at other sellers (ignored: ${R.rules.trust})`);
    if (!found.official.length) found.official = await step('shopify', 'search_brand_shops', () => ucp.findInBrandShops(query, buyer), (o) => o.length ? `Looked inside the brand's own country shops: best match "${o[0].title}" at ${o[0].host}` : `No own webshop found for the brand "${query.split(' ')[0]}"`).catch(() => []);
    if (amazon?.title) {
      // An Amazon title is long and vague. Collect candidates at the brand's shops, then let the small model on Superlinked accept only the exact same model.
      const words = amazon.title.replace(/&amp;/g, '&').split(/[\s,()|]+/).filter(Boolean);
      const q2 = [words[0], ...words.slice(1).filter((w) => /\d/.test(w)).slice(0, 3)].join(' ');
      const more = [...(await ucp.findInBrandShops(q2, buyer).catch(() => [])), ...((await ucp.findBrandProduct(q2, buyer).catch(() => ({ official: [] }))).official)];
      const seenU = new Set(); const cands = [...more, ...found.official].filter((c) => { const k = c.url.split('?')[0]; return seenU.has(k) ? false : seenU.add(k); }).slice(0, 8);
      const m = await step('superlinked', 'match_amazon_item', async () => {
        const tried = [];
        for (const c of cands) { const v = await sp.sameItem({ title: amazon.title.replace(/&amp;/g, '&'), sku: `Amazon ${amazon.asin}` }, { title: c.title, sku: '' }, { ignoreSku: true }).catch(() => ({ same: false, reason: 'check failed' })); tried.push({ title: c.title, host: c.host, same: v.same, reason: v.reason }); if (v.same) return { match: c, tried }; }
        return { match: null, tried };
      }, (o) => o.match ? `Of ${o.tried.length} candidates at the brand's shops, "${o.match.title}" at ${o.match.host} is the same model as the Amazon item` : `None of the ${o.tried.length} candidates at the brand's own shops is exactly the Amazon item (searched "${q2}")`).catch(() => ({ match: null }));
      found.official = m.match ? [m.match] : [];
      if (!m.match) { const e = new Error(`I cannot help with this Amazon item. I could not find exactly "${amazon.title.replace(/&amp;/g, '&').slice(0, 70)}" at the brand's own webshop, and I will not guess with a look-alike. ${R.rules.sameItem}`); e.cannotHelp = true; throw e; }
    }
    for (const c of found.official) { try { src = ucp.parseProductUrl(c.url); ref = await ucp.readProduct(src); break; } catch { src = null; } }
    if (!ref) {
      const cheap = found.others.filter((o) => o.currency === 'EUR').sort((a, b) => a.price - b.price)[0];
      const e = new Error(`I cannot help with "${query}". I found no webshop of the brand itself that I can talk to${found.others.length ? `, only ${found.others.length} other sellers${cheap ? ` (the cheapest, ${cheap.host}, asks ${eur(cheap.price)})` : ''}. ${R.rules.trust}` : '.'}`);
      e.cannotHelp = true; throw e;
    }
    via = { amazon, seen_price: opts.seen?.price ?? amazon?.price ?? null, shared: retailer ?? 'product name', query, brand_shop: src.host, ignored: found.others.slice(0, 6).map((o) => ({ host: o.host, title: o.title, price: o.price, currency: o.currency })) };
  }
  await step('shopify', 'read_product', async () => ref, (o) => `${via ? `You shared ${via.shared === 'product name' ? 'a product name' : via.shared}; the brand's own shop is ${src.host}. ` : ''}${o.title} · SKU ${o.sku} · ${eur(o.price)} at ${src.host}`);
  await exec('UPDATE cs_runs SET product_title = ?, sku = ?, source_store = ?, source_price = ? WHERE id = ?', [ref.title, ref.sku, src.host, ref.price, id]);

  // 2b. Decision memory in Senso: has the agent decided on this exact item before?
  const pastP = step('senso', 'past_decisions', () => sp.sensoPastDecisions(ref.sku), (o) => o.length ? `Senso holds ${o.length} earlier decision${o.length > 1 ? 's' : ''} on SKU ${ref.sku}. Latest: ${o[0].title}` : `No earlier decision on SKU ${ref.sku} in Senso`).catch(() => []);

  // 3. Memory: what did earlier runs learn about this brand's shops? (Cognee)
  const memP = step('cognee', 'recall', async () => {
    const r = await sp.cogneeRecall(`Which ${src.brand} country shops do not ship to ${buyer}? List the shop hostnames.`, buyer);
    const text = r.text ?? '';
    const known = [...new Set((text.match(/[a-z]{2,3}\.[a-z0-9-]+\.[a-z.]{2,6}/g) ?? []).filter((h) => h.endsWith(src.brand)))];
    const noShip = known.filter((h) => new RegExp(`${h.replace(/\./g, '\\.')}[^.\\n]{0,80}(does not|doesn't|not) (ship|deliver|offer)`, 'i').test(text));
    return { ok: r.ok, noShip, known, excerpt: text.slice(0, 1500) };
  }, (o) => o.noShip.length ? `Remembered: ${o.noShip.join(', ')} did not ship to ${buyer} last time` : (o.known?.length ? `Remembered ${o.known.length} ${src.brand} shop${o.known.length > 1 ? 's' : ''} from earlier runs (${o.known.slice(0, 4).join(', ')}); none of them refused delivery to ${buyer}` : `Nothing remembered yet about these shops in the ${buyer} brain`)).catch(() => ({ noShip: [] }));

  // Senso checks the rule claims in the background while the agent works; awaited before the run closes.
  const checkP = step('senso', 'verify_verdict', () => sp.sensoVerify(`My shopping rules say: I live in Belgium and my delivery country is BE. I only buy from a shop that ships to Belgium. I only switch country when I save at least 5 euro. The agent may fill a cart by itself and I pay myself.`), (o) => o.ok ? `Rules the agent acted on were checked against the knowledge base in Senso (eval ${o.run_id ?? 'recorded'}${o.metrics?.accuracy_pct != null ? ', accuracy ' + o.metrics.accuracy_pct + '%' : ''})` : `Senso check not available: ${o.error ?? 'no result'}`).catch(() => null);

  // 4. Which sibling country shops exist and speak the agent protocol?
  const stores = await step('shopify', 'discover_shops', () => ucp.siblingStores(src), (o) => `${o.length} country shops of ${src.brand}: ${o.map((s) => s.host).join(', ')}`);

  const onlyShop = stores.filter((x) => x.host !== src.host).length === 0;
  if (onlyShop && !via) {
    const e = new Error(`I cannot help with this one. ${src.brand} has no other country shops I can ask, so there is nothing to compare ${src.host} with.`);
    e.cannotHelp = true; throw e;
  }

  // 5. Ask each shop for this item, priced for a buyer in the home country.
  const found = await step('shopify', 'search_catalog', async () => {
    const lists = await Promise.all(stores.map((s) => ucp.searchStore(s.host, ref.sku || ref.title, buyer).then((l) => l.map((o) => ({ ...o, storeCountry: s.country })), () => [])));
    const seen = new Set();
    // A price more than four times the shared one is another currency or another product class, not a rival offer.
    return lists.flat().filter((o) => o.available && o.price <= ref.price * 4).filter((o) => (seen.has(o.variantId) ? false : seen.add(o.variantId))).map((o) => { try { const u = new URL(o.url); u.hostname = o.store; return { ...o, url: u.toString() }; } catch { return o; } });
  }, (o) => `${o.length} distinct offers found across ${stores.length} shop addresses (mirrors of the same shop counted once)`);

  // 5b. Vector shortlist: Superlinked embeds every listing title (any language), SingleStore ranks them against the item by DOT_PRODUCT.
  const sims = new Map();
  if (gateOn && found.length) await step('singlestore', 'vector_search', async () => {
    const E = await sp.embed([`${ref.title}`, ...found.map((o) => `${o.title}${o.variantTitle && o.variantTitle !== 'Default Title' ? ' ' + o.variantTitle : ''}`)]);
    await exec(`INSERT INTO cs_embed (run_id, kind, store, variant_id, sku, title, v) VALUES ${found.map(() => '(?,?,?,?,?,?,?)').join(',')}`, found.flatMap((o, i) => [id, 'offer', o.store, o.variantId, o.sku, o.title, JSON.stringify(E[i + 1])]));
    const ranked = await rows('SELECT store, variant_id, title, ROUND(DOT_PRODUCT(v, ? :> VECTOR(1024)), 3) AS sim FROM cs_embed WHERE run_id = ? ORDER BY sim DESC', [JSON.stringify(E[0]), id]);
    for (const r of ranked) sims.set(`${r.store}|${r.variant_id}`, Number(r.sim));
    return ranked.map((r) => ({ store: r.store, title: r.title, similarity: Number(r.sim) }));
  }, (o) => `Ranked ${o.length} listings by vector similarity to the item (bge-m3 embeddings from Superlinked, DOT_PRODUCT in SingleStore): top ${o[0]?.similarity}, lowest ${o[o.length - 1]?.similarity}; ${o.filter((x) => x.similarity < 0.5).length} are clearly another product`).catch(() => null);
  for (const o of found) o.sim = sims.get(`${o.store}|${o.variantId}`) ?? null;

  // 6. Same item? Gate ON: Superlinked decides with evidence. Gate OFF: naive "same brand shop, same search" match.
  const judged = [];
  await step(gateOn ? 'superlinked' : 'naive', 'same_item_check', async () => {
    if (gateOn) {
      // Identical manufacturer SKU is proof on its own; everything else (bundles, regional variants) goes to Superlinked.
      const vs = await Promise.all(found.map((o) => o.sku === ref.sku ? { same: true, probability: 1, reason: `Identical manufacturer SKU ${ref.sku}` } : (o.sim != null && o.sim < 0.5) ? { same: false, probability: o.sim, reason: `Another product: vector similarity ${o.sim} to the item (SingleStore)` } : sp.sameItem(ref, o).catch((e) => ({ same: false, probability: null, reason: 'check failed: ' + String(e.message).slice(0, 80) }))));
      found.forEach((o, i) => judged.push({ ...o, same: vs[i].same, score: vs[i].probability, why: vs[i].same || o.sim == null || /vector similarity/.test(vs[i].reason) ? vs[i].reason : `${vs[i].reason} (vector similarity ${o.sim})` }));
    }
    else for (const o of found) judged.push({ ...o, same: true, score: null, why: 'Naive match: appeared in the search for this item' });
    return judged.map((o) => ({ store: o.store, title: o.title, sku: o.sku, price: o.price, same: o.same, probability: o.score, why: o.why }));
  }, (o) => `${o.filter((x) => x.same).length} of ${o.length} offers judged the same item${gateOn ? ' (identical SKU, or Qwen3.5-4B on Superlinked, with GLiNER2.5-Decide as second opinion when warm)' : ' (no check: gate is off)'}`);

  // 7. Apply the shopper's rules, cheapest first. Every refusal quotes the rule.
  const mem = await memP;
  // 6b. Total cost to the door: ask each shop's own cart for the delivery cost to the shopper's postal code.
  const quotable = judged.filter((o) => o.same && (!o.currency || o.currency === 'EUR') && o.price <= ref.price).sort((a, b) => a.price - b.price).slice(0, 5);
  await step('shopify', 'shipping_quote', async () => {
    const qs = await Promise.all(quotable.map((o) => ucp.quote(o.store, o.variantId, buyer, R.postal).catch(() => null)));
    quotable.forEach((o, i) => { o.shipping = qs[i]?.shipping ?? null; o.shipMethod = qs[i]?.method ?? null; });
    return quotable.map((o) => ({ store: o.store, price: o.price, shipping: o.shipping, method: o.shipMethod, total: o.price + (o.shipping ?? 0) }));
  }, (o) => `Delivery to ${buyer} ${R.postal} quoted by ${o.filter((x) => x.shipping != null).length} of ${o.length} shops: ${o.filter((x) => x.shipping != null).map((x) => `${x.store.split('.')[0]} ${x.shipping === 0 ? 'free' : eur(x.shipping)}`).join(', ') || 'none'}`).catch(() => null);
  for (const o of judged) o.landed = o.price + (o.shipping ?? 0);
  const srcOffer = judged.find((o) => o.store === src.host && o.sku === ref.sku);
  let refLanded = srcOffer?.landed ?? ref.price;
  const cands = judged.filter((o) => o.same).sort((a, b) => (a.currency === 'EUR' ? 0 : 1) - (b.currency === 'EUR' ? 0 : 1) || a.landed - b.landed);
  let chosen = null;
  const lessons = [];
  for (const o of judged.filter((x) => !x.same)) { o.decision = 'not_same_item'; o.reason = `${o.why} · ${R.rules.sameItem}`; }
  for (const o of cands) {
    const saving = refLanded - o.landed;
    if (o.store === src.host) { o.decision = 'source'; o.reason = 'This is the shop you were looking at'; o.ships = null; continue; }
    if (o.currency && o.currency !== 'EUR') { o.decision = 'refused'; o.reason = `Priced in ${o.currency} · ${R.rules.currency}`; continue; }
    if (chosen) { o.decision = 'not_needed'; o.reason = o.landed === chosen.landed ? `Same total as ${chosen.store}, which already passed every rule` : `Dearer than ${chosen.store}, which already passed every rule`; continue; }
    if (saving <= 0) { o.decision = 'not_cheaper'; o.reason = `Not cheaper than ${src.host}`; continue; }
    if (o.currency && o.currency !== 'EUR') { o.decision = 'refused'; o.reason = `Priced in ${o.currency} · ${R.rules.currency}`; continue; }
    if (saving < R.minSaving) { o.decision = 'refused'; o.reason = `Saves only ${eur(saving)} with delivery included · ${R.rules.minSaving}`; continue; }
    if (mem.noShip?.includes(o.store)) { o.ships = false; o.decision = 'refused'; o.reason = `Remembered from an earlier run: no delivery to ${buyer} · ${R.rules.shipping}`; await note('cognee', 'memory_hit', `Skipped the shipping lookup for ${o.store}: memory says it does not ship to ${buyer}`, { store: o.store }); continue; }
    const s = await step('shopify', 'ships_to_check', () => ucp.offeredTo(o.url, buyer), (x) => `${o.store} ${x.offered ? 'offers' : 'does NOT offer'} this item to a buyer in ${buyer}`);
    o.ships = s.offered;
    if (!s.offered) { o.decision = 'refused'; o.reason = `${eur(o.price)} but no delivery to ${buyer} · ${R.rules.shipping}`; lessons.push(`${o.store} does not ship to ${buyer}: the Shop catalog did not offer "${o.title}" (SKU ${o.sku}) to a buyer in ${buyer} on ${new Date().toISOString().slice(0, 10)}.`); continue; }
    lessons.push(`${o.store} ships to ${buyer}: "${o.title}" (SKU ${o.sku}) was offered at ${eur(o.price)} on ${new Date().toISOString().slice(0, 10)}.`);
    o.decision = 'chosen'; o.reason = `Same item, ships to ${buyer}, ${o.shipping == null ? 'shipping not quoted' : o.shipping === 0 ? 'free delivery' : 'delivery ' + eur(o.shipping)}, saves ${eur(saving)} in total`; chosen = o;
  }
  // 7a. Pickup across the border (rule 9): a shop that only serves its own country can still deliver to the shopper's pickup address there.
  // Each of those shops is asked again as a buyer in its own country, because the price can differ per buyer country.
  if (opts.pickupMin != null) R.pickupMin = Number(opts.pickupMin); // test hook
  if (R.pickups.length) {
    const baseline = chosen ? chosen.landed : refLanded;
    const options = await step('shopify', 'pickup_quotes', async () => {
      const out = [];
      for (const pc of R.pickups) for (const st of stores.filter((x) => x.country === pc.country)) {
        const list = await ucp.searchStore(st.host, ref.sku || ref.title, pc.country).catch(() => []);
        const o = list.find((x) => x.sku === ref.sku && x.available && (!x.currency || x.currency === 'EUR'));
        if (!o) continue;
        const q = await ucp.quote(st.host, o.variantId, pc.country, pc.postal).catch(() => null);
        if (q?.shipping == null) continue;
        out.push({ ...o, storeCountry: pc.country, pickup: pc, shipping: q.shipping, shipMethod: q.method, landed: o.price + q.shipping });
      }
      return out.sort((a, b) => a.landed - b.landed);
    }, (o) => o.length ? `Asked the shops in your pickup countries as a local buyer: ${o.map((x) => `${x.store.split('.')[0]} ${eur(x.landed)} to ${x.pickup.country} ${x.pickup.postal}`).join(', ')}. Best delivered to your door: ${eur(baseline)}` : 'No shop in your pickup countries has this exact item with delivery to your pickup address').catch(() => []);
    const p = options[0];
    if (p && p.landed <= baseline - R.pickupMin) {
      if (chosen) { chosen.decision = 'not_needed'; chosen.reason = `Delivers to your door for ${eur(chosen.landed)}, but pickup in ${p.pickup.name} saves ${eur(chosen.landed - p.landed)} more`; }
      const row = judged.find((o) => o.store === p.store && o.sku === p.sku) ?? (judged.push({ ...p, same: true, score: 1, why: `Identical manufacturer SKU ${ref.sku}` }), judged[judged.length - 1]);
      Object.assign(row, { price: p.price, shipping: p.shipping, shipMethod: p.shipMethod, landed: p.landed, variantId: p.variantId, ships: false, pickup: p.pickup, decision: 'chosen', reason: `No delivery to ${buyer}, but ${p.shipping === 0 ? 'free delivery' : 'delivery for ' + eur(p.shipping)} to your pickup address in ${p.pickup.name} (${p.pickup.postal}). Saves ${eur(refLanded - p.landed)} in total, ${eur(baseline - p.landed)} more than the best offer delivered to your door · ${R.rules.pickup}` });
      chosen = row;
      lessons.push(`${p.store} delivers to a pickup address in ${p.pickup.country} ${p.pickup.postal}: "${p.title}" (SKU ${p.sku}) at ${eur(p.landed)} on ${new Date().toISOString().slice(0, 10)}.`);
    } else if (p) {
      const row = judged.find((o) => o.store === p.store && o.sku === p.sku);
      if (row && row.decision === 'refused') row.reason += ` · Pickup in ${p.pickup.name} would cost ${eur(p.landed)}, only ${eur(baseline - p.landed)} under the best delivered offer; rule 9 asks ${eur(R.pickupMin)}`;
    }
  }

  for (const o of judged) {
    await exec('INSERT INTO cs_offers (run_id, shipping, landed, ship_method, store, store_country, title, sku, variant_id, price, list_price, currency, available, same_item, same_item_score, ships_to_buyer, decision, reason, url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, o.shipping ?? null, o.same ? o.landed : null, o.shipMethod ?? null, o.store, o.storeCountry, o.title, o.sku, o.variantId, o.price, o.listPrice, o.currency ?? 'EUR', 1, o.same ? 1 : 0, o.score, o.ships == null ? null : (o.ships ? 1 : 0), o.decision ?? 'not_needed', o.reason ?? '', o.url]);
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

  // 7c. Discount codes: try the codes the winning shop shows on its own site, on the real cart. The shop decides, not the agent.
  let code = null;
  const buyAt = chosen ?? (via ? { store: src.host, variantId: ref.variantId, url: src.url, landed: refLanded } : null);
  if (buyAt) {
    const cc = buyAt.pickup?.country ?? buyer, pp = buyAt.pickup?.postal ?? R.postal;
    const tc = await step('shopify', 'try_codes', () => ucp.tryCodes(buyAt.store, buyAt.variantId, buyAt.url, cc, pp, ref.sku), (o) => o.tried.length ? `Tried ${o.tried.length} discount code${o.tried.length > 1 ? 's' : ''} from ${buyAt.store}'s own pages on the real cart: ${o.tried.map((t) => `${t.code} ${t.status}`).join(', ')}.${o.best ? ` ${o.best.code} brings the total to ${eur(o.best.total)}.` : ' None lowers the price.'}` : `${buyAt.store} shows no discount code on its own pages`).catch(() => null);
    for (const t of tc?.tried ?? []) lessons.push(`${buyAt.store} discount code ${t.code}: ${t.status} on the real cart for a buyer in ${cc} on ${new Date().toISOString().slice(0, 10)}.`);
    if (tc?.best && tc.best.total < buyAt.landed) { code = tc.best.code; if (chosen) { chosen.landed = tc.best.total; chosen.reason += ` · Code ${code} applied by the shop: ${eur(tc.best.total)}`; } else refLanded = tc.best.total; }
  }

  // 8. Act: fill a real cart at the winning shop, or refuse and say why.
  let status, verdict, cartUrl = null;
  // Standing order: "buy this when it is under my target at a shop that passes my rules". The shop you shared counts too.
  const target = opts.target != null ? Number(opts.target) : null;
  let best = chosen;
  if (target != null && !best) best = { store: src.host, price: ref.price, landed: refLanded, variantId: ref.variantId, title: ref.title, sku: ref.sku, isSource: true };
  // The price the shopper saw on the page they shared (sent by the bookmarklet from their own browser, or read from the page).
  const seenPrice = via ? (opts.seen?.price ?? amazon?.price ?? null) : null;
  const brandBest = chosen?.landed ?? refLanded;
  if (seenPrice != null && target == null && seenPrice - brandBest < R.minSaving) {
    status = 'refused';
    verdict = `Stay where you are. ${via.shared} shows ${eur(seenPrice)}; the best total at the brand's own shops is ${eur(brandBest)} at ${chosen?.store ?? src.host}. That would save ${eur(seenPrice - brandBest)}. ${R.rules.minSaving}`;
    await note('agent', 'refuse', verdict, { seen: seenPrice, brand_best: brandBest });
    chosen = null; best = null;
  } else
  if (target != null && best && best.landed > target) {
    status = 'waiting';
    verdict = `Not yet. The best total that passes your rules is ${eur(best.landed)} delivered, at ${best.store}. Your standing order says: buy under ${eur(target)}. I keep watching every country shop and fill the cart myself when it gets there.`;
    await note('agent', 'hold', verdict, { target, best: { store: best.store, price: best.price } });
    chosen = null;
  } else if (target != null && best?.isSource) {
    const cart = await step('shopify', 'create_cart', () => ucp.createCart(best.store, best.variantId, buyer, R.postal), () => `Real cart at ${best.store}: ${best.title}, ${eur(best.price)} (standing order under ${eur(target)} met)`);
    cartUrl = cart?.continue_url; status = 'cart_filled';
    verdict = `Standing order met: ${eur(best.price)} at ${best.store} is under your target of ${eur(target)}. Cart filled. ${R.rules.authority}`;
  } else if (via && !chosen && !(await step('shopify', 'ships_to_check', () => ucp.offeredTo(src.url, buyer), (x) => `${src.host} ${x.offered ? 'offers' : 'does NOT offer'} this item to a buyer in ${buyer}`).catch(() => ({ offered: true }))).offered) {
    status = 'refused';
    verdict = `No cart. The brand's own shop that has this item, ${src.host}, does not deliver to ${buyer}, and no other country shop of the brand passes your rules. ${R.rules.shipping}`;
    await note('agent', 'refuse', verdict, {});
  } else if (via && !chosen) {
    // Started from a retailer link or a product name: there is no shop to "stay" at, so buy at the best brand shop found.
    const cart = await step('shopify', 'create_cart', () => ucp.createCart(src.host, ref.variantId, buyer, R.postal, code), () => `Real cart at ${src.host}: ${ref.title}, ${eur(refLanded)} delivered`);
    cartUrl = cart?.continue_url; status = 'cart_filled'; best = { store: src.host, price: ref.price, landed: refLanded };
    verdict = `Cart filled at ${src.host}: ${eur(refLanded)} delivered. ${onlyShop ? `${src.brand} has one own webshop that delivers to ${buyer}, so there is no country to switch to; other sellers were ignored (rule 8).` : "That is the best total among the brand's own country shops that passes your rules."} ${R.rules.authority}`;
  } else
  if (chosen) {
    const cart = await step('shopify', 'create_cart', () => ucp.createCart(chosen.store, chosen.variantId, chosen.pickup?.country ?? buyer, chosen.pickup?.postal ?? R.postal, code), (c) => c?.permalink ? `Cart link at ${chosen.store} for ${chosen.title}. ${c.note}` : `Real cart at ${chosen.store}${chosen.pickup ? ' for pickup in ' + chosen.pickup.name : ''}: ${c?.line_items?.[0]?.item?.title ?? chosen.title}, total ${eur((c?.totals?.find((t) => t.type === 'total')?.amount ?? chosen.price * 100) / 100)}`);
    cartUrl = cart?.continue_url ?? chosen.checkoutUrl;
    status = 'cart_filled';
    verdict = `${target != null ? `Standing order met (under ${eur(target)}). ` : ''}Cart filled at ${chosen.store}: ${eur(chosen.landed)} ${chosen.pickup ? `delivered to your pickup address in ${chosen.pickup.name} (${chosen.pickup.postal})` : 'delivered'} instead of ${eur(refLanded)}. You save ${eur(refLanded - chosen.landed)}, shipping included. ${R.rules.authority}`;
  } else {
    const refused = cands.filter((o) => o.decision === 'refused');
    status = 'refused';
    verdict = refused.length ? `No switch. ${[...new Set(refused.map((o) => `${o.store}: ${o.reason}`))].join(' | ')}` : `No switch. ${src.host} already has the best price that passes your rules.`;
    await note('agent', 'refuse', verdict, { refused: refused.map((o) => ({ store: o.store, price: o.price, reason: o.reason })) });
  }

  // 9. Check the verdict against the rules in Senso, then remember what was learned.
  const check = await checkP;
  const past = await pastP;
  if (status !== 'waiting') {
    const today = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const refusedList = judged.filter((o) => o.decision === 'refused').map((o) => `${o.store} at ${eur(o.price)} (${o.reason.split(' · ')[0]})`);
    const text = `Decision record ${id}, ${today} UTC. Item: ${ref.title}, SKU ${ref.sku}. Link shared: ${src.host} at ${eur(ref.price)}. Outcome: ${status === 'cart_filled' ? `cart filled at ${best?.store ?? chosen?.store} for ${eur((best ?? chosen)?.landed ?? ref.price)} delivered to ${buyer}, saving ${eur(chosen ? refLanded - chosen.landed : 0)}` : 'no switch, the agent refused'}. Shops refused: ${refusedList.join('; ') || 'none'}. Offers compared: ${judged.length}, of which ${judged.filter((o) => o.same).length} the same item. Same-item check: ${gateOn ? 'Superlinked' : 'naive'}. Buy timing: ${timing?.moment ?? 'unknown'}.`;
    await step('senso', 'write_decision', () => sp.sensoWriteDecision(`Decision ${today}: ${ref.title.slice(0, 60)} (SKU ${ref.sku})`, text), (o) => o.ok ? `Decision written back to Senso as document ${String(o.content_id).slice(0, 8)}. It is decision number ${past.length + 1} on this item.` : `Senso write-back failed (${o.status})`).catch(() => null);
  }
  if (lessons.length) await step('cognee', 'remember', () => sp.cogneeRemember(lessons.join('\n'), buyer), () => `Stored in the ${buyer} brain, ${lessons.length} lessons: ${lessons.map((l) => l.split(':')[0]).join('; ')}`).catch(() => null);

  let saving = chosen ? refLanded - chosen.landed : 0;
  if (seenPrice != null) {
    await exec('UPDATE cs_runs SET source_store = ?, source_price = ? WHERE id = ?', [via.shared, seenPrice, id]);
    if (status === 'cart_filled') { const paid = best?.landed ?? chosen?.landed ?? refLanded; saving = seenPrice - paid; verdict = `Cart filled at ${best?.store ?? chosen?.store}: ${eur(paid)} delivered instead of ${eur(seenPrice)} at ${via.shared}. You save ${eur(saving)}. ${R.rules.authority}`; }
  }
  if (opts.watchId) await exec('UPDATE cs_watches SET last_checked = NOW(6), checks = checks + 1, last_best = ?, last_store = ?, last_run_id = ?, product_title = ?, cart_url = ?, status = ? WHERE id = ?', [best?.landed ?? refLanded, best?.store ?? src.host, id, ref.title, cartUrl, status === 'cart_filled' ? 'triggered' : 'watching', opts.watchId]).catch(() => {});
  await exec('UPDATE cs_runs SET status = ?, verdict = ?, best_price = ?, saving = ?, chosen_store = ?, cart_url = ?, summary = ? WHERE id = ?', [status, verdict, (status === 'cart_filled' || status === 'waiting' ? best?.landed : null) ?? chosen?.landed ?? refLanded, saving, chosen?.store ?? (status === 'cart_filled' ? best?.store : null) ?? null, cartUrl, JSON.stringify({ rules: R.rules, senso_chunks: R.chunks.slice(0, 3), offers: judged.length, senso_eval: check?.run_id ?? null, code, via, image: ref.image ?? null, timing, past_decisions: past.slice(0, 5) }), id]);
  amp.push({ event_type: '[Agent] Run Completed', session_id: session, time: Date.now(), insert_id: `${id}-done`, event_properties: { run_id: id, outcome: status, saving_eur: saving, buy_moment: timing?.moment ?? null, pct_under_list: timing?.pct_under_list ?? null, same_item_check: gateOn ? 'superlinked' : 'naive', chosen_store: chosen?.store ?? null, sku: ref.sku, chosen_sku: chosen?.sku ?? null, wrong_item: chosen ? chosen.sku !== ref.sku : false, tool_calls: seq } });
  await sp.amplitude(amp);
  await sp.amplitudeSession({ runId: id, input: sourceUrl, steps: stepLog.sort((a, b) => a.n - b.n), verdict, gateOn, totalMs: Date.now() - startedAt });
  await sp.statsigEvent('run_completed', saving, { outcome: status, same_item_check: gateOn ? 'superlinked' : 'naive', wrong_item: String(chosen ? chosen.sku !== ref.sku : false) });
  return { id, status, verdict, cartUrl };
}

// ---------- Standing orders ----------
export async function createWatch(sourceUrl, target, sharedBy) {
  const id = 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  await exec('INSERT INTO cs_watches (id, source_url, shared_by, target, status) VALUES (?, ?, ?, ?, ?)', [id, sourceUrl, sharedBy || null, target, 'watching']);
  return id;
}
// Called by the server-side timer: re-check every standing order that is due. Nobody has to be at the keyboard.
export async function tickWatches(minSeconds = 90) {
  const due = await rows('SELECT id, source_url, shared_by, target FROM cs_watches WHERE status = ? AND (last_checked IS NULL OR last_checked < NOW(6) - INTERVAL ? SECOND) AND id NOT IN (SELECT watch_id FROM cs_runs WHERE status = ? AND watch_id IS NOT NULL) ORDER BY last_checked LIMIT 3', ['watching', minSeconds, 'running']);
  const started = [];
  for (const w of due) { const { id, done } = await startRun(w.source_url, { target: Number(w.target), watchId: w.id, sharedBy: w.shared_by }); started.push(id); await done; }
  return started;
}
