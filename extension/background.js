// Runs in the shopper's own browser, with their own Amazon session, only when they click the button:
// one page per neighbouring country for the same ASIN. If Amazon shows a robot check, that country is
// reported as unreadable. Nothing is retried or disguised.
const SITES = [['BE', 'www.amazon.com.be'], ['DE', 'www.amazon.de'], ['NL', 'www.amazon.nl'], ['FR', 'www.amazon.fr']];
const num = (s) => (s == null ? null : Number(String(s).replace(/&nbsp;| /g, ' ').replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) || null);
const text = (s) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|‌| /g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function parse(html) {
  const robot = /Enter the characters you see below|api-services-support|To discuss automated access|Geben Sie die Zeichen|Saisissez les caract/i.test(html);
  const title = text((html.match(/id="productTitle"[^>]*>([\s\S]{3,400}?)<\/span>/) ?? [])[1]) || null;
  const p = (html.match(/id="corePrice_feature_div"[\s\S]{0,3000}?a-offscreen">\s*([^<]+)/) ?? html.match(/id="corePriceDisplay_desktop_feature_div"[\s\S]{0,3000}?a-offscreen">\s*([^<]+)/) ?? html.match(/apex-pricetopay-value[\s\S]{0,800}?a-offscreen">\s*([^<]+)/) ?? [])[1];
  const avail = text((html.match(/id="availability"[^>]*>([\s\S]{0,300}?)<\/span>/) ?? [])[1]).slice(0, 60);
  const unavailable = /Currently unavailable|Momenteel niet verkrijgbaar|Derzeit nicht verf|Actuellement indisponible|Tijdelijk niet op voorraad/i.test(avail);
  const deliver = [text((html.match(/id="glow-ingress-line1"[^>]*>([\s\S]{0,200}?)<\/span>/) ?? [])[1]), text((html.match(/id="glow-ingress-line2"[^>]*>([\s\S]{0,200}?)<\/span>/) ?? [])[1])].filter(Boolean).join(' ');
  return { robot, title, price: num(p), currency: 'EUR', available: !!p && !unavailable, availability: avail || null, deliver: deliver || null };
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.type !== 'cs-check') return;
  (async () => {
    const offers = await Promise.all(SITES.filter(([, h]) => h !== msg.source.site).map(async ([country, site]) => {
      const url = `https://${site}/dp/${msg.asin}`;
      try {
        const r = await fetch(`${url}?th=1&psc=1`, { credentials: 'include' });
        const h = await r.text();
        return { country, site, url, http: r.status, ...parse(h) };
      } catch (e) { return { country, site, url, error: String(e).slice(0, 120) }; }
    }));
    let saved = null;
    try {
      const r = await fetch('http://localhost:3311/api/amazon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asin: msg.asin, title: msg.title, image: msg.image, source: msg.source, offers }) });
      saved = await r.json();
    } catch (e) {
      // The agent is not running (for example after the hackathon): still give a useful answer from the prices just read.
      // Simple built-in rule: only switch for 5 euro or more. No audit trail in this mode.
      const eur = (n) => '€' + Number(n).toFixed(2);
      const cands = offers.filter((o) => o.price && o.available && !o.robot && !o.error).sort((a, b) => a.price - b.price);
      const best = cands[0]; const here = msg.source.price;
      if (!best) saved = { status: 'refused', headline: 'Nothing to compare', verdict: 'No other Amazon country site showed a price for this item.', offline: true };
      else if (here == null) saved = { status: 'cart_filled', headline: 'Available next door', verdict: `Not available here; ${best.site.replace('www.', '')} has it for ${eur(best.price)}. Check that it delivers to you before paying.`, chosen_site: best.site, cart_url: `https://${best.site}/gp/aws/cart/add.html?ASIN.1=${msg.asin}&Quantity.1=1`, offline: true };
      else if (here - best.price >= 5) saved = { status: 'cart_filled', headline: `Cheaper next door: you save ${eur(here - best.price)}`, verdict: `${eur(best.price)} on ${best.site.replace('www.', '')} instead of ${eur(here)} here. Check that it delivers to you before paying. (Your agent is not running, so this run is not recorded.)`, chosen_site: best.site, cart_url: `https://${best.site}/gp/aws/cart/add.html?ASIN.1=${msg.asin}&Quantity.1=1`, offline: true };
      else saved = { status: 'refused', headline: 'Stay here', verdict: `Best elsewhere is ${eur(best.price)} on ${best.site.replace('www.', '')}; here it is ${eur(here)}. Not worth switching (under 5 euro). (Your agent is not running, so this run is not recorded.)`, offline: true };
    }
    send({ offers, saved });
  })();
  return true;
});
