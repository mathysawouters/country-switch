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
  const m = url.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) throw new Error('Not a product link (no /products/ in the path)');
  const parts = url.hostname.split('.');
  const brand = parts.slice(-2).join('.');
  const sub = parts.length > 2 ? parts[0] : 'www';
  return { host: url.hostname, brand, sub, country: SUBS[sub] ?? null, handle: m[1], variant: url.searchParams.get('variant'), url: `https://${url.hostname}/products/${m[1]}` };
}
// Public storefront product JSON: title, SKU and shelf price of the item the shopper was looking at.
export async function readProduct(p) {
  const r = await fetch(`${p.url}.js`, { signal: T(15000) });
  if (!r.ok) throw new Error(`Could not read ${p.url} (${r.status})`);
  const d = await r.json();
  // Respect the exact variant in the shared link (?variant=...), otherwise the first one in stock.
  const v = d.variants.find((x) => String(x.id) === p.variant) ?? d.variants.find((x) => x.available) ?? d.variants[0];
  return { title: d.title, sku: v.sku, price: v.price / 100, listPrice: (v.compare_at_price ?? v.price) / 100, variantId: `gid://shopify/ProductVariant/${v.id}`, vendor: d.vendor };
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
export async function createCart(host, variantId, buyerCountry) {
  return storeCall(host, 'create_cart', { cart: { line_items: [{ quantity: 1, item: { id: variantId } }], context: { address_country: buyerCountry, currency: 'EUR' } } });
}
