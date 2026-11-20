'use client';
import { useEffect, useState, useCallback } from 'react';
import './v3.css';

const eur = (n) => (n == null ? '' : '€' + Number(n).toFixed(2));
const LABEL = { cart_filled: 'cart filled', refused: 'refused', running: 'running', error: 'error', waiting: 'waiting for price', cannot_help: 'cannot help' };
const CLS = { cart_filled: 'ok', refused: 'no', running: 'run', error: 'no', waiting: 'run', cannot_help: 'run' };
const DEC = { chosen: 'chosen', refused: 'refused by your rule', not_same_item: 'not the same item', source: 'where you were', not_needed: 'not needed', not_cheaper: 'not cheaper' };

const COLORS = ['#0a0a0a', '#0a7a3d', '#3f3f3f', '#6b6b6b', '#8c8c8c', '#a3a3a3', '#bdbdbd'];
function PriceChart({ t }) {
  const h = (t.history ?? []).map((x) => ({ ...x, price: Number(x.price), ms: Date.parse(x.seen.replace(' ', 'T') + 'Z') })).filter((x) => x.price < 1000);
  if (h.length < 2) return null;
  const stores = [...new Set(h.map((x) => x.store))];
  const W = 640, H = 170, L = 44, R = 110, T = 10, B = 22;
  const t0 = Math.min(...h.map((x) => x.ms)), t1 = Math.max(...h.map((x) => x.ms));
  const lo = Math.min(...h.map((x) => x.price)) * 0.95, hi = Math.max(...h.map((x) => x.price)) * 1.03;
  const X = (ms) => L + ((ms - t0) / Math.max(1, t1 - t0)) * (W - L - R), Y = (p) => T + (1 - (p - lo) / Math.max(0.01, hi - lo)) * (H - T - B);
  const day = (ms) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 640, marginTop: 10 }} role="img" aria-label="Price history per country shop">
      {[lo / 0.95, hi / 1.03].map((p, i) => <g key={i}><line x1={L} x2={W - R} y1={Y(p)} y2={Y(p)} stroke="#ececec" /><text x={L - 6} y={Y(p) + 4} textAnchor="end" fontSize="11" fill="#6b6b6b">€{p.toFixed(0)}</text></g>)}
      <text x={L} y={H - 6} fontSize="11" fill="#6b6b6b">{day(t0)} UTC</text><text x={W - R} y={H - 6} textAnchor="end" fontSize="11" fill="#6b6b6b">{day(t1)} UTC</text>
      {stores.map((s, i) => { const pts = h.filter((x) => x.store === s); const c = s === t.store ? '#0a7a3d' : COLORS[(i % (COLORS.length - 1)) + 2] ?? '#6b6b6b';
        return <g key={s}><polyline fill="none" stroke={c} strokeWidth={s === t.store ? 2.5 : 1.2} points={pts.map((x) => `${X(x.ms)},${Y(x.price)}`).join(' ')} />{pts.map((x, j) => <circle key={j} cx={X(x.ms)} cy={Y(x.price)} r={s === t.store ? 3 : 2} fill={c} />)}</g>; })}
      {Object.entries(stores.reduce((m, s) => { const p = h.filter((x) => x.store === s).pop().price.toFixed(2); (m[p] ||= []).push(s.split('.')[0]); return m; }, {})).map(([p, names]) => <text key={p} x={W - R + 6} y={Y(Number(p)) + 4} fontSize="11" fill={names.includes(t.store.split('.')[0]) ? '#0a7a3d' : '#6b6b6b'} fontWeight={names.includes(t.store.split('.')[0]) ? 700 : 400}>{names.join(', ')} €{p}</text>)}
    </svg>
  );
}

