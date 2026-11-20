// A small button on Amazon product pages. Nothing happens until you click it.
(() => {
  const m = location.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
  if (!m || document.getElementById('cs-panel')) return;
  const asin = m[1].toUpperCase();
  const q = (s) => document.querySelector(s);
  const num = (s) => (s == null ? null : Number(String(s).replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) || null);
  const FLAG = { BE: '🇧🇪', DE: '🇩🇪', NL: '🇳🇱', FR: '🇫🇷' };
  const CC = { 'www.amazon.com.be': 'BE', 'www.amazon.de': 'DE', 'www.amazon.nl': 'NL', 'www.amazon.fr': 'FR' };
  const eur = (n) => (n == null ? 'no price' : '€' + Number(n).toFixed(2));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const box = document.createElement('div');
  box.id = 'cs-panel';
  box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;width:360px;max-width:92vw;background:#0e100f;color:#f2f4f3;border:1px solid #26302b;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.45);font:14px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:14px 16px';
  const head = '<div style="display:flex;align-items:center;gap:8px;font-weight:800;font-size:15px"><span style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;background:#2fe07a;color:#06140c">⇄</span>Country Switch</div>';
  box.innerHTML = head + '<div style="color:#9aa39e;margin:6px 0 10px">Same item, same ASIN, on Amazon next door. Prices with VAT.</div><button id="cs-go" style="width:100%;padding:10px;border:0;border-radius:10px;background:#2fe07a;color:#06140c;font-weight:800;font-size:14px;cursor:pointer">Check the neighbours</button>';
  document.body.appendChild(box);

  q('#cs-go').addEventListener('click', () => {
    const priceEl = q('#corePrice_feature_div .a-offscreen') || q('#corePriceDisplay_desktop_feature_div .a-offscreen') || q('#apex_desktop .a-offscreen');
    const source = {
      site: location.hostname, country: CC[location.hostname] ?? null, url: `https://${location.hostname}/dp/${asin}`,
      // On an Amazon Business session the first price is without VAT; the price with VAT is in brackets. Use the one with VAT.
      price: num(((q('#corePrice_feature_div') || q('#corePriceDisplay_desktop_feature_div'))?.textContent ?? '').replace(/\s+/g, ' ').match(/\(\s*€?\s*([\d.,]+)\s+(?:€?\s*[\d.,]+\s+)?(?:incl\.?\s*VAT|inkl\.?\s*(?:USt|MwSt)|incl\.?\s*btw|TTC)/i)?.[1]) ?? num(priceEl?.textContent), available: !!priceEl,
      deliver: [q('#glow-ingress-line1')?.textContent, q('#glow-ingress-line2')?.textContent].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    };
    const title = (q('#productTitle')?.textContent ?? document.title).trim().slice(0, 200);
    box.innerHTML = head + '<div style="color:#9aa39e;margin-top:8px">Reading this item on Amazon in the other countries, in your browser…</div>';
    chrome.runtime.sendMessage({ type: 'cs-check', asin, title, image: q('#landingImage')?.src ?? null, source }, (res) => {
      if (!res) { box.innerHTML = head + '<div style="color:#ff5a4d;margin-top:8px">No answer from the extension. Reload the page and try again.</div>'; return; }
      const s = res.saved ?? {};
      const rows = [{ ...source, here: true }, ...res.offers].map((o) => {
        const chosen = s.chosen_site && o.site === s.chosen_site;
        const right = o.robot ? '<span style="color:#9aa39e">Amazon asked for a robot check</span>' : o.error ? '<span style="color:#9aa39e">not readable</span>' : (!o.price ? '<span style="color:#9aa39e">not available</span>' : eur(o.price));
        return `<div style="display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-top:1px solid #1d2420;${chosen ? 'color:#2fe07a;font-weight:800' : ''}"><span>${FLAG[o.country ?? CC[o.site]] ?? '🌐'} ${esc(o.site.replace('www.', ''))}${o.here ? ' <small style="color:#9aa39e">(here)</small>' : ''}</span><span>${right}</span></div>`;
      }).join('');
      const tone = s.status === 'cart_filled' ? '#2fe07a' : s.status === 'refused' ? '#ff5a4d' : '#9aa39e';
      box.innerHTML = head + `<div style="margin-top:8px">${rows}</div>`
        + `<div style="margin-top:10px;padding:10px;border-radius:10px;background:#141816;border:1px solid ${tone}"><b style="color:${tone}">${esc(s.headline ?? (s.error ? 'Could not reach your agent' : 'Done'))}</b><div style="color:#c9d0cc;margin-top:4px;font-size:13px">${esc(s.verdict ?? s.error ?? '')}</div></div>`
        + (s.cart_url ? `<a href="${esc(s.cart_url)}" target="_blank" style="display:block;text-align:center;margin-top:10px;padding:10px;border-radius:10px;background:#2fe07a;color:#06140c;font-weight:800;text-decoration:none">Add to cart on ${esc((s.chosen_site ?? '').replace('www.', ''))}</a>` : '')
        + (s.trail_url ? `<a href="${esc(s.trail_url)}" target="_blank" style="display:block;text-align:center;margin-top:8px;color:#9aa39e;font-size:13px">See the audit trail</a>` : '');
    });
  });
})();
