// Shopify agent endpoints. Per-store UCP for search and carts, Shop MCP for the "does it ship to me" lookup.
const PROFILE = 'https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json';
const meta = { 'ucp-agent': { profile: PROFILE } };
const T = (ms) => AbortSignal.timeout(ms);

export async function storeCall(host, name, args) {
  const r = await fetch(`https://${host}/api/ucp/mcp`, { method: 'POST', signal: T(25000), headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name, arguments: { meta, ...args } } }) });
  const d = JSON.parse(await r.text());
  if (d.error) throw new Error(`${host} ${name}: ${JSON.stringify(d.error).slice(0, 200)}`);
  return d.result?.structuredContent ?? d.result;
}
export async function shopCall(name, args) {
  const r = await fetch('https://mcp.shop.com/', { method: 'POST', signal: T(25000), headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'country-switch', version: '0.1' } }, name, arguments: args } }) });
  const d = JSON.parse(await r.text());
  if (d.error) throw new Error(`shop ${name}: ${JSON.stringify(d.error).slice(0, 200)}`);
  return d.result?.structuredContent ?? d.result;
}

const SUBS = { www: null, eu: null, nl: 'NL', fr: 'FR', de: 'DE', es: 'ES', it: 'IT', be: 'BE', uk: 'GB', pl: 'PL', at: 'AT', pt: 'PT' };
export function parseProductUrl(u) {
  const url = new URL(u);
  const m = url.pathname.match(/^(.*)\/products\/([^/?#]+)/);
  if (!m) throw new Error('Not a product link (no /products/ in the path)');
  const parts = url.hostname.split('.');
  const brand = parts.slice(-2).join('.');
  const sub = parts.length > 2 ? parts[0] : 'www';
  return { host: url.hostname, brand, sub, country: SUBS[sub] ?? null, handle: m[2], prefix: m[1] || '', variant: url.searchParams.get('variant'), url: `https://${url.hostname}/products/${m[2]}` };
}
// Public storefront product JSON: title, SKU and shelf price of the item the shopper was looking at.
export async function readProduct(p) {
  // Some shops keep a market prefix in the path (/eu-en/products/...): try the link as shared first, then without the prefix.
  const tryRead = async (u) => { try { const r = await fetch(u, { signal: T(15000) }); if (!r.ok) return null; const j = JSON.parse(await r.text()); return j?.variants?.length ? j : null; } catch { return null; } };
  const d = (p.prefix ? await tryRead(`https://${p.host}${p.prefix}/products/${p.handle}.js`) : null) ?? await tryRead(`${p.url}.js`);
  if (!d) throw new Error(`Could not read ${p.url}`);
  // Respect the exact variant in the shared link (?variant=...), otherwise the first one in stock.
  const v = d.variants.find((x) => String(x.id) === p.variant) ?? d.variants.find((x) => x.available) ?? d.variants[0];
  return { title: d.title, sku: v.sku, price: v.price / 100, listPrice: (v.compare_at_price ?? v.price) / 100, variantId: `gid://shopify/ProductVariant/${v.id}`, vendor: d.vendor, image: d.featured_image ? (String(d.featured_image).startsWith('//') ? 'https:' + d.featured_image : d.featured_image) : null };
}
// Which sibling country shops of this brand speak the agent protocol?
export async function siblingStores(p) {
  const hosts = Object.keys(SUBS).map((s) => `${s}.${p.brand}`);
  const res = await Promise.all(hosts.map(async (h) => {
    try { const r = await fetch(`https://${h}/.well-known/ucp`, { signal: T(7000), redirect: 'manual' }); return r.ok ? h : null; } catch { return null; }
  }));
  return res.filter(Boolean).map((h) => ({ host: h, country: SUBS[h.split('.')[0]] }));
}
export async function searchStore(host, query, buyerCountry) {
  const d = await storeCall(host, 'search_catalog', { catalog: { query, context: { address_country: buyerCountry, currency: 'EUR' }, pagination: { limit: 5 } } });
  const out = [];
  for (const p of d?.products ?? []) for (const v of p.variants ?? []) out.push({ store: host, title: p.title, variantTitle: v.title, sku: v.sku ?? '', variantId: v.id, price: (v.price?.amount ?? 0) / 100, listPrice: (v.list_price?.amount ?? v.price?.amount ?? 0) / 100, currency: v.price?.currency, available: v.availability?.available !== false, url: p.url, checkoutUrl: v.checkout_url });
  return out;
}
// Shop's own catalog answers whether this product is offered to a buyer in a given country.
export async function offeredTo(productUrl, country) {
  const d = await shopCall('lookup_catalog', { catalog: { ids: [productUrl], context: { address_country: country, currency: 'EUR' } } });
  return { offered: (d?.products?.length ?? 0) > 0, messages: d?.messages ?? [] };
}
export async function createCart(host, variantId, buyerCountry, postalCode, code) {
  try { return await createCartApi(host, variantId, buyerCountry, postalCode, code); }
  catch (e) {
    const n = String(variantId).split('/').pop();
    return { continue_url: `https://${host}/cart/${n}:1${code ? '?discount=' + encodeURIComponent(code) : ''}`, permalink: true, note: `The shop's agent endpoint did not answer (${String(e.message).slice(0, 80)}); used the shop's own cart link for the same variant.` };
  }
}
async function createCartApi(host, variantId, buyerCountry, postalCode, code) {
  return storeCall(host, 'create_cart', { cart: { line_items: [{ quantity: 1, item: { id: variantId } }], context: { address_country: buyerCountry, currency: 'EUR' }, ...(postalCode ? { fulfillment: { methods: [{ type: 'shipping', destinations: [{ postal_code: postalCode, address_country: buyerCountry }] }] } } : {}), ...(code ? { discounts: { codes: [code] } } : {}) } });
}

// Real delivery quote: a cart with a destination returns the merchant's own shipping line. The quote cart is cancelled again.
export async function quote(host, variantId, buyerCountry, postalCode) {
  const c = await storeCall(host, 'create_cart', { cart: { line_items: [{ quantity: 1, item: { id: variantId } }], context: { address_country: buyerCountry, currency: 'EUR' }, fulfillment: { methods: [{ type: 'shipping', destinations: [{ postal_code: postalCode, address_country: buyerCountry }] }] } } });
  const tot = (t) => c?.totals?.find((x) => x.type === t)?.amount;
  const g = c?.fulfillment?.methods?.[0]?.groups?.[0];
  const opt = g?.options?.find((o) => o.id === g.selected_option_id) ?? g?.options?.[0];
  if (c?.id) storeCall(host, 'cancel_cart', { id: c.id }).catch(() => {});
  const ship = tot('fulfillment');
  return { shipping: ship == null ? null : ship / 100, total: tot('total') == null ? null : tot('total') / 100, method: opt?.title ?? null, eta: opt?.description?.plain ?? null };
}

// A retailer link or a plain product name: turn it into search words.
export function queryFromInput(input) {
  const t = String(input).trim();
  if (!/^https?:\/\//i.test(t)) return { query: t, retailer: null, hostBrand: null };
  const u = new URL(t);
  const segs = u.pathname.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  const pi = segs.indexOf('products');
  const cand = segs.filter((x) => !/^[a-z]{2}(-[a-z]{2})?$/i.test(x) && !['products', 'product', 'p', 'nl', 'be'].includes(x));
  const best = (pi >= 0 && segs[pi + 1]) ? segs[pi + 1] : (cand.filter((x) => /[a-z]/i.test(x) && /[-_+]/.test(x)).sort((a, b) => b.length - a.length)[0] ?? cand.filter((x) => /[a-z]{3}/i.test(x)).join(' '));
  return { query: (best ?? '').replace(/\.html?$/i, '').replace(/[-_+]/g, ' ').replace(/\b\d{6,}\b/g, ' ').replace(/\s+/g, ' ').trim(), retailer: u.hostname, hostBrand: u.hostname.split('.').slice(-2, -1)[0] };
}
// Search every Shopify merchant that ships to the buyer, then keep only the brand's own webshops (the trust rule).
export async function findBrandProduct(query, buyerCountry) {
  const d = await shopCall('search_catalog', { catalog: { query, context: { address_country: buyerCountry, currency: 'EUR' }, filters: { ships_to: { country: buyerCountry } }, pagination: { limit: 10 } } });
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2).slice(0, 2);
  const all = (d?.products ?? []).map((p) => { const v = p.variants?.[0] ?? {}; const url = v.url ?? p.url ?? ''; let host = ''; try { host = new URL(url).hostname; } catch {} const name = host.split('.').slice(-2, -1)[0] ?? ''; return { title: p.title, host, url, price: (v.price?.amount ?? 0) / 100, currency: v.price?.currency, official: words.includes(name) }; }).filter((x) => x.host);
  // Rank the brand's own listings by how well the title matches the words asked for; accessories that only mention the product are dropped.
  const need = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(1);
  const official = all.filter((x) => x.official && /\/products\//.test(x.url)).map((x) => ({ ...x, hits: need.filter((w) => x.title.toLowerCase().includes(w)).length }))
    .filter((x) => need.length === 0 || x.hits >= Math.ceil(need.length * 0.6)).sort((a, b) => b.hits - a.hits || a.title.length - b.title.length);
  return { official, others: all.filter((x) => !x.official) };
}

// Fallback: if the first word is a brand with its own country shops, search inside those shops directly.
export async function findInBrandShops(query, buyerCountry) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const brand = words[0]?.replace(/[^a-z0-9-]/g, '');
  if (!brand || brand.length < 3) return [];
  const stores = await siblingStores({ brand: `${brand}.com` });
  if (!stores.length) return [];
  const rest = words.slice(1).join(' ') || query;
  const order = ['eu', 'nl', 'be', 'de', 'fr', 'www'];
  const pick = [...stores].sort((a, b) => (order.indexOf(a.host.split('.')[0]) + 99) % 99 - (order.indexOf(b.host.split('.')[0]) + 99) % 99).slice(0, 2);
  const lists = await Promise.all(pick.map((st) => searchStore(st.host, rest, buyerCountry).catch(() => [])));
  const need = words.slice(1).filter((w) => w.length > 1);
  return lists.flat().filter((o) => o.url && (!o.currency || o.currency === 'EUR')).map((o) => ({ ...o, hits: need.filter((w) => `${o.title} ${o.sku} ${o.url}`.toLowerCase().includes(w)).length }))
    .filter((o) => need.length === 0 || o.hits >= Math.ceil(need.length * 0.6)).sort((a, b) => b.hits - a.hits || a.title.length - b.title.length).map((o) => ({ title: o.title, host: o.store, url: (() => { try { const u = new URL(o.url); u.hostname = o.store; return u.toString(); } catch { return o.url; } })(), price: o.price, currency: 'EUR', official: true }));
}

// The same product handle often exists on the brand's country shops: try the shared handle there directly.
export async function sameHandleElsewhere(handle, brandDomain, variant) {
  const stores = await siblingStores({ brand: brandDomain });
  const order = ['eu', 'nl', 'be', 'de', 'fr', 'www'];
  for (const st of [...stores].sort((a, b) => (order.indexOf(a.host.split('.')[0]) + 99) % 99 - (order.indexOf(b.host.split('.')[0]) + 99) % 99)) {
    const p = { host: st.host, brand: brandDomain, sub: st.host.split('.')[0], country: st.country, handle, prefix: '', variant, url: `https://${st.host}/products/${handle}` };
    try { const ref = await readProduct(p); return { src: p, ref }; } catch {}
  }
  return null;
}

// Amazon link as input: Amazon has no agent endpoint, so the agent only reads what the item is (ASIN, title, price if shown)
// and then looks for the same product at the brand's own shop. Reading can fail (Amazon blocks automated readers); the caller falls back to the link text.
export function amazonAsin(input) {
  try { const u = new URL(input); if (!/(^|\.)amazon\.[a-z.]+$/i.test(u.hostname)) return null; const m = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i); return m ? { asin: m[1].toUpperCase(), host: u.hostname } : { asin: null, host: u.hostname }; } catch { return null; }
}
export async function readAmazon(a) {
  const num = (x) => (x == null ? null : Number(String(x).replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')));
  const sites = ['amazon.com.be', 'amazon.de', 'amazon.nl', 'amazon.fr'].map((d) => ({ site: d, url: `https://www.${d}/dp/${a.asin}` }));
  let title = null, price = null;
  try {
    const r = await fetch(`https://${a.host}/dp/${a.asin}`, { signal: T(12000), headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept-Language': 'en-GB,en;q=0.9', Accept: 'text/html' } });
    const h = await r.text();
    title = (h.match(/id="productTitle"[^>]*>\s*([^<]{5,200})/) ?? [])[1]?.trim() ?? null;
    const p = (h.match(/apex-pricetopay-value[\s\S]{0,600}?a-offscreen">\s*([^<]+)/) ?? [])[1];
    price = p ? num(p) : null;
  } catch {}
  return { asin: a.asin, host: a.host, title, price, sites };
}

// Discount codes: only codes the shop itself shows on its own pages, each one tried on the real cart.
// The shop's cart answers per code: applied (with the new total), expired, or invalid. Test carts are cancelled.
export async function tryCodes(host, variantId, productUrl, buyerCountry, postalCode, sku) {
  const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };
  const pages = await Promise.all([`https://${host}/`, productUrl].filter(Boolean).map((u) => fetch(u, { headers: UA, signal: T(9000) }).then((r) => r.text()).catch(() => '')));
  const text = pages.join(' ').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  const shown = [...new Set([...text.matchAll(/(?:code|Code|CODE|Gutschein|Rabattcode|kortingscode|coupon|Coupon)[\s:"“”'-]{1,6}([A-Z][A-Z0-9]{3,14})\b/g)].map((m) => m[1]))].filter((c) => /\d|[A-Z]{5,}/.test(c));
  // Some shops use one code per product (a prefix plus the SKU): if such codes are shown, the one for this SKU is worth a try.
  const prefixes = [...new Set(shown.map((c) => (c.match(/^([A-Z]{2,4})\d{4,6}[A-Z]?$/) ?? [])[1]).filter(Boolean))];
  const guess = /^[A-Z0-9]{4,10}$/i.test(sku ?? '') ? prefixes.map((p) => `${p}${sku}`) : [];
  const codes = [...new Set([...guess, ...shown.filter((c) => !prefixes.some((p) => c.startsWith(p) && c !== `${p}${sku}`)), ...shown])].slice(0, 2);
  const tried = []; let best = null, base = null;
  for (const code of codes) {
    const c = await storeCall(host, 'create_cart', { cart: { line_items: [{ quantity: 1, item: { id: variantId } }], context: { address_country: buyerCountry, currency: 'EUR' }, fulfillment: { methods: [{ type: 'shipping', destinations: [{ postal_code: postalCode, address_country: buyerCountry }] }] }, discounts: { codes: [code] } } }).catch(() => null);
    if (!c) { tried.push({ code, status: 'no answer' }); continue; }
    const total = (c.totals?.find((t) => t.type === 'total')?.amount ?? 0) / 100, sub = (c.totals?.find((t) => t.type === 'subtotal')?.amount ?? 0) / 100;
    const applied = (c.discounts?.applied ?? []).length > 0;
    const status = applied ? 'applied' : (c.messages?.find((m) => /discount/.test(m.code ?? ''))?.code ?? 'not applied').replace('discount_code_', '');
    base ??= sub;
    tried.push({ code, status, total });
    if (applied && (!best || total < best.total)) best = { code, total, saved: Math.max(0, sub - (c.totals?.find((t) => t.type === 'subtotal')?.amount ?? 0) / 100) || null };
    if (c.id) storeCall(host, 'cancel_cart', { id: c.id }).catch(() => {});
  }
  return { shown: shown.length, tried, best };
}
