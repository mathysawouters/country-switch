import { rows } from '../lib/s2.mjs';
import { quote, offeredTo, storeCall } from '../lib/ucp.mjs';
const targets = [['es.eufy.com', 'T2353G21'], ['fr.anker.com', 'A1289011'], ['www.repetto.com', 'V080VLUX-1450-35'], ['fr.ugreen.com', '40747'], ['de.ugreen.com', '40747'], ['uk.eufy.com', 'BUNDLE-T8214311-1-T80303D1-1']];
for (const [store, sku] of targets) {
  const [o] = await rows('SELECT variant_id, url, price, currency FROM cs_offers WHERE store = ? AND sku = ? ORDER BY id DESC LIMIT 1', [store, sku]);
  if (!o) { console.log(store, sku, 'no offer row'); continue; }
  const q = await quote(store, o.variant_id, 'BE', '3500').catch((e) => ({ err: String(e.message).slice(0, 80) }));
  const c = await offeredTo(o.url, 'BE').catch(() => ({ offered: '?' }));
  // what does the cart itself say about currency and messages for a BE buyer?
  const cart = await storeCall(store, 'create_cart', { cart: { line_items: [{ quantity: 1, item: { id: o.variant_id } }], context: { address_country: 'BE' } } }).catch((e) => ({ err: String(e.message).slice(0, 100) }));
  console.log(store.padEnd(16), sku.padEnd(18).slice(0, 18), 'price', o.price, o.currency, '| quote ship:', q.shipping ?? q.err ?? 'none', q.method ?? '', '| catalog offered:', c.offered, '| BE cart:', cart.err ?? `${cart.currency} ${(cart.totals?.find((t) => t.type === 'total')?.amount ?? 0) / 100} msgs=${JSON.stringify(cart.messages ?? []).slice(0, 120)}`);
  if (cart.id) storeCall(store, 'cancel_cart', { id: cart.id }).catch(() => {});
}