const flag = (cc) => { const c = String(cc || '').toUpperCase().replace('UK', 'GB'); return /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0))) : '🌐'; };
const money = (n, cur) => (n == null ? '' : cur && cur !== 'EUR' ? `${Number(n).toFixed(2)} ${cur}` : eur(n));
const delivery = (o) => (o.shipping == null ? '' : Number(o.shipping) === 0 ? 'free' : eur(o.shipping));
const shortReason = (r) => { const t = String(r ?? '').split(' · ')[0]; return t.length > 70 ? t.slice(0, 68) + '…' : t; };
const TILE = { chosen: 'chosen', refused: 'refused', source: 'where you were', not_cheaper: 'not cheaper', not_needed: 'not needed' };
const ORDER = { chosen: 0, source: 1, refused: 2, not_cheaper: 3, not_needed: 4 };
const TOOLS = ['senso', 'shopify', 'superlinked', 'statsig', 'singlestore', 'cognee', 'amazon', 'agent', 'naive'];
const HEAD = {
  running: { tone: 'run', kicker: 'Working', title: 'Checking the brand shops in other countries…' },
  refused: { tone: 'no', kicker: 'Refused', title: 'No switch. Buy it where you were.' },
  waiting: { tone: 'wait', kicker: 'Standing order' },
  cannot_help: { tone: 'mute', kicker: 'Cannot help', title: 'This one is outside what the agent can do.' },
  error: { tone: 'no', kicker: 'Error', title: 'The run failed.' },
};
function parseRule(r) { const m = /^Rule (\d+) \(([^)]+)\):\s*([\s\S]*)$/.exec(r); return m ? { n: m[1], name: m[2], text: m[3] } : { n: '', name: '', text: r }; }

const STAMP = { cart_filled: 'Cart filled', refused: 'Refused', running: 'Working', error: 'Error', waiting: 'Standing order', cannot_help: 'Cannot help' };
const TONE = { cart_filled: 'ok', refused: 'no', error: 'no', running: 'mute', waiting: 'mute', cannot_help: 'mute' };
const LINE = { chosen: 'chosen', refused: 'refused', source: 'where you were', not_cheaper: 'not cheaper', not_needed: 'not needed' };
const ruleNums = (text) => [...String(text ?? '').matchAll(/Rule (\d+) /g)].map((m) => m[1]);

function Receipt({ run, same, flagOf, oflag, rules, chunks }) {
  const st = run.status; const filled = st === 'cart_filled'; const saved = Number(run.saving) > 0;
  const img = run.summary?.image; const via = run.summary?.via;
  const src = same.find((o) => o.decision === 'source');
  const lines = same.filter((o) => o !== src);
  const inVerdict = new Set(ruleNums(run.verdict));
  const inLines = new Set(same.flatMap((o) => ruleNums(o.reason)));
  const ruleList = rules ? Object.values(rules).filter(Boolean).sort() : [];
  return (
    <article className={'r-receipt r-' + (TONE[st] ?? 'mute')}>
      <div className="r-paper">
        <header className="r-head">
          <div className="r-shopname"><span>Country Switch</span><span className={'r-stamp r-' + (TONE[st] ?? 'mute')}>{STAMP[st] ?? st}</span></div>
          <div className="r-product">
            {img && <img className="r-img" src={img} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
            <div className="r-product-text">
              <h2 className="r-title">{nice(run)}</h2>
              <dl className="r-meta">
                {run.sku && <div><dt>SKU</dt><dd>{run.sku}</dd></div>}
                {run.source_store && <div><dt>Shared from</dt><dd>{flagOf(run.source_store)} {run.source_store}</dd></div>}
                {run.shared_by && <div><dt>For</dt><dd>{run.shared_by}</dd></div>}
                {run.created && <div><dt>Date</dt><dd>{String(run.created).slice(0, 16)}</dd></div>}
                <div><dt>Buyer country</dt><dd>{flag(run.buyer_country)} {run.buyer_country}</dd></div>
                <div><dt>Same-item check</dt><dd>{run.gate_same_item ? 'Superlinked (gate ON)' : 'naive (gate OFF)'}</dd></div>
                <div><dt>Receipt no.</dt><dd>{run.id}</dd></div>
              </dl>
            </div>
          </div>
          {via?.amazon && <p className="r-via">Amazon item {via.amazon.asin}{via.amazon.price ? `, shown at ${eur(via.amazon.price)} on ${via.amazon.host.replace('www.', '')}` : ''}. Amazon gives an agent no way to act, so the cart is at the brand's own shop. The same item on Amazon in other countries: {via.amazon.sites.map((x, k) => <span key={x.site}>{k ? ' · ' : ''}<a href={x.url} target="_blank" rel="noreferrer">{x.site.replace('amazon.', '')}</a></span>)}</p>}
          {via && <p className="r-via">You shared {via.shared === 'product name' ? `the name “${via.query}”` : `a ${via.shared} link`}. The agent traced it to the brand's own shop, {via.brand_shop}, and ignored {via.ignored?.length ?? 0} other sellers (rule 8).</p>}
        </header>

        {(src || run.source_price || lines.length > 0) && (
          <section className="r-block">
            <h3 className="r-label">The same item, country by country</h3>
            <ul className="r-lines">
              {(src || run.source_price) && (
                <li className="r-line r-source">
                  <div className="r-line-main">
                    <span className="r-flag">{src ? oflag(src) : flagOf(run.source_store)}</span>
                    <span className="r-line-name">{src?.url ? <a href={src.url} target="_blank" rel="noreferrer">{src.store}</a> : (src?.store ?? run.source_store)}<small>Price at the shop you shared</small></span>
                    <span className="r-tag">where you were</span>
                    <span className="r-amount">{src ? money(src.landed ?? src.price, src.currency) : eur(run.source_price)}</span>
                  </div>
                  {src && <div className="r-line-sub">price {money(src.price, src.currency)}{delivery(src) ? ` · delivery ${delivery(src)}` : ''}</div>}
                </li>)}
              {lines.map((o, i) => (
                <li key={i} className={'r-line r-' + o.decision}>
                  <div className="r-line-main">
                    <span className="r-flag">{oflag(o)}</span>
                    <span className="r-line-name">{o.url ? <a href={o.url} target="_blank" rel="noreferrer">{o.store}</a> : o.store}</span>
                    <span className={'r-tag r-tag-' + o.decision}>{LINE[o.decision] ?? DEC[o.decision] ?? o.decision}</span>
                    <span className="r-amount">{money(o.landed ?? o.price, o.currency)}</span>
                  </div>
                  <div className="r-line-sub">price {money(o.price, o.currency)}{delivery(o) ? ` · delivery ${delivery(o)}` : o.ships_to_buyer === 0 ? ' · no delivery to you' : ''}{o.landed != null ? ` · total ${money(o.landed, o.currency)}` : ''}</div>
                  {o.reason && <div className="r-line-why">{o.reason}</div>}
                </li>))}
            </ul>
          </section>)}

        <section className="r-block r-totals">
          {filled && saved && (<>
            <div className="r-row"><span>You were going to pay</span><span className="r-num r-was">{eur(run.source_price)}</span></div>
            <div className="r-row"><span>You pay now<small>{flagOf(run.chosen_store)} {run.chosen_store}, delivered</small></span><span className="r-num">{eur(run.best_price)}</span></div>
            <div className="r-row r-save"><span>You save</span><span className="r-num">{eur(run.saving)}</span></div>
          </>)}
          {filled && !saved && (<>
            <div className="r-row"><span>You pay now<small>{flagOf(run.chosen_store)} {run.chosen_store}, delivered</small></span><span className="r-num">{eur(run.best_price)}</span></div>
            <div className="r-row r-save r-save-text"><span>Best brand shop for you</span><span className="r-num">{eur(run.best_price)}</span></div>
          </>)}
          {st === 'refused' && (<>
            <div className="r-close r-close-no">No switch. Buy it where you were.</div>
            {run.source_price && <div className="r-row"><span>You pay<small>{flagOf(run.source_store)} {run.source_store} is already the best deal</small></span><span className="r-num">{eur(run.source_price)}</span></div>}
            <div className="r-row"><span>You save by switching</span><span className="r-num">{eur(0)}</span></div>
          </>)}
          {st === 'waiting' && (<>
            <div className="r-close">Not yet. Watching for a price under {eur(run.target)}.</div>
            {run.best_price && <div className="r-row"><span>Best price right now</span><span className="r-num">{eur(run.best_price)}</span></div>}
            <div className="r-row"><span>Your target</span><span className="r-num">{eur(run.target)}</span></div>
          </>)}
          {st === 'running' && (<><div className="r-close">Checking the brand shops in other countries…</div><div className="r-progress"><i /></div></>)}
          {st === 'cannot_help' && (<><div className="r-close">This one is outside what the agent can do.</div><div className="r-row"><span>Cart filled</span><span className="r-num">none</span></div></>)}
          {st === 'error' && (<><div className="r-close r-close-no">The run failed.</div><div className="r-row"><span>Cart filled</span><span className="r-num">none</span></div></>)}
          {!(filled || HEAD[st]) && <div className="r-close">{st}</div>}
          {st !== 'running' && run.verdict && <p className="r-verdict">{run.verdict}</p>}
          {run.cart_url && <a className="r-cta" href={run.cart_url} target="_blank" rel="noreferrer">Open the filled cart · {eur(run.best_price)}</a>}
          {run.cart_url && <div className="r-carturl">{run.cart_url}</div>}
          {run.cart_url && <div className="r-fine">The agent fills the cart. You pay yourself.</div>}
        </section>

        {rules && (
          <section className="r-block">
            <h3 className="r-label">Signed by your rules <span className="r-tool">senso</span></h3>
            <ol className="r-rules">{ruleList.map((r) => { const x = parseRule(r); const used = x.n && String(run.verdict ?? '').includes(`Rule ${x.n} `); const onLine = !used && x.n && inLines.has(x.n) && !inVerdict.has(x.n);
              return <li key={r} className={used ? 'r-used' : onLine ? 'r-online' : ''}><span className="r-rule-n">{x.n || '·'}</span><div>{x.name && <b>{x.name}{used ? <em>applied in this decision</em> : onLine ? <em>applied to a line above</em> : null}</b>}<span>{x.text}</span></div></li>; })}</ol>
            {chunks[0] && <div className="r-fine">Read from Senso before acting. Source: “{chunks[0].title}”, content {chunks[0].content_id?.slice(0, 8)}, version {chunks[0].version_id?.slice(0, 8)}</div>}
          </section>)}
        <footer className="r-foot"><span>Thank you for not overpaying</span><span className="r-barcode" aria-hidden="true" /><span>{run.id}</span></footer>
      </div>
    </article>
  );
}

// A ready-to-send answer for the person who shared the link (Dutch, for friends back home).
function replyText(run) {
  const hi = run.shared_by ? `Hey ${run.shared_by}! ` : 'Hey! ';
  const item = run.product_title ?? 'je product';
  if (run.status === 'cart_filled' && !(Number(run.saving) > 0)) return `${hi}Mijn agent heeft alle landenwinkels van het merk zelf nagekeken voor "${item}". Beste plek om te kopen: ${run.chosen_store}, ${eur(run.best_price)} geleverd in België. Winkelmandje staat al klaar, je moet enkel nog betalen: ${run.cart_url}`;
  if (run.status === 'cart_filled') return `${hi}Mijn agent heeft je link nagekeken. "${item}" kost ${eur(run.source_price)} bij ${run.source_store}, maar bij ${run.chosen_store} (zelfde merk, zelfde product) is het ${eur(run.best_price)} geleverd in België. Dat scheelt ${eur(run.saving)}. Winkelmandje staat al klaar, je moet enkel nog betalen: ${run.cart_url}`;
  if (run.status === 'refused') return `${hi}Mijn agent heeft je link nagekeken in alle landenwinkels van het merk. "${item}" voor ${eur(run.source_price)} bij ${run.source_store} is al de beste keuze: nergens anders is het minstens 5 euro goedkoper mét levering naar België. Gewoon daar kopen dus.`;
  if (run.status === 'waiting') return `${hi}Mijn agent houdt "${item}" voor je in de gaten. Beste prijs nu is ${eur(run.best_price)}, hij vult zelf een winkelmandje zodra het onder ${eur(run.target)} zakt.`;
  if (run.status === 'cannot_help') return `${hi}Deze link kan mijn agent (nog) niet aan: hij werkt voor merken met een eigen webshop per land (UGREEN, Anker, eufy, soundcore, Shokz, xTool...), niet voor winkels zoals bol.com of Coolblue. Heb je iets van zo'n merk op het oog? Stuur maar door!`;
  return null;
}

// A readable title when the agent could not name the product: the words from the link, not the raw address.
function nice(r) {
  if (r.product_title) return r.product_title;
  const u = String(r.source_url ?? '');
  if (!/^https?:/i.test(u)) return u;
  try { const x = new URL(u); const seg = x.pathname.split('/').filter((p) => /[a-z]{3}/i.test(p)).sort((a, b) => b.length - a.length)[0] ?? ''; const words = decodeURIComponent(seg).replace(/\.html?$/, '').replace(/[-_+]/g, ' ').split(' ').slice(0, 7).join(' '); return `${words || 'Link'} (${x.hostname.replace('www.', '')})`; } catch { return u.slice(0, 70); }
}

export default function ReceiptPage() {
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState('');
  const [edit, setEdit] = useState({});
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState({ runs: [], stats: [], watches: [], totals: null });
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [open, setOpen] = useState(null);

  const loadRuns = useCallback(async () => { const d = await fetch('/api/runs').then((r) => r.json()).catch(() => null); if (d?.runs) setData(d); return d; }, []);
  useEffect(() => { const q = new URLSearchParams(location.search).get('run'); if (q) setSel(q); loadRuns().then((d) => { if (!q && d?.runs?.[0]) setSel(d.runs[0].id); }); const t = setInterval(loadRuns, 4000); return () => clearInterval(t); }, [loadRuns]);
  useEffect(() => {
    if (!sel) return; let stop = false;
    const tick = async () => { const d = await fetch('/api/runs/' + sel).then((r) => r.json()).catch(() => null); if (stop) return; if (d?.run) setDetail(d); if (!d?.run || d.run.status === 'running') setTimeout(tick, 1200); };
    setDetail(null); setOpen(null); tick(); return () => { stop = true; };
  }, [sel]);

  const share = async (gate) => {
    if (!url) return; setBusy(true);
    const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, gate, target, from }) }).then((x) => x.json());
    setBusy(false); if (r.id) { setSel(r.id); setUrl(''); setTarget(''); loadRuns(); } else alert(r.error);
  };

  const watch = async (body) => { await fetch('/api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); loadRuns(); };
  // Follow a standing order: when the agent starts a new check for the run on screen, show it.
  useEffect(() => { const cur = data.runs.find((r) => r.id === sel); if (!cur?.watch_id) return; const newest = data.runs.find((r) => r.watch_id === cur.watch_id); if (newest && newest.id !== sel) setSel(newest.id); }, [data.runs, sel]);
  const tot = data.totals;
  const run = detail?.run; const rules = run?.summary?.rules; const chunks = run?.summary?.senso_chunks ?? [];
  const offers = detail?.offers ?? []; const steps = detail?.steps ?? [];
  const countryOf = Object.fromEntries(offers.map((o) => [o.store, o.store_country]));
  const flagOf = (store) => flag(countryOf[store] ?? (/^([a-z]{2})\./.exec(store ?? '')?.[1]));
  const oflag = (o) => flag(o.store_country ?? (/^([a-z]{2})\./.exec(o.store ?? '')?.[1]));
  const same = offers.filter((o) => o.same_item).sort((a, b) => (ORDER[a.decision] ?? 9) - (ORDER[b.decision] ?? 9) || Number(a.landed ?? a.price) - Number(b.landed ?? b.price));
  const others = offers.filter((o) => !o.same_item);
  const reply = run ? replyText(run) : null;
  const usedTools = [...new Set(steps.map((s) => s.tool))];
  return (
    <div className="v3">
      <nav className="r-switch" aria-label="Design versions"><a href="/">Classic</a><a href="/v2">V2</a><a href="/v3" className="r-on">Receipt</a></nav>
      <header className="r-top">
        <div className="r-brand"><span className="r-logo" aria-hidden="true">⇄</span><h1>Country Switch</h1></div>
        <p className="r-tagline">Same brand, same product, cheaper next door. Share a link and the agent fills the cart or refuses, and shows why.</p>
        <div className="r-share">
          <input className="r-in-main" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a product link from any shop, or just name the product" onKeyDown={(e) => e.key === 'Enter' && share()} />
          <input className="r-in-small" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="buy under € (optional)" inputMode="decimal" />
          <input className="r-in-small" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="from (optional)" />
          <button className="r-go" disabled={busy} onClick={() => share()}>{busy ? 'Starting…' : target ? 'Place standing order' : 'Share link'}</button>
        </div>
        {tot && <div className="r-stats">
          <div><b>{tot.links}</b><span>links checked</span></div>
          {Number(tot.people) > 0 && <div><b>{tot.people}</b><span>{Number(tot.people) === 1 ? 'person' : 'people'} asked</span></div>}
          <div><b>{tot.helped}</b><span>cheaper next door</span></div>
          <div className="r-good"><b>{eur(tot.saved)}</b><span>found</span></div>
        </div>}
        <details className="r-more">
          <summary>Also works without this page</summary>
          <p>Any share sheet or bookmarklet can call <code>/api/run?url=…</code>. The agent runs alone and reports back here.</p>
          <p className="r-bm" dangerouslySetInnerHTML={{ __html: `On Amazon or any other shop: drag this button to your bookmarks bar and click it on a product page. Your own browser sends the page, the product name and the price you see. <a class="r-bmbtn" href="javascript:(()=>{const q=s=>document.querySelector(s);const t=((q('#productTitle')||q('h1')||{}).textContent||document.title).trim().slice(0,200);const az=/amazon\\./.test(location.hostname);const p=q('#corePrice_feature_div .a-offscreen')||q('#corePriceDisplay_desktop_feature_div .a-offscreen')||q('#apex_desktop .a-offscreen')||(az?null:(q('[itemprop=price]')||q('[data-test=price]')||q('.price')))||{};const pv=(p.textContent||p.content||'').trim();window.open('http://localhost:3311/api/run?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(t)+'&price='+encodeURIComponent(pv))})()">Send to Country Switch</a>` }} />
        </details>
      </header>
      <div className="r-layout">
        <main className="r-main">
          {!run && <div className="r-empty">{sel ? 'Loading the run…' : 'Share a product link to start a run.'}</div>}
          {run && (<>
            <Receipt run={run} same={same} flagOf={flagOf} oflag={oflag} rules={rules} chunks={chunks} />

            {reply && (<section className="r-card">
              <div className="r-card-head"><h3>Reply for {run.shared_by || 'the person who shared this'}</h3>
                <button className="r-copy" onClick={(e) => { navigator.clipboard?.writeText(reply); e.currentTarget.textContent = 'Copied'; }}>Copy</button></div>
              <div className="r-bubble">{reply}</div>
            </section>)}

            <section className="r-card">
              <div className="r-card-head"><h3>How the agent got here</h3><span className="r-toolrow">{TOOLS.filter((t) => usedTools.includes(t)).map((t) => <span key={t} className="r-tool">{t}</span>)}</span></div>
              <ol className="r-steps">{steps.map((s, si) => (
                <li key={si} className={'r-step-' + s.status + (open === si ? ' r-open' : '')} onClick={() => setOpen(open === si ? null : si)}>
                  <span className="r-step-n">{String(s.seq).padStart(2, '0')}</span>
                  <div className="r-step-body">
                    <div className="r-step-line"><span className="r-tool">{s.tool}</span><code>{s.action}</code><span className="r-ms">{s.ms} ms</span><span className="r-chev" aria-hidden="true">{open === si ? '−' : '+'}</span></div>
                    <div className="r-step-sum">{s.summary}</div>
                    {open === si && <pre onClick={(e) => e.stopPropagation()}>{JSON.stringify(s.detail, null, 2)}</pre>}
                  </div>
                </li>))}</ol>
              <div className="r-fine">Click a step to see the raw data behind it. Stored in SingleStore, mirrored to Amplitude; lessons go to Cognee.</div>
            </section>

            {run.summary?.timing && (<section className={'r-card r-timing r-' + run.summary.timing.moment}>
              <div className="r-card-head"><h3>Is this a good moment to buy?</h3><span className="r-tool">singlestore</span></div>
              <div className="r-moment">{run.summary.timing.moment === 'good' ? 'Yes, good moment.' : run.summary.timing.moment === 'wait' ? 'Not the best moment.' : 'Fair moment.'}</div>
              <div className="r-text">{run.summary.timing.why}</div>
              <PriceChart t={run.summary.timing} />
              <div className="r-fine">Price history comes from the agent's own ledger in SingleStore: every run adds an observation per shop. Tracking started on {run.summary.timing.since}.</div>
            </section>)}

            {run.summary?.past_decisions?.length > 0 && (<section className="r-card">
              <div className="r-card-head"><h3>Decision memory in Senso: this item came up before</h3><span className="r-tool">senso</span></div>
              {run.summary.past_decisions.slice(0, 3).map((d) => <div className="r-memo" key={d.content_id}>{d.text}<small>{d.title} · Senso document {String(d.content_id).slice(0, 8)}</small></div>)}
            </section>)}

            {others.length > 0 && (<details className="r-fold">
              <summary><b>{others.length}</b> other {others.length === 1 ? 'listing was' : 'listings were'} not the same item (bundles, other models)</summary>
              <ul className="r-others">{others.map((o, i) => (
                <li key={i}><span className="r-flag">{oflag(o)}</span><div>{o.url ? <a href={o.url} target="_blank" rel="noreferrer">{o.title}</a> : <span className="r-others-t">{o.title}</span>}<small>{o.store} · {money(o.price, o.currency)}{o.same_item_score != null ? ` · match ${Number(o.same_item_score).toFixed(2)}` : ''}</small><small>{o.reason}</small></div></li>))}</ul>
            </details>)}
            {offers.length > 0 && (<details className="r-fold">
              <summary>Show all {offers.length} offers as a table</summary>
              <div className="r-scroll"><table className="r-table"><thead><tr><th>Shop</th><th>Listing</th><th>SKU</th><th>Price</th><th>Delivery</th><th>Total</th><th>Same item</th><th>Ships to you</th><th>Decision</th></tr></thead>
                <tbody>{offers.map((o, i) => (
                  <tr key={i} className={o.decision === 'chosen' ? 'r-tr-chosen' : o.decision === 'refused' ? 'r-tr-refused' : o.decision === 'not_same_item' || o.decision === 'not_needed' || o.decision === 'not_cheaper' ? 'r-tr-dim' : ''}>
                    <td>{o.store}</td><td>{o.url ? <a href={o.url} target="_blank" rel="noreferrer">{o.title}</a> : o.title}</td><td className="r-td-num">{o.sku}</td><td className="r-td-num">{eur(o.price)}</td><td className="r-td-num" title={o.ship_method ?? ''}>{delivery(o)}</td><td className="r-td-num">{o.landed == null ? '' : eur(o.landed)}</td>
                    <td>{o.same_item ? 'yes' : 'no'}{o.same_item_score != null ? ` (${Number(o.same_item_score).toFixed(2)})` : ''}</td><td>{o.ships_to_buyer == null ? '' : o.ships_to_buyer ? 'yes' : 'no'}</td>
                    <td><b>{DEC[o.decision] ?? o.decision}</b><br /><span style={{ fontWeight: 400 }}>{o.reason}</span></td>
                  </tr>))}</tbody></table></div>
            </details>)}
          </>)}
        </main>
        <aside className="r-side">
          {data.watches?.length > 0 && (<section className="r-panel">
            <h3>Standing orders</h3><div className="r-sub">The agent keeps watching</div>
            <ul className="r-runs">{data.watches.map((w) => (
              <li key={w.id} className={w.last_run_id === sel ? 'r-on' : ''} onClick={() => w.last_run_id && setSel(w.last_run_id)}>
                <div className="r-run-t">{nice(w)}</div>
                <div className="r-run-s"><span>buy under {eur(w.target)}{w.last_best ? ` · now ${eur(w.last_best)} at ${w.last_store}` : ''}</span><span className={'r-badge ' + (w.status === 'triggered' ? 'r-b-ok' : 'r-b-run')}><i />{w.status === 'triggered' ? 'cart filled' : 'watching'}</span></div>
                <div className="r-run-s" onClick={(e) => e.stopPropagation()}><span>{w.checks} checks{w.shared_by ? ` · for ${w.shared_by}` : ''}</span>
                  <span className="r-mini"><input value={edit[w.id] ?? ''} onChange={(e) => setEdit({ ...edit, [w.id]: e.target.value })} placeholder="new €" /><button onClick={() => edit[w.id] && watch({ id: w.id, target: edit[w.id] }).then(() => setEdit({ ...edit, [w.id]: '' }))}>set</button><button onClick={() => watch({ id: w.id, stop: true })}>stop</button></span></div>
              </li>))}</ul>
          </section>)}
          <section className="r-panel">
            <h3>Runs</h3><div className="r-sub">Every receipt, newest first</div>
            <ul className="r-runs r-scrolly">
              {data.runs.map((r) => (
                <li key={r.id} className={r.id === sel ? 'r-on' : ''} onClick={() => setSel(r.id)}>
                  <div className="r-run-t">{nice(r)}</div>
                  <div className="r-run-s"><span>{r.shared_by ? r.shared_by + ' · ' : ''}{r.source_store} {r.status === 'cart_filled' ? `→ ${r.chosen_store}` : ''}</span><span className={'r-badge r-b-' + CLS[r.status] + (r.status === 'running' ? ' r-live' : '')}><i />{LABEL[r.status] ?? r.status}{r.status === 'cart_filled' ? ' −' + eur(r.saving) : ''}</span></div>
                </li>
              ))}
            </ul>
          </section>
          <section className="r-panel">
            <h3>The loop</h3><div className="r-sub">Same-item check on or off</div>
            <table className="r-table r-loop"><thead><tr><th>Check</th><th>Runs</th><th>Carts</th><th>Wrong item</th><th>Saved</th></tr></thead>
              <tbody>{data.stats.map((s) => <tr key={s.check_mode}><td><span className="r-tool">{s.check_mode}</span></td><td className="r-td-num">{s.runs}</td><td className="r-td-num">{s.carts}</td><td className="r-td-num" style={{ color: Number(s.wrong_item) ? '#b42318' : undefined, fontWeight: Number(s.wrong_item) ? 700 : undefined }}>{s.wrong_item}</td><td className="r-td-num">{eur(s.honest_saving)}</td></tr>)}</tbody></table>
            <div className="r-fine">Live SQL on the SingleStore ledger. The check sits behind a Statsig gate; each run is a session in Amplitude.</div>
          </section>
        </aside>
      </div>
    </div>
  );
}
